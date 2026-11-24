'use strict';

// Resolução das pendências da importação (9.4, D301, E9-Q22; 9.5.1b, D327 a D331): "Remover lançamento" e "Manter" (trade
// revertido); "Criar mesmo assim", "Ligar a este lançamento" e "Ignorar" (possível duplicado); "Lançar compra", "Foi drop" e
// "Ignorar" (venda sem compra no app); "Ignorar" (outras falhas e estado desconhecido); "Voltar para pendências" (ignoradas) e as
// ações em lote. Nada é apagado sozinho: só a ação do usuário remove um lançamento. Roda sob a trava da importação (D303), numa
// transação.
const ImportBatchEntry = require('../../models/ImportBatchEntry');
const ExternalRecord = require('../../models/ExternalRecord');
const ExternalLink = require('../../models/ExternalLink');
const Integration = require('../../models/Integration');
const Item = require('../../models/Item');
const { runInTransaction } = require('../../models/modelHelpers');
const { AppError, NotFoundError, ConflictError, ValidationError } = require('../../errors/AppError');
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
const transferImport = require('./transferImport');
const { requireImportStore } = require('./importStore');
const Deposit = require('../../models/Deposit');
const Withdrawal = require('../../models/Withdrawal');
const { openActionsFor, RESERVED_ACTIONS } = require('./entryActions');
const { isWeaponCategory } = require('../itemAttributesService');
const { parseDate, formatDateTimeBr } = require('../dateUtils');

const SOURCE = 'CSFLOAT';

const MAX_BULK = 200;
// Tracking do registro ao voltar para as pendências (D329), pelo resultado da entrada.
const REOPEN_TRACKING = Object.freeze({ POSSIBLE_DUPLICATE: 'NEEDS_REVIEW', FAILED: 'RETRY', UNKNOWN_STATE: 'UNKNOWN_STATE' });

const conflict = (message, reason, params = {}) => new ConflictError(message, 'IMPORT_ENTRY_CONFLICT', { params: { reason, ...params } });

// Função pura: a ação vale para a entrada? Devolve o código do erro (ou null). As reservadas (SPLIT_FROM_ITEM) nunca valem ainda.
function checkAction(entry, action) {
  if (entry.resolution !== null && entry.resolution !== undefined) return 'IMPORT_ENTRY_ALREADY_RESOLVED';
  if (RESERVED_ACTIONS.includes(action) || !openActionsFor(entry).includes(action)) return 'IMPORT_ENTRY_ACTION_NOT_ALLOWED';
  return null;
}

function loadStore() {
  return requireImportStore(Integration.get(SOURCE));
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
// Aporte ou saque do extrato (9.6): "Criar mesmo assim" cria o lançamento; "Ligar" liga a um aporte/saque manual sugerido.
function createTransferLaunchInBatch(entry, record, { now }) {
  const transfer = transferImport.transferOf(record);
  if (transfer.error) throw conflict('Os dados deste aporte ou saque não servem para criar o lançamento.', transfer.error);
  const entity = transferImport.createTransfer(transfer, loadStore(), { now });
  transferImport.linkTransfer(record, transfer.kind, entity, 'CREATED', entry.batchId, { now });
  return 'CREATED';
}

function linkTransferLaunch(entry, record, targetId, { now }) {
  const kind = transferImport.TRANSFER_TYPES[record.txType];
  const entity = kind === 'DEPOSIT' ? Deposit.findById(targetId) : Withdrawal.findById(targetId);
  if (!entity) throw new NotFoundError('Lançamento não encontrado.', kind === 'DEPOSIT' ? 'DEPOSIT_NOT_FOUND' : 'WITHDRAWAL_NOT_FOUND');
  if (ExternalLink.findByEntity(kind, entity.id)) throw conflict('Este lançamento já está ligado a outro registro do CSFloat.', 'TARGET_ALREADY_LINKED');
  transferImport.linkTransfer(record, kind, entity, 'MATCHED', entry.batchId, { now });
  return 'LINKED';
}

function createLaunch(entry, display, { now }) {
  const record = requireRecord(entry);
  if (record.kind === 'TRANSACTION') return createTransferLaunchInBatch(entry, record, { now });
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
  if (record.kind === 'TRANSACTION') return linkTransferLaunch(entry, record, targetId, { now });
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

// --- Venda sem compra no app: "Lançar compra" e "Foi drop" (D327, D328) ------------------------------------------------

const hasFloat = (category, floatValue) => isWeaponCategory(category) && floatValue !== null && floatValue !== undefined;

// Identidade do item a criar, do `display_json` (nunca do corpo): catálogo ou nome livre, e os atributos de arma.
function identityInput(mapped) {
  const input = mapped.catalogEntry ? { catalogId: mapped.catalogEntry.id } : { category: mapped.category, name: mapped.name };
  if (isWeaponCategory(mapped.category)) {
    input.variant = mapped.variant;
    if (mapped.floatValue !== null) input.floatValue = mapped.floatValue;
    if (mapped.paintSeed !== null) input.paintSeed = mapped.paintSeed;
    if (mapped.phase) input.phase = mapped.phase;
  }
  return input;
}

// A unidade já está no estoque? (ajuste do usuário na E951-Q5) Com float: só a de MESMO float (a mesma unidade física); outra do
// mesmo item com float diferente não bloqueia. Sem float: qualquer unidade do item, e a mensagem indica qual.
function assertNoUnitInStock(mapped, saleAt) {
  const trade = {
    catalogId: mapped.catalogEntry ? mapped.catalogEntry.id : null, category: mapped.category, nameKey: normalizeSearchText(mapped.name),
    variant: mapped.variant, phase: (mapped.catalogEntry && mapped.catalogEntry.phase) || mapped.phase, floatValue: mapped.floatValue,
    paintSeed: mapped.paintSeed, date: saleAt,
  };
  const units = Item.findInStockByCatalogOrCategory({ catalogId: trade.catalogId, category: mapped.category });
  let itemIds;
  if (hasFloat(mapped.category, mapped.floatValue)) {
    itemIds = units
      .filter((u) => manualMatchService.sameItem(trade, u) && hasFloat(u.category, u.floatValue) && manualMatchService.sameUnit(trade, u))
      .map((u) => u.id);
  } else {
    const pick = manualMatchService.pickSoldUnit(trade, units);
    itemIds = pick.kind === 'UNIT' ? [pick.itemId] : pick.kind === 'AMBIGUOUS' ? pick.candidateIds : [];
  }
  if (itemIds.length) {
    throw conflict('Esta unidade já está no estoque. Importe de novo para registrar a venda nela.', 'UNIT_IN_STOCK', { itemIds });
  }
}

function parseLaunchDate(value, label, field) {
  return parseDate(value, label, { field });
}

// Datas da compra contra a da venda (D327 3 e 4). A igualdade é permitida.
function assertDatesBeforeSale({ acquiredAt, tradeUnlockAt = null }, saleAt) {
  const saleMs = Date.parse(saleAt);
  const params = { soldAt: saleAt };
  if (parseLaunchDate(acquiredAt, 'Data da compra', 'acquiredAt').getTime() > saleMs) {
    throw new ValidationError(`A data da compra não pode ser depois da venda (${formatDateTimeBr(saleAt)}).`, 'PURCHASE_AFTER_SALE', { field: 'acquiredAt', params });
  }
  if (tradeUnlockAt !== null && tradeUnlockAt !== undefined
    && parseLaunchDate(tradeUnlockAt, 'Fim do trade lock', 'tradeUnlockAt').getTime() > saleMs) {
    throw new ValidationError(
      `Com esta data, o trade lock terminaria depois da venda (${formatDateTimeBr(saleAt)}). A Steam não teria deixado vender: confira a data da compra ou o fim do trade lock.`,
      'PURCHASE_UNLOCK_AFTER_SALE',
      { field: 'tradeUnlockAt', params }
    );
  }
}

// Cria a compra (ou o drop) e registra nela a venda importada, numa transação (a de quem chama). `check` roda antes de gravar
// (avisos). `purchaseOnly` ("Salvar só a compra", quando o extrato ainda não trouxe o crédito): grava só a compra e devolve null
// (a pendência continua aberta; a próxima importação registra a venda nessa unidade).
function launchAndSell(entry, display, buildInput, { now, check = null, purchaseOnly = false }) {
  const record = requireRecord(entry);
  const store = loadStore();
  const mapped = mappedOfDisplay(display);
  const saleAt = new Date(saleMoment(tradeOfRecord(record))).toISOString();
  assertNoUnitInStock(mapped, saleAt);
  const input = buildInput(mapped, saleAt);
  assertDatesBeforeSale(input, saleAt);
  if (check) check({ store, input });
  const created = itemService.createItem(input, { now });
  if (purchaseOnly) return null;
  const sold = sellImported(record, Item.findById(created.id), store, { now });
  linkRecord(record, 'ITEM_SALE', sold, 'CREATED', entry.batchId, { now });
  return 'CREATED';
}

// "Lançar compra" (D327): loja, preço, cotação, data e trade lock vêm do formulário; a identidade, da pendência.
function createPurchaseLaunch(entry, display, { purchase, confirmWarnings = false, purchaseOnly = false }, { now }) {
  return launchAndSell(
    entry, display,
    (mapped) => {
      const input = {
        ...identityInput(mapped), acquisitionType: 'COMPRA', purchaseStoreId: purchase.purchaseStoreId,
        purchasePriceCents: purchase.purchasePriceCents, acquiredAt: purchase.acquiredAt, tradeUnlockAt: purchase.tradeUnlockAt ?? null,
      };
      if (purchase.fxRateAtPurchase !== undefined && purchase.fxRateAtPurchase !== null) input.fxRateAtPurchase = purchase.fxRateAtPurchase;
      return input;
    },
    {
      now,
      purchaseOnly,
      // Aviso (E951-Q6): compra na loja da integração antes da data de corte pode contar o dinheiro de novo no saldo calculado.
      check: ({ store, input }) => {
        const cutoff = Integration.get(SOURCE).tradesCutoffAt;
        const early = input.purchaseStoreId === store.id && cutoff && Date.parse(input.acquiredAt) < Date.parse(cutoff);
        if (early && confirmWarnings !== true) {
          throw new ConflictError('Confirme o aviso para lançar a compra.', 'IMPORT_ENTRY_WARNINGS_NOT_CONFIRMED', {
            params: { warnings: [{ code: 'PURCHASE_IN_INTEGRATION_STORE_BEFORE_CUTOFF', cutoffAt: cutoff }] },
          });
        }
      },
    }
  );
}

// "Foi drop (ganhei)" (D328): GANHEI com custo 0 e sem trade lock; a data padrão é a da venda.
function markWonLaunch(entry, display, { acquiredAt = null }, { now }) {
  return launchAndSell(
    entry, display,
    (mapped, saleAt) => ({ ...identityInput(mapped), acquisitionType: 'GANHEI', acquiredAt: acquiredAt || saleAt }),
    { now }
  );
}

// --- Entrada ------------------------------------------------------------------------------------------------------------

function guardBusy() {
  // A trava da importação também conta como "ocupado" para o backup: confere o backup antes de pegá-la.
  importLock.assertIdle();
  if (backupService.isExportInProgress()) {
    throw new ConflictError('Há uma exportação de backup em andamento. Aguarde terminar e tente de novo.', 'BACKUP_BUSY');
  }
}

// Sob a trava e numa transação.
function underLock(fn) {
  guardBusy();
  const release = importLock.acquire();
  try {
    return runInTransaction(fn);
  } finally {
    release();
  }
}

// Resolve uma entrada (dentro da transação de quem chama).
function resolveOne(entryId, body, { now }) {
  const { action, targetId = null } = body;
  const entry = ImportBatchEntry.findById(entryId);
  if (!entry) throw new NotFoundError('Pendência não encontrada.', 'IMPORT_ENTRY_NOT_FOUND', { params: { entryId } });
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
  } else if (action === 'CREATE_PURCHASE') {
    resolution = createPurchaseLaunch(entry, display, body, { now });
  } else if (action === 'MARK_WON') {
    resolution = markWonLaunch(entry, display, body, { now });
  } else {
    ignoreEntry(entry, { now });
    resolution = 'IGNORED';
  }
  // "Salvar só a compra": a pendência continua aberta.
  if (resolution === null) return ImportBatchEntry.findById(entry.id);
  // Esta entrada e as outras pendências abertas do mesmo registro ficam resolvidas juntas.
  ImportBatchEntry.resolve(entry.id, resolution, { now });
  if (entry.recordId) ImportBatchEntry.resolveOpenForRecord(entry.recordId, resolution, { now });
  return ImportBatchEntry.findById(entry.id);
}

// Resolve a pendência. Devolve a entrada atualizada (crua; a visão é montada por quem chama).
function resolveEntry(entryId, body = {}, { now = new Date() } = {}) {
  return underLock(() => resolveOne(entryId, body, { now }));
}

// --- Ignoradas: "Voltar para pendências" (D329) ------------------------------------------------------------------------

const notReopenable = (reason) => new ConflictError('Esta pendência não pode voltar para a lista.', 'IMPORT_ENTRY_NOT_REOPENABLE', { params: { reason } });

function reopenOne(entryId, { now }) {
  const entry = ImportBatchEntry.findById(entryId);
  if (!entry) throw new NotFoundError('Pendência não encontrada.', 'IMPORT_ENTRY_NOT_FOUND', { params: { entryId } });
  if (entry.resolution !== 'IGNORED' || !REOPEN_TRACKING[entry.outcome]) throw notReopenable('NOT_IGNORED');
  const record = entry.recordId ? ExternalRecord.findById(entry.recordId) : null;
  if (!record) throw notReopenable('RECORD_NOT_FOUND');
  if (record.tracking !== 'IGNORED') throw notReopenable('NOT_IGNORED');
  if ((record.accountFingerprint ?? null) !== (Integration.get(SOURCE).accountFingerprint ?? null)) throw notReopenable('OTHER_ACCOUNT');
  // Depois de um recomeço completo não há data de corte: a pendência só volta depois da primeira importação (revisão D340).
  if (!Integration.get(SOURCE).tradesCutoffAt) {
    throw new ConflictError('Faça a primeira importação antes de voltar uma ignorada para as pendências.', 'IMPORT_CUTOFF_NOT_SET');
  }
  ImportBatchEntry.reopen(entry.id);
  ExternalRecord.update(record.id, { tracking: REOPEN_TRACKING[entry.outcome] }, { now });
  return ImportBatchEntry.findById(entry.id);
}

function reopenEntry(entryId, { now = new Date() } = {}) {
  return underLock(() => reopenOne(entryId, { now }));
}

// Ignoradas que podem voltar: da conta atual, com o registro ainda IGNORED.
function listIgnored() {
  return ImportBatchEntry.listIgnored(SOURCE, Integration.get(SOURCE).accountFingerprint ?? null);
}

// --- Lote (D330) -------------------------------------------------------------------------------------------------------

// Tudo ou nada: cada entrada num savepoint; se alguma falhar, a transação inteira volta e a resposta lista as falhas.
function bulkResolve({ action, entryIds, acquiredAt = null }, { now = new Date() } = {}) {
  if (entryIds.length > MAX_BULK) throw new ValidationError(`No máximo ${MAX_BULK} por vez.`, 'INVALID_FIELD', { field: 'entryIds' });
  return underLock(() => {
    const results = [];
    const failures = [];
    for (const entryId of entryIds) {
      try {
        results.push(runInTransaction(() => (action === 'REOPEN'
          ? reopenOne(entryId, { now })
          : resolveOne(entryId, { action, acquiredAt }, { now }))));
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        failures.push({ entryId, code: err.code, reason: (err.params && err.params.reason) || null });
      }
    }
    if (failures.length) {
      throw new ConflictError(`${failures.length} pendência(s) não puderam ser resolvidas; nada foi gravado.`, 'IMPORT_BULK_CONFLICT', {
        params: { failures },
      });
    }
    return results;
  });
}

module.exports = { checkAction, resolveEntry, reopenEntry, listIgnored, bulkResolve, MAX_BULK };
