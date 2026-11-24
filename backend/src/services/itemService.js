'use strict';

// Orquestra os services puros para o CRUD, a venda e o desfazer venda de itens (D50).
// As funções `build*` e `toItemView` são puras (sem banco) e exportadas para teste unitário.
const Item = require('../models/Item');
const Store = require('../models/Store');
const Setting = require('../models/Setting');
const ItemComponent = require('../models/ItemComponent');
const ItemOperation = require('../models/ItemOperation');
const { runInTransaction } = require('../models/modelHelpers');
const { MAX_AMOUNT_CENTS, MAX_NAME_LENGTH } = require('../config/constants');
const { AppError, ValidationError, NotFoundError, ConflictError } = require('../errors/AppError');
const { isValidFxRate } = require('./currencyService');
const { parseDate, toIso, formatDateTimeBr } = require('./dateUtils');
const {
  CATEGORIES, CATALOG_CATEGORIES, isWeaponCategory, normalizeAttributes, assertFloatInCatalogRange,
} = require('./itemAttributesService');
const catalogService = require('./catalogService');
const { getTradeLockStatus } = require('./tradeLockService');
const { computeSaleRelease } = require('./saleHoldService');
const {
  getAging, assertAcquiredAtNotFuture, assertNotFutureDay, filterStagnant, sortByAge, sortByTurnaround, sortBySoldAt, filterSoldInPeriod,
  isOffSale, soldWhileOffSale,
} = require('./inventoryAgingService');
const { minPricesForItem, resolveSaleNet } = require('./pricingService');
const { computeSaleProfitUsdCents, buildSaleInfo } = require('./profitService');
const { buildStatsIndex, buildStatsKey, computeStats, computeSalesSummary } = require('./itemStatsService');
const { groupByStatsKey, summarizeGroupCost, summarizeStockStates, countStagnant, pickUnitsForSaleState } = require('./inventoryGroupService');
const { getStoreOrFail } = require('./storeService');
const { getAgingThresholds } = require('./settingsService');
const externalLinkService = require('./externalLinkService');
const itemComponentService = require('./itemComponentService');
const { buildValuationIndex, groupValuation } = require('./valuation/valuationIndex');
const operationContextService = require('./operations/operationContext');
const openingRules = require('./operations/openingRules');

// `GERADO` só nasce de uma transformação (2.1, D363): o cadastro e a edição não o aceitam (a edição só mantém uma unidade que já é `GERADO`).
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
  saleHoldDaysApplied: null,
  saleReleaseAt: null, // liberação real da venda importada (D312); desfazer a venda limpa
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
// `allowGenerated`: só a abertura (`prepareItemRecord`) e a edição de uma unidade que já é `GERADO` aceitam esse tipo (D363 item 7).
function buildItemRecord(merged, { store = null, settings = null, now = new Date(), existing = null, priceInformed = true, body, allowGenerated = false } = {}) {
  // T31: o corpo da requisição é obrigatório (GANHEI e cotação dependem de saber o que foi enviado).
  if (body === null || typeof body !== 'object') {
    throw new Error('buildItemRecord exige o corpo da requisição em `body`.');
  }
  const name = isNil(merged.name) ? '' : String(merged.name).trim();
  if (name === '') throw new ValidationError('O nome do item é obrigatório.', 'REQUIRED_FIELD', { field: 'name' });

  const isGenerated = merged.acquisitionType === 'GERADO' && allowGenerated;
  if (!isGenerated && !ACQUISITION_TYPES.includes(merged.acquisitionType)) {
    throw new ValidationError('Tipo de aquisição inválido.', 'INVALID_ACQUISITION_TYPE', { field: 'acquisitionType' });
  }
  const isGanhei = merged.acquisitionType === 'GANHEI';
  if (!isGenerated && !isNil(merged.purchaseStoreId) && !store) {
    throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND', { field: 'purchaseStoreId' });
  }
  const purchaseStoreId = isGenerated || isNil(merged.purchaseStoreId) ? null : merged.purchaseStoreId;

  let purchasePriceCents = 0;
  let currency = 'USD';
  let fxRate = null;
  if (isGenerated) {
    // GERADO: sem loja, preço nem cotação (o custo vem da operação, 2.2.3).
    for (const field of ['purchasePriceCents', 'purchaseStoreId', 'fxRateAtPurchase']) {
      if (hasKey(body, field) && (field === 'purchasePriceCents' || !isNil(body[field]))) {
        throw new AppError(422, 'GENERATED_COST_NOT_ALLOWED', 'Item gerado por uma abertura não tem loja, preço nem cotação próprios.', { field });
      }
    }
  } else if (isGanhei) {
    // GANHEI: custo fixo US$ 0,00, sem cotação; a loja é só informativa (D65).
    if (hasKey(body, 'purchasePriceCents')) {
      throw new ValidationError('Item ganho tem custo fixo US$ 0,00; não informe preço de compra.', 'GANHEI_COST_NOT_ALLOWED', { field: 'purchasePriceCents' });
    }
    // `fxRateAtPurchase: null` equivale a "sem cotação" e é aceito (T35 b, D73).
    if (hasKey(body, 'fxRateAtPurchase') && !isNil(body.fxRateAtPurchase)) {
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
      saleHoldDaysApplied: store.saleHoldDays, // snapshot da retenção vigente (D214)
    },
    sale: { netReceivedCents, feeCents, netReceivedManual, saleHoldDaysApplied: store.saleHoldDays },
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

// Lugar onde a unidade foi consumida (operação ativa): { operationId, occurredAt, targetItemId, targetName }, ou null.
function consumedInOf(item, opCtx) {
  if (item.status !== 'CONSUMIDO') return null;
  const link = opCtx.consumedByItem.get(item.id);
  if (!link) return null;
  const operation = opCtx.opsById.get(link.operationId);
  // Na abertura o destino é a unidade gerada (`CREATED`), ou nenhum no terminal recusado (`lost`); na aplicação, o alvo (`TARGET`).
  const opening = Boolean(operation) && operation.kind.startsWith('OPEN_');
  const targetLink = (opCtx.linksByOperation.get(link.operationId) ?? []).find((l) => l.role === (opening ? 'CREATED' : 'TARGET'));
  const target = targetLink ? opCtx.itemsById.get(targetLink.itemId) : null;
  return {
    operationId: link.operationId,
    occurredAt: operation ? operation.occurredAt : item.consumedAt,
    kind: operation ? operation.kind : null,
    lost: Boolean(operation) && operation.outcome === 'LOST',
    targetItemId: targetLink ? targetLink.itemId : null,
    targetName: target ? target.name : null,
  };
}

// De onde a unidade veio (abertura ativa): { operationId, occurredAt, kind, container, decision, containerName, keyName }, ou null (D363 item 8).
function generatedFromOf(item, opCtx) {
  const link = opCtx.createdByItem.get(item.id);
  if (!link) return null;
  const operation = opCtx.opsById.get(link.operationId);
  if (!operation) return null;
  const consumed = (opCtx.linksByOperation.get(operation.id) ?? []).filter((l) => l.role === 'CONSUMED').map((l) => opCtx.itemsById.get(l.itemId));
  let detail = {};
  try {
    detail = operation.detailJson ? JSON.parse(operation.detailJson) : {};
  } catch (err) {
    detail = {};
  }
  return {
    operationId: operation.id,
    occurredAt: operation.occurredAt,
    kind: operation.kind,
    container: detail.container ?? null,
    decision: detail.decision ?? null,
    containerName: consumed[0] ? consumed[0].name : null,
    keyName: consumed[1] ? consumed[1].name : null,
  };
}

// Abertura possível da unidade em estoque: { kind, compatibleKeys, requiredKeyName } ou null (D363 item 9). `stockKeys`: chaves em estoque.
function openableOf(item, entry, stockKeys) {
  const kind = openingRules.openingKindOf(item, entry);
  if (!kind) return null;
  if (kind !== 'CASE') return { kind, compatibleKeys: 0, requiredKeyName: null };
  const compatibleKeys = stockKeys.filter((key) => key.id !== item.id && openingRules.keyMatchesCase(key.name, item.name)).length;
  return { kind, compatibleKeys, requiredKeyName: openingRules.caseKeyName(item.name) };
}

function toItemView(
  item,
  {
    stores, settings, statsIndex, catalogById = new Map(), externalSources = new Map(), componentsByItemId = new Map(), now = new Date(), thresholds,
    operationContext: opCtx = operationContextService.EMPTY_OPERATION_CONTEXT, stockKeys = [], valuationIndex = null,
  }
) {
  const inStock = item.status === 'EM_ESTOQUE';
  const componentRows = componentsByItemId.get(item.id) ?? [];
  const costIndex = opCtx.costIndex;
  const cost = costIndex.effectiveOf(item);
  const inheritedUsdCents = cost.inheritedUsdCents;
  const undoableOf = (row) => {
    const operation = opCtx.opsById.get(row.operationId);
    return operation ? operationContextService.assessUndo(operation, opCtx).undoable : false;
  };
  return {
    ...item,
    // Componentes (10.1, D344; 10.3, D362): os que vieram junto e os aplicados do estoque.
    components: itemComponentService.toView(componentRows, { catalogById, undoableOf }),
    componentSummary: itemComponentService.toSummary(componentRows),
    // Custo efetivo (D362): o próprio mais o dos componentes aplicados do estoque; o `purchasePrice` nunca muda.
    cost: { ownUsdCents: cost.ownUsdCents, inheritedUsdCents, effectiveUsdCents: cost.effectiveUsdCents, estimated: cost.estimated },
    consumedIn: consumedInOf(item, opCtx),
    generatedFrom: generatedFromOf(item, opCtx),
    openable: inStock ? openableOf(item, isNil(item.catalogId) ? null : catalogById.get(item.catalogId) ?? null, stockKeys) : null,
    canReceiveComponents: inStock && itemComponentService.allowedKindsFor(item.category).length > 0,
    // Origem da importação (D318): 'CSFLOAT' se o item tem vínculo de compra ou venda com a loja externa; senão null.
    externalSource: externalSources.get(item.id) ?? null,
    // Legado: sem vínculo com o catálogo numa categoria que o exige (D82).
    // Estado de venda (D265): só itens em estoque; vendido = null. `soldWhileOffSale`: vendido sem passar pela venda (sem giro).
    saleState: inStock ? (isOffSale(item) ? 'OFF_SALE' : 'FOR_SALE') : null,
    soldWhileOffSale: soldWhileOffSale(item),
    isLegacy: isNil(item.catalogId) && CATALOG_CATEGORIES.includes(item.category),
    catalog: isNil(item.catalogId) ? null : toCatalogSummary(catalogById.get(item.catalogId)),
    tradeLock: getTradeLockStatus(item.tradeUnlockAt, now),
    aging: getAging(item, { thresholds, now }),
    minPrices: inStock ? minPricesForItem({ item, stores, settings, costParts: costIndex.hasOperations ? cost.parts : undefined }) : null,
    saleProfitUsdCents: computeSaleProfitUsdCents(item, { inheritedUsdCents }),
    saleInfo: buildSaleInfo(item, settings ? settings.usdBrlRate : null, { inheritedUsdCents }),
    saleRelease: computeSaleRelease(item, now),
    stats: statsIndex.get(buildStatsKey(item)) ?? computeStats([item], { costIndex }),
    // Valor de mercado (10.5, D364): só informativo; vendida e consumida = null. Nunca entra no lucro real nem nos números do app.
    marketValue: valuationIndex ? valuationIndex.get(item.id) ?? null : null,
  };
}

// --- Orquestração -------------------------------------------------------------------------------

// Catálogo dos itens e dos componentes deles (uma consulta só).
function loadCatalogMap(items, componentsByItemId) {
  const ids = new Set(items.map((i) => i.catalogId).filter((id) => !isNil(id)));
  for (const rows of componentsByItemId.values()) for (const row of rows) if (!isNil(row.catalogId)) ids.add(row.catalogId);
  return new Map(catalogService.getCatalogItemsByIds([...ids]).map((c) => [c.id, c]));
}

function loadContext(ctxNow = new Date(), { withValuation = true } = {}) {
  const items = Item.findAll();
  const componentsByItemId = ItemComponent.listAll();
  const operationContext = operationContextService.loadOperationContext(items);
  const settings = Setting.get();
  const catalogById = loadCatalogMap(items, componentsByItemId);
  return {
    items, stores: Store.findAll(), settings, statsIndex: buildStatsIndex(items, { costIndex: operationContext.costIndex }),
    catalogById, componentsByItemId,
    valuationIndex: !withValuation ? null : buildValuationIndex({ items, componentsByItemId, catalogById, costIndex: operationContext.costIndex, usdBrlRate: settings.usdBrlRate, now: ctxNow }),
    externalSources: externalLinkService.sourcesByItemIds(), operationContext,
    stockKeys: items.filter((item) => item.status === 'EM_ESTOQUE' && openingRules.isKey(item)),
  };
}

// Grava e monta a resposta na mesma transação: se a montagem falhar, nada é gravado.
function inTransaction(fn) {
  return runInTransaction(fn);
}

// Itens do mesmo grupo de histórico (2.7), sem carregar o inventário inteiro (T27).
function loadStatsGroup({ category, name }, key) {
  return Item.findStatsCandidates({ category, name }).filter((item) => buildStatsKey(item) === key);
}

function viewOf(item, { now, thresholds }) {
  const key = buildStatsKey(item);
  const operationContext = operationContextService.loadOperationContext([item]);
  const statsIndex = new Map([[key, computeStats(loadStatsGroup(item, key), { costIndex: operationContext.costIndex })]]);
  const componentsByItemId = ItemComponent.listByItemIds([item.id]);
  const catalogById = loadCatalogMap([item], componentsByItemId);
  const externalSources = externalLinkService.sourcesByItemIds([item.id]);
  const settings = Setting.get();
  const valuationIndex = buildValuationIndex({
    items: [item], componentsByItemId, catalogById, costIndex: operationContext.costIndex, usdBrlRate: settings.usdBrlRate, now,
  });
  return toItemView(item, {
    stores: Store.findAll(), settings, valuationIndex, statsIndex, catalogById, externalSources, componentsByItemId, now, thresholds, operationContext,
    stockKeys: openingRules.needsKey(item) ? Item.findInStockByCategories(['OUTRO']).filter(openingRules.isKey) : [],
  });
}

// Valida a lista de componentes contra a categoria final do item e o catálogo (itemComponentService).
function normalizeComponentsFor(components, category, source = 'MANUAL', existingRows = []) {
  return itemComponentService.normalizeComponents(components, {
    category, source, existingRows, findCatalogById: (id) => catalogService.getCatalogItem(id),
  });
}

// `components` do PATCH (10.3, D362 item 7): a lista dos que VIERAM JUNTO; os aplicados do estoque ficam sempre, contam nos limites e só
// aceitam slot/wear/pattern por entrada com o `id` de um componente aplicado do próprio item. Devolve { came, appliedUpdates }.
function splitComponentInput(list, appliedRows) {
  const came = [];
  const appliedUpdates = [];
  list.forEach((entry, index) => {
    if (entry && entry.id !== undefined && entry.id !== null) {
      const row = appliedRows.find((r) => r.id === entry.id);
      if (!row) {
        throw new ValidationError('Componente inválido para este item.', 'INVALID_COMPONENT_FIELD', { field: 'components', params: { index, field: 'id' } });
      }
      const pick = (key) => (hasKey(entry, key) ? entry[key] : row[key]);
      const next = { slot: pick('slot'), wear: pick('wear'), pattern: pick('pattern') };
      itemComponentService.checkNumbers(row.kind, next, index);
      appliedUpdates.push({ id: row.id, ...next });
    } else {
      came.push(entry);
    }
  });
  return { came, appliedUpdates };
}

// Mudar a aquisição para depois de uma operação ativa da unidade quebraria o histórico (D362 item 7).
function assertAcquiredBeforeOperations(itemId, acquiredAtIso) {
  const active = operationContextService.loadActiveOperations();
  for (const link of active.links) {
    if (link.itemId !== itemId) continue;
    const operation = active.opsById.get(link.operationId);
    if (operation && Date.parse(acquiredAtIso) > Date.parse(operation.occurredAt)) {
      throw new AppError(422, 'OPERATION_DATE_INVALID', 'A data de aquisição não pode ser depois de uma operação da unidade.', {
        field: 'acquiredAt', params: { reason: 'ACQUIRED_AFTER_OPERATION', operationId: operation.id, occurredAt: operation.occurredAt },
      });
    }
  }
}

// Unidade criada por uma abertura (vínculo CREATED ativo): aquisição, loja de compra e data não mudam na edição (D363 item 7); para
// trocar, desfaz-se a abertura. Nome, atributos, componentes, trade lock, origem e (no terminal) preço e cotação são correção e podem mudar.
function assertGeneratedFieldsUnlocked(existing, partial) {
  if (!ItemOperation.findActiveCreatingOperation(existing.id)) return;
  const changed = (field) => {
    if (!hasKey(partial, field)) return false;
    if (field === 'acquiredAt') return toIso(partial.acquiredAt, 'Data de aquisição', { field }) !== toIso(existing.acquiredAt);
    return partial[field] !== existing[field];
  };
  for (const field of ['acquisitionType', 'purchaseStoreId', 'acquiredAt']) {
    if (changed(field)) {
      throw new ConflictError('Esta unidade veio de uma abertura: desfaça a abertura para mudar este campo.', 'GENERATED_FIELD_LOCKED', { field, params: { field } });
    }
  }
}

function findOrFail(id) {
  const item = Item.findById(id);
  if (!item) throw new NotFoundError('Item não encontrado.', 'ITEM_NOT_FOUND');
  return item;
}

// Unidade consumida por uma transformação (10.3, D362): não se vende, não vai para o holding e não se edita; desfaz-se a operação.
function assertNotConsumed(item) {
  if (item.status === 'CONSUMIDO') {
    throw new ConflictError('Esta unidade foi consumida. Desfaça a aplicação antes.', 'ITEM_CONSUMED', { params: { itemId: item.id } });
  }
}

// Filtros e ordenação comuns à lista individual e à agrupada (D272), nesta ordem: category, status, saleState, stagnantOnly e ordenação.
// `saleStateCounts` (D265, adendo 1 da revisão 8.6/8.7): sobre os itens em estoque, com a categoria, independente de status,
// saleState e stagnantOnly.
function selectItems(all, query, { now, thresholds }) {
  // Sem `status`, só EM_ESTOQUE e VENDIDO (D362 item 8): as consumidas só vêm com `status=CONSUMIDO`.
  let items = query.status ? all : all.filter((i) => i.status !== 'CONSUMIDO');
  if (query.category) items = items.filter((i) => i.category === query.category);
  const stock = items.filter((i) => i.status === 'EM_ESTOQUE');
  if (query.status) items = items.filter((i) => i.status === query.status);
  const saleStateCounts = { forSale: stock.filter((i) => !isOffSale(i)).length, offSale: stock.filter((i) => isOffSale(i)).length };
  if (query.saleState === 'FOR_SALE') items = items.filter((i) => i.status === 'EM_ESTOQUE' && !isOffSale(i));
  else if (query.saleState === 'OFF_SALE') items = items.filter((i) => isOffSale(i));
  if (query.stagnantOnly) items = filterStagnant(items, thresholds, now);
  if (query.sortBy === 'age') items = sortByAge(items, query.order ?? 'desc', now);
  else if (query.sortBy === 'turnaround') items = sortByTurnaround(items, query.order ?? 'asc');
  return { items, saleStateCounts };
}

function listItems(query = {}, { now = new Date(), thresholds = getAgingThresholds() } = {}) {
  const { items: all, stores, settings, statsIndex, catalogById, externalSources, componentsByItemId, operationContext, stockKeys, valuationIndex } = loadContext(now);
  const { items, saleStateCounts } = selectItems(all, query, { now, thresholds });

  return {
    items: items.map((item) => toItemView(item, { stores, settings, statsIndex, catalogById, externalSources, componentsByItemId, now, thresholds, operationContext, stockKeys, valuationIndex })),
    meta: {
      count: items.length,
      saleStateCounts,
      fastTurnoverDays: thresholds.fastTurnoverDays,
      slowItemDays: thresholds.slowItemDays,
      usdBrlRate: settings.usdBrlRate,
      generatedAt: now.toISOString(),
    },
  };
}

// Visão agrupada (D271-D275): só itens em estoque, mesma seleção e ordenação da lista individual. Os grupos seguem a
// ordem da primeira aparição na lista ordenada; `stock` conta todo o estoque da chave, independente da aba e dos filtros.
function listItemGroups(query = {}, { now = new Date(), thresholds = getAgingThresholds() } = {}) {
  const { items: all, stores, settings, statsIndex, catalogById, externalSources, componentsByItemId, operationContext, stockKeys, valuationIndex } = loadContext(now);
  const { items, saleStateCounts } = selectItems(all, { ...query, status: 'EM_ESTOQUE' }, { now, thresholds });

  const stockByKey = new Map();
  for (const item of all) {
    if (item.status !== 'EM_ESTOQUE') continue;
    const key = buildStatsKey(item);
    if (!stockByKey.has(key)) stockByKey.set(key, []);
    stockByKey.get(key).push(item);
  }

  const groups = groupByStatsKey(items).map(({ key, items: units }) => {
    const first = units[0];
    const withCatalog = units.find((u) => !isNil(u.catalogId) && catalogById.has(u.catalogId));
    return {
      key,
      name: first.name,
      category: first.category,
      variant: first.variant,
      exterior: first.exterior,
      phase: first.phase,
      catalog: withCatalog ? toCatalogSummary(catalogById.get(withCatalog.catalogId)) : null,
      // QTD e custos do grupo inteiro em estoque (9.5.1a, D334 revista pelo usuário): batem com "X à venda · Y no holding";
      // ao expandir aparecem só as unidades da aba e dos filtros.
      ...summarizeGroupCost(stockByKey.get(key) ?? units, settings.usdBrlRate, { costIndex: operationContext.costIndex }),
      // Unidades do grupo em estoque com algum componente (10.1, D344); fora da chave do agrupamento (2.7).
      // Valor de mercado do estoque inteiro do grupo (10.5, D364), só informativo.
      marketValue: groupValuation(stockByKey.get(key) ?? units, valuationIndex, settings.usdBrlRate),
      componentUnits: (stockByKey.get(key) ?? units).filter((u) => (componentsByItemId.get(u.id) ?? []).length > 0).length,
      stagnantCount: countStagnant(units, thresholds, now),
      stock: summarizeStockStates(stockByKey.get(key) ?? [], now),
      units: units.map((item) => toItemView(item, { stores, settings, statsIndex, catalogById, externalSources, componentsByItemId, now, thresholds, operationContext, stockKeys, valuationIndex })),
    };
  });

  return {
    groups,
    meta: {
      count: items.length,
      groupCount: groups.length,
      saleStateCounts,
      fastTurnoverDays: thresholds.fastTurnoverDays,
      slowItemDays: thresholds.slowItemDays,
      usdBrlRate: settings.usdBrlRate,
      generatedAt: now.toISOString(),
    },
  };
}

// Vendas (D124/D127): lista filtrada/ordenada + resumo sobre o mesmo conjunto. Estatísticas usam todos os itens.
function listSales(query = {}, { now = new Date(), thresholds = getAgingThresholds() } = {}) {
  const { items: all, stores, settings, statsIndex, catalogById, externalSources, componentsByItemId, operationContext, stockKeys } = loadContext(now, { withValuation: false });
  let items = all.filter((i) => i.status === 'VENDIDO');
  if (!isNil(query.saleStoreId)) items = items.filter((i) => i.saleStoreId === query.saleStoreId);
  items = filterSoldInPeriod(items, { soldFrom: query.soldFrom, soldTo: query.soldTo });
  const sortKey = query.sortBy ?? 'soldAt';
  if (sortKey === 'turnaround') items = sortByTurnaround(items, query.order ?? 'asc');
  else items = sortBySoldAt(items, query.order ?? 'desc');
  return {
    items: items.map((item) => toItemView(item, { stores, settings, statsIndex, catalogById, externalSources, componentsByItemId, now, thresholds, operationContext, stockKeys })),
    summary: computeSalesSummary(items, { usdBrlRate: settings.usdBrlRate, costIndex: operationContext.costIndex }),
    meta: {
      count: items.length,
      fastTurnoverDays: thresholds.fastTurnoverDays,
      slowItemDays: thresholds.slowItemDays,
      usdBrlRate: settings.usdBrlRate,
      generatedAt: now.toISOString(),
      soldFrom: query.soldFrom ?? null,
      soldTo: query.soldTo ?? null,
    },
  };
}

function getItem(id, ctx = {}) {
  const { now = new Date(), thresholds = getAgingThresholds() } = ctx;
  return viewOf(findOrFail(id), { now, thresholds });
}

// --- Holding em lote (9.5.1a, D332) --------------------------------------------------------------------------------------

// Unidades do pedido: por grupo (`groupKey` + `quantity`, a escolha é a de `pickUnitsForSaleState`) ou por seleção (`itemIds`).
// Tudo numa transação (tudo ou nada), com o mesmo `now`. Devolve { movedIds, movedCount, unchangedCount }.
function bulkChangeSaleState(direction, body, ctx = {}) {
  const { now = new Date() } = ctx;
  let targetIds;
  let unchangedCount = 0;
  if (body.groupKey !== undefined) {
    const units = Item.findAll({ status: 'EM_ESTOQUE' }).filter((item) => buildStatsKey(item) === body.groupKey);
    const pick = pickUnitsForSaleState(units, { direction, quantity: body.quantity ?? null });
    if (pick.exceeded) {
      throw new ConflictError(
        `Só há ${pick.available} unidade(s) disponível(is) para mover. Recarregue a lista e tente de novo.`,
        'BULK_QUANTITY_EXCEEDS_AVAILABLE',
        { field: 'quantity', params: { available: pick.available } }
      );
    }
    targetIds = pick.picked;
  } else {
    targetIds = [];
    for (const id of body.itemIds) {
      const item = Item.findById(id);
      if (!item) throw new NotFoundError('Item não encontrado.', 'ITEM_NOT_FOUND', { params: { itemId: id } });
      assertNotConsumed(item);
      if (item.status !== 'EM_ESTOQUE') throw new ConflictError('Item já vendido.', 'ITEM_ALREADY_SOLD', { params: { itemId: id } });
      const alreadyThere = direction === 'OFF_SALE' ? isOffSale(item) : !isOffSale(item);
      if (alreadyThere) unchangedCount += 1;
      else targetIds.push(id);
    }
  }
  const stamp = now.toISOString();
  const patch = direction === 'OFF_SALE' ? { offSaleAt: stamp } : { forSaleSince: stamp, offSaleAt: null };
  inTransaction(() => {
    for (const id of targetIds) Item.update(id, patch, { now });
  });
  return { movedIds: targetIds, movedCount: targetIds.length, unchangedCount };
}

const bulkMarkOffSale = (body, ctx) => bulkChangeSaleState('OFF_SALE', body, ctx);
const bulkMarkForSale = (body, ctx) => bulkChangeSaleState('FOR_SALE', body, ctx);

// Ordem real das validações do POST /api/items (T28; a primeira falha vence):
//  1. Forma do corpo, em middlewares/itemValidators (tipos, campos desconhecidos, formatos): 400.
//  2. Identidade, em resolveItemIdentity: CATALOG_DERIVED_FIELD -> CATALOG_ITEM_NOT_FOUND -> CATALOG_ITEM_REQUIRED
//     -> REQUIRED_FIELD/FIELD_TOO_LONG do nome (categorias de nome livre) -> CATALOG_ITEM_REQUIRED (passe de batalha do catálogo).
//  3. Loja da compra existe (getStoreOrFail): STORE_NOT_FOUND.
//  4. buildItemRecord: nome -> tipo de aquisição -> custo (GANHEI: GANHEI_COST_NOT_ALLOWED/FX_RATE_NOT_ALLOWED;
//     COMPRA: PURCHASE_STORE_REQUIRED -> PURCHASE_PRICE_REQUIRED -> INVALID_AMOUNT -> teto -> cotação) -> atributos de
//     arma (normalizeAttributes) -> data de aquisição (inválida, futura) -> liberação da troca.
//  5. Faixa de float do catálogo (assertFloatInCatalogRange).
//  6. Componentes (itemComponentService): COMPONENTS_NOT_ALLOWED -> COMPONENT_LIMIT_EXCEEDED -> campos -> catálogo -> slot.
//  Opções INTERNAS do contexto, só da importação (o controller nunca as passa; D361): `componentSource` ('CSFLOAT') grava os
//  componentes com essa origem, e `componentsImportedAt` marca que a importação já cuidou dos componentes da unidade.
// Montagem do registro e dos componentes de uma unidade nova, sem gravar (D363 item 4): a mesma regra do `createItem`. Sem `acquisition`,
// a aquisição vem do próprio corpo (cadastro). Com ele (abertura), é `{ type: 'GERADO' }` ou `{ type: 'COMPRA', store, priceCents }` (a
// cotação, se for BRL, vem em `input.fxRateAtPurchase` ou das configurações) e a data é `acquiredAt`.
function prepareItemRecord(input, { acquisition = null, acquiredAt, now = new Date(), componentSource = 'MANUAL' } = {}) {
  const catalogEntry = loadCatalogEntry(input, null);
  const identity = resolveItemIdentity({
    body: input, catalogEntry, freeNameCatalogMatch: lookupFreeNameMatch(input, null),
  });
  const merged = { ...input, name: identity.name, category: identity.category, phase: identity.phase };
  delete merged.components;
  let store;
  let body = input;
  if (acquisition === null) {
    store = isNil(input.purchaseStoreId) ? null : getStoreOrFail(input.purchaseStoreId, { field: 'purchaseStoreId' });
  } else {
    merged.acquisitionType = acquisition.type;
    merged.acquiredAt = acquiredAt;
    body = {};
    if (acquisition.type === 'COMPRA') {
      store = acquisition.store;
      merged.purchaseStoreId = store.id;
      merged.purchasePriceCents = acquisition.priceCents;
      merged.fxRateAtPurchase = acquisition.fxRate ?? null;
    } else {
      store = null;
    }
  }
  const record = buildItemRecord(merged, { store, settings: Setting.get(), now, body, allowGenerated: acquisition !== null && acquisition.type === 'GERADO' });
  if (catalogEntry) assertFloatInCatalogRange(record.floatValue, catalogEntry);
  const components = hasKey(input, 'components') ? normalizeComponentsFor(input.components, identity.category, componentSource) : null;
  return { record: { ...record, catalogId: identity.catalogId }, components };
}

function createItem(input, ctx = {}) {
  const { now = new Date(), thresholds = getAgingThresholds(), componentSource = 'MANUAL', componentsImportedAt = null } = ctx;
  const { record, components } = prepareItemRecord(input, { now, componentSource });
  const importedStamp = componentsImportedAt ? new Date(componentsImportedAt).toISOString() : undefined;
  return inTransaction(() => {
    const created = Item.create({ ...record, componentsImportedAt: importedStamp }, { now });
    if (components && components.length > 0) ItemComponent.insertMany(created.id, components, { now });
    return viewOf(created, { now, thresholds });
  });
}

function updateItem(id, partial, ctx = {}) {
  const { now = new Date(), thresholds = getAgingThresholds() } = ctx;
  const existing = findOrFail(id);
  assertNotConsumed(existing);
  assertGeneratedFieldsUnlocked(existing, partial);
  const catalogEntry = loadCatalogEntry(partial, existing);
  const identity = resolveItemIdentity({
    body: partial, existing, catalogEntry, freeNameCatalogMatch: lookupFreeNameMatch(partial, existing),
  });
  const merged = { ...existing, ...partial, name: identity.name, category: identity.category, phase: identity.phase };
  delete merged.components;
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
  const record = buildItemRecord(merged, {
    store, settings: Setting.get(), now, existing, priceInformed, body: partial, allowGenerated: existing.acquisitionType === 'GERADO',
  });
  // Faixa de float do catálogo: ao trocar o item do catálogo ou o float (limites inclusivos).
  const catalogChanged = hasKey(partial, 'catalogId') && partial.catalogId !== existing.catalogId;
  if (catalogEntry && (catalogChanged || hasKey(partial, 'floatValue'))) {
    assertFloatInCatalogRange(record.floatValue, catalogEntry);
  }
  if (!existing.acquiredAt || toIso(existing.acquiredAt) !== record.acquiredAt) assertAcquiredBeforeOperations(id, record.acquiredAt);
  // Componentes (10.1, 10.3): presente = substitui a lista dos que vieram junto (os aplicados do estoque ficam); ausente = não mexe,
  // mas a categoria final precisa aceitar os já gravados.
  const currentRows = ItemComponent.listByItemIds([id]).get(id) ?? [];
  const appliedRows = currentRows.filter((row) => row.origin === 'APPLIED_FROM_STOCK');
  itemComponentService.assertExistingAllowed(appliedRows, identity.category);
  let components = null;
  let appliedUpdates = [];
  if (hasKey(partial, 'components')) {
    const split = splitComponentInput(partial.components, appliedRows);
    appliedUpdates = split.appliedUpdates;
    components = normalizeComponentsFor(split.came, identity.category, 'MANUAL', appliedRows);
  } else {
    itemComponentService.assertExistingAllowed(currentRows, identity.category);
  }
  return inTransaction(() => {
    const updated = Item.update(id, { ...record, catalogId: identity.catalogId }, { now });
    if (components) ItemComponent.replaceCameWithForItem(id, components, { now });
    for (const change of appliedUpdates) ItemComponent.updateNumbers(change.id, change, { now });
    return viewOf(updated, { now, thresholds });
  });
}

// Excluir um item importado desliga o vínculo e marca o registro externo como REMOVED_IN_APP (não volta a ser importado, D318).
function deleteItem(id, ctx = {}) {
  const { now = new Date() } = ctx;
  return inTransaction(() => {
    // Unidade em operação ativa não se exclui (D362 item 7): desfaz-se a operação antes. As desfeitas são apagadas (o RESTRICT impediria).
    if (ItemOperation.hasActiveLink(id)) {
      throw new ConflictError('Esta unidade participa de uma operação. Desfaça a operação antes de excluir.', 'ITEM_IN_OPERATION', { params: { itemId: id } });
    }
    ItemOperation.deleteUndoneForItem(id);
    externalLinkService.detachOnRemove('ITEM_PURCHASE', id, { now });
    externalLinkService.detachOnRemove('ITEM_SALE', id, { now });
    if (!Item.remove(id)) throw new NotFoundError('Item não encontrado.', 'ITEM_NOT_FOUND');
    return { id };
  });
}

// `ctx.saleReleaseAt` (ISO ou null): só a importação do CSFloat informa a liberação real (D312). Nunca vem do corpo da API
// (o validador recusa o campo), então as vendas manuais continuam com a retenção da loja.
function sellItem(id, input, ctx = {}) {
  const { now = new Date(), thresholds = getAgingThresholds(), saleReleaseAt = null } = ctx;
  const item = findOrFail(id);
  assertNotConsumed(item);
  if (item.status !== 'EM_ESTOQUE') throw new ConflictError('Item já vendido.', 'ITEM_ALREADY_SOLD');
  const store = getStoreOrFail(input.saleStoreId, { field: 'saleStoreId' });
  const { record, sale } = buildSaleRecord(item, input, { store, settings: Setting.get(), now });
  if (saleReleaseAt !== null) record.saleReleaseAt = toIso(saleReleaseAt);
  const view = inTransaction(() => viewOf(Item.update(id, record, { now }), { now, thresholds }));
  return { item: view, sale: { ...sale, saleProfitUsdCents: view.saleProfitUsdCents } };
}

function unsellItem(id, ctx = {}) {
  const { now = new Date(), thresholds = getAgingThresholds() } = ctx;
  const item = findOrFail(id);
  assertNotConsumed(item);
  if (item.status !== 'VENDIDO') throw new ConflictError('Item não está vendido.', 'ITEM_NOT_SOLD');
  return inTransaction(() => {
    externalLinkService.detachOnRemove('ITEM_SALE', id, { now });
    return viewOf(Item.update(id, buildUnsellPatch(), { now }), { now, thresholds });
  });
}

// Atualiza a liberação real de uma venda importada (D312): o CSFloat mudou o `verify_sale_at` ou chegou o `trade_verified`.
// Só para itens vendidos; devolve o item gravado (ou o mesmo, se nada mudou).
function updateImportedSaleRelease(id, saleReleaseAt, ctx = {}) {
  const { now = new Date() } = ctx;
  const item = findOrFail(id);
  if (item.status !== 'VENDIDO') throw new ConflictError('Item não está vendido.', 'ITEM_NOT_SOLD');
  const next = isNil(saleReleaseAt) ? null : toIso(saleReleaseAt);
  if ((item.saleReleaseAt ?? null) === next) return item;
  return Item.update(id, { saleReleaseAt: next }, { now });
}

// "Não está à venda" (D263, D265): grava `offSaleAt = now`. Só em estoque; já fora de venda = sem mudança (idempotente).
function markOffSale(id, ctx = {}) {
  const { now = new Date(), thresholds = getAgingThresholds() } = ctx;
  const item = findOrFail(id);
  assertNotConsumed(item);
  if (item.status !== 'EM_ESTOQUE') throw new ConflictError('Item já vendido.', 'ITEM_ALREADY_SOLD');
  if (isOffSale(item)) return { item: viewOf(item, { now, thresholds }) };
  return { item: inTransaction(() => viewOf(Item.update(id, { offSaleAt: now.toISOString() }, { now }), { now, thresholds })) };
}

// "Colocar à venda" (D263, D265): grava `forSaleSince = now` e limpa `offSaleAt`; o giro recomeça. Já à venda = sem mudança.
function markForSale(id, ctx = {}) {
  const { now = new Date(), thresholds = getAgingThresholds() } = ctx;
  const item = findOrFail(id);
  assertNotConsumed(item);
  if (item.status !== 'EM_ESTOQUE') throw new ConflictError('Item já vendido.', 'ITEM_ALREADY_SOLD');
  if (!isOffSale(item)) return { item: viewOf(item, { now, thresholds }) };
  const patch = { forSaleSince: now.toISOString(), offSaleAt: null };
  return { item: inTransaction(() => viewOf(Item.update(id, patch, { now }), { now, thresholds })) };
}

function getItemStats({ name, category, variant, exterior, phase }) {
  const key = buildStatsKey({ name, category, variant, exterior, phase });
  const group = loadStatsGroup({ category, name }, key);
  return { key, ...computeStats(group, { costIndex: operationContextService.loadOperationContext(group).costIndex }) };
}

module.exports = {
  prepareItemRecord,
  resolveItemIdentity,
  buildItemRecord,
  buildSaleRecord,
  buildUnsellPatch,
  toItemView,
  listItems,
  listItemGroups,
  listSales,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  sellItem,
  unsellItem,
  updateImportedSaleRelease,
  markOffSale,
  markForSale,
  bulkMarkOffSale,
  bulkMarkForSale,
  getItemStats,
};
