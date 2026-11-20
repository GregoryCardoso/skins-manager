'use strict';

// Lacunas QA da 4B.4 (D132): complementa salesSummary.test.js.
const { computeStats, computeSalesSummary, buildStatsIndex, buildStatsKey } = require('../../src/services/itemStatsService');
const { buildSaleInfo, computeSaleProfitUsdCents } = require('../../src/services/profitService');
const { isWithinSaoPauloDays, filterSoldInPeriod, sortBySoldAt } = require('../../src/services/inventoryAgingService');

const ACQ = '2026-10-01T12:00:00.000Z';
const knife = { name: 'Karambit | Doppler', category: 'FACA', variant: 'NORMAL', exterior: 'FN', acquiredAt: ACQ };
const mk = (extra) => ({
  id: 1, ...knife, status: 'VENDIDO', purchasePriceCents: 1000, purchaseCurrency: 'USD', fxRateAtPurchase: null,
  salePriceCents: 2000, saleCurrency: 'USD', fxRateAtSale: null, netReceivedCents: 1960, soldAt: '2026-10-11T12:00:00.000Z',
  ...extra,
});

describe('buildSaleInfo: casos extras', () => {
  test('compra BRL e venda BRL: duas cotações gravadas, lucro = saleProfitUsdCents', () => {
    const item = mk({
      purchaseCurrency: 'BRL', fxRateAtPurchase: 5, purchasePriceCents: 1000,
      saleCurrency: 'BRL', fxRateAtSale: 5.4, salePriceCents: 5400, netReceivedCents: 4700,
    });
    const info = buildSaleInfo(item, 6);
    expect(info.fxUsed).toEqual({ sale: 5.4, purchase: 5 });
    expect(info.usesRecordedFx).toBe(true);
    expect(info.purchaseCostUsdCents).toBe(200);
    expect(info.salePriceUsdCents).toBe(1000);
    expect(info.netReceivedUsdCents - info.purchaseCostUsdCents).toBe(computeSaleProfitUsdCents(item));
  });

  test('a cotação atual nunca altera os campos em USD, só approxBrl', () => {
    const item = mk({ saleCurrency: 'BRL', fxRateAtSale: 5.4, salePriceCents: 5400, netReceivedCents: 4700 });
    const a = buildSaleInfo(item, 5);
    const b = buildSaleInfo(item, 7.5);
    const strip = ({ approxBrl, ...rest }) => rest;
    expect(strip(a)).toEqual(strip(b));
    expect(b.approxBrl.profit).toBe(Math.round((b.netReceivedUsdCents - b.purchaseCostUsdCents) * 7.5));
  });

  test('venda em estoque com cotação undefined -> null (sem lançar)', () => {
    expect(buildSaleInfo({ status: 'EM_ESTOQUE' })).toBeNull();
  });

  test('GANHEI: custo 0 e compra USD sem cotação usada', () => {
    const info = buildSaleInfo(mk({ purchasePriceCents: 0, acquisitionType: 'GANHEI' }), 5);
    expect(info.purchaseCostUsdCents).toBe(0);
    expect(info.fxUsed.purchase).toBeNull();
    expect(info.approxBrl.purchaseCost).toBe(0);
  });

  test('cotação inválida (0) não gera approx', () => {
    expect(buildSaleInfo(mk(), 0).approxBrl.profit).toBeNull();
  });
});

describe('computeSalesSummary: identidades', () => {
  test('lucro = líquido - custo com todas as combinações de moeda', () => {
    const items = [
      mk({ id: 1 }),
      mk({ id: 2, saleCurrency: 'BRL', fxRateAtSale: 5.37, salePriceCents: 1234, netReceivedCents: 1111 }),
      mk({ id: 3, purchaseCurrency: 'BRL', fxRateAtPurchase: 5.11, purchasePriceCents: 9999 }),
      mk({ id: 4, purchaseCurrency: 'BRL', fxRateAtPurchase: 5.11, purchasePriceCents: 777, saleCurrency: 'BRL', fxRateAtSale: 5.9, salePriceCents: 333, netReceivedCents: 301 }),
    ];
    const s = computeSalesSummary(items, { usdBrlRate: 5.5 });
    expect(s.totalProfitUsdCents).toBe(s.totalNetReceivedUsdCents - s.totalPurchaseCostUsdCents);
    expect(s.totalProfitUsdCents).toBe(items.reduce((a, i) => a + computeSaleProfitUsdCents(i), 0));
    expect(s.soldWithFxCount).toBe(3);
    expect(s.count).toBe(4);
  });

  test('um item vendido; sem opções -> approx nulo', () => {
    const s = computeSalesSummary([mk({ soldAt: '2026-10-01T12:00:00.000Z' })]);
    expect(s.avgTurnaroundDays).toBe(0);
    expect(s.approxBrl.totalProfit).toBeNull();
  });

  test('média com 1 casa arredondada (2/3 -> 0.7)', () => {
    const items = [
      mk({ soldAt: '2026-10-01T12:00:00.000Z' }),
      mk({ soldAt: '2026-10-02T12:00:00.000Z' }),
      mk({ soldAt: '2026-10-02T12:00:00.000Z' }),
    ];
    expect(computeSalesSummary(items, { usdBrlRate: 5 }).avgTurnaroundDays).toBe(0.7);
  });
});

describe('itemStats com fase', () => {
  const ruby = (extra) => mk({ phase: 'Ruby', ...extra });
  const p2 = (extra) => mk({ phase: 'Phase 2', ...extra });

  test('Ruby, Phase 2 e sem fase da mesma faca ficam em grupos distintos', () => {
    const items = [
      ruby({ id: 1 }), ruby({ id: 2, status: 'EM_ESTOQUE' }),
      p2({ id: 3 }),
      mk({ id: 4 }), mk({ id: 5, phase: null }), mk({ id: 6, phase: '' }),
    ];
    const idx = buildStatsIndex(items);
    expect(idx.size).toBe(3);
    expect(idx.get(buildStatsKey(ruby())).unitCount).toBe(2);
    expect(idx.get(buildStatsKey(ruby())).soldCount).toBe(1);
    expect(idx.get(buildStatsKey(p2())).unitCount).toBe(1);
    expect(idx.get(buildStatsKey(mk())).unitCount).toBe(3);
  });

  test('fase com caixa e espaços diferentes cai no mesmo grupo', () => {
    expect(buildStatsKey(ruby())).toBe(buildStatsKey(ruby({ phase: '  ruby ' })));
  });

  test('unitCount inclui estoque; soldWithFxCount só vendidas; sem vendas', () => {
    const inStock = mk({ status: 'EM_ESTOQUE', saleCurrency: 'BRL', purchaseCurrency: 'BRL', fxRateAtPurchase: 5 });
    const s = computeStats([inStock, inStock]);
    expect(s).toMatchObject({ unitCount: 2, soldCount: 0, soldWithFxCount: 0, avgDaysToSell: null });
    expect(computeStats([])).toMatchObject({ unitCount: 0, soldCount: 0, soldWithFxCount: 0 });
  });
});

describe('período em America/Sao_Paulo: casos extras', () => {
  test('pontas de from e de to (00:00 e 23:59:59.999 BRT)', () => {
    const r = { from: '2026-11-10', to: '2026-11-12' };
    expect(isWithinSaoPauloDays('2026-11-10T03:00:00.000Z', r)).toBe(true);
    expect(isWithinSaoPauloDays('2026-11-10T02:59:59.999Z', r)).toBe(false);
    expect(isWithinSaoPauloDays('2026-11-13T02:59:59.999Z', r)).toBe(true);
    expect(isWithinSaoPauloDays('2026-11-13T03:00:00.000Z', r)).toBe(false);
  });

  test('virada de mês/ano em BRT (2027-01-01T02:59Z ainda é 2026-12-31)', () => {
    expect(isWithinSaoPauloDays('2027-01-01T02:59:59.999Z', { from: '2026-12-31', to: '2026-12-31' })).toBe(true);
    expect(isWithinSaoPauloDays('2027-01-01T03:00:00.000Z', { to: '2026-12-31' })).toBe(false);
  });

  test('filterSoldInPeriod: from = to e intervalo vazio', () => {
    const items = [mk({ id: 1, soldAt: '2026-11-10T12:00:00.000Z' }), mk({ id: 2, soldAt: '2026-11-11T12:00:00.000Z' })];
    expect(filterSoldInPeriod(items, { soldFrom: '2026-11-11', soldTo: '2026-11-11' }).map((i) => i.id)).toEqual([2]);
    expect(filterSoldInPeriod(items, { soldFrom: '2027-01-01' })).toEqual([]);
  });

  test('não muta a entrada', () => {
    const items = [mk({ id: 2 }), mk({ id: 1 })];
    const copy = JSON.stringify(items);
    filterSoldInPeriod(items, { soldFrom: '2020-01-01' });
    sortBySoldAt(items, 'asc');
    expect(JSON.stringify(items)).toBe(copy);
  });
});
