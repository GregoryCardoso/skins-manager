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

// Saldos por loja como o /current os entrega (buildCurrentBalances), a partir de lojas, saldos e itens.
const balancesOf = ({ stores = [], latestBalances = [], items = [], withdrawals = [], settings = SETTINGS } = {}) =>
  buildCurrentBalances({ stores, latestBalances, items, withdrawals, settings, now: NOW });
const latest = (storeId, balanceCents, recordedAt = '2026-11-10T12:00:00.000Z') => ({ id: storeId, storeId, balanceCents, recordedAt, fxRate: null });
const heldSale = (storeId, net, soldAt, days = 7) => ({
  status: 'VENDIDO', saleStoreId: storeId, netReceivedCents: net, soldAt, saleHoldDaysApplied: days, purchaseStoreId: null, acquiredAt: '2026-01-01T00:00:00.000Z',
});

// Cenário base de D44: aportes 100000; saques 30000 (um sem loja); CSFloat saldo 10000 USD a 5.0; estoque 20000 BRL.
function baseScenario() {
  const csfWithdrawal = { id: 1, storeId: 1, amountStoreCents: 2000, amountBrlCents: 10000, withdrawnAt: '2026-11-01T12:00:00.000Z' };
  const withdrawals = [csfWithdrawal, { id: 2, storeId: null, amountStoreCents: null, amountBrlCents: 20000, withdrawnAt: '2026-11-02T12:00:00.000Z' }];
  return {
    deposits: [{ amountBrlCents: 100000 }],
    withdrawals,
    balances: balancesOf({ stores: [csfloat()], latestBalances: [latest(1, 10000)], withdrawals }),
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
  test('exemplo D44 → realProfit 0, sem pendente nem liberado', () => {
    const r = computeRealProfit(baseScenario());
    expect(r).toMatchObject({
      depositsBrlCents: 100000,
      withdrawalsBrlCents: 30000,
      platformBalanceEstimatedBrlCents: 50000,
      pendingBalanceEstimatedBrlCents: 0,
      releasedAfterBalanceEstimatedBrlCents: 0,
      nextReleaseAt: null,
      stockEstimatedBrlCents: 20000,
      realProfitBrlCents: 0,
      realProfitUsdCentsApprox: 0,
      withdrawnVsDeposited: { withdrawnBrlCents: 30000, depositedBrlCents: 100000, ratio: 0.3 },
      warnings: [],
    });
    expect(r).not.toHaveProperty('withdrawableRealProfitBrlCents');
    expect(r).not.toHaveProperty('nonWithdrawableBalanceBrlCents');
  });

  test('loja não sacável (Steam) entra no lucro como as demais', () => {
    const s = baseScenario();
    s.balances = balancesOf({ stores: [csfloat(), steam()], latestBalances: [latest(1, 10000), latest(steam().id, 8000)], withdrawals: s.withdrawals });
    const r = computeRealProfit(s);
    expect(r.platformBalanceEstimatedBrlCents).toBe(58000);
    expect(r.realProfitBrlCents).toBe(8000);
    expect(r.realProfitUsdCentsApprox).toBe(1600);
    // a soma "não sacável" é só informativa e não é somada de novo
    expect(s.balances.totals.nonWithdrawableEstimatedBrlCents).toBe(8000);
  });

  test('pendente e liberado após o registro entram no total, cada um arredondado por loja (ROUND)', () => {
    const stores = [csfloat()];
    const items = [heldSale(1, 7500, '2026-11-20T18:00:00.000Z'), heldSale(1, 1200, '2026-11-13T20:00:00.000Z')];
    const balances = balancesOf({ stores, latestBalances: [latest(1, 12346, '2026-11-20T15:00:00.000Z')], items, settings: { usdBrlRate: 5.4321 } });
    const r = computeRealProfit({ balances, settings: { usdBrlRate: 5.4321 } });
    expect(r.platformBalanceEstimatedBrlCents).toBe(67065);
    expect(r.pendingBalanceEstimatedBrlCents).toBe(40741);
    expect(r.releasedAfterBalanceEstimatedBrlCents).toBe(6519);
    expect(r.nextReleaseAt).toBe('2026-11-27T18:00:00.000Z');
    expect(r.realProfitBrlCents).toBe(67065 + 40741 + 6519);
  });

  test('P1: estoque pelo custo — USD 1000 + BRL 3000, cotação 5.0 → 8000', () => {
    const r = computeRealProfit({ stockItems: [stockItem(1000, 'USD'), stockItem(3000, 'BRL')], settings: SETTINGS });
    expect(r.stockEstimatedBrlCents).toBe(8000);
    expect(r.realProfitBrlCents).toBe(8000);
  });

  test('itens vendidos não entram no estoque', () => {
    const r = computeRealProfit({ stockItems: [stockItem(3000, 'BRL'), soldItem({ purchasePriceCents: 99999 })], settings: SETTINGS });
    expect(r.stockEstimatedBrlCents).toBe(3000);
  });

  test('estoque USD sem cotação → estoque e lucro null + aviso objeto STOCK (T48)', () => {
    const r = computeRealProfit({ deposits: [{ amountBrlCents: 100 }], stockItems: [stockItem(1000, 'USD')], settings: NO_FX });
    expect(r.stockEstimatedBrlCents).toBeNull();
    expect(r.realProfitBrlCents).toBeNull();
    expect(r.warnings).toEqual([{ source: 'STOCK', storeId: null, storeName: null, code: 'FX_NOT_CONFIGURED', text: 'cotação não configurada' }]);
  });

  test('tudo vazio → 0 e ratio null', () => {
    const r = computeRealProfit({ settings: SETTINGS });
    expect(r).toMatchObject({
      depositsBrlCents: 0,
      withdrawalsBrlCents: 0,
      platformBalanceEstimatedBrlCents: 0,
      pendingBalanceEstimatedBrlCents: 0,
      releasedAfterBalanceEstimatedBrlCents: 0,
      stockEstimatedBrlCents: 0,
      realProfitBrlCents: 0,
      withdrawnVsDeposited: { withdrawnBrlCents: 0, depositedBrlCents: 0, ratio: null },
      warnings: [],
    });
  });

  test('loja com saque e taxa nula: saldo estimado sem desconto de taxa', () => {
    const balances = balancesOf({ stores: [csmoney()], latestBalances: [latest(csmoney().id, 1000)] });
    const r = computeRealProfit({ balances, settings: SETTINGS });
    expect(r.platformBalanceEstimatedBrlCents).toBe(5000);
    expect(r.realProfitBrlCents).toBe(5000);
    expect(r.warnings).toEqual([]);
  });

  test('loja USD sem cotação → lucro null e aviso da loja com código; outros códigos coexistem', () => {
    const store = csfloat({ id: 9, name: 'LojaUSD', allowsWithdrawal: false });
    const balances = balancesOf({ stores: [store], latestBalances: [latest(9, 1000)], items: [], settings: NO_FX });
    const r = computeRealProfit({
      deposits: [{ amountBrlCents: 1000 }], withdrawals: [{ amountBrlCents: 3000 }], balances, settings: NO_FX,
    });
    expect(r.platformBalanceEstimatedBrlCents).toBeNull();
    expect(r.realProfitBrlCents).toBeNull();
    expect(r.warnings).toEqual([{ source: 'STORE', storeId: 9, storeName: 'LojaUSD', code: 'FX_NOT_CONFIGURED', text: 'cotação não configurada' }]);
  });

  test('pendente USD sem cotação anula o lucro; disponível 0 não fica nulo', () => {
    const balances = balancesOf({ stores: [csfloat()], items: [heldSale(1, 2500, '2026-11-20T18:00:00.000Z')], settings: NO_FX });
    const r = computeRealProfit({ balances, settings: NO_FX });
    expect(r.platformBalanceEstimatedBrlCents).toBe(0);
    expect(r.pendingBalanceEstimatedBrlCents).toBeNull();
    expect(r.realProfitBrlCents).toBeNull();
  });

  test('aviso BALANCE_MAYBE_OUTDATED vira objeto com a loja', () => {
    const balances = balancesOf({
      stores: [csfloat()], latestBalances: [latest(1, 100, '2026-11-01T12:00:00.000Z')],
      withdrawals: [{ storeId: 1, withdrawnAt: '2026-11-05T12:00:00.000Z' }],
    });
    expect(computeRealProfit({ balances, settings: SETTINGS }).warnings).toEqual([
      { source: 'STORE', storeId: 1, storeName: 'CSFloat', code: 'BALANCE_MAYBE_OUTDATED', text: 'saldo possivelmente desatualizado' },
    ]);
  });

  test('…UsdCentsApprox null sem cotação; lucro negativo arredonda sem -0', () => {
    const r = computeRealProfit({ deposits: [{ amountBrlCents: 1000 }], withdrawals: [{ amountBrlCents: 6000 }], settings: NO_FX });
    expect(r.realProfitBrlCents).toBe(5000);
    expect(r.realProfitUsdCentsApprox).toBeNull();
    const neg = computeRealProfit({ deposits: [{ amountBrlCents: 1 }], settings: SETTINGS });
    expect(neg.realProfitBrlCents).toBe(-1);
    expect(neg.realProfitUsdCentsApprox).toBe(0);
    expect(Object.is(neg.realProfitUsdCentsApprox, -0)).toBe(false);
  });

  test('loja sem saldo registrado → 0; loja inativa com saldo é somada', () => {
    const none = computeRealProfit({ balances: balancesOf({ stores: [csfloat()] }), settings: SETTINGS });
    expect(none.realProfitBrlCents).toBe(0);
    const inactive = steam({ isActive: false });
    const r = computeRealProfit({ balances: balancesOf({ stores: [inactive], latestBalances: [latest(inactive.id, 4000)] }), settings: SETTINGS });
    expect(r.realProfitBrlCents).toBe(4000);
  });
});
