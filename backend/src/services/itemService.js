'use strict';

// Orquestra os services puros para o CRUD, a venda e o desfazer venda de itens (D50).
// As funções `build*` e `toItemView` são puras (sem banco) e exportadas para teste unitário.
const env = require('../config/env');
const Item = require('../models/Item');
const Store = require('../models/Store');
const Setting = require('../models/Setting');
const { ValidationError, NotFoundError, ConflictError } = require('../errors/AppError');
const { isValidFxRate } = require('./currencyService');
const { parseDate, toIso, formatDateTimeBr } = require('./dateUtils');
const { normalizeAttributes } = require('./itemAttributesService');
const { getTradeLockStatus } = require('./tradeLockService');
const {
  getAging, assertAcquiredAtNotFuture, assertNotFutureDay, filterStagnant, sortByAge, sortByTurnaround,
} = require('./inventoryAgingService');
const { minPricesForItem, computeSale } = require('./pricingService');
const { computeSaleProfitUsdCents } = require('./profitService');
const { buildStatsIndex, buildStatsKey, computeStats } = require('./itemStatsService');
const { getStoreOrFail } = require('./storeService');

const ACQUISITION_TYPES = ['GANHEI', 'COMPRA'];

const SALE_FIELDS_NULL = {
  saleStoreId: null,
  salePriceCents: null,
  saleCurrency: null,
  fxRateAtSale: null,
  saleFeeTypeApplied: null,
  saleFeeRateApplied: null,
  saleFeeRoundingApplied: null,
  saleMinFeeCentsApplied: null,
  saleFixedFeeCentsApplied: null,
  netReceivedCents: null,
  soldAt: null,
};

const isNil = (v) => v === null || v === undefined;

function optionalText(value) {
  if (isNil(value)) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

// Moeda da loja (ou USD sem loja) e cotação: BRL usa a informada ou a das configurações; USD recusa cotação.
function resolveCurrencyAndFx(store, informedFx, settings) {
  const currency = store ? store.currency : 'USD';
  if (currency === 'USD') {
    if (!isNil(informedFx)) {
      throw new ValidationError('Cotação só se aplica a operações em BRL.', 'FX_RATE_NOT_ALLOWED');
    }
    return { currency, fxRate: null };
  }
  if (!isNil(informedFx)) {
    if (!isValidFxRate(informedFx)) throw new ValidationError('Cotação USD→BRL inválida.', 'INVALID_FX_RATE');
    return { currency, fxRate: informedFx };
  }
  const saved = settings ? settings.usdBrlRate : null;
  if (!isValidFxRate(saved)) {
    throw new ValidationError('Informe a cotação USD→BRL ou salve uma nas configurações.', 'FX_RATE_REQUIRED');
  }
  return { currency, fxRate: saved };
}

// Monta o registro de aquisição/atributos a partir do estado já mesclado. `existing` só na edição.
function buildItemRecord(merged, { store = null, settings = null, now = new Date(), existing = null } = {}) {
  const name = isNil(merged.name) ? '' : String(merged.name).trim();
  if (name === '') throw new ValidationError('O nome do item é obrigatório.', 'REQUIRED_FIELD');

  if (!ACQUISITION_TYPES.includes(merged.acquisitionType)) {
    throw new ValidationError('Tipo de aquisição inválido.', 'INVALID_ACQUISITION_TYPE');
  }
  const isPurchase = merged.acquisitionType === 'COMPRA';
  if (isPurchase && isNil(merged.purchaseStoreId)) {
    throw new ValidationError('Informe a loja da compra.', 'PURCHASE_STORE_REQUIRED');
  }
  if (isPurchase && isNil(merged.purchasePriceCents)) {
    throw new ValidationError('Informe o preço da compra.', 'PURCHASE_PRICE_REQUIRED');
  }
  const purchasePriceCents = isNil(merged.purchasePriceCents) ? 0 : merged.purchasePriceCents;
  if (!Number.isSafeInteger(purchasePriceCents) || purchasePriceCents < 0) {
    throw new ValidationError('O preço deve ser um inteiro de centavos maior ou igual a 0.', 'INVALID_AMOUNT');
  }
  if (!isNil(merged.purchaseStoreId) && !store) {
    throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND');
  }
  const purchaseStoreId = isNil(merged.purchaseStoreId) ? null : merged.purchaseStoreId;
  const { currency, fxRate } = resolveCurrencyAndFx(purchaseStoreId === null ? null : store, merged.fxRateAtPurchase, settings);

  const attrs = normalizeAttributes({
    category: merged.category,
    variant: merged.variant,
    floatValue: merged.floatValue,
    exterior: merged.exterior,
    paintSeed: merged.paintSeed,
    phase: merged.phase,
  });

  const acquiredAtIso = toIso(isNil(merged.acquiredAt) ? now : merged.acquiredAt, 'Data de aquisição');
  const acquiredChanged = !existing || toIso(existing.acquiredAt) !== acquiredAtIso;
  if (acquiredChanged) assertAcquiredAtNotFuture(acquiredAtIso, now);

  const tradeUnlockAt = isNil(merged.tradeUnlockAt) ? null : toIso(merged.tradeUnlockAt, 'Data de liberação da troca');

  if (existing && existing.status === 'VENDIDO' && Date.parse(existing.soldAt) < Date.parse(acquiredAtIso)) {
    throw new ValidationError('A data de venda não pode ser anterior à data de compra.', 'SOLD_BEFORE_ACQUIRED');
  }

  return {
    name,
    category: merged.category,
    ...attrs,
    inspectLink: optionalText(merged.inspectLink),
    assetId: optionalText(merged.assetId),
    acquisitionType: merged.acquisitionType,
    originDetail: optionalText(merged.originDetail),
    purchaseStoreId,
    purchasePriceCents,
    purchaseCurrency: currency,
    fxRateAtPurchase: fxRate,
    acquiredAt: acquiredAtIso,
    tradeUnlockAt,
  };
}

// Registro de venda (2.4, D18, D31). Trade lock avaliado na data da venda, nunca em `now` (D59 revisada).
function buildSaleRecord(item, input, { store, settings = null, now = new Date() } = {}) {
  const soldAt = parseDate(input.soldAt, 'Data de venda');
  assertNotFutureDay(soldAt, now, { code: 'SOLD_AT_IN_FUTURE', message: 'A data de venda não pode ser futura.' });
  if (soldAt.getTime() < Date.parse(item.acquiredAt)) {
    throw new ValidationError('A data de venda não pode ser anterior à data de compra.', 'SOLD_BEFORE_ACQUIRED');
  }
  if (getTradeLockStatus(item.tradeUnlockAt, soldAt).isLocked) {
    throw new ConflictError(
      `Item em trade lock até ${formatDateTimeBr(item.tradeUnlockAt)}`,
      'ITEM_TRADE_LOCKED'
    );
  }

  const { netReceivedCents, feeCents, snapshot } = computeSale({ salePriceCents: input.salePriceCents, store });
  const { currency, fxRate } = resolveCurrencyAndFx(store, input.fxRateAtSale, settings);

  return {
    record: {
      status: 'VENDIDO',
      saleStoreId: store.id,
      salePriceCents: input.salePriceCents,
      saleCurrency: currency,
      fxRateAtSale: fxRate,
      ...snapshot,
      netReceivedCents,
      soldAt: soldAt.toISOString(),
    },
    sale: { netReceivedCents, feeCents },
  };
}

function buildUnsellPatch() {
  return { status: 'EM_ESTOQUE', ...SALE_FIELDS_NULL };
}

function toItemView(item, { stores, settings, statsIndex, now = new Date(), slowItemDays = env.slowItemDays }) {
  const inStock = item.status === 'EM_ESTOQUE';
  return {
    ...item,
    tradeLock: getTradeLockStatus(item.tradeUnlockAt, now),
    aging: getAging(item, { slowItemDays, now }),
    minPrices: inStock ? minPricesForItem({ item, stores, settings }) : null,
    saleProfitUsdCents: computeSaleProfitUsdCents(item),
    stats: statsIndex.get(buildStatsKey(item)) ?? computeStats([item]),
  };
}

// --- Orquestração -------------------------------------------------------------------------------

function loadContext() {
  const items = Item.findAll();
  return { items, stores: Store.findAll(), settings: Setting.get(), statsIndex: buildStatsIndex(items) };
}

function viewOf(item, { now, slowItemDays }) {
  const { stores, settings, statsIndex } = loadContext();
  return toItemView(item, { stores, settings, statsIndex, now, slowItemDays });
}

function findOrFail(id) {
  const item = Item.findById(id);
  if (!item) throw new NotFoundError('Item não encontrado.', 'ITEM_NOT_FOUND');
  return item;
}

function listItems(query = {}, { now = new Date(), slowItemDays = env.slowItemDays } = {}) {
  const { items: all, stores, settings, statsIndex } = loadContext();
  let items = all;
  if (query.status) items = items.filter((i) => i.status === query.status);
  if (query.category) items = items.filter((i) => i.category === query.category);
  if (query.stagnantOnly) items = filterStagnant(items, slowItemDays, now);
  if (query.sortBy === 'age') items = sortByAge(items, query.order ?? 'desc', now);
  else if (query.sortBy === 'turnaround') items = sortByTurnaround(items, query.order ?? 'asc');

  return {
    items: items.map((item) => toItemView(item, { stores, settings, statsIndex, now, slowItemDays })),
    meta: { count: items.length, slowItemDays, usdBrlRate: settings.usdBrlRate, generatedAt: now.toISOString() },
  };
}

function getItem(id, ctx = {}) {
  const { now = new Date(), slowItemDays = env.slowItemDays } = ctx;
  return viewOf(findOrFail(id), { now, slowItemDays });
}

function createItem(input, ctx = {}) {
  const { now = new Date(), slowItemDays = env.slowItemDays } = ctx;
  const store = isNil(input.purchaseStoreId) ? null : getStoreOrFail(input.purchaseStoreId);
  const record = buildItemRecord(input, { store, settings: Setting.get(), now });
  const created = Item.create(record);
  return viewOf(created, { now, slowItemDays });
}

function updateItem(id, partial, ctx = {}) {
  const { now = new Date(), slowItemDays = env.slowItemDays } = ctx;
  const existing = findOrFail(id);
  const merged = { ...existing, ...partial };
  // Trocar a loja de compra recalcula moeda e cotação; mesma loja mantém a cotação gravada (D52).
  if (partial.purchaseStoreId !== undefined && partial.purchaseStoreId !== existing.purchaseStoreId) {
    merged.fxRateAtPurchase = partial.fxRateAtPurchase ?? null;
  }
  const store = isNil(merged.purchaseStoreId) ? null : getStoreOrFail(merged.purchaseStoreId);
  const record = buildItemRecord(merged, { store, settings: Setting.get(), now, existing });
  return viewOf(Item.update(id, record), { now, slowItemDays });
}

function deleteItem(id) {
  if (!Item.remove(id)) throw new NotFoundError('Item não encontrado.', 'ITEM_NOT_FOUND');
  return { id };
}

function sellItem(id, input, ctx = {}) {
  const { now = new Date(), slowItemDays = env.slowItemDays } = ctx;
  const item = findOrFail(id);
  if (item.status !== 'EM_ESTOQUE') throw new ConflictError('Item já vendido.', 'ITEM_ALREADY_SOLD');
  const store = getStoreOrFail(input.saleStoreId);
  const { record, sale } = buildSaleRecord(item, input, { store, settings: Setting.get(), now });
  const updated = Item.update(id, record);
  const view = viewOf(updated, { now, slowItemDays });
  return { item: view, sale: { ...sale, saleProfitUsdCents: view.saleProfitUsdCents } };
}

function unsellItem(id, ctx = {}) {
  const { now = new Date(), slowItemDays = env.slowItemDays } = ctx;
  const item = findOrFail(id);
  if (item.status !== 'VENDIDO') throw new ConflictError('Item não está vendido.', 'ITEM_NOT_SOLD');
  return viewOf(Item.update(id, buildUnsellPatch()), { now, slowItemDays });
}

function getItemStats({ name, category, variant, exterior }) {
  const key = buildStatsKey({ name, category, variant, exterior });
  const group = Item.findAll().filter((item) => buildStatsKey(item) === key);
  return { key, ...computeStats(group) };
}

module.exports = {
  buildItemRecord,
  buildSaleRecord,
  buildUnsellPatch,
  toItemView,
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  sellItem,
  unsellItem,
  getItemStats,
};
