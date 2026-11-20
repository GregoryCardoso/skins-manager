'use strict';

const { computeStats, computeSalesSummary } = require('../../src/services/itemStatsService');
const { buildSaleInfo, computeSaleProfitUsdCents } = require('../../src/services/profitService');
const {
  isWithinSaoPauloDays, filterSoldInPeriod, sortBySoldAt,
} = require('../../src/services/inventoryAgingService');

const ACQ = '2026-10-01T12:00:00.000Z';
const base = { name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', exterior: 'FT', acquiredAt: ACQ };
const stock = (cost, extra = {}) => ({
  id: 1, ...base, status: 'EM_ESTOQUE', purchasePriceCents: cost, purchaseCurrency: 'USD', fxRateAtPurchase: null, ...extra,
});
const sold = (cost, price, net, soldAt, extra = {}) => ({
  ...stock(cost), status: 'VENDIDO', salePriceCents: price, saleCurrency: 'USD', fxRateAtSale: null,
  netReceivedCents: net, soldAt, ...extra,
});

describe('buildSaleInfo', () => {
  test('em estoque -> null', () => {
    expect(buildSaleInfo(stock(100), 5)).toBeNull();
  });

  test('CSFloat USD: valores nativos, sem cotação usada, approx pela cotação atual', () => {
    const item = sold(100, 125, 122, '2026-10-05T12:00:00.000Z');
    const info = buildSaleInfo(item, 5);
    expect(info).toEqual({
      salePriceUsdCents: 125, netReceivedUsdCents: 122, purchaseCostUsdCents: 100,
      fxUsed: { sale: null, purchase: null }, usesRecordedFx: false,
      approxBrl: { salePrice: 625, netReceived: 610, purchaseCost: 500, profit: 110 },
    });
    expect(info.netReceivedUsdCents - info.purchaseCostUsdCents).toBe(computeSaleProfitUsdCents(item));
  });

  test('Steam BRL: converte pela cotação gravada da venda', () => {
    const item = sold(100, 540, 470, '2026-10-05T12:00:00.000Z', { saleCurrency: 'BRL', fxRateAtSale: 5.4 });
    const info = buildSaleInfo(item, 6);
    expect(info.salePriceUsdCents).toBe(100);
    expect(info.netReceivedUsdCents).toBe(87);
    expect(info.fxUsed).toEqual({ sale: 5.4, purchase: null });
    expect(info.usesRecordedFx).toBe(true);
  });

  test('compra BRL + venda USD usa cotação gravada da compra', () => {
    const item = sold(1000, 500, 490, '2026-10-05T12:00:00.000Z', { purchaseCurrency: 'BRL', fxRateAtPurchase: 5 });
    const info = buildSaleInfo(item, 6);
    expect(info.purchaseCostUsdCents).toBe(200);
    expect(info.fxUsed).toEqual({ sale: null, purchase: 5 });
    expect(info.usesRecordedFx).toBe(true);
  });

  test('GANHEI com custo 0', () => {
    const info = buildSaleInfo(sold(0, 100, 98, '2026-10-05T12:00:00.000Z'), 5);
    expect(info.purchaseCostUsdCents).toBe(0);
    expect(info.approxBrl.profit).toBe(490);
  });

  test('mudar a cotação atual muda só approxBrl; sem cotação -> approxBrl nulo', () => {
    const item = sold(100, 125, 122, '2026-10-05T12:00:00.000Z');
    const a = buildSaleInfo(item, 5);
    const b = buildSaleInfo(item, 6);
    expect({ ...a, approxBrl: null }).toEqual({ ...b, approxBrl: null });
    expect(a.approxBrl).not.toEqual(b.approxBrl);
    expect(buildSaleInfo(item, null).approxBrl).toEqual({ salePrice: null, netReceived: null, purchaseCost: null, profit: null });
  });
});

describe('computeStats: unitCount e soldWithFxCount', () => {
  test('conta estoque + vendidos e vendas com cotação gravada', () => {
    const items = [
      stock(100),
      sold(100, 125, 122, '2026-10-05T12:00:00.000Z'),
      sold(100, 540, 470, '2026-10-05T12:00:00.000Z', { saleCurrency: 'BRL', fxRateAtSale: 5.4 }),
      sold(1000, 500, 490, '2026-10-05T12:00:00.000Z', { purchaseCurrency: 'BRL', fxRateAtPurchase: 5 }),
    ];
    expect(computeStats(items)).toMatchObject({ unitCount: 4, soldCount: 3, soldWithFxCount: 2 });
  });
});

describe('computeSalesSummary', () => {
  test('vazio', () => {
    expect(computeSalesSummary([], { usdBrlRate: 5 })).toEqual({
      count: 0, totalSalePriceUsdCents: 0, totalNetReceivedUsdCents: 0, totalPurchaseCostUsdCents: 0,
      totalProfitUsdCents: 0, avgTurnaroundDays: null, soldWithFxCount: 0,
      approxBrl: { totalSalePrice: 0, totalNetReceived: 0, totalProfit: 0 },
    });
  });

  test('moedas misturadas, lucro negativo, média de giro e contagem de cotação', () => {
    const items = [
      sold(100, 125, 122, '2026-10-04T12:00:00.000Z'), // 3 dias
      sold(100, 540, 470, '2026-10-05T12:00:00.000Z', { saleCurrency: 'BRL', fxRateAtSale: 5.4 }), // 4 dias; net 87
      sold(500, 100, 98, '2026-10-06T12:00:00.000Z'), // 5 dias
      stock(999),
    ];
    const s = computeSalesSummary(items, { usdBrlRate: 5 });
    expect(s.count).toBe(3);
    expect(s.totalSalePriceUsdCents).toBe(125 + 100 + 100);
    expect(s.totalNetReceivedUsdCents).toBe(122 + 87 + 98);
    expect(s.totalPurchaseCostUsdCents).toBe(700);
    expect(s.totalProfitUsdCents).toBe(s.totalNetReceivedUsdCents - s.totalPurchaseCostUsdCents);
    expect(s.totalProfitUsdCents).toBe(-393);
    expect(s.avgTurnaroundDays).toBe(4);
    expect(s.soldWithFxCount).toBe(1);
    expect(s.approxBrl.totalProfit).toBe(-1965);
  });

  test('média de giro com 1 casa; sem cotação -> approx nulo', () => {
    const items = [
      sold(1, 2, 2, '2026-10-02T12:00:00.000Z'),
      sold(1, 2, 2, '2026-10-02T12:00:00.000Z'),
      sold(1, 2, 2, '2026-10-03T12:00:00.000Z'),
    ];
    const s = computeSalesSummary(items, { usdBrlRate: null });
    expect(s.avgTurnaroundDays).toBe(1.3);
    expect(s.approxBrl).toEqual({ totalSalePrice: null, totalNetReceived: null, totalProfit: null });
  });
});

describe('isWithinSaoPauloDays / filterSoldInPeriod', () => {
  test('pontas do dia em Brasília (UTC-3)', () => {
    const range = { from: '2026-11-19', to: '2026-11-19' };
    expect(isWithinSaoPauloDays('2026-11-19T03:00:00.000Z', range)).toBe(true);
    expect(isWithinSaoPauloDays('2026-11-20T02:59:59.999Z', range)).toBe(true);
    expect(isWithinSaoPauloDays('2026-11-19T02:59:59.999Z', range)).toBe(false);
    expect(isWithinSaoPauloDays('2026-11-20T03:00:00.000Z', range)).toBe(false);
  });

  test('2026-11-20T02:30Z é dia 19 em Brasília; só from; só to; sem limites', () => {
    expect(isWithinSaoPauloDays('2026-11-20T02:30:00.000Z', { to: '2026-11-19' })).toBe(true);
    expect(isWithinSaoPauloDays('2026-11-20T02:30:00.000Z', { from: '2026-11-20' })).toBe(false);
    expect(isWithinSaoPauloDays('2026-11-20T02:30:00.000Z', { from: '2026-11-19' })).toBe(true);
    expect(isWithinSaoPauloDays('2026-11-20T02:30:00.000Z', {})).toBe(true);
  });

  test('filterSoldInPeriod descarta em estoque', () => {
    const items = [
      sold(1, 2, 2, '2026-11-10T12:00:00.000Z', { id: 1 }),
      sold(1, 2, 2, '2026-11-20T12:00:00.000Z', { id: 2 }),
      stock(1, { id: 3 }),
    ];
    expect(filterSoldInPeriod(items, { soldFrom: '2026-11-15' }).map((i) => i.id)).toEqual([2]);
    expect(filterSoldInPeriod(items, {}).map((i) => i.id)).toEqual([1, 2]);
  });
});

describe('sortBySoldAt', () => {
  const items = [
    sold(1, 2, 2, '2026-11-10T12:00:00.000Z', { id: 3 }),
    sold(1, 2, 2, '2026-11-12T12:00:00.000Z', { id: 1 }),
    sold(1, 2, 2, '2026-11-10T12:00:00.000Z', { id: 2 }),
    stock(1, { id: 9 }),
  ];
  test('desc (padrão) e asc, empates por id, em estoque no fim, não muta', () => {
    const copy = [...items];
    expect(sortBySoldAt(items).map((i) => i.id)).toEqual([1, 2, 3, 9]);
    expect(sortBySoldAt(items, 'asc').map((i) => i.id)).toEqual([2, 3, 1, 9]);
    expect(items).toEqual(copy);
  });
});
