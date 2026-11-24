'use strict';

// Desfazer importação (D302, D318 seção 9). Só o último lote que mudou algo. Itens criados pelo lote são excluídos; vendas criadas
// pelo lote em itens que já existiam são desfeitas (o item volta ao estoque ou ao holding); os lançamentos manuais ligados só são
// desligados (nunca apagados). Regra de negócio aqui; os models só fazem SQL.
const ImportBatch = require('../../models/ImportBatch');
const ImportBatchEntry = require('../../models/ImportBatchEntry');
const ExternalLink = require('../../models/ExternalLink');
const ExternalRecord = require('../../models/ExternalRecord');
const Integration = require('../../models/Integration');
const Item = require('../../models/Item');
const Deposit = require('../../models/Deposit');
const Withdrawal = require('../../models/Withdrawal');
const { runInTransaction } = require('../../models/modelHelpers');
const { NotFoundError, ConflictError } = require('../../errors/AppError');
const importLock = require('./importLock');
const { buildUnsellPatch } = require('../itemService');

const SOURCE = 'CSFLOAT';

const isCreated = (link, entityType) => link.linkKind === 'CREATED' && link.entityType === entityType;
const isTransfer = (link) => link.entityType === 'DEPOSIT' || link.entityType === 'WITHDRAWAL';

// Função pura. `links`: vínculos do lote; `itemsById`: Map id -> item.
// - Compra criada: o item será excluído. Bloqueio: vendido no app fora deste lote. Avisos: editado depois da importação, ou no holding.
// - Venda criada num item que já existia: a venda será desfeita. Aviso: editado depois da importação.
// - Vínculo com lançamento manual (MATCHED): só é desligado.
// "Editado" compara com o vínculo mais recente do lote para o item (compra e venda do mesmo item no mesmo lote).
function assessUndo(links, itemsById) {
  const blockers = [];
  const warnings = [];
  let itemsToDelete = 0;
  let linksToRemove = 0;
  let salesToUndo = 0;
  let transfersToDelete = 0;
  const createdItems = new Set(links.filter((l) => isCreated(l, 'ITEM_PURCHASE')).map((l) => l.entityId));
  const soldByBatch = new Set(links.filter((l) => isCreated(l, 'ITEM_SALE')).map((l) => l.entityId));
  const stampOf = new Map();
  for (const link of links) {
    const previous = stampOf.get(link.entityId);
    if (link.entityType.startsWith('ITEM_') && (!previous || Date.parse(link.entityUpdatedAt) > Date.parse(previous))) stampOf.set(link.entityId, link.entityUpdatedAt);
  }
  for (const link of links) {
    if (link.linkKind !== 'CREATED') {
      linksToRemove += 1;
      continue;
    }
    const item = itemsById.get(link.entityId);
    const base = item ? { itemId: item.id, name: item.name } : null;
    if (link.entityType === 'ITEM_PURCHASE') {
      itemsToDelete += 1;
      if (!item) continue;
      if (item.status === 'VENDIDO' && !soldByBatch.has(item.id)) blockers.push({ code: 'ITEM_SOLD_IN_APP', ...base });
      if (item.updatedAt !== stampOf.get(item.id)) warnings.push({ code: 'ITEM_EDITED', ...base });
      if (item.offSaleAt) warnings.push({ code: 'ITEM_IN_HOLDING', ...base });
      continue;
    }
    if (link.entityType === 'ITEM_SALE') {
      if (createdItems.has(link.entityId)) continue; // o item inteiro sai junto com a compra
      salesToUndo += 1;
      if (item && item.updatedAt !== link.entityUpdatedAt) warnings.push({ code: 'ITEM_EDITED', ...base });
      continue;
    }
    // Aporte ou saque criado pelo lote (9.6): é excluído.
    if (isTransfer(link)) {
      transfersToDelete += 1;
      continue;
    }
    linksToRemove += 1;
  }
  return { blockers, warnings, counts: { itemsToDelete, linksToRemove, salesToUndo, transfersToDelete } };
}

const hasChanges = (batch) => ExternalLink.listByBatch(batch.id).length > 0 ||
  batch.purchasesCreated + batch.matchedCount + batch.salesCreated + batch.depositsCreated + batch.withdrawalsCreated > 0;

// Motivo de o lote não poder ser desfeito (ou null).
function undoReason(batch, latest) {
  if (batch.status === 'UNDONE') return 'ALREADY_UNDONE';
  if (batch.status === 'FAILED') return 'FAILED_BATCH';
  if (!hasChanges(batch)) return 'NOTHING_TO_UNDO';
  if (!latest || latest.id !== batch.id) return 'NOT_LATEST';
  return null;
}

function findBatchOrFail(batchId) {
  const batch = ImportBatch.findById(batchId);
  if (!batch) throw new NotFoundError('Importação não encontrada.', 'IMPORT_BATCH_NOT_FOUND');
  return batch;
}

function loadItems(links) {
  const itemsById = new Map();
  for (const link of links) {
    if (!link.entityType.startsWith('ITEM_') || itemsById.has(link.entityId)) continue;
    const item = Item.findById(link.entityId);
    if (item) itemsById.set(item.id, item);
  }
  return itemsById;
}

// Aviso ENTRY_RESOLVED (9.4, D302): pendências do lote que o usuário já resolveu (remover, manter, criar, ligar, ignorar). Desfazer
// o lote apaga os registros dele, e essas decisões se perdem.
function resolvedEntryWarnings(batchId) {
  return ImportBatchEntry.listResolvedOpenTypeByBatch(batchId).map((entry) => {
    const display = parseJson(entry.displayJson);
    return { code: 'ENTRY_RESOLVED', itemId: entry.entityId ?? null, name: display.marketHashName ?? null, entryId: entry.id };
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text) || {};
  } catch (err) {
    return {};
  }
}

function assessBatch(batchId) {
  const links = ExternalLink.listByBatch(batchId);
  const assessed = assessUndo(links, loadItems(links));
  return { ...assessed, warnings: [...assessed.warnings, ...resolvedEntryWarnings(batchId)], links };
}

// Pré-visualização: { undoable, reason, blockers, warnings, counts }.
function preview(batchId, { source = SOURCE } = {}) {
  const batch = findBatchOrFail(batchId);
  const reason = undoReason(batch, ImportBatch.findLatestUndoable(source));
  if (reason) return { undoable: false, reason, blockers: [], warnings: [], counts: { itemsToDelete: 0, linksToRemove: 0, salesToUndo: 0, transfersToDelete: 0 } };
  const { blockers, warnings, counts } = assessBatch(batchId);
  return { undoable: blockers.length === 0, reason: null, blockers, warnings, counts };
}

// Desfaz o lote. Sob a trava da importação; tudo numa transação (qualquer falha volta tudo).
function undo(batchId, { confirmWarnings = false, now = new Date(), source = SOURCE } = {}) {
  const release = importLock.acquire();
  try {
    return runInTransaction(() => {
      const batch = findBatchOrFail(batchId);
      const reason = undoReason(batch, ImportBatch.findLatestUndoable(source));
      if (reason) {
        throw new ConflictError('Só a última importação que mudou algo pode ser desfeita.', 'IMPORT_UNDO_NOT_LATEST', { params: { reason } });
      }
      const { blockers, warnings, links } = assessBatch(batchId);
      if (blockers.length) {
        throw new ConflictError('Há itens vendidos no app depois da importação. Desfaça a venda deles antes.', 'IMPORT_UNDO_CONFLICT', {
          params: { items: blockers },
        });
      }
      if (warnings.length && confirmWarnings !== true) {
        throw new ConflictError('Confirme os avisos para desfazer a importação.', 'IMPORT_UNDO_WARNINGS_NOT_CONFIRMED', { params: { warnings } });
      }

      // Itens criados pelo lote são excluídos; vendas criadas em itens que já existiam são desfeitas (como "desfazer a venda", que
      // também limpa a liberação real); os ligados só perdem o vínculo. O registro de cada vínculo volta a ser reavaliado.
      const createdItems = new Set(links.filter((l) => isCreated(l, 'ITEM_PURCHASE')).map((l) => l.entityId));
      for (const link of links) {
        if (isCreated(link, 'ITEM_SALE') && !createdItems.has(link.entityId)) Item.update(link.entityId, buildUnsellPatch(), { now });
        if (isCreated(link, 'ITEM_PURCHASE')) Item.remove(link.entityId);
        // Aportes e saques criados pelo lote (9.6) são excluídos; o registro do extrato volta a "visto".
        if (isCreated(link, 'DEPOSIT')) Deposit.remove(link.entityId);
        if (isCreated(link, 'WITHDRAWAL')) Withdrawal.remove(link.entityId);
        ExternalRecord.update(link.recordId, { tracking: isTransfer(link) ? 'SEEN' : 'WAITING_TRANSFER' }, { now });
      }
      ExternalLink.removeByBatch(batchId);

      const restart = ImportBatch.countDoneWithChanges(source, { excludeId: batchId }) === 0;
      if (restart) {
        // Nenhum lançamento ligado sobrou: recomeço completo (o corte volta a ser perguntado e tudo volta a ser "novo").
        ImportBatchEntry.resolveAllOpen('UNDONE', { now });
        ExternalRecord.deleteAllForSource(source);
        Integration.update(
          source,
          {
            tradesCutoffAt: null, transactionsCutoffAt: null, lastTransactionId: null, lastImportAt: null, lastImportStatus: null,
            lastImportErrorCode: null, autoImportPaused: true,
          },
          { now }
        );
      } else {
        ImportBatchEntry.resolveOpenForBatch(batchId, 'UNDONE', { now });
        ImportBatchEntry.resolveOpenForRecordsOfBatch(batchId, 'UNDONE', { now });
        ExternalRecord.deleteByFirstBatch(batchId);
        Integration.update(source, { lastTransactionId: batch.previousTransactionCursor, autoImportPaused: true }, { now });
        // O lote mudou a data de corte (9.5.1c, D326): volta o corte anterior, e os trades sem vínculo voltam ao lado certo dele.
        if (batch.previousTradesCutoffAt) {
          Integration.update(source, { tradesCutoffAt: batch.previousTradesCutoffAt }, { now });
          for (const id of ExternalRecord.restoreCutoffTrackings(source, batch.previousTradesCutoffAt, { now })) {
            ImportBatchEntry.resolveOpenForRecord(id, 'UNDONE', { now });
          }
        }
        // Uma só data de corte (Revisão 28): os aportes e saques sem vínculo voltam ao lado certo do corte atual (o restaurado).
        // Lotes antigos que mudaram o corte próprio dos aportes também caem aqui: esse corte não vale mais.
        const currentCutoff = Integration.get(source).tradesCutoffAt;
        if (currentCutoff) {
          for (const id of ExternalRecord.closeTransfersBefore(source, currentCutoff, { now })) ImportBatchEntry.resolveOpenForRecord(id, 'UNDONE', { now });
          ExternalRecord.reopenTransfersFrom(source, currentCutoff, { now });
        }
      }
      return ImportBatch.update(batchId, { status: 'UNDONE', undoneAt: now.toISOString() });
    });
  } finally {
    release();
  }
}

module.exports = { assessUndo, undoReason, preview, undo };
