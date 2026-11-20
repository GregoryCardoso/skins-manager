'use strict';

// Histórico agregado por item igual (2.7). Métricas em USD (centavos) com a cotação gravada de cada item.
const { toUsdCents } = require('./currencyService');
const { roundCents } = require('./fees/rounding');
const { daysBetween } = require('./inventoryAgingService');
const { computeSaleProfitUsdCents, buildSaleInfo } = require('./profitService');
const { approxCounterpart } = require('./currencyService');

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

function computeStats(items) {
  const sold = items.filter((item) => item.status === 'VENDIDO');
  const unitCount = items.length;
  const soldWithFxCount = sold.filter(usesRecordedFx).length;
  const empty = {
    unitCount,
    soldWithFxCount,
    soldCount: 0,
    avgDaysToSell: null,
    avgPurchaseCostUsdCents: null,
    avgSalePriceUsdCents: null,
    avgProfitUsdCents: null,
  };
  const avgPurchaseCostUsdCents = items.length
    ? roundCents(
        mean(items.map((item) => toUsdCents(item.purchasePriceCents, item.purchaseCurrency, item.fxRateAtPurchase, 'ROUND'))),
        'ROUND'
      )
    : null;
  if (sold.length === 0) return { ...empty, avgPurchaseCostUsdCents };

  return {
    unitCount,
    soldWithFxCount,
    soldCount: sold.length,
    avgDaysToSell: Math.round(mean(sold.map((item) => daysBetween(item.acquiredAt, item.soldAt))) * 10) / 10,
    avgPurchaseCostUsdCents,
    avgSalePriceUsdCents: roundCents(
      mean(sold.map((item) => toUsdCents(item.salePriceCents, item.saleCurrency, item.fxRateAtSale, 'ROUND'))),
      'ROUND'
    ),
    avgProfitUsdCents: roundCents(mean(sold.map((item) => computeSaleProfitUsdCents(item))), 'ROUND'),
  };
}

function buildStatsIndex(items) {
  const groups = new Map();
  for (const item of items) {
    const key = buildStatsKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const index = new Map();
  for (const [key, group] of groups) index.set(key, computeStats(group));
  return index;
}

// Resumo das vendas já filtradas (D126). Tudo em USD com a cotação gravada de cada venda; "≈ R$" pela cotação atual.
function computeSalesSummary(items, { usdBrlRate = null } = {}) {
  const sold = items.filter((item) => item.status === 'VENDIDO');
  const infos = sold.map((item) => buildSaleInfo(item, usdBrlRate));
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
    avgTurnaroundDays: sold.length
      ? Math.round(mean(sold.map((item) => daysBetween(item.acquiredAt, item.soldAt))) * 10) / 10
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
