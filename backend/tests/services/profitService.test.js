'use strict';

const { computeSaleProfitUsdCents, computeRealProfit } = require('../../src/services/profitService');
const { csfloat, steam, csmoney } = require('../helpers/storeFixtures');
const { buildCurrentBalances } = require('../../src/services/storeBalanceService');

const SETTINGS = { usdBrlRate: 5.0 };

const soldItem = (extra = {}) => ({
  status: 'VENDIDO',
  purchasePriceCents: 100,
  purchaseCurrency: 'USD',
  fxRateAtPurchase: null,
  salePriceCents: 125,
  saleCurrency: 'USD',
  fxRateAtSale: null,
  netReceivedCents: 122,
  ...extra,
});
const stockItem = (cost, currency = 'USD', extra = {}) => ({
  status: 'EM_ESTOQUE',
  purchasePriceCents: cost,
  purchaseCurrency: currency,
  fxRateAtPurchase: currency === 'BRL' ? 5.0 : null,
  ...extra,
});

const NOW = new Date('2026-11-21T12:00:00.000Z');
const NO_FX = { usdBrlRate: null };

// `latest(...)` agora vira um aporte da loja (não existe mais saldo inicial, D252): o saldo calculado parte de 0.
const asDeposits = (list) => list.map((b) => ({ storeId: b.storeId, amountStoreCents: b.balanceCents, depositedAt: b.recordedAt }));
// Saldos por loja como o /current os entrega (buildCurrentBalances), a partir de lojas, saldos e itens.
// `latestBalances` são saldos iniciais (a âncora do cálculo, D239).
const balancesOf = ({ stores = [], latestBalances = [], items = [], withdrawals = [], deposits = [], settings = SETTINGS } = {}) =>
  buildCurrentBalances({ stores, items, withdrawals, deposits: [...deposits, ...asDeposits(latestBalances)], settings, now: NOW });
const latest = (storeId, balanceCents, recordedAt = '2026-11-10T12:00:00.000Z') => ({
  id: storeId, storeId, kind: 'INITIAL', balanceCents, computedCents: null, adjustmentCents: null, recordedAt, fxRate: null,
});
const heldSale = (storeId, net, soldAt, days = 7) => ({
  status: 'VENDIDO', saleStoreId: storeId, saleCurrency: 'USD', netReceivedCents: net, soldAt, saleHoldDaysApplied: days, purchaseStoreId: null, acquiredAt: '2026-01-01T00:00:00.000Z',
});

// Cenário base de D44 em US$: aportes 20000 (CSFloat); saques líquidos 6000 (um sem loja, R$ 200,00 / 5,0); CSFloat saldo 10000;
// estoque BRL 20000 a 5,0 = 4000. Lucro = 6000 + 10000 + 4000 - 20000 = 0.
function baseScenario() {
  const csfWithdrawal = { id: 1, storeId: 1, amountStoreCents: 2000, feeCents: null, amountBrlCents: 10000, withdrawnAt: '2026-11-01T12:00:00.000Z' };
  const withdrawals = [csfWithdrawal, { id: 2, storeId: null, amountStoreCents: null, feeCents: null, amountBrlCents: 20000, withdrawnAt: '2026-11-02T12:00:00.000Z' }];
  return {
    deposits: [{ id: 1, storeId: 1, amountStoreCents: 20000, amountBrlCents: 100000 }],
    withdrawals,
    stores: [csfloat()],
    balances: balancesOf({ stores: [csfloat()], latestBalances: [latest(1, 12000)], withdrawals }), // 12000 − saque 2000 = 10000
    stockItems: [stockItem(20000, 'BRL')],
    settings: SETTINGS,
  };
}

describe('profitService.computeSaleProfitUsdCents', () => {
  test('CSFloat custo 100, netReceived 122 → 22', () => {
    expect(computeSaleProfitUsdCents(soldItem())).toBe(22);
  });

  test('venda BRL convertida com fxRateAtSale (6000 BRL / 5.0 = 1200; custo 1000 USD) → 200', () => {
    expect(computeSaleProfitUsdCents(soldItem({ purchasePriceCents: 1000, saleCurrency: 'BRL', fxRateAtSale: 5.0, netReceivedCents: 6000 }))).toBe(200);
  });

  test('custo BRL convertido com fxRateAtPurchase', () => {
    expect(computeSaleProfitUsdCents(soldItem({ purchasePriceCents: 400, purchaseCurrency: 'BRL', fxRateAtPurchase: 4.0 }))).toBe(22);
  });

  test('GANHEI sem preço (custo 0) → lucro = netReceived', () => {
    expect(computeSaleProfitUsdCents(soldItem({ acquisitionType: 'GANHEI', purchasePriceCents: 0 }))).toBe(122);
  });

  test('cada parcela arredondada antes de subtrair', () => {
    // net 1003 BRL / 2 = 501.5 → 502; custo 1001 BRL / 2 = 500.5 → 501; lucro 1
    expect(
      computeSaleProfitUsdCents(
        soldItem({ purchasePriceCents: 1001, purchaseCurrency: 'BRL', fxRateAtPurchase: 2, netReceivedCents: 1003, saleCurrency: 'BRL', fxRateAtSale: 2 })
      )
    ).toBe(1);
  });

  test('item em estoque → null', () => {
    expect(computeSaleProfitUsdCents(stockItem(100))).toBeNull();
  });
});

describe('profitService.computeRealProfit', () => {
  test('exemplo D44 em US$: lucro 0, sem pendente', () => {
    const r = computeRealProfit(baseScenario());
    expect(r).toMatchObject({
      baseCurrency: 'USD',
      depositsUsdCents: 20000,
      withdrawalsNetUsdCents: 6000, // 2000 (CSFloat, sem taxa informada = 0) + ROUND(20000 / 5,0) = 4000
      platformBalanceUsdCents: 10000,
      pendingBalanceUsdCents: 0,
      nextReleaseAt: null,
      stockUsdCents: 4000,
      realProfitUsdCents: 0,
      warnings: [],
    });
    expect(r.withdrawnVsDeposited).toMatchObject({ withdrawnUsdCents: 6000, depositedUsdCents: 20000 });
    expect(r.withdrawnVsDeposited.ratio).toBeCloseTo(0.3, 10);
    expect(r).not.toHaveProperty('depositsBrlCents');
    expect(r).not.toHaveProperty('realProfitBrlCents');
  });

  test('loja não sacável (Steam, BRL) entra no lucro convertida: 8000 BRL / 5,0 = 1600', () => {
    const s = baseScenario();
    s.stores = [csfloat(), steam()];
    s.balances = balancesOf({ stores: s.stores, latestBalances: [latest(1, 12000), latest(steam().id, 8000)], withdrawals: s.withdrawals });
    const r = computeRealProfit(s);
    expect(r.platformBalanceUsdCents).toBe(11600);
    expect(r.realProfitUsdCents).toBe(1600);
    expect(r.approx.realProfit).toBe(8000);
    // a soma "não sacável" é só informativa e não é somada de novo
    expect(s.balances.totals.nonWithdrawableUsdCents).toBe(1600);
  });

  test('pendente e vendas liberadas (já no disponível calculado) entram no total, sem parcela separada (lojas USD, exatos)', () => {
    const stores = [csfloat()];
    const items = [heldSale(1, 7500, '2026-11-20T18:00:00.000Z'), heldSale(1, 1200, '2026-11-13T20:00:00.000Z')];
    const rate = { usdBrlRate: 5.4321 };
    const balances = balancesOf({ stores, latestBalances: [latest(1, 12346, '2026-11-20T15:00:00.000Z')], items, settings: rate });
    const r = computeRealProfit({ balances, stores, settings: rate });
    expect(r.platformBalanceUsdCents).toBe(12346 + 1200); // a venda liberada depois do saldo inicial já está no disponível
    expect(r.pendingBalanceUsdCents).toBe(7500);
    expect(r).not.toHaveProperty('releasedAfterBalanceUsdCents');
    expect(r.approx).not.toHaveProperty('releasedAfterBalance');
    expect(r.estimatedParts).not.toHaveProperty('releasedAfterBalance');
    expect(r.nextReleaseAt).toBe('2026-11-27T18:00:00.000Z');
    expect(r.realProfitUsdCents).toBe(12346 + 7500 + 1200);
    expect(r.estimated).toBe(false);
    expect(r.approx.pendingBalance).toBe(40741);
  });

  test('estoque pelo custo: USD nominal e BRL pela cotação gravada (3000 / 5,0 = 600)', () => {
    const r = computeRealProfit({ stockItems: [stockItem(1000, 'USD'), stockItem(3000, 'BRL')], settings: SETTINGS });
    expect(r.stockUsdCents).toBe(1600);
    expect(r.realProfitUsdCents).toBe(1600);
    expect(r.estimatedParts.stock).toBe(true);
  });

  test('itens vendidos não entram no estoque', () => {
    const r = computeRealProfit({ stockItems: [stockItem(3000, 'BRL'), soldItem({ purchasePriceCents: 99999 })], settings: SETTINGS });
    expect(r.stockUsdCents).toBe(600);
  });

  test('estoque não depende da cotação atual: sem cotação o estoque continua e o lucro também', () => {
    const r = computeRealProfit({ deposits: [], stockItems: [stockItem(1000, 'USD'), stockItem(3000, 'BRL')], settings: NO_FX });
    expect(r.stockUsdCents).toBe(1600);
    expect(r.realProfitUsdCents).toBe(1600);
    expect(r.warnings).toEqual([]);
  });

  test('tudo vazio: 0 e ratio null', () => {
    const r = computeRealProfit({ settings: SETTINGS });
    expect(r).toMatchObject({
      depositsUsdCents: 0,
      withdrawalsNetUsdCents: 0,
      platformBalanceUsdCents: 0,
      pendingBalanceUsdCents: 0,
      stockUsdCents: 0,
      realProfitUsdCents: 0,
      withdrawnVsDeposited: { withdrawnUsdCents: 0, depositedUsdCents: 0, ratio: null },
      warnings: [],
    });
  });

  test('loja com saque e taxa nula: saldo sem desconto de taxa', () => {
    const balances = balancesOf({ stores: [csmoney()], latestBalances: [latest(csmoney().id, 1000)] });
    const r = computeRealProfit({ balances, settings: SETTINGS });
    expect(r.platformBalanceUsdCents).toBe(1000);
    expect(r.realProfitUsdCents).toBe(1000);
    expect(r.warnings).toEqual([]);
  });

  test('aporte legado ou saque sem loja sem cotação: lucro null e avisos DEPOSITS e WITHDRAWALS', () => {
    const r = computeRealProfit({
      deposits: [{ storeId: null, amountStoreCents: null, amountBrlCents: 1000 }],
      withdrawals: [{ storeId: null, amountStoreCents: null, amountBrlCents: 3000 }],
      settings: NO_FX,
    });
    expect(r.depositsUsdCents).toBeNull();
    expect(r.withdrawalsNetUsdCents).toBeNull();
    expect(r.realProfitUsdCents).toBeNull();
    expect(r.warnings).toEqual([
      { source: 'DEPOSITS', storeId: null, storeName: null, code: 'FX_NOT_CONFIGURED', text: 'cotação não configurada' },
      { source: 'WITHDRAWALS', storeId: null, storeName: null, code: 'FX_NOT_CONFIGURED', text: 'cotação não configurada' },
    ]);
  });

  test('loja BRL sem cotação: lucro null e aviso da loja com código', () => {
    const store = steam({ id: 9, name: 'LojaBRL' });
    const balances = balancesOf({ stores: [store], latestBalances: [latest(9, 1000)], settings: NO_FX });
    const r = computeRealProfit({ balances, stores: [store], settings: NO_FX });
    expect(r.platformBalanceUsdCents).toBeNull();
    expect(r.realProfitUsdCents).toBeNull();
    expect(r.warnings).toEqual([{ source: 'STORE', storeId: 9, storeName: 'LojaBRL', code: 'FX_NOT_CONFIGURED', text: 'cotação não configurada' }]);
  });

  test('loja USD sem cotação: tudo exato e sem aviso; disponível 0 de loja BRL não fica nulo', () => {
    const balances = balancesOf({ stores: [csfloat(), steam()], items: [heldSale(1, 2500, '2026-11-20T18:00:00.000Z')], settings: NO_FX });
    const r = computeRealProfit({ balances, settings: NO_FX });
    expect(r.platformBalanceUsdCents).toBe(0);
    expect(r.pendingBalanceUsdCents).toBe(2500);
    expect(r.realProfitUsdCents).toBe(2500);
    expect(r.warnings).toEqual([]);
  });

  test('saldo calculado negativo vira aviso com a loja e entra no lucro com sinal (E8-Q20)', () => {
    const withdrawals = [{ storeId: 1, amountStoreCents: 300, feeCents: null, amountBrlCents: null, withdrawnAt: '2026-11-05T12:00:00.000Z' }];
    const balances = balancesOf({ stores: [csfloat()], latestBalances: [latest(1, 100, '2026-11-01T12:00:00.000Z')], withdrawals });
    const r = computeRealProfit({ balances, stores: [csfloat()], withdrawals, settings: SETTINGS });
    expect(r.platformBalanceUsdCents).toBe(-200);
    expect(r.warnings).toEqual([
      { source: 'STORE', storeId: 1, storeName: 'CSFloat', code: 'COMPUTED_BALANCE_NEGATIVE', text: 'saldo calculado negativo' },
    ]);
  });

  test('sem saldo inicial e nunca conferida: nenhum aviso (D243)', () => {
    const r = computeRealProfit({ balances: balancesOf({ stores: [csfloat(), steam(), csmoney()] }), settings: SETTINGS });
    expect(r.warnings).toEqual([]);
  });

  test('aporte de 10,20 + compra de 5,20: saldo 500, colocado 1020, estoque 520 e lucro 0 (D252)', () => {
    const stores = [csfloat()];
    const deposits = [{ id: 1, storeId: 1, amountStoreCents: 1020, amountBrlCents: null, depositedAt: '2026-11-01T12:00:00.000Z' }];
    const bought = { status: 'EM_ESTOQUE', acquisitionType: 'COMPRA', purchaseStoreId: 1, purchasePriceCents: 520, purchaseCurrency: 'USD', fxRateAtPurchase: null, acquiredAt: '2026-11-02T12:00:00.000Z' };
    const balances = balancesOf({ stores, deposits, items: [bought] });
    const r = computeRealProfit({ balances, stores, deposits, stockItems: [bought], settings: SETTINGS });
    expect(r).toMatchObject({ depositsUsdCents: 1020, platformBalanceUsdCents: 500, stockUsdCents: 520, realProfitUsdCents: 0, estimated: false });
  });

  test('todo aporte e saque contam no lucro real e no saldo da loja, de qualquer data (D245, D252)', () => {
    const stores = [csfloat()];
    const deposits = [{ id: 1, storeId: 1, amountStoreCents: 5000, amountBrlCents: null, depositedAt: '2020-11-01T12:00:00.000Z' }];
    const withdrawals = [{ id: 1, storeId: 1, amountStoreCents: 1000, feeCents: null, amountBrlCents: null, withdrawnAt: '2020-11-02T12:00:00.000Z' }];
    const balances = balancesOf({ stores, deposits, withdrawals });
    expect(balances.stores[0].availableCents).toBe(4000);
    const r = computeRealProfit({ balances, stores, deposits, withdrawals, settings: SETTINGS });
    expect(r.depositsUsdCents).toBe(5000);
    expect(r.withdrawalsNetUsdCents).toBe(1000);
    expect(r.realProfitUsdCents).toBe(1000 + 4000 - 5000);
  });

  test('loja sem saldo registrado -> 0; loja inativa com saldo é somada', () => {
    const none = computeRealProfit({ balances: balancesOf({ stores: [csfloat()] }), settings: SETTINGS });
    expect(none.realProfitUsdCents).toBe(0);
    const inactive = csmoney({ isActive: false });
    const r = computeRealProfit({ balances: balancesOf({ stores: [inactive], latestBalances: [latest(inactive.id, 4000)] }), settings: SETTINGS });
    expect(r.realProfitUsdCents).toBe(4000);
  });
});
