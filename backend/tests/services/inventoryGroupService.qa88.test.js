'use strict';

// QA 8.8: bordas do inventoryGroupService puro (D271-D275, D280).
const {
  groupByStatsKey, summarizeGroupCost, summarizeStockStates, countStagnant,
} = require('../../src/services/inventoryGroupService');
const { buildStatsKey } = require('../../src/services/itemStatsService');

const NOW = new Date('2026-11-19T12:00:00.000Z');
const DAY = 86400000;
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
const ahead = (d) => new Date(NOW.getTime() + d * DAY).toISOString();
const TH = { fastTurnoverDays: 7, slowItemDays: 21 };
const unit = (id, extra = {}) => ({
  id, name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', exterior: 'FT', phase: null, status: 'EM_ESTOQUE',
  acquiredAt: ago(40), purchasePriceCents: 1000, purchaseCurrency: 'USD', fxRateAtPurchase: null, ...extra,
});

describe('groupByStatsKey (bordas)', () => {
  test('lista vazia -> []', () => {
    expect(groupByStatsKey([])).toEqual([]);
  });

  test('a chave devolvida é a buildStatsKey do itemStats', () => {
    const [g] = groupByStatsKey([unit(1, { name: '  AK-47 |   Redline ' })]);
    expect(g.key).toBe(buildStatsKey(unit(1)));
  });

  test('categoria diferente com o mesmo nome não se junta', () => {
    expect(groupByStatsKey([unit(1), unit(2, { category: 'FACA' })])).toHaveLength(2);
  });

  test('fases diferentes não se juntam; fase com espaços/maiúsculas se junta', () => {
    const doppler = { name: 'Karambit | Doppler', category: 'FACA', exterior: 'FN' };
    const result = groupByStatsKey([
      unit(1, { ...doppler, phase: 'Phase 1' }),
      unit(2, { ...doppler, phase: 'Phase 2' }),
      unit(3, { ...doppler, phase: ' phase  1 ' }),
      unit(4, { ...doppler, phase: null }),
    ]);
    expect(result.map((g) => g.items.map((i) => i.id))).toEqual([[1, 3], [2], [4]]);
  });

  test('não altera a ordem interna das unidades nem muta a entrada', () => {
    const input = [unit(3), unit(1), unit(2)];
    const copy = [...input];
    expect(groupByStatsKey(input)[0].items.map((i) => i.id)).toEqual([3, 1, 2]);
    expect(input).toEqual(copy);
  });

  test('grupo de 1 unidade', () => {
    const result = groupByStatsKey([unit(1)]);
    expect(result).toHaveLength(1);
    expect(result[0].items).toHaveLength(1);
  });
});

describe('summarizeGroupCost (bordas)', () => {
  test('grupo de 1 unidade: média = total', () => {
    expect(summarizeGroupCost([unit(1, { purchasePriceCents: 777 })], 5)).toMatchObject({
      quantity: 1, totalCostUsdCents: 777, avgCostUsdCents: 777,
    });
  });

  test('lista vazia não divide por zero', () => {
    expect(summarizeGroupCost([], 5)).toMatchObject({ quantity: 0, totalCostUsdCents: 0, avgCostUsdCents: 0, costUsesRecordedFx: false });
  });

  test('BRL: cada unidade usa a cotação gravada na sua compra (cotações diferentes)', () => {
    const items = [
      unit(1, { purchasePriceCents: 500, purchaseCurrency: 'BRL', fxRateAtPurchase: 5 }),
      unit(2, { purchasePriceCents: 600, purchaseCurrency: 'BRL', fxRateAtPurchase: 6 }),
    ];
    expect(summarizeGroupCost(items, 4)).toMatchObject({ totalCostUsdCents: 200, avgCostUsdCents: 100, costUsesRecordedFx: true });
  });

  test('arredonda cada conversão BRL->USD e a média em centavos (ROUND)', () => {
    const items = [
      unit(1, { purchasePriceCents: 1000, purchaseCurrency: 'BRL', fxRateAtPurchase: 3 }),
      unit(2, { purchasePriceCents: 1000, purchaseCurrency: 'BRL', fxRateAtPurchase: 3 }),
    ];
    expect(summarizeGroupCost(items, 5)).toMatchObject({ totalCostUsdCents: 666, avgCostUsdCents: 333 });
    expect(summarizeGroupCost([unit(1, { purchasePriceCents: 1001 }), unit(2, { purchasePriceCents: 0 })], 5).avgCostUsdCents).toBe(501);
  });

  test('GANHEI (custo 0) junto de compra entra na média', () => {
    expect(summarizeGroupCost([unit(1, { purchasePriceCents: 0 }), unit(2, { purchasePriceCents: 1000 })], 5))
      .toMatchObject({ totalCostUsdCents: 1000, avgCostUsdCents: 500 });
  });

  test('approxBrl com a cotação das configurações; cotação inválida (0, negativa, NaN) -> null', () => {
    const items = [unit(1, { purchasePriceCents: 1000 })];
    expect(summarizeGroupCost(items, 5.4).approxBrl).toEqual({ totalCostCents: 5400, avgCostCents: 5400 });
    for (const bad of [0, -1, NaN, undefined]) expect(summarizeGroupCost(items, bad).approxBrl).toBeNull();
  });

  test('costUsesRecordedFx só olha a moeda da compra', () => {
    expect(summarizeGroupCost([unit(1), unit(2)], 5).costUsesRecordedFx).toBe(false);
  });
});

describe('summarizeStockStates (bordas)', () => {
  test('lista vazia', () => {
    expect(summarizeStockStates([], NOW)).toEqual({ forSale: 0, tradeLocked: 0, offSale: 0, nextUnlockAt: null });
  });

  test('a soma das três contagens = número de unidades em estoque (sem sobreposição)', () => {
    const items = [
      unit(1), unit(2, { tradeUnlockAt: ahead(1) }), unit(3, { offSaleAt: ago(1) }),
      unit(4, { offSaleAt: ago(1), tradeUnlockAt: ahead(9) }), unit(5, { tradeUnlockAt: ago(3) }), unit(6, { status: 'VENDIDO', tradeUnlockAt: ahead(1) }),
    ];
    const r = summarizeStockStates(items, NOW);
    expect(r.forSale + r.tradeLocked + r.offSale).toBe(5);
    expect(r).toEqual({ forSale: 2, tradeLocked: 1, offSale: 2, nextUnlockAt: ahead(1) });
  });

  test('nextUnlockAt ignora trade lock de itens em holding e já liberados', () => {
    const items = [
      unit(1, { offSaleAt: ago(1), tradeUnlockAt: ahead(1) }),
      unit(2, { tradeUnlockAt: ago(1) }),
      unit(3, { tradeUnlockAt: ahead(7) }),
    ];
    expect(summarizeStockStates(items, NOW).nextUnlockAt).toBe(ahead(7));
  });

  test('1 ms antes de liberar ainda é trade lock; exatamente agora é liberado', () => {
    const justBefore = new Date(NOW.getTime() + 1).toISOString();
    expect(summarizeStockStates([unit(1, { tradeUnlockAt: justBefore })], NOW)).toMatchObject({ tradeLocked: 1, forSale: 0, nextUnlockAt: justBefore });
    expect(summarizeStockStates([unit(1, { tradeUnlockAt: NOW.toISOString() })], NOW)).toMatchObject({ tradeLocked: 0, forSale: 1, nextUnlockAt: null });
  });

  test('menor data futura vale mesmo com a lista fora de ordem', () => {
    const items = [unit(1, { tradeUnlockAt: ahead(5) }), unit(2, { tradeUnlockAt: ahead(1) }), unit(3, { tradeUnlockAt: ahead(3) })];
    expect(summarizeStockStates(items, NOW).nextUnlockAt).toBe(ahead(1));
  });

  test('o relógio now é respeitado (mesmos dados, outro now)', () => {
    const items = [unit(1, { tradeUnlockAt: ahead(2) })];
    expect(summarizeStockStates(items, new Date(NOW.getTime() + 3 * DAY))).toMatchObject({ forSale: 1, tradeLocked: 0 });
  });
});

describe('countStagnant (bordas)', () => {
  test('limites: 21 dias à venda ainda não é agarrado; 22 é', () => {
    expect(countStagnant([unit(1, { acquiredAt: ago(21) })], TH, NOW)).toBe(0);
    expect(countStagnant([unit(1, { acquiredAt: ago(22) })], TH, NOW)).toBe(1);
  });

  test('conta a partir de tradeUnlockAt quando existe (liberado há pouco não é agarrado)', () => {
    expect(countStagnant([unit(1, { acquiredAt: ago(60), tradeUnlockAt: ago(2) })], TH, NOW)).toBe(0);
    expect(countStagnant([unit(1, { acquiredAt: ago(60), tradeUnlockAt: ago(30) })], TH, NOW)).toBe(1);
  });

  test('limites personalizados', () => {
    expect(countStagnant([unit(1, { acquiredAt: ago(15) })], { fastTurnoverDays: 3, slowItemDays: 10 }, NOW)).toBe(1);
  });

  test('vendidos não contam e lista vazia = 0', () => {
    expect(countStagnant([unit(1, { status: 'VENDIDO' })], TH, NOW)).toBe(0);
    expect(countStagnant([], TH, NOW)).toBe(0);
  });
});
