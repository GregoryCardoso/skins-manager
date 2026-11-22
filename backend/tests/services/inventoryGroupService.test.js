'use strict';

// 8.8 (D275): agrupamento puro do inventário.
const {
  groupByStatsKey, summarizeGroupCost, summarizeStockStates, countStagnant,
} = require('../../src/services/inventoryGroupService');

const NOW = new Date('2026-11-19T12:00:00.000Z');
const DAY = 86400000;
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
const ahead = (d) => new Date(NOW.getTime() + d * DAY).toISOString();
const TH = { fastTurnoverDays: 7, slowItemDays: 21 };
const unit = (id, extra = {}) => ({
  id, name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', exterior: 'FT', phase: null, status: 'EM_ESTOQUE',
  acquiredAt: ago(40), purchasePriceCents: 1000, purchaseCurrency: 'USD', fxRateAtPurchase: null, ...extra,
});

describe('groupByStatsKey', () => {
  test('ordem da primeira aparição; nome com maiúsculas e espaços diferentes cai no mesmo grupo', () => {
    const items = [unit(1, { name: 'AWP | Dragon Lore' }), unit(2), unit(3, { name: '  ak-47 |  REDLINE ' }), unit(4, { name: 'AWP | Dragon Lore' })];
    const result = groupByStatsKey(items);
    expect(result.map((g) => g.items.map((i) => i.id))).toEqual([[1, 4], [2, 3]]);
  });

  test('exterior, variante ou fase diferentes formam grupos próprios', () => {
    const result = groupByStatsKey([unit(1), unit(2, { exterior: 'FN' }), unit(3, { variant: 'STATTRAK' }), unit(4, { exterior: null }), unit(5, { phase: 'Phase 1' })]);
    expect(result).toHaveLength(5);
  });
});

describe('summarizeGroupCost', () => {
  test('tudo em USD', () => {
    expect(summarizeGroupCost([unit(1), unit(2, { purchasePriceCents: 500 })], 5)).toEqual({
      quantity: 2, totalCostUsdCents: 1500, avgCostUsdCents: 750, costUsesRecordedFx: false,
      approxBrl: { totalCostCents: 7500, avgCostCents: 3750 },
    });
  });

  test('USD + BRL converte pela cotação gravada e marca costUsesRecordedFx', () => {
    const result = summarizeGroupCost([unit(1), unit(2, { purchasePriceCents: 540, purchaseCurrency: 'BRL', fxRateAtPurchase: 5.4 })], 5);
    expect(result).toMatchObject({ quantity: 2, totalCostUsdCents: 1100, avgCostUsdCents: 550, costUsesRecordedFx: true });
  });

  test('só GANHEI: custo 0', () => {
    expect(summarizeGroupCost([unit(1, { purchasePriceCents: 0 })], 5)).toMatchObject({ totalCostUsdCents: 0, avgCostUsdCents: 0 });
  });

  test('média arredondada (1000 em 3 unidades = 333) e approxBrl nulo sem cotação', () => {
    const items = [unit(1, { purchasePriceCents: 500 }), unit(2, { purchasePriceCents: 250 }), unit(3, { purchasePriceCents: 250 })];
    const result = summarizeGroupCost(items, null);
    expect(result).toMatchObject({ totalCostUsdCents: 1000, avgCostUsdCents: 333, approxBrl: null });
  });
});

describe('summarizeStockStates', () => {
  test('três contagens disjuntas; fora de venda em trade lock conta só em offSale; nextUnlockAt é o menor', () => {
    const items = [
      unit(1),
      unit(2, { tradeUnlockAt: ahead(5) }),
      unit(3, { tradeUnlockAt: ahead(2) }),
      unit(4, { offSaleAt: ago(1) }),
      unit(5, { offSaleAt: ago(1), tradeUnlockAt: ahead(1) }),
      unit(6, { tradeUnlockAt: NOW.toISOString() }), // igualdade = liberado
      unit(7, { status: 'VENDIDO' }),
    ];
    expect(summarizeStockStates(items, NOW)).toEqual({ forSale: 2, tradeLocked: 2, offSale: 2, nextUnlockAt: ahead(2) });
  });

  test('sem bloqueados: nextUnlockAt nulo', () => {
    expect(summarizeStockStates([unit(1)], NOW).nextUnlockAt).toBeNull();
  });
});

describe('countStagnant', () => {
  test('fora de venda e trade lock nunca contam', () => {
    const items = [unit(1), unit(2, { offSaleAt: ago(1) }), unit(3, { tradeUnlockAt: ahead(2) }), unit(4, { acquiredAt: ago(2) })];
    expect(countStagnant(items, TH, NOW)).toBe(1);
  });
});
