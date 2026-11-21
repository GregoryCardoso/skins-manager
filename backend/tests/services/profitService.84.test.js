'use strict';

// Complemento do bloco 8.4 de D211: computeRealProfit com os saldos de buildCurrentBalances.
const { computeRealProfit } = require('../../src/services/profitService');
const { buildCurrentBalances } = require('../../src/services/storeBalanceService');
const { csfloat, steam, csmoney } = require('../helpers/storeFixtures');

const NOW = new Date('2026-11-21T12:00:00.000Z');
const RATE = 5.4321;
const SETTINGS = { usdBrlRate: RATE };
const NO_FX = { usdBrlRate: null };

const balancesOf = (args) => buildCurrentBalances({ withdrawals: [], items: [], latestBalances: [], settings: SETTINGS, now: NOW, ...args });
const latest = (storeId, balanceCents, recordedAt) => ({ id: storeId, storeId, balanceCents, recordedAt, fxRate: null });
const sale = (storeId, net, soldAt, days = 7) => ({
  status: 'VENDIDO', saleStoreId: storeId, netReceivedCents: net, soldAt, saleHoldDaysApplied: days, purchaseStoreId: null,
  acquiredAt: '2026-01-01T00:00:00.000Z',
});
const stock = (cost, currency = 'USD') => ({
  status: 'EM_ESTOQUE', purchasePriceCents: cost, purchaseCurrency: currency, fxRateAtPurchase: currency === 'BRL' ? RATE : null,
});

// Exemplo de D206 inteiro, em memória.
function d206() {
  const stores = [csfloat({ id: 1 }), steam({ id: 2 }), csmoney({ id: 3 })];
  const items = [
    sale(1, 2500, '2026-11-20T18:00:00.000Z'), sale(1, 2000, '2026-11-21T01:30:00.000Z'), sale(1, 3000, '2026-11-18T09:00:00.000Z'),
    sale(1, 1200, '2026-11-13T20:00:00.000Z'), sale(1, 1500, '2026-11-12T10:00:00.000Z'),
    sale(3, 1000, '2026-11-19T12:00:00.000Z'), sale(3, 600, '2026-11-10T12:00:00.000Z'),
    sale(2, 800, '2026-11-21T10:00:00.000Z', 0),
  ];
  const withdrawals = [
    { id: 1, storeId: 1, amountStoreCents: 10000, feeCents: 250, amountBrlCents: 52037, withdrawnAt: '2026-11-10T12:00:00.000Z' },
    { id: 2, storeId: null, amountStoreCents: null, feeCents: null, amountBrlCents: 10000, withdrawnAt: '2026-11-02T12:00:00.000Z' },
  ];
  const latestBalances = [latest(1, 12346, '2026-11-20T15:00:00.000Z'), latest(2, 4590, '2026-11-21T09:00:00.000Z')];
  return {
    deposits: [{ amountBrlCents: 50000 }, { amountBrlCents: 30000 }],
    withdrawals,
    stockItems: [stock(1000), stock(2500, 'BRL'), stock(0)],
    settings: SETTINGS,
    balances: balancesOf({ stores, items, withdrawals, latestBalances }),
    stores, items, latestBalances,
  };
}

describe('computeRealProfit: exemplo de D206 (8.4)', () => {
  test('117575, ≈ US$ 21644 (ROUND sobre o total), ratio 0,7754625 e nextReleaseAt', () => {
    const r = computeRealProfit(d206());
    expect(r.platformBalanceEstimatedBrlCents).toBe(71655);
    expect(r.pendingBalanceEstimatedBrlCents).toBe(46173);
    expect(r.releasedAfterBalanceEstimatedBrlCents).toBe(9778);
    expect(r.stockEstimatedBrlCents).toBe(7932);
    expect(r.withdrawalsBrlCents).toBe(62037);
    expect(r.realProfitBrlCents).toBe(117575);
    expect(r.realProfitUsdCentsApprox).toBe(21644);
    expect(r.withdrawnVsDeposited.ratio).toBeCloseTo(0.7754625, 7);
    expect(r.nextReleaseAt).toBe('2026-11-25T09:00:00.000Z');
  });

  test('ROUND por parcela: a soma das parcelas difere do ROUND do total', () => {
    const r = computeRealProfit(d206());
    // pendente por loja: 40741 + 5432 (7500 e 1000 centavos USD), e não ROUND(8500 × 5,4321) = 46173 (igual aqui), liberado 6519 + 3259
    expect(r.pendingBalanceEstimatedBrlCents).toBe(Math.round(7500 * RATE) + Math.round(1000 * RATE));
    expect(r.releasedAfterBalanceEstimatedBrlCents).toBe(Math.round(1200 * RATE) + Math.round(600 * RATE));
    // 1200 + 600 = 1800 × 5,4321 = 9777,78 → 9778; por parcela 6519 + 3259 = 9778 (coincide) e o disponível é por loja
    expect(r.platformBalanceEstimatedBrlCents).toBe(Math.round(12346 * RATE) + 4590);
  });

  test('referência 61624 sem pendente e sem liberado (sem retenção nas vendas)', () => {
    const s = d206();
    const items = s.items.map((item) => ({ ...item, saleHoldDaysApplied: 0 }));
    const r = computeRealProfit({ ...s, balances: balancesOf({ stores: s.stores, items, withdrawals: s.withdrawals, latestBalances: s.latestBalances }) });
    expect(r.pendingBalanceEstimatedBrlCents).toBe(0);
    expect(r.releasedAfterBalanceEstimatedBrlCents).toBe(0);
    expect(r.nextReleaseAt).toBeNull();
    expect(r.realProfitBrlCents).toBe(61624);
  });

  test('avisos: BALANCE_MAYBE_OUTDATED da CSFloat e da Steam; nenhum da CSMoney (sem saldo registrado)', () => {
    const r = computeRealProfit(d206());
    expect(r.warnings).toEqual([
      { source: 'STORE', storeId: 1, storeName: 'CSFloat', code: 'BALANCE_MAYBE_OUTDATED', text: expect.any(String) },
      { source: 'STORE', storeId: 2, storeName: 'Steam', code: 'BALANCE_MAYBE_OUTDATED', text: expect.any(String) },
    ]);
    expect(r.warnings.some((w) => w.storeId === 3)).toBe(false);
  });

  test('trocar allowsWithdrawal da Steam (ou da CSFloat) não muda o lucro', () => {
    const s = d206();
    const flipped = s.stores.map((store) => ({ ...store, allowsWithdrawal: !store.allowsWithdrawal }));
    const r = computeRealProfit({ ...s, balances: balancesOf({ stores: flipped, items: s.items, withdrawals: s.withdrawals, latestBalances: s.latestBalances }) });
    expect(r.realProfitBrlCents).toBe(117575);
  });

  test('loja inativa continua somada; saque antigo sem loja conta; taxa paga do saque não entra', () => {
    const s = d206();
    const inactive = s.stores.map((store) => ({ ...store, isActive: false }));
    const noFee = s.withdrawals.map((w) => ({ ...w, feeCents: w.feeCents === null ? null : 99999 }));
    const r = computeRealProfit({
      ...s, withdrawals: noFee,
      balances: balancesOf({ stores: inactive, items: s.items, withdrawals: noFee, latestBalances: s.latestBalances }),
    });
    expect(r.realProfitBrlCents).toBe(117575);
    expect(r.withdrawalsBrlCents).toBe(62037); // inclui os 10000 do saque sem loja
  });
});

describe('computeRealProfit: sem cotação (8.4)', () => {
  test('pendente USD sem cotação → null e lucro null; a parcela BRL (Steam) continua', () => {
    const s = d206();
    const balances = balancesOf({ stores: s.stores, items: s.items, withdrawals: s.withdrawals, latestBalances: s.latestBalances, settings: NO_FX });
    const r = computeRealProfit({ ...s, balances, stockItems: [stock(2500, 'BRL')], settings: NO_FX });
    expect(r.pendingBalanceEstimatedBrlCents).toBeNull();
    expect(r.platformBalanceEstimatedBrlCents).toBeNull(); // CSFloat 12346 USD
    expect(r.realProfitBrlCents).toBeNull();
    expect(r.realProfitUsdCentsApprox).toBeNull();
    expect(r.stockEstimatedBrlCents).toBe(2500);
    const steamRow = balances.stores.find((row) => row.storeId === 2);
    expect(steamRow.availableEstimatedBrlCents).toBe(4590);
  });

  test('só a Steam (BRL) sem cotação: lucro calculado normalmente', () => {
    const balances = balancesOf({ stores: [steam({ id: 2 })], latestBalances: [latest(2, 4590, '2026-11-21T09:00:00.000Z')], settings: NO_FX });
    const r = computeRealProfit({ balances, settings: NO_FX });
    expect(r.platformBalanceEstimatedBrlCents).toBe(4590);
    expect(r.realProfitBrlCents).toBe(4590);
    expect(r.realProfitUsdCentsApprox).toBeNull();
    expect(r.warnings).toEqual([]);
  });

  test('liberado USD sem cotação → null e lucro null', () => {
    const balances = balancesOf({
      stores: [csfloat({ id: 1 })], items: [sale(1, 1200, '2026-11-13T20:00:00.000Z')],
      latestBalances: [latest(1, 0, '2026-11-20T15:00:00.000Z')], settings: NO_FX,
    });
    const r = computeRealProfit({ balances, settings: NO_FX });
    expect(r.releasedAfterBalanceEstimatedBrlCents).toBeNull();
    expect(r.realProfitBrlCents).toBeNull();
    expect(r.warnings.map((w) => w.code)).toContain('FX_NOT_CONFIGURED');
  });

  test('estoque USD sem cotação → aviso source STOCK; só GANHEI sem cotação → 0 sem aviso', () => {
    const bad = computeRealProfit({ stockItems: [stock(1000)], settings: NO_FX });
    expect(bad.warnings).toEqual([{ source: 'STOCK', storeId: null, storeName: null, code: 'FX_NOT_CONFIGURED', text: expect.any(String) }]);
    const ok = computeRealProfit({ stockItems: [stock(0)], settings: NO_FX });
    expect(ok.stockEstimatedBrlCents).toBe(0);
    expect(ok.warnings).toEqual([]);
  });
});

describe('computeRealProfit: bordas (8.4)', () => {
  test('depósitos zero → ratio null (mesmo com saques)', () => {
    const r = computeRealProfit({ withdrawals: [{ amountBrlCents: 500 }], settings: SETTINGS });
    expect(r.withdrawnVsDeposited).toEqual({ withdrawnBrlCents: 500, depositedBrlCents: 0, ratio: null });
    expect(r.realProfitBrlCents).toBe(500);
  });

  test('sinal negativo: ROUND afasta do zero no meio e nunca devolve -0', () => {
    const half = computeRealProfit({ deposits: [{ amountBrlCents: 5 }], settings: { usdBrlRate: 2 } });
    expect(half.realProfitBrlCents).toBe(-5);
    expect(half.realProfitUsdCentsApprox).toBe(-3); // -2,5 → -3 (meio afastando de zero)
    const tiny = computeRealProfit({ deposits: [{ amountBrlCents: 1 }], settings: SETTINGS });
    expect(Object.is(tiny.realProfitUsdCentsApprox, -0)).toBe(false);
    expect(tiny.realProfitUsdCentsApprox).toBe(0);
    const big = computeRealProfit({ deposits: [{ amountBrlCents: 54321 }], settings: SETTINGS });
    expect(big.realProfitUsdCentsApprox).toBe(-10000);
  });

  test('nextReleaseAt é a menor data entre as lojas', () => {
    const balances = balancesOf({
      stores: [csfloat({ id: 1 }), csmoney({ id: 3 })],
      items: [sale(1, 100, '2026-11-20T18:00:00.000Z'), sale(3, 100, '2026-11-19T12:00:00.000Z'), sale(3, 100, '2026-11-20T01:00:00.000Z')],
    });
    expect(computeRealProfit({ balances, settings: SETTINGS }).nextReleaseAt).toBe('2026-11-26T12:00:00.000Z');
  });

  test('sem balances → parcelas 0 e sem avisos', () => {
    const r = computeRealProfit({ settings: SETTINGS });
    expect([r.platformBalanceEstimatedBrlCents, r.pendingBalanceEstimatedBrlCents, r.releasedAfterBalanceEstimatedBrlCents]).toEqual([0, 0, 0]);
    expect(r.warnings).toEqual([]);
  });
});
