'use strict';

const { normalizeName, buildStatsKey, computeStats, buildStatsIndex } = require('../../src/services/itemStatsService');

const DAY = 86400000;
const ACQ = '2026-10-01T12:00:00.000Z';
const at = (days) => new Date(Date.parse(ACQ) + days * DAY).toISOString();

const base = { name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', exterior: 'FT', acquiredAt: ACQ };
const inStock = (cost, extra = {}) => ({
  ...base, status: 'EM_ESTOQUE', purchasePriceCents: cost, purchaseCurrency: 'USD', fxRateAtPurchase: null, ...extra,
});
const soldUsd = (cost, salePrice, net, days, extra = {}) => ({
  ...inStock(cost),
  status: 'VENDIDO',
  salePriceCents: salePrice,
  saleCurrency: 'USD',
  fxRateAtSale: null,
  netReceivedCents: net,
  soldAt: at(days),
  ...extra,
});

describe('itemStatsService — chave', () => {
  test('nome normalizado: "  AK-47 |  Redline " e "ak-47 | redline" → mesma chave', () => {
    expect(normalizeName('  AK-47 |  Redline ')).toBe('ak-47 | redline');
    expect(buildStatsKey({ ...base, name: '  AK-47 |  Redline ' })).toBe(buildStatsKey({ ...base, name: 'ak-47 | redline' }));
  });

  test('variant, exterior ou categoria diferentes → chaves diferentes', () => {
    const k = buildStatsKey(base);
    expect(buildStatsKey({ ...base, variant: 'STATTRAK' })).not.toBe(k);
    expect(buildStatsKey({ ...base, exterior: 'MW' })).not.toBe(k);
    expect(buildStatsKey({ ...base, category: 'FACA' })).not.toBe(k);
    expect(buildStatsKey({ ...base, phase: 'Ruby' })).not.toBe(k);
  });

  test('fase entra na chave (Q8): normalizada; ausente forma grupo próprio', () => {
    const knife = { name: 'Karambit | Doppler', category: 'FACA', variant: 'NORMAL', exterior: 'FN' };
    expect(buildStatsKey({ ...knife, phase: ' Ruby ' })).toBe(buildStatsKey({ ...knife, phase: 'ruby' }));
    expect(buildStatsKey({ ...knife, phase: 'Ruby' })).not.toBe(buildStatsKey({ ...knife, phase: 'Phase 2' }));
    expect(buildStatsKey({ ...knife, phase: null })).not.toBe(buildStatsKey({ ...knife, phase: 'Ruby' }));
    expect(buildStatsKey({ ...knife, phase: null })).toBe(buildStatsKey(knife));
  });

  test('variant/exterior nulos viram vazio', () => {
    expect(buildStatsKey({ name: 'Caixa Revolution', category: 'CAIXA', variant: null, exterior: null })).toBe(
      'caixa revolution|CAIXA|||'
    );
  });
});

describe('itemStatsService.computeStats', () => {
  test('P3: só itens em estoque (100 e 200) → soldCount 0, avgPurchaseCost 150, demais null', () => {
    expect(computeStats([inStock(100), inStock(200)])).toEqual({
      unitCount: 2,
      soldWithFxCount: 0,
      soldCount: 0,
      soldOffSaleCount: 0,
      avgDaysToSell: null,
      avgPurchaseCostUsdCents: 150,
      avgSalePriceUsdCents: null,
      avgProfitUsdCents: null,
    });
  });

  test('lista vazia → avgPurchaseCost null', () => {
    expect(computeStats([])).toEqual({
      unitCount: 0, soldWithFxCount: 0, soldCount: 0, soldOffSaleCount: 0, avgDaysToSell: null, avgPurchaseCostUsdCents: null, avgSalePriceUsdCents: null, avgProfitUsdCents: null,
    });
  });

  test('P3: 2 vendidos (100/300, 3 e 4 dias) + 1 em estoque (200)', () => {
    const items = [soldUsd(100, 200, 190, 3), soldUsd(300, 500, 480, 4), inStock(200)];
    expect(computeStats(items)).toEqual({
      unitCount: 3,
      soldWithFxCount: 0,
      soldCount: 2,
      soldOffSaleCount: 0,
      avgDaysToSell: 3.5,
      avgPurchaseCostUsdCents: 200, // (100 + 300 + 200) / 3
      avgSalePriceUsdCents: 350, // só vendidos
      avgProfitUsdCents: 135, // (90 + 180) / 2
    });
  });

  test('venda Steam BRL convertida com fxRateAtSale do item', () => {
    const item = soldUsd(100, 1150, 1000, 5, { saleCurrency: 'BRL', fxRateAtSale: 5.0 });
    expect(computeStats([item])).toMatchObject({ soldCount: 1, avgSalePriceUsdCents: 230, avgProfitUsdCents: 100 });
  });

  test('custo BRL convertido com fxRateAtPurchase do item', () => {
    const item = inStock(1000, { purchaseCurrency: 'BRL', fxRateAtPurchase: 4.0 });
    expect(computeStats([item]).avgPurchaseCostUsdCents).toBe(250);
  });

  test('arredondamento das médias (ROUND, meio para cima) e avgDaysToSell com 1 casa', () => {
    const items = [soldUsd(100, 200, 151, 1), soldUsd(101, 201, 152, 1), soldUsd(100, 200, 150, 2)];
    const s = computeStats(items);
    expect(s.avgDaysToSell).toBe(1.3); // 4/3
    expect(s.avgPurchaseCostUsdCents).toBe(100); // 100.33
    expect(s.avgSalePriceUsdCents).toBe(200); // 200.33
    expect(s.avgProfitUsdCents).toBe(51); // (51+51+50)/3 = 50.67
    const half = computeStats([inStock(100), inStock(101)]);
    expect(half.avgPurchaseCostUsdCents).toBe(101); // 100.5 → 101
  });

  test('lucro médio negativo arredonda afastando de zero', () => {
    const items = [soldUsd(100, 100, 98, 1), soldUsd(100, 100, 99, 1)]; // -2 e -1 → -1.5 → -2
    expect(computeStats(items).avgProfitUsdCents).toBe(-2);
  });
});

describe('itemStatsService.buildStatsIndex', () => {
  test('agrupa por chave normalizada', () => {
    const items = [
      soldUsd(100, 200, 190, 3, { name: 'AK-47 | Redline' }),
      inStock(300, { name: '  ak-47 |   REDLINE ' }),
      inStock(999, { variant: 'STATTRAK' }),
    ];
    const index = buildStatsIndex(items);
    expect(index.size).toBe(2);
    expect(index.get(buildStatsKey(base))).toMatchObject({ soldCount: 1, avgPurchaseCostUsdCents: 200 });
    expect(index.get(buildStatsKey({ ...base, variant: 'STATTRAK' }))).toMatchObject({ soldCount: 0, avgPurchaseCostUsdCents: 999 });
  });
});
