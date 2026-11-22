'use strict';

// QA 8.7.2 (D263, D265, D270): bordas extras dos services puros dos itens "fora de venda".
const {
  listingStart, isOffSale, soldWhileOffSale, getAging, sortByAge, sortByTurnaround, filterStagnant,
} = require('../../src/services/inventoryAgingService');
const { computeStats, computeSalesSummary } = require('../../src/services/itemStatsService');

const NOW = new Date('2026-11-19T12:00:00.000Z');
const DAY = 86400000;
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
const ahead = (days) => new Date(NOW.getTime() + days * DAY).toISOString();
const TH = { fastTurnoverDays: 7, slowItemDays: 21 };
const stock = (id, extra = {}) => ({ id, status: 'EM_ESTOQUE', acquiredAt: ago(60), ...extra });
const sold = (id, extra = {}) => ({
  id, status: 'VENDIDO', acquiredAt: ago(60), soldAt: ago(50), purchasePriceCents: 100, purchaseCurrency: 'USD',
  salePriceCents: 200, saleCurrency: 'USD', netReceivedCents: 190, ...extra,
});

describe('listingStart: empates e ordem', () => {
  test('forSaleSince anterior à aquisição ou à liberação não vale; igual à aquisição devolve a aquisição', () => {
    expect(listingStart(stock(1, { forSaleSince: ago(90) }))).toBe(ago(60));
    expect(listingStart(stock(1, { forSaleSince: ago(60) }))).toBe(ago(60));
    expect(listingStart(stock(1, { tradeUnlockAt: ago(10), forSaleSince: ago(30) }))).toBe(ago(10));
    expect(listingStart(stock(1, { tradeUnlockAt: ago(10), forSaleSince: ago(10) }))).toBe(ago(10));
    expect(listingStart(stock(1, { tradeUnlockAt: ago(30), forSaleSince: ago(5) }))).toBe(ago(5));
    expect(listingStart(stock(1, { tradeUnlockAt: ahead(3), forSaleSince: ago(5) }))).toBe(ahead(3));
  });

  test('forSaleSince inválido lança (nunca ignora em silêncio um dado corrompido)', () => {
    expect(() => listingStart(stock(1, { forSaleSince: 'lixo' }))).toThrow();
  });
});

describe('estado fora de venda e vendas', () => {
  test('um item fora de venda com tradeUnlockAt no passado, no futuro e igual a agora fica FORA_DE_VENDA', () => {
    for (const unlock of [ago(5), ahead(5), NOW.toISOString()]) {
      expect(getAging(stock(1, { offSaleAt: ago(1), tradeUnlockAt: unlock }), { thresholds: TH, now: NOW }).agingBucket).toBe('FORA_DE_VENDA');
    }
  });

  test('voltou à venda há 7 e 8 dias: limites do giro rápido; 21 e 22 dias: limites do agarrado', () => {
    const bucket = (days) => getAging(stock(1, { forSaleSince: ago(days) }), { thresholds: TH, now: NOW }).agingBucket;
    expect(bucket(0)).toBe('RECENTE');
    expect(bucket(21)).toBe('EM_GIRO');
    expect(bucket(22)).toBe('AGARRADO');
  });

  test('GANHEI vendido fora de venda também é SEM_GIRO; vendido com offSaleAt e forSaleSince (voltou, saiu e vendeu) é SEM_GIRO', () => {
    const won = sold(1, { acquisitionType: 'GANHEI', offSaleAt: ago(55) });
    expect(soldWhileOffSale(won)).toBe(true);
    expect(getAging(won, { thresholds: TH, now: NOW })).toMatchObject({ turnaroundDays: null, turnaroundBucket: 'SEM_GIRO', daysHeld: 10 });
    const twice = sold(2, { offSaleAt: ago(55), forSaleSince: ago(58) });
    expect(getAging(twice, { thresholds: TH, now: NOW }).turnaroundBucket).toBe('SEM_GIRO');
  });

  test('vendido depois de voltar à venda tem giro da volta (offSaleAt nulo)', () => {
    const view = getAging(sold(1, { forSaleSince: ago(54) }), { thresholds: TH, now: NOW });
    expect(view).toMatchObject({ turnaroundDays: 4 });
    expect(view.turnaroundBucket).not.toBe('SEM_GIRO');
  });

  test('isOffSale é falso para vendido e para offSaleAt vazio ou indefinido', () => {
    expect(isOffSale(sold(1, { offSaleAt: ago(1) }))).toBe(false);
    expect(isOffSale(stock(1, { offSaleAt: null }))).toBe(false);
    expect(isOffSale(stock(1))).toBe(false);
    expect(isOffSale(stock(1, { offSaleAt: ago(1) }))).toBe(true);
  });
});

describe('filtros e ordenação', () => {
  test('filterStagnant: fora de venda com trade lock ou sem, e voltando à venda depois de 22 dias, só o último entra', () => {
    const items = [
      stock(1, { offSaleAt: ago(1) }),
      stock(2, { offSaleAt: ago(1), tradeUnlockAt: ahead(2) }),
      stock(3, { forSaleSince: ago(22) }),
      stock(4, { forSaleSince: ago(5) }),
      stock(5),
    ];
    expect(filterStagnant(items, TH, NOW).map((i) => i.id)).toEqual([3, 5]);
  });

  test('sortByAge: empate de offSaleAt desempata por id; em trade lock fora de venda vai no grupo dos fora de venda', () => {
    const items = [
      stock(7, { offSaleAt: ago(2) }),
      stock(3, { offSaleAt: ago(2) }),
      stock(5, { offSaleAt: ago(9), tradeUnlockAt: ahead(1) }),
      stock(1, { tradeUnlockAt: ahead(4) }),
      stock(2),
    ];
    for (const order of ['asc', 'desc']) {
      expect(sortByAge(items, order, NOW).map((i) => i.id)).toEqual([2, 1, 5, 3, 7]);
    }
  });

  test('sortByTurnaround: vários SEM_GIRO ficam depois das vendas com giro, antes dos em estoque, nas duas direções', () => {
    const items = [
      stock(9),
      sold(1, { offSaleAt: ago(55) }),
      sold(2, { soldAt: ago(59) }),
      sold(3, { soldAt: ago(40) }),
      sold(4, { offSaleAt: ago(55) }),
    ];
    expect(sortByTurnaround(items, 'asc').map((i) => i.id)).toEqual([2, 3, 1, 4, 9]);
    expect(sortByTurnaround(items, 'desc').map((i) => i.id)).toEqual([3, 2, 1, 4, 9]);
  });
});

describe('estatísticas', () => {
  test('computeStats: venda SEM_GIRO e venda com giro; lucro médio e preço médio contam as duas', () => {
    const items = [
      sold(1, { soldAt: ago(54) }), // giro 6
      sold(2, { offSaleAt: ago(55), salePriceCents: 400, netReceivedCents: 380 }),
      stock(3, { offSaleAt: ago(1), purchasePriceCents: 100, purchaseCurrency: 'USD' }),
    ];
    const stats = computeStats(items);
    expect(stats).toMatchObject({ soldCount: 2, soldOffSaleCount: 1, avgDaysToSell: 6, unitCount: 3 });
    expect(computeStats([items[1]])).toMatchObject({ soldCount: 1, soldOffSaleCount: 1, avgDaysToSell: null });
  });

  test('computeSalesSummary: só SEM_GIRO deixa o tempo médio nulo e conta as vendas', () => {
    const summary = computeSalesSummary([sold(1, { offSaleAt: ago(55) }), sold(2, { offSaleAt: ago(55) })], { usdBrlRate: 5 });
    expect(summary.count).toBe(2);
    expect(summary.avgTurnaroundDays).toBeNull();
  });
});
