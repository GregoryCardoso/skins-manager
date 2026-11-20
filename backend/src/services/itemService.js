'use strict';

// Orquestra os services puros para o CRUD, a venda e o desfazer venda de itens (D50).
// As funções `build*` e `toItemView` são puras (sem banco) e exportadas para teste unitário.
const env = require('../config/env');
const Item = require('../models/Item');
const Store = require('../models/Store');
const Setting = require('../models/Setting');
const { runInTransaction } = require('../models/modelHelpers');
const { MAX_AMOUNT_CENTS, MAX_NAME_LENGTH } = require('../config/constants');
const { ValidationError, NotFoundError, ConflictError } = require('../errors/AppError');
const { isValidFxRate } = require('./currencyService');
const { parseDate, toIso, formatDateTimeBr } = require('./dateUtils');
const {
  CATEGORIES, CATALOG_CATEGORIES, isWeaponCategory, normalizeAttributes, assertFloatInCatalogRange,
} = require('./itemAttributesService');
const catalogService = require('./catalogService');
const { getTradeLockStatus } = require('./tradeLockService');
const {
  getAging, assertAcquiredAtNotFuture, assertNotFutureDay, filterStagnant, sortByAge, sortByTurnaround,
} = require('./inventoryAgingService');
const { minPricesForItem, resolveSaleNet } = require('./pricingService');
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
  netReceivedManual: false,
  soldAt: null,
};

const isNil = (v) => v === null || v === undefined;
const hasKey = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function optionalText(value) {
  if (isNil(value)) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

// Moeda da loja (ou USD sem loja) e cotação: BRL usa a informada ou a das configurações; USD recusa cotação.
function resolveCurrencyAndFx(store, informedFx, settings, field = 'fxRateAtPurchase') {
  const currency = store ? store.currency : 'USD';
  if (currency === 'USD') {
    if (!isNil(informedFx)) {
      throw new ValidationError('Cotação só se aplica a operações em BRL.', 'FX_RATE_NOT_ALLOWED', { field });
    }
    return { currency, fxRate: null };
  }
  if (!isNil(informedFx)) {
    if (!isValidFxRate(informedFx)) throw new ValidationError('Cotação USD→BRL inválida.', 'INVALID_FX_RATE', { field });
    return { currency, fxRate: informedFx };
  }
  const saved = settings ? settings.usdBrlRate : null;
  if (!isValidFxRate(saved)) {
    throw new ValidationError('Informe a cotação USD→BRL ou salve uma nas configurações.', 'FX_RATE_REQUIRED', { field });
  }
  return { currency, fxRate: saved };
}

// --- Identidade do item: catálogo obrigatório, nome canônico e categoria derivada (D78) -----------

const WEAPON_ATTRIBUTE_KEYS = ['variant', 'floatValue', 'exterior', 'paintSeed', 'phase'];

function derivedFieldError(field) {
  return new ValidationError(
    'Nome e categoria vêm do catálogo; não os envie junto com o item do catálogo.',
    'CATALOG_DERIVED_FIELD',
    { field }
  );
}

// Função pura. `body` é o corpo da requisição (POST completo ou PATCH parcial); `existing`, o item gravado
// (só no PATCH); `catalogEntry`, a entrada do catálogo do `catalogId` resultante (ou `null` se não existe);
// `freeNameCatalogMatch`, a entrada PASSE_BATALHA do catálogo com o mesmo nome (ou `null`).
// Devolve { catalogId, name, category, phase, phaseLocked }; `phase` é o valor a usar no item mesclado.
function resolveItemIdentity({ body, existing = null, catalogEntry = null, freeNameCatalogMatch = null }) {
  const hasCatalogKey = hasKey(body, 'catalogId');
  let resultCatalogId = null;
  if (hasCatalogKey) resultCatalogId = body.catalogId;
  else if (existing) resultCatalogId = existing.catalogId;
  const catalogChanged = existing ? hasCatalogKey && body.catalogId !== existing.catalogId : true;
  const bodyPhase = hasKey(body, 'phase') ? body.phase : undefined;
  const storedPhase = existing ? existing.phase : null;

  if (!isNil(resultCatalogId)) {
    // (1) CATALOG_DERIVED_FIELD
    if (hasKey(body, 'name')) throw derivedFieldError('name');
    if (hasKey(body, 'category')) throw derivedFieldError('category');
    if (!catalogEntry) {
      // (2) CATALOG_ITEM_NOT_FOUND, só quando o vínculo muda; entrada que sumiu não invalida o item gravado.
      if (catalogChanged) throw new ValidationError('Item do catálogo não encontrado.', 'CATALOG_ITEM_NOT_FOUND', { field: 'catalogId' });
      return {
        catalogId: resultCatalogId,
        name: existing.name,
        category: existing.category,
        phase: bodyPhase !== undefined ? bodyPhase : storedPhase,
        phaseLocked: false,
      };
    }
    const phaseLocked = !isNil(catalogEntry.phase);
    if (phaseLocked && bodyPhase !== undefined) throw derivedFieldError('phase');
    let phase;
    if (phaseLocked) phase = catalogEntry.phase;
    else if (bodyPhase !== undefined) phase = bodyPhase;
    else phase = catalogChanged ? null : storedPhase; // a fase antiga não é herdada ao trocar de item
    return {
      catalogId: resultCatalogId,
      name: catalogChanged ? catalogEntry.name : existing.name,
      category: catalogChanged ? catalogEntry.category : existing.category,
      phase,
      phaseLocked,
    };
  }

  // Sem vínculo com o catálogo.
  let category;
  if (hasKey(body, 'category')) category = body.category;
  else if (existing) category = existing.category;
  else throw new ValidationError('O campo category é obrigatório.', 'REQUIRED_FIELD', { field: 'category' });
  if (!CATEGORIES.includes(category)) throw new ValidationError('Categoria inválida.', 'INVALID_CATEGORY', { field: 'category' });
  // A fase gravada só vale em categoria de arma; fora dela é limpa (T35). Fase enviada segue as regras.
  const phase = bodyPhase !== undefined ? bodyPhase : isWeaponCategory(category) ? storedPhase : null;

  if (CATALOG_CATEGORIES.includes(category)) {
    // (3) CATALOG_ITEM_REQUIRED. No PATCH só passa o item que já era legado, sem mexer na identidade (D82).
    const untouchedLegacy =
      existing && isNil(existing.catalogId) && !['name', 'category', 'catalogId'].some((k) => hasKey(body, k));
    if (!untouchedLegacy) throw new ValidationError('Escolha o item no catálogo.', 'CATALOG_ITEM_REQUIRED', { field: 'catalogId' });
    return { catalogId: null, name: existing.name, category: existing.category, phase, phaseLocked: false };
  }

  // Categoria de nome livre (OUTRO, PASSE_BATALHA). (4) REQUIRED_FIELD do nome.
  let name;
  if (hasKey(body, 'name')) name = body.name;
  else if (existing) name = existing.name;
  const trimmed = isNil(name) ? '' : String(name).trim();
  if (trimmed === '') throw new ValidationError('O nome do item é obrigatório.', 'REQUIRED_FIELD', { field: 'name' });
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`O campo name deve ter no máximo ${MAX_NAME_LENGTH} caracteres.`, 'FIELD_TOO_LONG', {
      field: 'name', params: { maxLength: MAX_NAME_LENGTH },
    });
  }
  if (category === 'PASSE_BATALHA' && freeNameCatalogMatch) {
    throw new ValidationError('Este item existe no catálogo: selecione-o na busca.', 'CATALOG_ITEM_REQUIRED', { field: 'catalogId' });
  }
  return { catalogId: null, name: trimmed, category, phase, phaseLocked: false };
}

// Procura no catálogo o PASSE_BATALHA de nome livre (D78). Só quando a identidade está sendo definida.
function lookupFreeNameMatch(body, existing) {
  const catalogId = hasKey(body, 'catalogId') ? body.catalogId : existing && existing.catalogId;
  if (!isNil(catalogId)) return null;
  const linkChanged = existing && hasKey(body, 'catalogId') && body.catalogId !== existing.catalogId;
  if (existing && !hasKey(body, 'name') && !hasKey(body, 'category') && !linkChanged) return null;
  let category = null;
  if (hasKey(body, 'category')) category = body.category;
  else if (existing) category = existing.category;
  if (category !== 'PASSE_BATALHA') return null;
  let name = null;
  if (hasKey(body, 'name')) name = body.name;
  else if (existing) name = existing.name;
  if (typeof name !== 'string' || name.trim() === '') return null;
  return catalogService.findExactMatch({ name, category });
}

// Entrada do catálogo do `catalogId` resultante (ou `null`).
function loadCatalogEntry(body, existing) {
  let id = null;
  if (hasKey(body, 'catalogId')) id = body.catalogId;
  else if (existing) id = existing.catalogId;
  return isNil(id) ? null : catalogService.getCatalogItem(id);
}

// Monta o registro de aquisição/atributos a partir do estado já mesclado. `existing` só na edição.
function buildItemRecord(merged, { store = null, settings = null, now = new Date(), existing = null, priceInformed = true, body = null } = {}) {
  const name = isNil(merged.name) ? '' : String(merged.name).trim();
  if (name === '') throw new ValidationError('O nome do item é obrigatório.', 'REQUIRED_FIELD', { field: 'name' });

  if (!ACQUISITION_TYPES.includes(merged.acquisitionType)) {
    throw new ValidationError('Tipo de aquisição inválido.', 'INVALID_ACQUISITION_TYPE', { field: 'acquisitionType' });
  }
  const isGanhei = merged.acquisitionType === 'GANHEI';
  if (!isNil(merged.purchaseStoreId) && !store) {
    throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND', { field: 'purchaseStoreId' });
  }
  const purchaseStoreId = isNil(merged.purchaseStoreId) ? null : merged.purchaseStoreId;

  let purchasePriceCents = 0;
  let currency = 'USD';
  let fxRate = null;
  if (isGanhei) {
    // GANHEI: custo fixo US$ 0,00, sem cotação; a loja é só informativa (D65).
    if (body && hasKey(body, 'purchasePriceCents')) {
      throw new ValidationError('Item ganho tem custo fixo US$ 0,00; não informe preço de compra.', 'GANHEI_COST_NOT_ALLOWED', { field: 'purchasePriceCents' });
    }
    // `fxRateAtPurchase: null` equivale a "sem cotação" e é aceito (T35 b, D73).
    if (body && hasKey(body, 'fxRateAtPurchase') && !isNil(body.fxRateAtPurchase)) {
      throw new ValidationError('Item ganho não usa cotação.', 'FX_RATE_NOT_ALLOWED', { field: 'fxRateAtPurchase' });
    }
  } else {
    if (isNil(merged.purchaseStoreId)) {
      throw new ValidationError('Informe a loja da compra.', 'PURCHASE_STORE_REQUIRED', { field: 'purchaseStoreId' });
    }
    if (isNil(merged.purchasePriceCents)) {
      throw new ValidationError('Informe o preço da compra.', 'PURCHASE_PRICE_REQUIRED', { field: 'purchasePriceCents' });
    }
    purchasePriceCents = merged.purchasePriceCents;
    if (!Number.isSafeInteger(purchasePriceCents) || purchasePriceCents < 0) {
      throw new ValidationError('O preço deve ser um inteiro de centavos maior ou igual a 0.', 'INVALID_AMOUNT', { field: 'purchasePriceCents' });
    }
    // O teto vale só para o valor que entra (D63); item legado acima do teto continua editável em outros campos.
    if (priceInformed && purchasePriceCents > MAX_AMOUNT_CENTS) {
      throw new ValidationError('O valor excede o máximo permitido.', 'INVALID_AMOUNT', {
        field: 'purchasePriceCents', params: { maxCents: MAX_AMOUNT_CENTS },
      });
    }
    // Moeda diferente da gravada: o preço antigo não vale na nova moeda (I1).
    if (existing && !priceInformed && store.currency !== existing.purchaseCurrency) {
      throw new ValidationError(
        'Ao trocar para uma loja de outra moeda, informe o preço na nova moeda.',
        'PURCHASE_PRICE_REQUIRED',
        { field: 'purchasePriceCents' }
      );
    }
    ({ currency, fxRate } = resolveCurrencyAndFx(store, merged.fxRateAtPurchase, settings));
  }

  const attrs = normalizeAttributes({
    category: merged.category,
    variant: merged.variant,
    floatValue: merged.floatValue,
    exterior: merged.exterior,
    paintSeed: merged.paintSeed,
    phase: merged.phase,
  });

  const acquiredAtIso = toIso(isNil(merged.acquiredAt) ? now : merged.acquiredAt, 'Data de aquisição', { field: 'acquiredAt' });
  const acquiredChanged = !existing || toIso(existing.acquiredAt) !== acquiredAtIso;
  if (acquiredChanged) assertAcquiredAtNotFuture(acquiredAtIso, now);

  const tradeUnlockAt = isNil(merged.tradeUnlockAt) ? null : toIso(merged.tradeUnlockAt, 'Data de liberação da troca', { field: 'tradeUnlockAt' });
  if (existing && existing.status === 'VENDIDO' && getTradeLockStatus(tradeUnlockAt, new Date(existing.soldAt)).isLocked) {
    throw new ConflictError(`Item em trade lock até ${formatDateTimeBr(tradeUnlockAt)}`, 'ITEM_TRADE_LOCKED', {
      field: 'tradeUnlockAt', params: { tradeUnlockAt },
    });
  }

  if (existing && existing.status === 'VENDIDO' && Date.parse(existing.soldAt) < Date.parse(acquiredAtIso)) {
    throw new ValidationError('A data de venda não pode ser anterior à data de compra.', 'SOLD_BEFORE_ACQUIRED', { field: 'acquiredAt' });
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
  const soldAt = parseDate(input.soldAt, 'Data de venda', { field: 'soldAt' });
  assertNotFutureDay(soldAt, now, { code: 'SOLD_AT_IN_FUTURE', message: 'A data de venda não pode ser futura.', field: 'soldAt' });
  if (soldAt.getTime() < Date.parse(item.acquiredAt)) {
    throw new ValidationError('A data de venda não pode ser anterior à data de compra.', 'SOLD_BEFORE_ACQUIRED', { field: 'soldAt' });
  }
  if (getTradeLockStatus(item.tradeUnlockAt, soldAt).isLocked) {
    throw new ConflictError(
      `Item em trade lock até ${formatDateTimeBr(item.tradeUnlockAt)}`,
      'ITEM_TRADE_LOCKED',
      { field: 'soldAt', params: { tradeUnlockAt: toIso(item.tradeUnlockAt) } }
    );
  }

  if (Number.isSafeInteger(input.salePriceCents) && input.salePriceCents > MAX_AMOUNT_CENTS) {
    throw new ValidationError('O valor excede o máximo permitido.', 'INVALID_AMOUNT', {
      field: 'salePriceCents', params: { maxCents: MAX_AMOUNT_CENTS },
    });
  }
  const { netReceivedCents, feeCents, snapshot, netReceivedManual } = resolveSaleNet({
    salePriceCents: input.salePriceCents, store, netReceivedCents: input.netReceivedCents,
  });
  const { currency, fxRate } = resolveCurrencyAndFx(store, input.fxRateAtSale, settings, 'fxRateAtSale');

  return {
    record: {
      status: 'VENDIDO',
      saleStoreId: store.id,
      salePriceCents: input.salePriceCents,
      saleCurrency: currency,
      fxRateAtSale: fxRate,
      ...snapshot,
      netReceivedCents,
      netReceivedManual,
      soldAt: soldAt.toISOString(),
    },
    sale: { netReceivedCents, feeCents, netReceivedManual },
  };
}

function buildUnsellPatch() {
  return { status: 'EM_ESTOQUE', ...SALE_FIELDS_NULL };
}

function toCatalogSummary(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    name: entry.name,
    namePtBr: entry.namePtBr,
    imageUrl: entry.imageUrl,
    minFloat: entry.minFloat,
    maxFloat: entry.maxFloat,
    hasStattrak: entry.hasStattrak,
    hasSouvenir: entry.hasSouvenir,
    phase: entry.phase,
  };
}

function toItemView(
  item,
  { stores, settings, statsIndex, catalogById = new Map(), now = new Date(), slowItemDays = env.slowItemDays }
) {
  const inStock = item.status === 'EM_ESTOQUE';
  return {
    ...item,
    // Legado: sem vínculo com o catálogo numa categoria que o exige (D82).
    isLegacy: isNil(item.catalogId) && CATALOG_CATEGORIES.includes(item.category),
    catalog: isNil(item.catalogId) ? null : toCatalogSummary(catalogById.get(item.catalogId)),
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
  const catalogIds = items.map((i) => i.catalogId).filter((id) => !isNil(id));
  const catalogById = new Map(catalogService.getCatalogItemsByIds(catalogIds).map((c) => [c.id, c]));
  return { items, stores: Store.findAll(), settings: Setting.get(), statsIndex: buildStatsIndex(items), catalogById };
}

// Grava e monta a resposta na mesma transação: se a montagem falhar, nada é gravado.
function inTransaction(fn) {
  return runInTransaction(fn);
}

function viewOf(item, { now, slowItemDays }) {
  const { stores, settings, statsIndex, catalogById } = loadContext();
  return toItemView(item, { stores, settings, statsIndex, catalogById, now, slowItemDays });
}

function findOrFail(id) {
  const item = Item.findById(id);
  if (!item) throw new NotFoundError('Item não encontrado.', 'ITEM_NOT_FOUND');
  return item;
}

function listItems(query = {}, { now = new Date(), slowItemDays = env.slowItemDays } = {}) {
  const { items: all, stores, settings, statsIndex, catalogById } = loadContext();
  let items = all;
  if (query.status) items = items.filter((i) => i.status === query.status);
  if (query.category) items = items.filter((i) => i.category === query.category);
  if (query.stagnantOnly) items = filterStagnant(items, slowItemDays, now);
  if (query.sortBy === 'age') items = sortByAge(items, query.order ?? 'desc', now);
  else if (query.sortBy === 'turnaround') items = sortByTurnaround(items, query.order ?? 'asc');

  return {
    items: items.map((item) => toItemView(item, { stores, settings, statsIndex, catalogById, now, slowItemDays })),
    meta: { count: items.length, slowItemDays, usdBrlRate: settings.usdBrlRate, generatedAt: now.toISOString() },
  };
}

function getItem(id, ctx = {}) {
  const { now = new Date(), slowItemDays = env.slowItemDays } = ctx;
  return viewOf(findOrFail(id), { now, slowItemDays });
}

function createItem(input, ctx = {}) {
  const { now = new Date(), slowItemDays = env.slowItemDays } = ctx;
  const catalogEntry = loadCatalogEntry(input, null);
  const identity = resolveItemIdentity({
    body: input, catalogEntry, freeNameCatalogMatch: lookupFreeNameMatch(input, null),
  });
  const merged = { ...input, name: identity.name, category: identity.category, phase: identity.phase };
  const store = isNil(input.purchaseStoreId) ? null : getStoreOrFail(input.purchaseStoreId, { field: 'purchaseStoreId' });
  const record = buildItemRecord(merged, { store, settings: Setting.get(), now, body: input });
  if (catalogEntry) assertFloatInCatalogRange(record.floatValue, catalogEntry);
  return inTransaction(() => viewOf(Item.create({ ...record, catalogId: identity.catalogId }), { now, slowItemDays }));
}

function updateItem(id, partial, ctx = {}) {
  const { now = new Date(), slowItemDays = env.slowItemDays } = ctx;
  const existing = findOrFail(id);
  const catalogEntry = loadCatalogEntry(partial, existing);
  const identity = resolveItemIdentity({
    body: partial, existing, catalogEntry, freeNameCatalogMatch: lookupFreeNameMatch(partial, existing),
  });
  const merged = { ...existing, ...partial, name: identity.name, category: identity.category, phase: identity.phase };
  // Novo float sem exterior no corpo: o exterior gravado é descartado e derivado de novo do float.
  if (hasKey(partial, 'floatValue') && !hasKey(partial, 'exterior')) merged.exterior = null;
  // T35 (a): categoria sem atributos de arma limpa os atributos que não vieram no corpo (D73).
  if (!isWeaponCategory(identity.category)) {
    for (const key of WEAPON_ATTRIBUTE_KEYS) if (!hasKey(partial, key)) merged[key] = null;
  }
  // Trocar a loja de compra recalcula moeda e cotação; mesma loja mantém a cotação gravada (D52).
  if (partial.purchaseStoreId !== undefined && partial.purchaseStoreId !== existing.purchaseStoreId) {
    merged.fxRateAtPurchase = partial.fxRateAtPurchase ?? null;
  }
  const store = isNil(merged.purchaseStoreId) ? null : getStoreOrFail(merged.purchaseStoreId, { field: 'purchaseStoreId' });
  const priceInformed = !isNil(partial.purchasePriceCents);
  // GANHEI -> COMPRA: preço no mesmo PATCH; a loja pode ser a já gravada (T33, D73).
  if (merged.acquisitionType === 'COMPRA' && existing.acquisitionType === 'GANHEI') {
    if (!priceInformed) throw new ValidationError('Informe o preço da compra.', 'PURCHASE_PRICE_REQUIRED', { field: 'purchasePriceCents' });
    if (isNil(merged.purchaseStoreId)) throw new ValidationError('Informe a loja da compra.', 'PURCHASE_STORE_REQUIRED', { field: 'purchaseStoreId' });
  }
  const record = buildItemRecord(merged, { store, settings: Setting.get(), now, existing, priceInformed, body: partial });
  // Faixa de float do catálogo: ao trocar o item do catálogo ou o float (limites inclusivos).
  const catalogChanged = hasKey(partial, 'catalogId') && partial.catalogId !== existing.catalogId;
  if (catalogEntry && (catalogChanged || hasKey(partial, 'floatValue'))) {
    assertFloatInCatalogRange(record.floatValue, catalogEntry);
  }
  return inTransaction(() => viewOf(Item.update(id, { ...record, catalogId: identity.catalogId }), { now, slowItemDays }));
}

function deleteItem(id) {
  if (!Item.remove(id)) throw new NotFoundError('Item não encontrado.', 'ITEM_NOT_FOUND');
  return { id };
}

function sellItem(id, input, ctx = {}) {
  const { now = new Date(), slowItemDays = env.slowItemDays } = ctx;
  const item = findOrFail(id);
  if (item.status !== 'EM_ESTOQUE') throw new ConflictError('Item já vendido.', 'ITEM_ALREADY_SOLD');
  const store = getStoreOrFail(input.saleStoreId, { field: 'saleStoreId' });
  const { record, sale } = buildSaleRecord(item, input, { store, settings: Setting.get(), now });
  const view = inTransaction(() => viewOf(Item.update(id, record), { now, slowItemDays }));
  return { item: view, sale: { ...sale, saleProfitUsdCents: view.saleProfitUsdCents } };
}

function unsellItem(id, ctx = {}) {
  const { now = new Date(), slowItemDays = env.slowItemDays } = ctx;
  const item = findOrFail(id);
  if (item.status !== 'VENDIDO') throw new ConflictError('Item não está vendido.', 'ITEM_NOT_SOLD');
  return inTransaction(() => viewOf(Item.update(id, buildUnsellPatch()), { now, slowItemDays }));
}

function getItemStats({ name, category, variant, exterior }) {
  const key = buildStatsKey({ name, category, variant, exterior });
  const group = Item.findAll().filter((item) => buildStatsKey(item) === key);
  return { key, ...computeStats(group) };
}

module.exports = {
  resolveItemIdentity,
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
