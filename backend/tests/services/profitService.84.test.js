'use strict';

// Lucro real em USD (8.5, D225, D226; saldo calculado da 8.6, D239/D245): o exemplo de D226 centavo a centavo, a referência só em USD, sem cotação e bordas.
const { computeRealProfit, estimateStockUsd } = require('../../src/services/profitService');
const { buildCurrentBalances } = require('../../src/services/storeBalanceService');
const { csfloat, steam, csmoney } = require('../helpers/storeFixtures');

const NOW = new Date('2026-11-21T12:00:00.000Z');
const RATE = 5.4321;
const SETTINGS = { usdBrlRate: RATE };
const NO_FX = { usdBrlRate: null };

// `latest(...)` agora vira um aporte da loja (não existe mais saldo inicial, D252): o saldo calculado parte de 0.
const asDeposits = (list) => list.map((b) => ({ storeId: b.storeId, amountStoreCents: b.balanceCents, depositedAt: b.recordedAt }));
// `latestBalances` são saldos iniciais (âncora do cálculo, D239).
const balancesOf = ({ latestBalances = [], ...args } = {}) => buildCurrentBalances({
  withdrawals: [], items: [], deposits: asDeposits(latestBalances), settings: SETTINGS, now: NOW, ...args,
});
const latest = (storeId, balanceCents, recordedAt) => ({
  id: storeId, storeId, kind: 'INITIAL', balanceCents, computedCents: null, adjustmentCents: null, recordedAt, fxRate: null,
});
const sale = (storeId, net, soldAt, days = 7) => ({
  status: 'VENDIDO', saleStoreId: storeId, saleCurrency: storeId === 2 ? 'BRL' : 'USD', netReceivedCents: net, soldAt, saleHoldDaysApplied: days, purchaseStoreId: null,
  acquiredAt: '2026-01-01T00:00:00.000Z',
});
// COMPRA em USD, COMPRA na Steam (BRL, cotação gravada 5,0000) e GANHEI (0).
const stock = (cost, currency = 'USD') => ({
  status: 'EM_ESTOQUE', purchasePriceCents: cost, purchaseCurrency: currency, fxRateAtPurchase: currency === 'BRL' ? 5.0 : null,
});

const DEPOSIT_A = { id: 1, storeId: 1, amountStoreCents: 9200, amountBrlCents: 50000 }; // creditado US$ 92,00; pago R$ 500 (informativo)
const DEPOSIT_B = { id: 2, storeId: null, amountStoreCents: null, amountBrlCents: 30000 }; // legado
const WITHDRAWAL_1 = { id: 1, storeId: 1, amountStoreCents: 10000, feeCents: 250, amountBrlCents: 52037, withdrawnAt: '2026-11-10T12:00:00.000Z' };
const WITHDRAWAL_2 = { id: 2, storeId: null, amountStoreCents: null, feeCents: null, amountBrlCents: 10000, withdrawnAt: '2026-11-02T12:00:00.000Z' };

// Exemplo de D226 inteiro, em memória.
function d226({ onlyUsd = false } = {}) {
  const stores = onlyUsd ? [csfloat({ id: 1 }), csmoney({ id: 3 })] : [csfloat({ id: 1 }), steam({ id: 2 }), csmoney({ id: 3 })];
  const items = [
    sale(1, 2500, '2026-11-20T18:00:00.000Z'), sale(1, 2000, '2026-11-21T01:30:00.000Z'), sale(1, 3000, '2026-11-18T09:00:00.000Z'),
    sale(1, 1200, '2026-11-13T20:00:00.000Z'), sale(1, 1500, '2026-11-12T10:00:00.000Z'),
    sale(3, 1000, '2026-11-19T12:00:00.000Z'), sale(3, 600, '2026-11-10T12:00:00.000Z'),
    sale(2, 800, '2026-11-21T10:00:00.000Z', 0),
  ];
  const withdrawals = onlyUsd ? [WITHDRAWAL_1] : [WITHDRAWAL_1, WITHDRAWAL_2];
  const latestBalances = onlyUsd
    ? [latest(1, 12346, '2026-11-20T15:00:00.000Z')]
    : [latest(1, 12346, '2026-11-20T15:00:00.000Z'), latest(2, 4590, '2026-11-21T09:00:00.000Z')];
  return {
    deposits: onlyUsd ? [DEPOSIT_A] : [DEPOSIT_A, DEPOSIT_B],
    withdrawals,
    stockItems: onlyUsd ? [stock(1000), stock(0)] : [stock(1000), stock(2500, 'BRL'), stock(0)],
    settings: SETTINGS,
    balances: balancesOf({ stores, items, withdrawals, latestBalances }),
    stores, items, latestBalances,
  };
}

describe('computeRealProfit: exemplo de D226 (8.5)', () => {
  const r = computeRealProfit(d226());

  test('parcelas em US$ centavo a centavo', () => {
    expect(r.baseCurrency).toBe('USD');
    expect(r.depositsUsdCents).toBe(14723); // 9200 + ROUND(30000 / 5,4321) = 5523
    expect(r.withdrawalsNetUsdCents).toBe(11591); // 9750 + ROUND(10000 / 5,4321) = 1841
    // disponível calculado (D252, sem corte por data): CSFloat 12346 + vendas liberadas F 1200 e D 1500 − saque 10000 = 5046;
    // Steam ROUND((4590 + 800) / 5,4321) = 992; CSMoney 600 liberado. Não há parcela "liberado após o registro" (D245).
    expect(r.platformBalanceUsdCents).toBe(6638); // 5046 + 992 + 600
    expect(r.pendingBalanceUsdCents).toBe(8500);
    expect(r).not.toHaveProperty('releasedAfterBalanceUsdCents');
    expect(r.stockUsdCents).toBe(1500); // 1000 + 2500 / 5,0 = 500 (cotação gravada) + 0
    expect(r.realProfitUsdCents).toBe(13506); // 11591 + 6638 + 8500 + 1500 - 14723
    expect(r.nextReleaseAt).toBe('2026-11-25T09:00:00.000Z');
  });

  test('"≈ R$" de cada total vem do backend, sobre o total já somado', () => {
    expect(r.approx).toEqual({
      deposits: 79977, withdrawals: 62963, platformBalance: 36058, pendingBalance: 46173, stock: 8148,
      realProfit: 73366,
    });
  });

  test('estimated e estimatedParts', () => {
    expect(r.estimated).toBe(true);
    expect(r.estimatedParts).toEqual({
      deposits: true, withdrawals: true, platformBalance: true, pendingBalance: false, stock: true,
    });
  });

  test('já sacado vs. colocado: 11591 / 14723', () => {
    expect(r.withdrawnVsDeposited).toMatchObject({ withdrawnUsdCents: 11591, depositedUsdCents: 14723 });
    expect(r.withdrawnVsDeposited.ratio).toBeCloseTo(0.78727, 5);
  });

  test('o valor em R$ informativo de aportes e saques NÃO altera o lucro', () => {
    const s = d226();
    s.deposits = [{ ...DEPOSIT_A, amountBrlCents: 1 }, DEPOSIT_B];
    s.withdrawals = [{ ...WITHDRAWAL_1, amountBrlCents: null }, WITHDRAWAL_2];
    expect(computeRealProfit(s).realProfitUsdCents).toBe(13506);
    s.withdrawals = [{ ...WITHDRAWAL_1, amountBrlCents: 999999 }, WITHDRAWAL_2];
    s.deposits = [{ ...DEPOSIT_A, amountBrlCents: 999999 }, DEPOSIT_B];
    expect(computeRealProfit(s).realProfitUsdCents).toBe(13506);
  });

  test('a taxa do saque só reduz o saque líquido; taxa nula conta 0 (D233) e não anula o lucro', () => {
    const s = d226();
    s.withdrawals = [{ ...WITHDRAWAL_1, feeCents: null }, WITHDRAWAL_2];
    const noFee = computeRealProfit(s);
    expect(noFee.withdrawalsNetUsdCents).toBe(10000 + 1841);
    expect(noFee.realProfitUsdCents).toBe(13506 + 250);
  });

  test('avisos: nenhum (não há mais aviso de saldo desatualizado, D243; CSMoney sem saldo inicial não avisa)', () => {
    expect(r.warnings).toEqual([]);
  });

  test('loja inativa continua somada; allowsWithdrawal não muda o lucro', () => {
    const s = d226();
    const flipped = s.stores.map((store) => ({ ...store, isActive: false, allowsWithdrawal: !store.allowsWithdrawal }));
    const out = computeRealProfit({
      ...s, stores: flipped, balances: balancesOf({ stores: flipped, items: s.items, withdrawals: s.withdrawals, latestBalances: s.latestBalances }),
    });
    expect(out.realProfitUsdCents).toBe(13506);
  });
});

describe('computeRealProfit: referência só em USD (D226)', () => {
  test('24196, estimated false e sem "≈" em nenhuma parcela', () => {
    const r = computeRealProfit(d226({ onlyUsd: true }));
    expect(r.realProfitUsdCents).toBe(15696); // 9750 + 5046 + 600 + 8500 + 1000 - 9200
    expect(r.estimated).toBe(false);
    expect(Object.values(r.estimatedParts).some(Boolean)).toBe(false);
    expect(r.depositsUsdCents).toBe(9200);
    expect(r.withdrawalsNetUsdCents).toBe(9750);
  });

  test('sem cotação, a referência em USD segue exata e só o "≈ R$" some', () => {
    const s = d226({ onlyUsd: true });
    const balances = balancesOf({ stores: s.stores, items: s.items, withdrawals: s.withdrawals, latestBalances: s.latestBalances, settings: NO_FX });
    const r = computeRealProfit({ ...s, balances, settings: NO_FX });
    expect(r.realProfitUsdCents).toBe(15696);
    expect(r.approx.realProfit).toBeNull();
    expect(r.approx.deposits).toBeNull();
    expect(r.warnings.some((w) => w.code === 'FX_NOT_CONFIGURED')).toBe(false);
  });
});

describe('computeRealProfit: sem cotação (8.5)', () => {
  const s = d226();
  const balances = balancesOf({ stores: s.stores, items: s.items, withdrawals: s.withdrawals, latestBalances: s.latestBalances, settings: NO_FX });
  const r = computeRealProfit({ ...s, balances, settings: NO_FX });

  test('aportes, saques e disponível ficam nulos; pendente e estoque (cotação gravada) continuam', () => {
    expect(r.depositsUsdCents).toBeNull();
    expect(r.withdrawalsNetUsdCents).toBeNull();
    expect(r.platformBalanceUsdCents).toBeNull();
    expect(r.pendingBalanceUsdCents).toBe(8500);
    expect(r.stockUsdCents).toBe(1500);
    expect(r.realProfitUsdCents).toBeNull();
    expect(r.withdrawnVsDeposited.ratio).toBeNull();
  });

  test('todos os "≈ R$" ficam nulos', () => {
    expect(Object.values(r.approx).every((value) => value === null)).toBe(true);
  });

  test('avisos FX_NOT_CONFIGURED de DEPOSITS, WITHDRAWALS e STORE (Steam); estoque não emite aviso', () => {
    const fx = r.warnings.filter((w) => w.code === 'FX_NOT_CONFIGURED');
    expect(fx.map((w) => w.source).sort()).toEqual(['DEPOSITS', 'STORE', 'WITHDRAWALS']);
    expect(fx.find((w) => w.source === 'STORE')).toMatchObject({ storeId: 2, storeName: 'Steam' });
    expect(r.warnings.some((w) => w.source === 'STOCK')).toBe(false);
  });
});

describe('computeRealProfit: bordas (8.5)', () => {
  test('sem aportes: ratio nulo mesmo com saques', () => {
    const r = computeRealProfit({
      withdrawals: [{ storeId: 1, amountStoreCents: 500, feeCents: null, amountBrlCents: null }], stores: [csfloat()], settings: SETTINGS,
    });
    expect(r.withdrawnVsDeposited).toEqual({ withdrawnUsdCents: 500, depositedUsdCents: 0, ratio: null });
    expect(r.realProfitUsdCents).toBe(500);
  });

  test('lucro negativo: "≈ R$" afasta do zero no meio e nunca devolve -0', () => {
    const half = computeRealProfit({ deposits: [{ storeId: 1, amountStoreCents: 5, amountBrlCents: null }], stores: [csfloat()], settings: { usdBrlRate: 0.5 } });
    expect(half.realProfitUsdCents).toBe(-5);
    expect(half.approx.realProfit).toBe(-3); // -2,5 -> -3
    const tiny = computeRealProfit({ deposits: [{ storeId: 1, amountStoreCents: 1, amountBrlCents: null }], stores: [csfloat()], settings: { usdBrlRate: 0.1 } });
    expect(Object.is(tiny.approx.realProfit, -0)).toBe(false);
    expect(tiny.approx.realProfit).toBe(0);
  });

  test('nextReleaseAt é a menor data entre as lojas', () => {
    const balances = balancesOf({
      stores: [csfloat({ id: 1 }), csmoney({ id: 3 })],
      items: [sale(1, 100, '2026-11-20T18:00:00.000Z'), sale(3, 100, '2026-11-19T12:00:00.000Z'), sale(3, 100, '2026-11-20T01:00:00.000Z')],
    });
    expect(computeRealProfit({ balances, settings: SETTINGS }).nextReleaseAt).toBe('2026-11-26T12:00:00.000Z');
  });

  test('sem balances: parcelas 0 e sem avisos', () => {
    const r = computeRealProfit({ settings: SETTINGS });
    expect([r.platformBalanceUsdCents, r.pendingBalanceUsdCents]).toEqual([0, 0]);
    expect(r.warnings).toEqual([]);
    expect(r.estimated).toBe(false);
  });
});

describe('estimateStockUsd', () => {
  test('USD nominal, BRL pela cotação gravada (estimado), GANHEI 0; vendidos fora', () => {
    expect(estimateStockUsd([stock(1000), stock(2500, 'BRL'), stock(0), { ...stock(99999), status: 'VENDIDO' }]))
      .toEqual({ totalUsdCents: 1500, estimated: true });
    expect(estimateStockUsd([stock(1000)])).toEqual({ totalUsdCents: 1000, estimated: false });
    expect(estimateStockUsd([])).toEqual({ totalUsdCents: 0, estimated: false });
  });
});
