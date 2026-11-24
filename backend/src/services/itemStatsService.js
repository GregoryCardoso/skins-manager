'use strict';

// Histórico agregado por item igual (2.7). Métricas em USD (centavos) com a cotação gravada de cada item.
const { toUsdCents } = require('./currencyService');
const { roundCents } = require('./fees/rounding');
const { turnaroundDaysOf, soldWhileOffSale } = require('./inventoryAgingService');
const { computeSaleProfitUsdCents, buildSaleInfo } = require('./profitService');
const { approxCounterpart } = require('./currencyService');
const { EMPTY_COST_INDEX } = require('./operations/costService');

function normalizeName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Chave do "mesmo item" (2.7, revisada em 2026-11-20): nome canônico + categoria + variante + exterior + fase.
// Variante, exterior ou fase ausentes formam grupo próprio.
function buildStatsKey({ name, category, variant, exterior, phase }) {
  return `${normalizeName(name)}|${category}|${variant ?? ''}|${exterior ?? ''}|${normalizeName(phase)}`;
}

const usesRecordedFx = (item) => item.saleCurrency === 'BRL' || item.purchaseCurrency === 'BRL';

const mean = (values) => values.reduce((acc, v) => acc + v, 0) / values.length;

// `costIndex`: custo efetivo (D362). As unidades consumidas (CONSUMIDO) não contam como unidade nem como venda: só no `consumedCount`.
function computeStats(allItems, { costIndex = EMPTY_COST_INDEX } = {}) {
  const items = allItems.filter((item) => item.status !== 'CONSUMIDO');
  const consumedCount = allItems.length - items.length;
  // Perdas (D363): unidades consumidas numa operação sem saída (terminal recusado) e o custo efetivo delas.
  const lostItems = allItems.filter((item) => item.status === 'CONSUMIDO' && costIndex.isLost(item));
  const lossCount = lostItems.length;
  const lossUsdCents = lostItems.reduce((acc, item) => acc + costIndex.effectiveUsdCents(item), 0);
  const sold = items.filter((item) => item.status === 'VENDIDO');
  const unitCount = items.length;
  const soldWithFxCount = sold.filter(usesRecordedFx).length;
  const profitOf = (item) => computeSaleProfitUsdCents(item, { inheritedUsdCents: costIndex.inheritedUsdCents(item) });
  const empty = {
    unitCount,
    consumedCount,
    lossCount,
    lossUsdCents,
    soldWithFxCount,
    soldCount: 0,
    soldOffSaleCount: 0,
    avgDaysToSell: null,
    avgPurchaseCostUsdCents: null,
    avgSalePriceUsdCents: null,
    avgProfitUsdCents: null,
  };
  const avgPurchaseCostUsdCents = items.length
    ? roundCents(mean(items.map((item) => costIndex.effectiveUsdCents(item))), 'ROUND')
    : null;
  if (sold.length === 0) return { ...empty, avgPurchaseCostUsdCents };
  // Vendas feitas fora de venda não têm giro e ficam fora do tempo médio (D263).
  const withTurnover = sold.filter((item) => !soldWhileOffSale(item));

  return {
    unitCount,
    consumedCount,
    lossCount,
    lossUsdCents,
    soldWithFxCount,
    soldCount: sold.length,
    soldOffSaleCount: sold.length - withTurnover.length,
    avgDaysToSell: withTurnover.length ? Math.round(mean(withTurnover.map((item) => turnaroundDaysOf(item))) * 10) / 10 : null,
    avgPurchaseCostUsdCents,
    avgSalePriceUsdCents: roundCents(
      mean(sold.map((item) => toUsdCents(item.salePriceCents, item.saleCurrency, item.fxRateAtSale, 'ROUND'))),
      'ROUND'
    ),
    avgProfitUsdCents: roundCents(mean(sold.map(profitOf)), 'ROUND'),
  };
}

function buildStatsIndex(items, { costIndex = EMPTY_COST_INDEX } = {}) {
  const groups = new Map();
  for (const item of items) {
    const key = buildStatsKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const index = new Map();
  for (const [key, group] of groups) index.set(key, computeStats(group, { costIndex }));
  return index;
}

// Resumo das vendas já filtradas (D126). Tudo em USD com a cotação gravada de cada venda; "≈ R$" pela cotação atual.
function computeSalesSummary(items, { usdBrlRate = null, costIndex = EMPTY_COST_INDEX } = {}) {
  const sold = items.filter((item) => item.status === 'VENDIDO');
  const withTurnover = sold.filter((item) => !soldWhileOffSale(item));
  const infos = sold.map((item) => buildSaleInfo(item, usdBrlRate, { inheritedUsdCents: costIndex.inheritedUsdCents(item) }));
  const sum = (pick) => infos.reduce((acc, info) => acc + pick(info), 0);
  const totalSalePriceUsdCents = sum((i) => i.salePriceUsdCents);
  const totalNetReceivedUsdCents = sum((i) => i.netReceivedUsdCents);
  const totalPurchaseCostUsdCents = sum((i) => i.purchaseCostUsdCents);
  const totalProfitUsdCents = totalNetReceivedUsdCents - totalPurchaseCostUsdCents;
  const approx = (cents) => {
    const r = approxCounterpart(cents, 'USD', usdBrlRate);
    return r ? r.cents : null;
  };
  return {
    count: sold.length,
    totalSalePriceUsdCents,
    totalNetReceivedUsdCents,
    totalPurchaseCostUsdCents,
    totalProfitUsdCents,
    avgTurnaroundDays: withTurnover.length
      ? Math.round(mean(withTurnover.map((item) => turnaroundDaysOf(item))) * 10) / 10
      : null,
    soldWithFxCount: infos.filter((i) => i.usesRecordedFx).length,
    approxBrl: {
      totalSalePrice: approx(totalSalePriceUsdCents),
      totalNetReceived: approx(totalNetReceivedUsdCents),
      totalProfit: approx(totalProfitUsdCents),
    },
  };
}

module.exports = { normalizeName, buildStatsKey, computeStats, buildStatsIndex, computeSalesSummary };
