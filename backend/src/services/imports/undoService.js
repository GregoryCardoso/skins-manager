'use strict';

// Desfazer importação (D302, D318 seção 9). Só o último lote que mudou algo. Itens criados pelo lote são excluídos; os lançamentos
// manuais ligados só são desligados (nunca apagados). Regra de negócio aqui; os models só fazem SQL.
const ImportBatch = require('../../models/ImportBatch');
const ImportBatchEntry = require('../../models/ImportBatchEntry');
const ExternalLink = require('../../models/ExternalLink');
const ExternalRecord = require('../../models/ExternalRecord');
const Integration = require('../../models/Integration');
const Item = require('../../models/Item');
const { runInTransaction } = require('../../models/modelHelpers');
const { NotFoundError, ConflictError } = require('../../errors/AppError');
const importLock = require('./importLock');

const SOURCE = 'CSFLOAT';

// Função pura. `links`: vínculos do lote; `itemsById`: Map id -> item. Só os itens CRIADOS pelo lote contam.
// Bloqueio: o item criado foi vendido no app. Avisos: editado depois da importação, ou movido para o holding.
function assessUndo(links, itemsById) {
  const blockers = [];
  const warnings = [];
  let itemsToDelete = 0;
  let linksToRemove = 0;
  for (const link of links) {
    if (link.linkKind !== 'CREATED' || link.entityType !== 'ITEM_PURCHASE') {
      linksToRemove += 1;
      continue;
    }
    itemsToDelete += 1;
    const item = itemsById.get(link.entityId);
    if (!item) continue;
    const base = { itemId: item.id, name: item.name };
    if (item.status === 'VENDIDO') blockers.push({ code: 'ITEM_SOLD_IN_APP', ...base });
    if (item.updatedAt !== link.entityUpdatedAt) warnings.push({ code: 'ITEM_EDITED', ...base });
    if (item.offSaleAt) warnings.push({ code: 'ITEM_IN_HOLDING', ...base });
  }
  return { blockers, warnings, counts: { itemsToDelete, linksToRemove } };
}

const hasChanges = (batch) =>
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
    if (link.entityType !== 'ITEM_PURCHASE' || itemsById.has(link.entityId)) continue;
    const item = Item.findById(link.entityId);
    if (item) itemsById.set(item.id, item);
  }
  return itemsById;
}

// Pré-visualização: { undoable, reason, blockers, warnings, counts }.
function preview(batchId, { source = SOURCE } = {}) {
  const batch = findBatchOrFail(batchId);
  const reason = undoReason(batch, ImportBatch.findLatestUndoable(source));
  if (reason) return { undoable: false, reason, blockers: [], warnings: [], counts: { itemsToDelete: 0, linksToRemove: 0 } };
  const links = ExternalLink.listByBatch(batchId);
  const assessed = assessUndo(links, loadItems(links));
  return { undoable: assessed.blockers.length === 0, reason: null, ...assessed };
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
      const links = ExternalLink.listByBatch(batchId);
      const { blockers, warnings } = assessUndo(links, loadItems(links));
      if (blockers.length) {
        throw new ConflictError('Há itens vendidos no app depois da importação. Desfaça a venda deles antes.', 'IMPORT_UNDO_CONFLICT', {
          params: { items: blockers },
        });
      }
      if (warnings.length && confirmWarnings !== true) {
        throw new ConflictError('Confirme os avisos para desfazer a importação.', 'IMPORT_UNDO_WARNINGS_NOT_CONFIRMED', { params: { warnings } });
      }

      // Itens criados pelo lote são excluídos; os ligados só perdem o vínculo. O registro de cada vínculo volta a ser reavaliado.
      for (const link of links) {
        if (link.linkKind === 'CREATED' && link.entityType === 'ITEM_PURCHASE') Item.remove(link.entityId);
        ExternalRecord.update(link.recordId, { tracking: 'WAITING_TRANSFER' }, { now });
      }
      ExternalLink.removeByBatch(batchId);

      const restart = ImportBatch.countDoneWithChanges(source, { excludeId: batchId }) === 0;
      if (restart) {
        // Nenhum lançamento ligado sobrou: recomeço completo (o corte volta a ser perguntado e tudo volta a ser "novo").
        ImportBatchEntry.resolveAllOpen('UNDONE', { now });
        ExternalRecord.deleteAllForSource(source);
        Integration.update(
          source,
          { tradesCutoffAt: null, lastTransactionId: null, lastImportAt: null, lastImportStatus: null, lastImportErrorCode: null, autoImportPaused: true },
          { now }
        );
      } else {
        ImportBatchEntry.resolveOpenForBatch(batchId, 'UNDONE', { now });
        ImportBatchEntry.resolveOpenForRecordsOfBatch(batchId, 'UNDONE', { now });
        ExternalRecord.deleteByFirstBatch(batchId);
        Integration.update(source, { lastTransactionId: batch.previousTransactionCursor, autoImportPaused: true }, { now });
      }
      return ImportBatch.update(batchId, { status: 'UNDONE', undoneAt: now.toISOString() });
    });
  } finally {
    release();
  }
}

module.exports = { assessUndo, undoReason, preview, undo };
