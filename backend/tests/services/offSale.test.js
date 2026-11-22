'use strict';

// 8.7.2 (D263, D265, D270): itens "fora de venda" nos services puros (giro, ordenação, filtro e histórico).
const {
  listingStart, isOffSale, soldWhileOffSale, getAging, sortByAge, sortByTurnaround, filterStagnant,
} = require('../../src/services/inventoryAgingService');
const { computeStats, computeSalesSummary } = require('../../src/services/itemStatsService');
const { computeRealProfit } = require('../../src/services/profitService');
const { buildCurrentBalances } = require('../../src/services/storeBalanceService');
const { csfloat } = require('../helpers/storeFixtures');

const NOW = new Date('2026-11-19T12:00:00.000Z');
const DAY = 86400000;
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
const ahead = (days) => new Date(NOW.getTime() + days * DAY).toISOString();
const TH = { fastTurnoverDays: 7, slowItemDays: 21 };

const stock = (id, extra = {}) => ({ id, status: 'EM_ESTOQUE', acquiredAt: ago(40), ...extra });
const soldItem = (id, extra = {}) => ({
  id, status: 'VENDIDO', acquiredAt: '2026-10-01T12:00:00.000Z', soldAt: '2026-10-05T12:00:00.000Z',
  purchasePriceCents: 100, purchaseCurrency: 'USD', salePriceCents: 200, saleCurrency: 'USD', netReceivedCents: 190, ...extra,
});

describe('listingStart: o mais tarde entre acquiredAt, tradeUnlockAt e forSaleSince', () => {
  const acquiredAt = '2026-10-01T12:00:00.000Z';
  const later = '2026-10-10T12:00:00.000Z';
  const latest = '2026-10-20T12:00:00.000Z';

  test.each([
    ['só acquiredAt', {}, acquiredAt],
    ['tradeUnlockAt depois', { tradeUnlockAt: later }, later],
    ['tradeUnlockAt antes de acquiredAt', { tradeUnlockAt: '2026-09-01T00:00:00.000Z' }, acquiredAt],
    ['forSaleSince depois', { forSaleSince: later }, later],
    ['forSaleSince antes de acquiredAt', { forSaleSince: '2026-09-01T00:00:00.000Z' }, acquiredAt],
    ['forSaleSince mais tarde que tradeUnlockAt', { tradeUnlockAt: later, forSaleSince: latest }, latest],
    ['tradeUnlockAt mais tarde que forSaleSince', { tradeUnlockAt: latest, forSaleSince: later }, latest],
    ['empate entre os três', { tradeUnlockAt: acquiredAt, forSaleSince: acquiredAt }, acquiredAt],
    ['campos nulos', { tradeUnlockAt: null, forSaleSince: null }, acquiredAt],
  ])('%s', (_name, extra, expected) => {
    expect(listingStart({ acquiredAt, ...extra })).toBe(expected);
  });
});

describe('isOffSale e soldWhileOffSale', () => {
  test('só em estoque com offSaleAt; vendido com offSaleAt é "vendido fora de venda"', () => {
    expect(isOffSale(stock(1, { offSaleAt: ago(1) }))).toBe(true);
    expect(isOffSale(stock(1))).toBe(false);
    expect(isOffSale(stock(1, { offSaleAt: null }))).toBe(false);
    expect(isOffSale(soldItem(1, { offSaleAt: ago(1) }))).toBe(false);
    expect(soldWhileOffSale(soldItem(1, { offSaleAt: ago(1) }))).toBe(true);
    expect(soldWhileOffSale(soldItem(1))).toBe(false);
    expect(soldWhileOffSale(stock(1, { offSaleAt: ago(1) }))).toBe(false);
  });
});

describe('getAging com itens fora de venda', () => {
  const aging = (item) => getAging(item, { thresholds: TH, now: NOW });

  test('fora de venda e liberado: FORA_DE_VENDA, sem dias à venda, e dias no inventário continuam', () => {
    expect(aging(stock(1, { offSaleAt: ago(2) }))).toEqual({ daysInInventory: 40, daysForSale: null, agingBucket: 'FORA_DE_VENDA' });
  });

  test('fora de venda em trade lock: FORA_DE_VENDA prevalece sobre EM_TRADE_LOCK', () => {
    expect(aging(stock(1, { offSaleAt: ago(1), tradeUnlockAt: ahead(3) })).agingBucket).toBe('FORA_DE_VENDA');
  });

  test('voltou à venda há 0 dias: RECENTE, mesmo com o item muito antigo', () => {
    const item = stock(1, { offSaleAt: null, forSaleSince: NOW.toISOString() });
    expect(aging(item)).toEqual({ daysInInventory: 40, daysForSale: 0, agingBucket: 'RECENTE' });
  });

  test('voltou à venda mas ainda em trade lock: EM_TRADE_LOCK até liberar', () => {
    expect(aging(stock(1, { forSaleSince: ago(1), tradeUnlockAt: ahead(2) })).agingBucket).toBe('EM_TRADE_LOCK');
  });

  test('voltou à venda há 30 dias: a contagem parte dessa data (AGARRADO)', () => {
    expect(aging(stock(1, { forSaleSince: ago(30), acquiredAt: ago(60) }))).toMatchObject({ daysForSale: 30, agingBucket: 'AGARRADO' });
  });

  test('vendido fora de venda: SEM_GIRO, turnaroundDays nulo e daysHeld calculado', () => {
    expect(aging(soldItem(1, { offSaleAt: '2026-10-02T12:00:00.000Z' }))).toEqual({ turnaroundDays: null, turnaroundBucket: 'SEM_GIRO', daysHeld: 4 });
  });

  test('vendido normal continua com giro', () => {
    expect(aging(soldItem(1))).toMatchObject({ turnaroundDays: 4, turnaroundBucket: 'GIRO_RAPIDO' });
  });
});

describe('filterStagnant', () => {
  test('um agarrado tirado da venda não entra; ao voltar, conta do zero', () => {
    const stuck = stock(1);
    expect(filterStagnant([stuck], TH, NOW)).toHaveLength(1);
    expect(filterStagnant([{ ...stuck, offSaleAt: ago(1) }], TH, NOW)).toHaveLength(0);
    expect(filterStagnant([{ ...stuck, offSaleAt: null, forSaleSince: ago(2) }], TH, NOW)).toHaveLength(0);
    expect(filterStagnant([{ ...stuck, offSaleAt: null, forSaleSince: ago(30) }], TH, NOW)).toHaveLength(1);
  });
});

describe('sortByAge e sortByTurnaround', () => {
  test('à venda e liberados, depois em trade lock, depois fora de venda (por offSaleAt e id), nas duas direções', () => {
    const items = [
      stock(1, { offSaleAt: ago(1) }),
      stock(2, { tradeUnlockAt: ahead(2) }),
      stock(3, { acquiredAt: ago(10) }),
      stock(4, { offSaleAt: ago(5) }),
      stock(5, { acquiredAt: ago(30) }),
      stock(6, { offSaleAt: ago(5) }),
    ];
    expect(sortByAge(items, 'desc', NOW).map((i) => i.id)).toEqual([5, 3, 2, 4, 6, 1]);
    expect(sortByAge(items, 'asc', NOW).map((i) => i.id)).toEqual([3, 5, 2, 4, 6, 1]);
  });

  test('os SEM_GIRO ficam depois das vendas com giro e antes dos não vendidos', () => {
    const items = [stock(1), soldItem(2, { offSaleAt: ago(30) }), soldItem(3, { soldAt: '2026-10-20T12:00:00.000Z' }), soldItem(4)];
    expect(sortByTurnaround(items, 'asc').map((i) => i.id)).toEqual([4, 3, 2, 1]);
    expect(sortByTurnaround(items, 'desc').map((i) => i.id)).toEqual([3, 4, 2, 1]);
  });
});

describe('computeStats com vendas fora de venda', () => {
  const offSaleSold = (id, extra = {}) => soldItem(id, { offSaleAt: '2026-10-02T12:00:00.000Z', ...extra });

  test('avgDaysToSell ignora as SEM_GIRO; soldOffSaleCount conta; lucro e preço médio contam todas', () => {
    const stats = computeStats([
      soldItem(1, { soldAt: '2026-10-03T12:00:00.000Z' }), // 2 dias
      soldItem(2, { soldAt: '2026-10-05T12:00:00.000Z' }), // 4 dias
      offSaleSold(3, { soldAt: '2026-10-25T12:00:00.000Z', netReceivedCents: 290, salePriceCents: 300 }),
    ]);
    expect(stats).toMatchObject({ soldCount: 3, soldOffSaleCount: 1, avgDaysToSell: 3, unitCount: 3 });
    expect(stats.avgSalePriceUsdCents).toBe(233); // (200 + 200 + 300) / 3
    expect(stats.avgProfitUsdCents).toBe(123); // (90 + 90 + 190) / 3
  });

  test('tudo SEM_GIRO: avgDaysToSell nulo e o lucro médio continua calculado', () => {
    const stats = computeStats([offSaleSold(1), offSaleSold(2)]);
    expect(stats).toMatchObject({ soldCount: 2, soldOffSaleCount: 2, avgDaysToSell: null, avgProfitUsdCents: 90 });
  });

  test('unitCount e avgPurchaseCost contam os itens fora de venda', () => {
    const stats = computeStats([
      stock(1, { purchasePriceCents: 100, purchaseCurrency: 'USD', offSaleAt: ago(1) }),
      stock(2, { purchasePriceCents: 300, purchaseCurrency: 'USD' }),
    ]);
    expect(stats).toMatchObject({ unitCount: 2, avgPurchaseCostUsdCents: 200, soldOffSaleCount: 0 });
  });

  test('o resumo das vendas deixa as SEM_GIRO fora do tempo médio, mas conta o lucro', () => {
    const summary = computeSalesSummary([
      soldItem(1, { soldAt: '2026-10-03T12:00:00.000Z' }),
      offSaleSold(2, { soldAt: '2026-10-25T12:00:00.000Z' }),
    ]);
    expect(summary).toMatchObject({ count: 2, avgTurnaroundDays: 2, totalProfitUsdCents: 180 });
    expect(computeSalesSummary([offSaleSold(1)]).avgTurnaroundDays).toBeNull();
  });
});

describe('lucro real e saldo não mudam ao tirar um item da venda', () => {
  test('estoque, saldo da loja e lucro iguais antes e depois', () => {
    const store = csfloat({ id: 1 });
    const deposits = [{ storeId: 1, amountStoreCents: 1000, depositedAt: '2026-11-01T12:00:00.000Z' }];
    const bought = {
      status: 'EM_ESTOQUE', acquisitionType: 'COMPRA', purchaseStoreId: 1, purchasePriceCents: 400, purchaseCurrency: 'USD',
      fxRateAtPurchase: null, acquiredAt: '2026-11-02T12:00:00.000Z',
    };
    const run = (item) => {
      const balances = buildCurrentBalances({ stores: [store], deposits, items: [item], settings: { usdBrlRate: 5 }, now: NOW });
      return computeRealProfit({ deposits, stores: [store], balances, stockItems: [item], settings: { usdBrlRate: 5 } });
    };
    const before = run(bought);
    const after = run({ ...bought, offSaleAt: ago(1) });
    // Tudo igual, exceto a divisão do estoque (8.9, D283), que muda do jeito certo: o item passa de forSale para offSale.
    const { stockBreakdown: bBreak, ...bRest } = before;
    const { stockBreakdown: aBreak, ...aRest } = after;
    expect(aRest).toEqual(bRest);
    expect(after).toMatchObject({ stockUsdCents: 400, platformBalanceUsdCents: 600, realProfitUsdCents: 0 });
    expect(bBreak.forSale).toMatchObject({ usdCents: 400, count: 1 });
    expect(bBreak.offSale).toMatchObject({ usdCents: 0, count: 0 });
    expect(aBreak.forSale).toMatchObject({ usdCents: 0, count: 0 });
    expect(aBreak.offSale).toMatchObject({ usdCents: 400, count: 1 });
  });
});
