'use strict';

// Casamento dos trades de compra com os lançamentos manuais (D298, D318 seção 8). Função pura: recebe os trades do lote e os
// candidatos (itens `COMPRA` da loja sem vínculo) e devolve, por trade, MATCH, NONE ou AMBIGUOUS. Ligar nunca altera o item (E9-Q10).
const { normalizeSearchText } = require('../catalog/csgoApiAdapter');
const { isWeaponCategory } = require('../itemAttributesService');

const FLOAT_EPSILON = 1e-7;
const DAY_MS = 86400000;

const isNil = (v) => v === null || v === undefined;

// Dia local (inteiro) de um instante ISO: o fuso do sistema, como o usuário digita as datas (E9-Q9).
function localDayNumber(iso) {
  const date = new Date(iso);
  return Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / DAY_MS);
}

// Mesmo item: mesmo `catalogId`; sem catálogo (legado ou OUTRO), o mesmo nome normalizado e a mesma categoria.
function sameItem(trade, candidate) {
  if (!isNil(trade.catalogId) && !isNil(candidate.catalogId)) return trade.catalogId === candidate.catalogId;
  if (!isNil(candidate.catalogId) || !isNil(trade.catalogId)) {
    // um lado tem catálogo e o outro não (item legado): compara pelo nome e categoria
    return candidate.category === trade.category && normalizeSearchText(candidate.name) === trade.nameKey;
  }
  return candidate.category === trade.category && normalizeSearchText(candidate.name) === trade.nameKey;
}

// Float da API igual ao manual: |Δ| < 1e-7, ou o manual tem até 6 casas e é igual ao da API arredondado a 6 casas.
function floatsMatch(apiFloat, manualFloat) {
  if (Math.abs(apiFloat - manualFloat) < FLOAT_EPSILON) return true;
  return Number(apiFloat.toFixed(6)) === manualFloat;
}

const phaseKey = (phase) => (isNil(phase) || phase === '' ? null : normalizeSearchText(phase));
const hasFloat = (entity) => isWeaponCategory(entity.category) && !isNil(entity.floatValue);

// Pares com float: mesma variante, mesma fase, float igual e `paintSeed` igual se os dois tiverem.
function sameUnit(trade, candidate) {
  if ((trade.variant || 'NORMAL') !== (candidate.variant || 'NORMAL')) return false;
  if (phaseKey(trade.phase) !== phaseKey(candidate.phase)) return false;
  if (!floatsMatch(trade.floatValue, candidate.floatValue)) return false;
  if (!isNil(trade.paintSeed) && !isNil(candidate.paintSeed) && trade.paintSeed !== candidate.paintSeed) return false;
  return true;
}

// trades: [{ key, catalogId, category, nameKey, variant, phase, floatValue, paintSeed, priceCents, date (ISO) }]
// candidates: itens (`id`, `catalogId`, `name`, `category`, `variant`, `phase`, `floatValue`, `paintSeed` e o preço/data da operação)
// `priceOf`/`dateOf`: preço e data da operação no candidato (compra: custo e aquisição; venda: preço e data da venda).
// Devolve Map key -> { kind: 'MATCH', itemId } | { kind: 'NONE' } | { kind: 'AMBIGUOUS', candidateIds }.
function matchTrades(trades, candidates, { localDayOf = localDayNumber, priceOf, dateOf }) {
  const results = new Map();
  const taken = new Set(); // candidatos ligados neste lote
  const available = (list) => list.filter((c) => !taken.has(c.id));
  const dayOfTrade = (trade) => localDayOf(trade.date);
  const dayOfCandidate = (candidate) => localDayOf(dateOf(candidate));
  const ordered = [...trades].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  // 1. Com float: os dois lados com float (SKIN/FACA/LUVA).
  const pending = [];
  for (const trade of ordered) {
    if (!hasFloat(trade)) {
      pending.push(trade);
      continue;
    }
    const matches = available(candidates).filter((c) => sameItem(trade, c) && hasFloat(c) && sameUnit(trade, c));
    if (matches.length === 0) {
      pending.push(trade); // pode casar na regra sem float (candidato sem float)
    } else if (matches.length === 1) {
      taken.add(matches[0].id);
      results.set(trade.key, { kind: 'MATCH', itemId: matches[0].id });
    } else {
      // Mais de um: o de dia local mais próximo, se a diferença for <= 1 dia e o segundo estiver a mais de 1 dia.
      const day = dayOfTrade(trade);
      const ranked = matches.map((c) => ({ c, diff: Math.abs(dayOfCandidate(c) - day) })).sort((a, b) => a.diff - b.diff || a.c.id - b.c.id);
      if (ranked[0].diff <= 1 && ranked[1].diff > 1) {
        taken.add(ranked[0].c.id);
        results.set(trade.key, { kind: 'MATCH', itemId: ranked[0].c.id });
      } else {
        results.set(trade.key, { kind: 'AMBIGUOUS', candidateIds: matches.map((c) => c.id) });
      }
    }
  }

  // 2. Sem float: agrupa trades e candidatos por (item, preço); janela do mesmo dia local ou do vizinho.
  const groups = new Map();
  for (const trade of pending) {
    const groupKey = `${trade.catalogId ?? `${trade.category}:${trade.nameKey}`}|${trade.variant || ''}|${phaseKey(trade.phase) || ''}|${trade.priceCents}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(trade);
  }
  for (const groupTrades of groups.values()) {
    const sample = groupTrades[0];
    const days = groupTrades.map(dayOfTrade);
    // candidatos do mesmo item e preço, sem float quando o trade tem float; e na janela de algum trade do grupo
    const pool = available(candidates).filter(
      (c) =>
        sameItem(sample, c)
        && priceOf(c) === sample.priceCents
        && (!hasFloat(sample) || !hasFloat(c))
        && (hasFloat(sample) || phaseKey(sample.phase) === phaseKey(c.phase))
        && days.some((d) => Math.abs(dayOfCandidate(c) - d) <= 1)
    );
    if (pool.length === 0) {
      for (const trade of groupTrades) results.set(trade.key, { kind: 'NONE' });
      continue;
    }
    const sortedTrades = [...groupTrades].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const sortedPool = [...pool].sort((a, b) => Date.parse(dateOf(a)) - Date.parse(dateOf(b)) || a.id - b.id);
    const fits = sortedTrades.length === sortedPool.length
      && sortedTrades.every((t, i) => Math.abs(dayOfCandidate(sortedPool[i]) - dayOfTrade(t)) <= 1);
    if (fits) {
      sortedTrades.forEach((trade, i) => {
        taken.add(sortedPool[i].id);
        results.set(trade.key, { kind: 'MATCH', itemId: sortedPool[i].id });
      });
    } else {
      const ids = sortedPool.map((c) => c.id);
      for (const trade of sortedTrades) results.set(trade.key, { kind: 'AMBIGUOUS', candidateIds: ids });
    }
  }
  return results;
}

// Compras: candidatos `COMPRA` da loja sem vínculo; preço = custo, data = aquisição (D298).
function matchPurchases(trades, candidates, { localDayOf = localDayNumber } = {}) {
  return matchTrades(trades, candidates, { localDayOf, priceOf: (c) => c.purchasePriceCents, dateOf: (c) => c.acquiredAt });
}

// Vendas (D299, primeiro passo): candidatos `VENDIDO` na loja sem vínculo de venda; preço = preço de venda, data = data da venda.
function matchSales(trades, candidates, { localDayOf = localDayNumber } = {}) {
  return matchTrades(trades, candidates, { localDayOf, priceOf: (c) => c.salePriceCents, dateOf: (c) => c.soldAt });
}

const sameVariant = (trade, unit) =>
  !isWeaponCategory(trade.category) || (trade.variant || 'NORMAL') === (unit.variant || 'NORMAL');

// Ordem da venda sem float (E9-Q11): as unidades à venda antes das do holding; dentro de cada grupo, a mais antiga.
function bySaleOrder(a, b) {
  const holdA = isNil(a.offSaleAt) ? 0 : 1;
  const holdB = isNil(b.offSaleAt) ? 0 : 1;
  return holdA - holdB || Date.parse(a.acquiredAt) - Date.parse(b.acquiredAt) || a.id - b.id;
}

// Unidade vendida por uma venda importada sem lançamento manual (D299). Função pura.
//   trade: { catalogId, category, nameKey, variant, phase, floatValue, paintSeed, date (ISO da venda) }
//   units: itens EM_ESTOQUE (de qualquer loja de compra); só contam os do mesmo item, comprados até a data da venda.
// Com float: a unidade de float igual (mesma regra da D298); duas ou mais -> AMBIGUOUS. Sem unidade de float igual, vale a regra
// sem float entre as unidades lançadas sem float. Sem float: a primeira na ordem de venda (à venda, depois holding; mais antiga).
// Devolve { kind: 'UNIT', itemId } | { kind: 'NONE' } | { kind: 'AMBIGUOUS', candidateIds }.
function pickSoldUnit(trade, units) {
  const saleMs = Date.parse(trade.date);
  const pool = units.filter(
    (u) => u.status === 'EM_ESTOQUE' && sameItem(trade, u) && !(Date.parse(u.acquiredAt) > saleMs) && sameVariant(trade, u)
  );
  let candidates = pool;
  if (hasFloat(trade)) {
    const exact = pool.filter((u) => hasFloat(u) && sameUnit(trade, u));
    if (exact.length === 1) return { kind: 'UNIT', itemId: exact[0].id };
    if (exact.length > 1) return { kind: 'AMBIGUOUS', candidateIds: exact.map((u) => u.id) };
    candidates = pool.filter((u) => !hasFloat(u) && phaseKey(u.phase) === phaseKey(trade.phase));
  } else {
    candidates = pool.filter((u) => phaseKey(u.phase) === phaseKey(trade.phase));
  }
  if (candidates.length === 0) return { kind: 'NONE' };
  return { kind: 'UNIT', itemId: [...candidates].sort(bySaleOrder)[0].id };
}

module.exports = { matchPurchases, matchSales, pickSoldUnit, localDayNumber, floatsMatch, sameItem, sameUnit };

