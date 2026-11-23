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
  const result = { total: 0, forSale: 0, tradeLocked: 0, offSale: 0, nextUnlockAt: null };
  let nextMs = null;
  for (const item of stockItems) {
    if (item.status !== 'EM_ESTOQUE') continue;
    result.total += 1;
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

// Unidades que uma ação em lote move (9.5.1a, D332). Função pura.
//   direction 'OFF_SALE': disponíveis = as à venda (inclusive em trade lock); vão as MAIS RECENTES (as antigas continuam à venda,
//                         coerente com a venda importada que tira a mais antiga primeiro, D299).
//   direction 'FOR_SALE': disponíveis = as do holding; voltam as MAIS ANTIGAS (as primeiras a serem vendidas).
//   quantity: inteiro >= 1 ou null (todas). Devolve { available, picked: ids } ou { available, exceeded: true }.
function pickUnitsForSaleState(units, { direction, quantity = null }) {
  const inStock = units.filter((u) => u.status === 'EM_ESTOQUE');
  const pool = inStock.filter((u) => (direction === 'OFF_SALE' ? !isOffSale(u) : isOffSale(u)));
  const ms = (u) => Date.parse(u.acquiredAt);
  const ordered = [...pool].sort((a, b) =>
    direction === 'OFF_SALE' ? ms(b) - ms(a) || b.id - a.id : ms(a) - ms(b) || a.id - b.id
  );
  const available = ordered.length;
  const wanted = quantity === null ? available : quantity;
  if (available === 0 || wanted > available) return { available, exceeded: true };
  return { available, picked: ordered.slice(0, wanted).map((u) => u.id) };
}

module.exports = { groupByStatsKey, summarizeGroupCost, summarizeStockStates, countStagnant, pickUnitsForSaleState };
