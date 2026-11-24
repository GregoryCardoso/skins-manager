'use strict';

// Custo efetivo (D355, D362 item 3; 2.2.3): o custo próprio da unidade (o da compra, na cotação gravada, 2.9) mais o que ela recebeu
// das unidades consumidas por transformações ativas. Calculado na hora, nunca gravado. Funções puras: recebem os itens, as operações
// e os vínculos já carregados. Sem nenhuma operação, os números são idênticos aos de `purchase_price_cents` lido direto.
const { toUsdBase } = require('../currencyService');

const isNil = (v) => v === null || v === undefined;
const BP_TOTAL = 10000;

// Partes nativas do custo próprio (moeda e cotação gravadas na compra). `GERADO` não tem custo próprio. `GANHEI` guarda a parte
// de valor 0 em USD (o preço mínimo continua pedindo a cotação numa loja BRL, como antes).
function ownCostParts(item) {
  if (item.acquisitionType === 'GERADO') return [];
  return [{ cents: item.purchasePriceCents, currency: item.purchaseCurrency, fxRate: item.fxRateAtPurchase ?? null }];
}

// Custo próprio em USD (ROUND, como a 2.10) e se foi estimado (BRL convertido pela cotação gravada).
function ownCostUsd(item) {
  let usdCents = 0;
  let estimated = false;
  for (const part of ownCostParts(item)) {
    const base = toUsdBase(part.cents, part.currency, part.fxRate);
    if (base.estimated) estimated = true;
    usdCents = usdCents === null || base.usdCents === null ? null : usdCents + base.usdCents; // nulo: BRL sem cotação gravada (salvaguarda)
  }
  return { usdCents, estimated };
}

// Divide `poolCents` entre as saídas por frações em pontos-base que somam 10000 (E-P2-Q32): cada uma recebe o piso da sua parte, e o
// que sobrar vai para a maior fração (empate: a de menor id). `shares`: [{ id, bp }]. Devolve Map id -> centavos.
function splitPool(poolCents, shares) {
  const out = new Map();
  let given = 0;
  for (const { id, bp } of shares) {
    const part = Math.floor((poolCents * bp) / BP_TOTAL);
    out.set(id, part);
    given += part;
  }
  const rest = poolCents - given;
  if (rest !== 0 && shares.length > 0) {
    const best = [...shares].sort((a, b) => b.bp - a.bp || a.id - b.id)[0];
    out.set(best.id, out.get(best.id) + rest);
  }
  return out;
}

// `operations`: operações ATIVAS (as desfeitas são ignoradas aqui também). `links`: vínculos de qualquer operação.
// `itemsById`: Map id -> item (precisa ter as unidades consumidas).
function buildCostIndex({ itemsById = new Map(), operations = [], links = [] } = {}) {
  const active = new Map(operations.filter((op) => isNil(op.undoneAt)).map((op) => [op.id, op]));
  const linksByOperation = new Map();
  const receivingByItem = new Map(); // itemId -> vínculos TARGET/CREATED de operações ativas
  for (const link of links) {
    if (!active.has(link.operationId)) continue;
    if (!linksByOperation.has(link.operationId)) linksByOperation.set(link.operationId, []);
    linksByOperation.get(link.operationId).push(link);
    if (link.role === 'TARGET' || link.role === 'CREATED') {
      if (!receivingByItem.has(link.itemId)) receivingByItem.set(link.itemId, []);
      receivingByItem.get(link.itemId).push(link);
    }
  }
  const memo = new Map();
  const visiting = new Set();

  function poolOf(operationId) {
    let usdCents = 0;
    let estimated = false;
    const parts = [];
    for (const link of linksByOperation.get(operationId) ?? []) {
      if (link.role !== 'CONSUMED') continue;
      const consumed = itemsById.get(link.itemId);
      if (!consumed) throw new Error(`Unidade consumida ${link.itemId} não carregada para o cálculo do custo.`);
      const cost = compute(consumed);
      usdCents += cost.effectiveUsdCents;
      if (cost.estimated) estimated = true;
      parts.push(...cost.parts);
    }
    return { usdCents, estimated, parts };
  }

  // Fração (pontos-base) de `itemId` na operação, com a regra do centavo para várias saídas.
  function shareOf(operationId, itemId, poolCents) {
    const receivers = (linksByOperation.get(operationId) ?? []).filter((l) => l.role === 'TARGET' || l.role === 'CREATED');
    const shares = receivers.map((l) => ({ id: l.itemId, bp: isNil(l.costShareBp) ? BP_TOTAL : l.costShareBp }));
    const only = shares.length === 1 ? shares[0].bp === BP_TOTAL : false;
    const cents = only ? poolCents : splitPool(poolCents, shares).get(itemId) ?? 0;
    const bp = (shares.find((s) => s.id === itemId) || { bp: BP_TOTAL }).bp;
    return { cents, bp };
  }

  function ownOnly(item) {
    const own = ownCostUsd(item);
    return { ownUsdCents: own.usdCents, inheritedUsdCents: 0, effectiveUsdCents: own.usdCents, estimated: own.estimated, parts: ownCostParts(item) };
  }

  function compute(item) {
    // Sem nenhuma operação ativa o custo é o próprio (sem memória: itens de teste ou de passagem podem não ter id).
    if (active.size === 0) return ownOnly(item);
    if (memo.has(item.id)) return memo.get(item.id);
    if (visiting.has(item.id)) throw new Error('OPERATION_CYCLE');
    visiting.add(item.id);
    try {
      const own = ownCostUsd(item);
      let inherited = 0;
      let estimated = own.estimated;
      const parts = [...ownCostParts(item)];
      for (const link of receivingByItem.get(item.id) ?? []) {
        const pool = poolOf(link.operationId);
        const share = shareOf(link.operationId, item.id, pool.usdCents);
        inherited += share.cents;
        if (pool.estimated) estimated = true;
        for (const part of pool.parts) {
          parts.push(share.bp === BP_TOTAL ? part : { ...part, cents: Math.round((part.cents * share.bp) / BP_TOTAL) });
        }
      }
      const result = {
        ownUsdCents: own.usdCents,
        inheritedUsdCents: inherited,
        effectiveUsdCents: own.usdCents === null ? null : own.usdCents + inherited,
        estimated,
        parts,
      };
      memo.set(item.id, result);
      return result;
    } finally {
      visiting.delete(item.id);
    }
  }

  // Perdas por consumo (D363 item 5, E-P2-Q34): operações ativas sem saída (`LOST`, o terminal recusado). O custo da unidade consumida
  // vira perda realizada. Fora da fórmula do lucro real: ele já cai porque a unidade sai do estoque.
  const lostOperations = [...active.values()].filter((op) => op.outcome === 'LOST');
  const lostItemIds = new Set();
  for (const op of lostOperations) {
    for (const link of linksByOperation.get(op.id) ?? []) if (link.role === 'CONSUMED') lostItemIds.add(link.itemId);
  }

  function lossSummary() {
    let usdCents = 0;
    let estimated = false;
    for (const op of lostOperations) {
      const pool = poolOf(op.id);
      usdCents += pool.usdCents;
      if (pool.estimated) estimated = true;
    }
    return { usdCents, estimated, count: lostOperations.length };
  }

  return {
    hasOperations: active.size > 0,
    activeOperations: active,
    linksByOperation,
    // { ownUsdCents, inheritedUsdCents, effectiveUsdCents, estimated, parts }
    effectiveOf: compute,
    effectiveUsdCents: (item) => compute(item).effectiveUsdCents,
    inheritedUsdCents: (item) => compute(item).inheritedUsdCents,
    costParts: (item) => compute(item).parts,
    // Pool de uma operação ativa: { usdCents, estimated, parts } (D363 item 5).
    poolOf,
    // A unidade foi consumida numa operação sem saída (terminal recusado)? `isLost(item)` e o resumo das perdas.
    isLost: (item) => lostItemIds.has(item.id),
    lossSummary,
  };
}

// Índice sem nenhuma operação: o custo efetivo é o próprio.
const EMPTY_COST_INDEX = buildCostIndex();

module.exports = { ownCostParts, ownCostUsd, splitPool, buildCostIndex, EMPTY_COST_INDEX, BP_TOTAL };
