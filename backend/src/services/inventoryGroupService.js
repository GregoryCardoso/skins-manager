'use strict';

// Visão agrupada do inventário (8.8, D271-D275). Funções puras, sem banco: recebem os itens já filtrados e ordenados.
const { buildStatsKey } = require('./itemStatsService');
const { toUsdCents, approxBrlOf, isValidFxRate } = require('./currencyService');
const { roundCents } = require('./fees/rounding');
const { isOffSale, isInTradeLock, filterStagnant } = require('./inventoryAgingService');
const { parseDate } = require('./dateUtils');

// Agrupa pela chave do itemStats (2.7), na ordem da primeira aparição de cada chave. Devolve [{ key, items }].
function groupByStatsKey(sortedItems) {
  const groups = new Map();
  for (const item of sortedItems) {
    const key = buildStatsKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups].map(([key, items]) => ({ key, items }));
}

// Quantidade e custos em USD (cotação gravada em cada compra; GANHEI conta 0). `approxBrl` nulo sem cotação válida.
function summarizeGroupCost(items, usdBrlRate = null) {
  const quantity = items.length;
  const totalCostUsdCents = items.reduce(
    (sum, item) => sum + toUsdCents(item.purchasePriceCents, item.purchaseCurrency, item.fxRateAtPurchase, 'ROUND'),
    0
  );
  const avgCostUsdCents = quantity ? roundCents(totalCostUsdCents / quantity, 'ROUND') : 0;
  const hasRate = isValidFxRate(usdBrlRate);
  return {
    quantity,
    totalCostUsdCents,
    avgCostUsdCents,
    costUsesRecordedFx: items.some((item) => item.purchaseCurrency === 'BRL'),
    approxBrl: hasRate
      ? { totalCostCents: approxBrlOf(totalCostUsdCents, usdBrlRate), avgCostCents: approxBrlOf(avgCostUsdCents, usdBrlRate) }
      : null,
  };
}

// Situação do estoque da chave (D273): três contagens disjuntas. Fora de venda prevalece sobre o trade lock (D263).
function summarizeStockStates(stockItems, now = new Date()) {
  const result = { forSale: 0, tradeLocked: 0, offSale: 0, nextUnlockAt: null };
  let nextMs = null;
  for (const item of stockItems) {
    if (item.status !== 'EM_ESTOQUE') continue;
    if (isOffSale(item)) {
      result.offSale += 1;
    } else if (isInTradeLock(item, now)) {
      result.tradeLocked += 1;
      const ms = parseDate(item.tradeUnlockAt, 'Fim do trade lock').getTime();
      if (nextMs === null || ms < nextMs) {
        nextMs = ms;
        result.nextUnlockAt = item.tradeUnlockAt;
      }
    } else {
      result.forSale += 1;
    }
  }
  return result;
}

// Unidades agarradas (trade lock e fora de venda nunca contam).
function countStagnant(items, thresholds, now = new Date()) {
  return filterStagnant(items, thresholds, now).length;
}

module.exports = { groupByStatsKey, summarizeGroupCost, summarizeStockStates, countStagnant };
