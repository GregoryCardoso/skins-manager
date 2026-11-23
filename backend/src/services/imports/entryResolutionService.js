'use strict';

// Resolução das pendências da importação (9.4, D301, E9-Q22): "Remover lançamento" e "Manter" (trade revertido); "Criar mesmo
// assim", "Ligar a este lançamento" e "Ignorar" (possível duplicado); "Ignorar" (falhas e estado desconhecido). Nada é apagado
// sozinho: só esta ação do usuário remove um lançamento. Roda sob a mesma trava da importação (D303) e numa transação.
const ImportBatchEntry = require('../../models/ImportBatchEntry');
const ExternalRecord = require('../../models/ExternalRecord');
const ExternalLink = require('../../models/ExternalLink');
const Integration = require('../../models/Integration');
const Item = require('../../models/Item');
const Store = require('../../models/Store');
const { runInTransaction } = require('../../models/modelHelpers');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors/AppError');
const itemService = require('../itemService');
const catalogService = require('../catalogService');
const backupService = require('../backupService');
const { normalizeSearchText } = require('../catalog/csgoApiAdapter');
const importLock = require('./importLock');
const importViews = require('./importViews');
const tradeClassifier = require('./tradeClassifier');
const externalItemMapper = require('./externalItemMapper');
const manualMatchService = require('./manualMatchService');
const { saleMoment, saleReleaseOf, saleCreditOf } = require('./saleImportHelpers');

const SOURCE = 'CSFLOAT';

// Ações permitidas por resultado da entrada.
const ACTIONS_BY_OUTCOME = Object.freeze({
  REVERTED: Object.freeze(['REMOVE', 'KEEP']),
  POSSIBLE_DUPLICATE: Object.freeze(['CREATE', 'LINK', 'IGNORE']),
  FAILED: Object.freeze(['IGNORE']),
  UNKNOWN_STATE: Object.freeze(['IGNORE']),
});

const conflict = (message, reason, params = {}) => new ConflictError(message, 'IMPORT_ENTRY_CONFLICT', { params: { reason, ...params } });

// Função pura: a ação vale para a entrada? Devolve o código do erro (ou null).
function checkAction(entry, action) {
  if (entry.resolution !== null && entry.resolution !== undefined) return 'IMPORT_ENTRY_ALREADY_RESOLVED';
  const allowed = ACTIONS_BY_OUTCOME[entry.outcome];
  if (!allowed || !allowed.includes(action)) return 'IMPORT_ENTRY_ACTION_NOT_ALLOWED';
  return null;
}

function loadStore() {
  const row = Integration.get(SOURCE);
  const store = row && row.storeId ? Store.findById(row.storeId) : null;
  if (!store) throw new ConflictError('Crie, em Lojas, uma loja em US$ chamada "CSFloat".', 'IMPORT_STORE_REQUIRED');
  return store;
}

// O registro como "trade" para as regras de acompanhamento (D294).
const tradeOfRecord = (record) => ({
  rawState: record.rawState, protectionEndsAt: record.protectionEndsAt, verifySaleAt: record.verifySaleAt, acceptedAt: record.acceptedAt,
  soldAt: record.soldAt, createdAt: record.externalCreatedAt, priceCents: record.amountCents, contractId: record.contractId,
});

// Item do catálogo (ou nome livre) guardado no `display_json` da entrada, no formato do `externalItemMapper`.
function mappedOfDisplay(display) {
  const catalogEntry = display.catalogId ? catalogService.getCatalogItemsByIds([display.catalogId])[0] || null : null;
  if (display.catalogId && !catalogEntry) throw conflict('O item não está mais no catálogo. Atualize o catálogo e tente de novo.', 'CATALOG_NOT_FOUND');
  const category = catalogEntry ? catalogEntry.category : display.category;
  return {
    catalogEntry,
    category,
    name: catalogEntry ? catalogEntry.name : display.marketHashName,
    variant: display.variant ?? null,
    floatValue: display.floatValue ?? null,
    paintSeed: display.paintSeed ?? null,
    phase: catalogEntry && catalogEntry.phase ? null : display.phase ?? null,
  };
}

function linkRecord(record, entityType, item, linkKind, batchId, { now }) {
  ExternalLink.create({ recordId: record.id, entityType, entityId: item.id, linkKind, batchId, entityUpdatedAt: item.updatedAt }, { now });
  ExternalRecord.update(record.id, { tracking: tradeClassifier.settleTracking(tradeOfRecord(record), now) }, { now });
}

function requireRecord(entry) {
  const record = entry.recordId ? ExternalRecord.findById(entry.recordId) : null;
  if (!record) throw conflict('O registro do CSFloat desta pendência não existe mais.', 'RECORD_NOT_FOUND');
  if (ExternalLink.findByRecordId(record.id)) throw conflict('Este trade já está ligado a um lançamento.', 'ALREADY_LINKED');
  return record;
}

// --- Trade revertido ---------------------------------------------------------------------------------------------------

// "Remover lançamento": venda revertida -> desfaz a venda (o item volta ao estoque/holding); compra revertida -> exclui o item, mas
// só se ele ainda não foi vendido no app (E9-Q22). Vale também para o lançamento manual ligado (o modal avisa).
function removeLaunch(entry, { now }) {
  const record = entry.recordId ? ExternalRecord.findById(entry.recordId) : null;
  const link = record ? ExternalLink.findByRecordId(record.id) : null;
  if (!link) {
    // O lançamento já saiu (ex.: excluído à mão): só fecha a pendência.
    if (record) ExternalRecord.update(record.id, { tracking: 'REMOVED_IN_APP' }, { now });
    return;
  }
  const item = Item.findById(link.entityId);
  if (link.entityType === 'ITEM_SALE') {
    if (item && item.status === 'VENDIDO') itemService.unsellItem(item.id, { now });
    return;
  }
  if (link.entityType === 'ITEM_PURCHASE') {
    if (item && item.status === 'VENDIDO') {
      throw conflict(
        'Este item já foi vendido no app depois da compra. Desfaça a venda dele antes de remover a compra revertida.',
        'ITEM_SOLD_IN_APP', { itemId: item.id }
      );
    }
    if (item) itemService.deleteItem(item.id, { now });
  }
}

function keepLaunch(entry, { now }) {
  if (entry.recordId) ExternalRecord.update(entry.recordId, { tracking: 'SETTLED' }, { now });
}

// --- Possível duplicado ------------------------------------------------------------------------------------------------

function sellImported(record, item, store, { now }) {
  const credit = saleCreditOf(tradeOfRecord(record));
  if (credit.missing) throw conflict('O extrato do CSFloat ainda não trouxe o crédito desta venda. Importe de novo mais tarde.', 'SALE_TX_NOT_FOUND');
  if (credit.inconsistent) throw conflict('O crédito da venda no extrato não bate com o preço menos a taxa.', 'FEE_INCONSISTENT');
  itemService.sellItem(
    item.id,
    { saleStoreId: store.id, salePriceCents: record.amountCents, soldAt: saleMoment(tradeOfRecord(record)), netReceivedCents: credit.netCents },
    { now, saleReleaseAt: saleReleaseOf(record.contractId, record.verifySaleAt) }
  );
  return Item.findById(item.id);
}

// "Criar mesmo assim": como se não houvesse candidato. Compra -> cria o item; venda -> escolhe a unidade em estoque.
function createLaunch(entry, display, { now }) {
  const record = requireRecord(entry);
  const store = loadStore();
  const mapped = mappedOfDisplay(display);
  if (record.direction === 'BUY') {
    const created = itemService.createItem(externalItemMapper.buildPurchaseInput(tradeOfRecord(record), mapped, { storeId: store.id }), { now });
    linkRecord(record, 'ITEM_PURCHASE', Item.findById(created.id), 'CREATED', entry.batchId, { now });
    return 'CREATED';
  }
  const pick = manualMatchService.pickSoldUnit(
    {
      catalogId: mapped.catalogEntry ? mapped.catalogEntry.id : null, category: mapped.category, nameKey: normalizeSearchText(mapped.name),
      variant: mapped.variant, phase: (mapped.catalogEntry && mapped.catalogEntry.phase) || mapped.phase, floatValue: mapped.floatValue,
      paintSeed: mapped.paintSeed, date: saleMoment(tradeOfRecord(record)),
    },
    Item.findInStockByCatalogOrCategory({ catalogId: mapped.catalogEntry ? mapped.catalogEntry.id : null, category: mapped.category })
  );
  if (pick.kind === 'NONE') throw conflict('Não há unidade deste item em estoque no app. Lance a compra antes.', 'PURCHASE_NOT_FOUND');
  if (pick.kind === 'AMBIGUOUS') throw conflict('Há mais de uma unidade igual em estoque: escolha uma em "Ligar".', 'CHOOSE_UNIT');
  const sold = sellImported(record, Item.findById(pick.itemId), store, { now });
  linkRecord(record, 'ITEM_SALE', sold, 'CREATED', entry.batchId, { now });
  return 'CREATED';
}

// "Ligar a este lançamento": um dos candidatos da entrada. Compra -> liga à compra manual. Venda -> liga à venda manual já
// lançada ou, se o candidato é uma unidade em estoque, registra a venda nela.
function linkLaunch(entry, targetId, { now }) {
  const candidates = importViews.parseJson(entry.candidateIds, []);
  if (!candidates.includes(targetId)) {
    throw new ValidationError('Escolha um dos lançamentos sugeridos.', 'IMPORT_ENTRY_ACTION_NOT_ALLOWED', { field: 'targetId' });
  }
  const record = requireRecord(entry);
  const store = loadStore();
  const item = Item.findById(targetId);
  if (!item) throw new NotFoundError('Item não encontrado.', 'ITEM_NOT_FOUND');
  if (record.direction === 'BUY') {
    if (ExternalLink.findByEntity('ITEM_PURCHASE', item.id)) throw conflict('Este lançamento já está ligado a outra compra do CSFloat.', 'TARGET_ALREADY_LINKED');
    linkRecord(record, 'ITEM_PURCHASE', item, 'MATCHED', entry.batchId, { now });
    return 'LINKED';
  }
  if (item.status === 'VENDIDO') {
    if (ExternalLink.findByEntity('ITEM_SALE', item.id)) throw conflict('Esta venda já está ligada a outra venda do CSFloat.', 'TARGET_ALREADY_LINKED');
    linkRecord(record, 'ITEM_SALE', item, 'MATCHED', entry.batchId, { now });
    return 'LINKED';
  }
  const sold = sellImported(record, item, store, { now });
  linkRecord(record, 'ITEM_SALE', sold, 'CREATED', entry.batchId, { now });
  return 'LINKED';
}

function ignoreEntry(entry, { now }) {
  if (entry.recordId && ExternalRecord.findById(entry.recordId)) ExternalRecord.update(entry.recordId, { tracking: 'IGNORED' }, { now });
}

// --- Entrada ------------------------------------------------------------------------------------------------------------

// Resolve a pendência. Devolve a entrada atualizada (crua; a visão é montada por quem chama).
function resolveEntry(entryId, { action, targetId = null } = {}, { now = new Date() } = {}) {
  // A trava da importação também conta como "ocupado" para o backup: confere o backup antes de pegá-la.
  importLock.assertIdle();
  if (backupService.isBackupBusy()) {
    throw new ConflictError('Há uma operação em andamento (catálogo, cotação ou backup). Aguarde terminar e tente de novo.', 'BACKUP_BUSY');
  }
  const release = importLock.acquire();
  try {
    return runInTransaction(() => {
      const entry = ImportBatchEntry.findById(entryId);
      if (!entry) throw new NotFoundError('Pendência não encontrada.', 'IMPORT_ENTRY_NOT_FOUND');
      const problem = checkAction(entry, action);
      if (problem === 'IMPORT_ENTRY_ALREADY_RESOLVED') throw new ConflictError('Esta pendência já foi resolvida.', problem);
      if (problem) throw new ValidationError('Esta ação não vale para esta pendência.', problem, { field: 'action' });
      const display = importViews.parseJson(entry.displayJson, {});

      let resolution;
      if (action === 'REMOVE') {
        removeLaunch(entry, { now });
        resolution = 'REMOVED';
      } else if (action === 'KEEP') {
        keepLaunch(entry, { now });
        resolution = 'KEPT';
      } else if (action === 'CREATE') {
        resolution = createLaunch(entry, display, { now });
      } else if (action === 'LINK') {
        resolution = linkLaunch(entry, targetId, { now });
      } else {
        ignoreEntry(entry, { now });
        resolution = 'IGNORED';
      }
      // Esta entrada e as outras pendências abertas do mesmo registro ficam resolvidas juntas.
      ImportBatchEntry.resolve(entry.id, resolution, { now });
      if (entry.recordId) ImportBatchEntry.resolveOpenForRecord(entry.recordId, resolution, { now });
      return ImportBatchEntry.findById(entry.id);
    });
  } finally {
    release();
  }
}

module.exports = { ACTIONS_BY_OUTCOME, checkAction, resolveEntry };
