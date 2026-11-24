'use strict';

// Valor de mercado das unidades em estoque (D364 item 5; 2.13). Funções puras: nada é gravado, nada chama a rede. Só informativo:
// o lucro real, os saldos, o itemStats e o preço mínimo nunca importam este módulo.
const { MARKET_PRICE_STALE_HOURS } = require('../../config/constants');
const { ValidationError } = require('../../errors/AppError');
const { computeSale } = require('../pricingService');
const { buildPriceTarget } = require('./marketHashName');

const isNil = (v) => v === null || v === undefined;
const HANGING = ['CHARM', 'STICKER_SLAB'];

// A linha do cache tem preço (um OK, mesmo que a última tentativa tenha sido NOT_FOUND)?
const hasPrice = (row) => Boolean(row) && !isNil(row.basePriceCents) && !isNil(row.pricedAt);

// Desatualizado: preço há mais de `MARKET_PRICE_STALE_HOURS`, ou última tentativa sem resultado (NOT_FOUND) com preço antigo.
function isStaleRow(row, now) {
  if (!hasPrice(row)) return false;
  if (row.status === 'NOT_FOUND') return true;
  return now.getTime() - Date.parse(row.pricedAt) > MARKET_PRICE_STALE_HOURS * 3600000;
}

function priceOfSubject(subject, { priceOf, catalogById }) {
  const target = buildPriceTarget(subject, { catalogById });
  if (target.notPriceable) return { notPriceable: target.notPriceable, row: null };
  const row = priceOf(target.priceKey) ?? null;
  return { notPriceable: null, row: hasPrice(row) ? row : null, raw: row };
}

function netOf(valueCents, saleStore) {
  if (!saleStore) return { cents: null, reason: 'NO_INTEGRATION_STORE' };
  if (!Number.isSafeInteger(valueCents) || valueCents <= 0) return { cents: null, reason: 'NET_NOT_COMPUTABLE' };
  try {
    return { cents: computeSale({ salePriceCents: valueCents, store: saleStore }).netReceivedCents, reason: null };
  } catch (err) {
    if (err instanceof ValidationError) return { cents: null, reason: err.code === 'FEES_NOT_CONFIGURED' ? 'FEES_NOT_CONFIGURED' : 'NET_NOT_COMPUTABLE' };
    throw err;
  }
}

const EMPTY_PARTS = Object.freeze({ baseCents: null, hangingCents: null, stickersInfoCents: 0, patchesInfoCents: 0 });

function emptyValuation(status, extra = {}) {
  return {
    marketValueUsdCents: null, parts: { ...EMPTY_PARTS }, costUsdCents: null, costEstimated: false, unrealizedUsdCents: null,
    unrealizedNetUsdCents: null, netUnavailableReason: null, pricedAt: null, isStale: false, status, reason: null, isComplete: false,
    missing: [], basis: 'NAME', isEstimated: true, ...extra,
  };
}

// `priceOf(priceKey)` -> linha do cache ({ status, basePriceCents, pricedAt }) ou null. `costIndex`: índice de custo efetivo.
// `saleStore`: a loja da integração (para o líquido) ou null. Só `EM_ESTOQUE` tem valor; vendida e consumida -> null.
function valueUnit({ item, components = [], priceOf, catalogById = new Map(), costIndex, saleStore = null, now = new Date() }) {
  if (!item || item.status !== 'EM_ESTOQUE') return null;
  const env = { priceOf, catalogById };
  const cost = costIndex ? costIndex.effectiveOf(item) : { effectiveUsdCents: null, estimated: false };
  const costUsdCents = isNil(cost.effectiveUsdCents) ? null : cost.effectiveUsdCents;
  const costInfo = { costUsdCents, costEstimated: Boolean(cost.estimated) };

  const base = priceOfSubject(item, env);
  if (base.notPriceable) return emptyValuation('NOT_PRICEABLE', { ...costInfo, reason: base.notPriceable });
  // NOT_FOUND: a última tentativa não achou anúncio e não há preço anterior; NOT_FETCHED: ainda sem linha no cache (D365, B2).
  if (!base.row) return emptyValuation('NO_PRICE', { ...costInfo, reason: base.raw && base.raw.status === 'NOT_FOUND' ? 'NOT_FOUND' : 'NOT_FETCHED' });

  let hangingCents = null;
  let stale = isStaleRow(base.row, now);
  let missingHanging = false;
  let stickersInfoCents = 0;
  let patchesInfoCents = 0;
  let oldestPricedAt = base.row.pricedAt;
  for (const component of components) {
    const found = priceOfSubject(component, env);
    if (HANGING.includes(component.kind)) {
      if (found.row) {
        hangingCents = (hangingCents ?? 0) + found.row.basePriceCents;
        if (isStaleRow(found.row, now)) stale = true;
        if (Date.parse(found.row.pricedAt) < Date.parse(oldestPricedAt)) oldestPricedAt = found.row.pricedAt;
      } else missingHanging = true;
    } else if (found.row) {
      if (component.kind === 'STICKER') stickersInfoCents += found.row.basePriceCents;
      else if (component.kind === 'PATCH') patchesInfoCents += found.row.basePriceCents;
    }
  }
  const marketValueUsdCents = base.row.basePriceCents + (hangingCents ?? 0);
  const net = netOf(marketValueUsdCents, saleStore);
  return {
    marketValueUsdCents,
    parts: { baseCents: base.row.basePriceCents, hangingCents, stickersInfoCents, patchesInfoCents },
    ...costInfo,
    unrealizedUsdCents: costUsdCents === null ? null : marketValueUsdCents - costUsdCents,
    unrealizedNetUsdCents: costUsdCents === null || net.cents === null ? null : net.cents - costUsdCents,
    netUnavailableReason: net.reason,
    pricedAt: oldestPricedAt,
    isStale: stale,
    status: 'OK',
    reason: null,
    isComplete: !missingHanging,
    missing: missingHanging ? ['HANGING'] : [],
    basis: 'NAME',
    isEstimated: true,
  };
}

const sum = (list, pick) => list.reduce((acc, v) => acc + pick(v), 0);

// Totais só das unidades COM valor; os contadores cobrem todas as informadas (as nulas = vendida/consumida são ignoradas).
function summarize(unitValuations) {
  const units = unitValuations.filter(Boolean);
  const valued = units.filter((v) => v.status === 'OK');
  const withCost = valued.filter((v) => v.costUsdCents !== null);
  const withNet = valued.filter((v) => v.unrealizedNetUsdCents !== null);
  return {
    marketValueUsdCents: sum(valued, (v) => v.marketValueUsdCents),
    costUsdCents: sum(withCost, (v) => v.costUsdCents),
    unrealizedUsdCents: sum(withCost, (v) => v.unrealizedUsdCents),
    unrealizedNetUsdCents: sum(withNet, (v) => v.unrealizedNetUsdCents),
    costEstimated: valued.some((v) => v.costEstimated),
    pricedUnits: valued.length,
    netUnits: withNet.length,
    unpricedUnits: units.filter((v) => v.status === 'NO_PRICE').length,
    notPriceableUnits: units.filter((v) => v.status === 'NOT_PRICEABLE').length,
    staleUnits: valued.filter((v) => v.isStale).length,
    unitCount: units.length,
  };
}

// Proporção de cada parte no valor da unidade (base e pendurado), em fração de 0 a 1. Base da divisão do custo na 10.7.
function componentShares(valuation) {
  if (!valuation || valuation.status !== 'OK' || !valuation.marketValueUsdCents) return null;
  const total = valuation.marketValueUsdCents;
  const hanging = valuation.parts.hangingCents ?? 0;
  return { base: valuation.parts.baseCents / total, hanging: hanging / total };
}

module.exports = { MARKET_PRICE_STALE_HOURS, isStaleRow, valueUnit, summarize, componentShares };
