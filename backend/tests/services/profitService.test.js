'use strict';

const { computeSaleProfitUsdCents, computeRealProfit } = require('../../src/services/profitService');
const { csfloat, steam, csmoney } = require('../helpers/storeFixtures');

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

// Cenário base de D44: aportes 100000; saques 30000 (um sem loja); CSFloat saldo 10000 USD a 5.0; estoque 20000 BRL.
function baseScenario() {
  const csfWithdrawal = { id: 1, storeId: 1, amountStoreCents: 2000, amountBrlCents: 10000, withdrawnAt: '2026-11-01T12:00:00.000Z' };
  return {
    deposits: [{ amountBrlCents: 100000 }],
    withdrawals: [csfWithdrawal, { id: 2, storeId: null, amountStoreCents: null, amountBrlCents: 20000, withdrawnAt: '2026-11-02T12:00:00.000Z' }],
    platformBalances: [
      { store: csfloat(), balance: { balanceCents: 10000, fxRate: null, recordedAt: '2026-11-10T12:00:00.000Z' }, recentWithdrawals: [csfWithdrawal] },
    ],
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
  test('exemplo D44 → realProfit 0 e withdrawableRealProfit 0', () => {
    const r = computeRealProfit(baseScenario());
    expect(r).toMatchObject({
      depositsBrlCents: 100000,
      withdrawalsBrlCents: 30000,
      withdrawableBalanceBrlCents: 50000,
      nonWithdrawableBalanceBrlCents: 0,
      platformBalanceEstimatedBrlCents: 50000,
      stockEstimatedBrlCents: 20000,
      realProfitBrlCents: 0,
      withdrawableRealProfitBrlCents: 0,
      realProfitUsdCentsApprox: 0,
      withdrawableRealProfitUsdCentsApprox: 0,
      withdrawnVsDeposited: { withdrawnBrlCents: 30000, depositedBrlCents: 100000, ratio: 0.3 },
      warnings: [],
    });
    expect(r.balancesByStore).toEqual([
      { storeId: 1, storeName: 'CSFloat', balanceCents: 10000, currency: 'USD', estimatedBrlCents: 50000, withdrawable: true, warning: null },
    ]);
  });

  test('P2: + Steam saldo 8000 BRL → nonWithdrawable 8000, real 8000, sacável 0', () => {
    const s = baseScenario();
    s.platformBalances.push({ store: steam(), balance: { balanceCents: 8000, fxRate: 5.0, recordedAt: '2026-11-10T12:00:00.000Z' }, recentWithdrawals: [] });
    const r = computeRealProfit(s);
    expect(r.nonWithdrawableBalanceBrlCents).toBe(8000);
    expect(r.platformBalanceEstimatedBrlCents).toBe(58000);
    expect(r.realProfitBrlCents).toBe(8000);
    expect(r.withdrawableRealProfitBrlCents).toBe(0);
    expect(r.realProfitUsdCentsApprox).toBe(1600);
    expect(r.balancesByStore.find((b) => b.storeName === 'Steam')).toMatchObject({ withdrawable: false, estimatedBrlCents: 8000 });
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

  test('estoque USD sem cotação → estoque e lucros null + aviso', () => {
    const r = computeRealProfit({ deposits: [{ amountBrlCents: 100 }], stockItems: [stockItem(1000, 'USD')], settings: { usdBrlRate: null } });
    expect(r.stockEstimatedBrlCents).toBeNull();
    expect(r.realProfitBrlCents).toBeNull();
    expect(r.withdrawableRealProfitBrlCents).toBeNull();
    expect(r.warnings.some((w) => w.includes('cotação não configurada'))).toBe(true);
  });

  test('tudo vazio → 0 e ratio null', () => {
    const r = computeRealProfit({ settings: SETTINGS });
    expect(r).toMatchObject({
      depositsBrlCents: 0,
      withdrawalsBrlCents: 0,
      platformBalanceEstimatedBrlCents: 0,
      withdrawableBalanceBrlCents: 0,
      nonWithdrawableBalanceBrlCents: 0,
      stockEstimatedBrlCents: 0,
      realProfitBrlCents: 0,
      withdrawableRealProfitBrlCents: 0,
      balancesByStore: [],
      withdrawnVsDeposited: { withdrawnBrlCents: 0, depositedBrlCents: 0, ratio: null },
      warnings: [],
    });
  });

  test('loja com saque, taxa nula e sem saques → lucros null + aviso', () => {
    const r = computeRealProfit({
      platformBalances: [{ store: csmoney(), balance: { balanceCents: 1000, fxRate: null, recordedAt: '2026-11-10T12:00:00.000Z' }, recentWithdrawals: [] }],
      settings: SETTINGS,
    });
    expect(r.withdrawableBalanceBrlCents).toBeNull();
    expect(r.realProfitBrlCents).toBeNull();
    expect(r.withdrawableRealProfitBrlCents).toBeNull();
    expect(r.warnings).toContain('CSMoney: taxas não configuradas');
  });

  test('só loja não sacável USD sem cotação → realProfit null, sacável calculado', () => {
    const store = csfloat({ id: 9, name: 'LojaUSD', allowsWithdrawal: false });
    const r = computeRealProfit({
      deposits: [{ amountBrlCents: 1000 }],
      withdrawals: [{ id: 1, storeId: null, amountStoreCents: null, amountBrlCents: 3000, withdrawnAt: '2026-11-01T12:00:00.000Z' }],
      platformBalances: [{ store, balance: { balanceCents: 1000, fxRate: null, recordedAt: '2026-11-10T12:00:00.000Z' }, recentWithdrawals: [] }],
      settings: { usdBrlRate: null },
    });
    expect(r.nonWithdrawableBalanceBrlCents).toBeNull();
    expect(r.realProfitBrlCents).toBeNull();
    expect(r.withdrawableRealProfitBrlCents).toBe(2000);
    expect(r.warnings.some((w) => w.includes('cotação não configurada'))).toBe(true);
  });

  test('…UsdCentsApprox null sem cotação', () => {
    const r = computeRealProfit({ deposits: [{ amountBrlCents: 1000 }], withdrawals: [{ amountBrlCents: 6000 }], settings: { usdBrlRate: null } });
    expect(r.realProfitBrlCents).toBe(5000);
    expect(r.realProfitUsdCentsApprox).toBeNull();
    expect(r.withdrawableRealProfitUsdCentsApprox).toBeNull();
  });

  test('loja sem saldo registrado → 0', () => {
    const r = computeRealProfit({ platformBalances: [{ store: csfloat(), balance: null, recentWithdrawals: [] }], settings: SETTINGS });
    expect(r.balancesByStore[0]).toMatchObject({ balanceCents: 0, estimatedBrlCents: 0 });
    expect(r.realProfitBrlCents).toBe(0);
  });

  test('loja inativa com saldo é incluída', () => {
    const r = computeRealProfit({
      platformBalances: [{ store: steam({ isActive: false }), balance: { balanceCents: 4000, fxRate: 5.0, recordedAt: '2026-11-10T12:00:00.000Z' }, recentWithdrawals: [] }],
      settings: SETTINGS,
    });
    expect(r.nonWithdrawableBalanceBrlCents).toBe(4000);
    expect(r.realProfitBrlCents).toBe(4000);
  });
});
