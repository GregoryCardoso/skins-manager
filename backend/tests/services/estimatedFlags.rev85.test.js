'use strict';

// Conferência da revisão da 8.5 (D225, D229): flags de estimado por parcela e nos totais, consistência com
// computeRealProfit.estimatedParts e loja fora do mapa (lucro nulo). Puro, com `now` fixo.
const { buildCurrentBalances } = require('../../src/services/storeBalanceService');
const { computeRealProfit } = require('../../src/services/profitService');
const { csfloat, steam, csmoney } = require('../helpers/storeFixtures');

const NOW = new Date('2026-11-21T12:00:00.000Z');
const RATE = { usdBrlRate: 5.4321 };
const latest = (storeId, balanceCents) => ({ id: storeId, storeId, balanceCents, recordedAt: '2026-11-20T15:00:00.000Z', fxRate: null });
const sale = (storeId, soldAt, net, days = 7) => ({
  status: 'VENDIDO', saleStoreId: storeId, soldAt, netReceivedCents: net, saleHoldDaysApplied: days, acquisitionType: 'GANHEI',
  purchaseStoreId: null, acquiredAt: '2026-10-01T12:00:00.000Z',
});
const PENDING_SALE = (storeId, net) => sale(storeId, '2026-11-20T18:00:00.000Z', net); // ainda retida
const only = (store, extra = {}, settings = RATE) => buildCurrentBalances({ stores: [store], settings, now: NOW, ...extra });

describe('flags por parcela: loja BRL', () => {
  test('só com disponível: disponível estimado, pendente e liberado NÃO (zero não é estimado)', () => {
    const r = only(steam({ id: 2 }), { latestBalances: [latest(2, 4590)] });
    const row = r.stores[0];
    expect(row.availableEstimated).toBe(true);
    expect(row.pending).toMatchObject({ cents: 0, usdCents: 0, approxBrlCents: 0, estimated: false });
    expect(row.releasedAfterBalance).toMatchObject({ cents: 0, usdCents: 0, estimated: false });
    expect(row.estimated).toBe(true);
    expect(r.totals).toMatchObject({
      availableEstimated: true, pendingEstimated: false, releasedAfterBalanceEstimated: false, estimated: true,
    });
  });

  test('só com venda pendente: só o pendente é estimado', () => {
    const r = only(steam({ id: 2, saleHoldDays: 7 }), { items: [PENDING_SALE(2, 1000)] });
    const row = r.stores[0];
    expect(row.pending.cents).toBe(1000);
    expect(row.pending.estimated).toBe(true);
    expect(row.availableEstimated).toBe(false); // sem saldo registrado: 0
    expect(row.availableUsdCents).toBe(0);
    expect(r.totals).toMatchObject({ availableEstimated: false, pendingEstimated: true, releasedAfterBalanceEstimated: false });
  });

  test('saldo 0 registrado em loja BRL: nada estimado, mesmo com cotação', () => {
    const r = only(steam({ id: 2 }), { latestBalances: [latest(2, 0)] });
    expect(r.stores[0].estimated).toBe(false);
    expect(r.totals.estimated).toBe(false);
    expect(r.totals.availableEstimated).toBe(false);
  });

  test('loja USD: nada estimado em nenhuma parcela, mesmo com pendente', () => {
    const r = only(csfloat(), { latestBalances: [latest(1, 5000)], items: [PENDING_SALE(1, 700)] });
    const row = r.stores[0];
    expect([row.availableEstimated, row.pending.estimated, row.releasedAfterBalance.estimated, row.estimated]).toEqual([false, false, false, false]);
    expect(r.totals.estimated).toBe(false);
  });
});

describe('flags por parcela: sem cotação', () => {
  test('loja BRL com disponível sem cotação: usd nulo, estimated true (parcela é BRL > 0), pendente zero segue 0 e não estimado', () => {
    const r = only(steam({ id: 2 }), { latestBalances: [latest(2, 4590)] }, { usdBrlRate: null });
    const row = r.stores[0];
    expect(row.availableUsdCents).toBeNull();
    expect(row.availableApproxBrlCents).toBe(4590); // o nativo continua
    expect(row.pending).toMatchObject({ usdCents: 0, estimated: false });
    expect(row.warningCode).toBe('FX_NOT_CONFIGURED');
    expect(r.totals.availableUsdCents).toBeNull();
    expect(r.totals.pendingUsdCents).toBe(0);
    expect(r.totals.approxBrl.available).toBeNull();
    expect(r.totals.approxBrl.pending).toBeNull();
  });

  test('loja BRL com saldo 0 sem cotação: nada nulo (zero nunca é nulo nem estimado)', () => {
    const r = only(steam({ id: 2 }), { latestBalances: [latest(2, 0)] }, { usdBrlRate: null });
    expect(r.stores[0]).toMatchObject({ availableUsdCents: 0, availableEstimated: false, estimated: false, warningCode: null });
  });

  test('loja USD sem cotação segue exata, sem "≈ R$" e sem estimado', () => {
    const r = only(csfloat(), { latestBalances: [latest(1, 5000)] }, { usdBrlRate: null });
    expect(r.stores[0]).toMatchObject({ availableUsdCents: 5000, availableApproxBrlCents: null, availableEstimated: false });
    expect(r.totals).toMatchObject({ availableUsdCents: 5000, estimated: false });
    expect(r.totals.approxBrl.available).toBeNull();
  });
});

describe('totais: nonWithdrawableEstimated só olha lojas sem saque', () => {
  const mixed = (steamAllows) => buildCurrentBalances({
    stores: [csfloat(), steam({ id: 2, allowsWithdrawal: steamAllows })],
    latestBalances: [latest(1, 10000), latest(2, 4590)], settings: RATE, now: NOW,
  });

  test('Steam sem saque (BRL estimada): nonWithdrawableEstimated true', () => {
    expect(mixed(false).totals).toMatchObject({ nonWithdrawableEstimated: true, availableEstimated: true });
  });
  test('Steam com saque: a loja BRL estimada não conta como não sacável, e a CSFloat (sacável) também não', () => {
    const t = mixed(true).totals;
    expect(t.nonWithdrawableEstimated).toBe(false);
    expect(t.nonWithdrawableUsdCents).toBe(0);
    expect(t.availableEstimated).toBe(true);
  });
  test('loja USD sem saque (CSMoney): não sacável exata -> nonWithdrawableEstimated false', () => {
    const r = buildCurrentBalances({
      stores: [csfloat(), csmoney({ id: 3, allowsWithdrawal: false })], latestBalances: [latest(3, 800)], settings: RATE, now: NOW,
    });
    expect(r.totals).toMatchObject({ nonWithdrawableUsdCents: 800, nonWithdrawableEstimated: false, estimated: false });
  });
  test('loja sem saque estimada só por parcela pendente: nonWithdrawableEstimated true', () => {
    const r = buildCurrentBalances({
      stores: [steam({ id: 2, allowsWithdrawal: false, saleHoldDays: 7 })], items: [PENDING_SALE(2, 500)], settings: RATE, now: NOW,
    });
    expect(r.totals).toMatchObject({ pendingEstimated: true, availableEstimated: false, nonWithdrawableEstimated: true });
  });
});

describe('consistência dos flags entre buildCurrentBalances e computeRealProfit.estimatedParts', () => {
  const run = ({ stores, latestBalances = [], items = [], settings = RATE, deposits = [], withdrawals = [] }) => {
    const balances = buildCurrentBalances({ stores, latestBalances, items, withdrawals, settings, now: NOW });
    const profit = computeRealProfit({ deposits, withdrawals, stores, balances, stockItems: [], settings });
    return { balances, profit };
  };

  test.each([
    ['só Steam com disponível', { stores: [csfloat(), steam({ id: 2 })], latestBalances: [latest(2, 4590)] }],
    ['só Steam com pendente', { stores: [csfloat(), steam({ id: 2 })], items: [PENDING_SALE(2, 900)] }],
    ['Steam com saldo 0', { stores: [steam({ id: 2 })], latestBalances: [latest(2, 0)] }],
    ['só USD', { stores: [csfloat(), csmoney({ id: 3 })], latestBalances: [latest(1, 100)], items: [PENDING_SALE(1, 300)] }],
    ['Steam sem cotação', { stores: [steam({ id: 2 })], latestBalances: [latest(2, 4590)], settings: { usdBrlRate: null } }],
    ['sem lojas', { stores: [] }],
  ])('%s', (_name, input) => {
    const { balances, profit } = run(input);
    expect(profit.estimatedParts.platformBalance).toBe(balances.totals.availableEstimated);
    expect(profit.estimatedParts.pendingBalance).toBe(balances.totals.pendingEstimated);
    expect(profit.estimatedParts.releasedAfterBalance).toBe(balances.totals.releasedAfterBalanceEstimated);
    expect(profit.platformBalanceUsdCents).toBe(balances.totals.availableUsdCents);
    expect(profit.pendingBalanceUsdCents).toBe(balances.totals.pendingUsdCents);
    expect(profit.releasedAfterBalanceUsdCents).toBe(balances.totals.releasedAfterBalanceUsdCents);
  });

  test('um saldo disponível BRL estimado não contamina pendente nem liberado no resumo', () => {
    const { profit } = run({ stores: [csfloat(), steam({ id: 2 })], latestBalances: [latest(2, 4590)], items: [PENDING_SALE(1, 900)] });
    expect(profit.estimatedParts).toMatchObject({ platformBalance: true, pendingBalance: false, releasedAfterBalance: false });
    expect(profit.estimated).toBe(true);
  });
});

describe('loja fora do mapa: lucro nulo (computeRealProfit com stores = [])', () => {
  const base = { stores: [], balances: { stores: [] }, stockItems: [], settings: RATE };
  const dep = { id: 1, storeId: 1, amountStoreCents: 9200, amountBrlCents: null };
  const wd = { id: 1, storeId: 1, amountStoreCents: 10000, feeCents: 250, amountBrlCents: null };

  test('aporte com storeId sem loja: aportes nulos e lucro nulo; aviso FX_NOT_CONFIGURED DEPOSITS (comportamento atual)', () => {
    const r = computeRealProfit({ ...base, deposits: [dep] });
    expect(r.depositsUsdCents).toBeNull();
    expect(r.realProfitUsdCents).toBeNull();
    expect(r.approxBrl.deposits).toBeNull();
    expect(r.approxBrl.realProfit).toBeNull();
    expect(r.withdrawnVsDeposited.ratio).toBeNull();
  });

  test('saque com storeId sem loja: saques nulos e lucro nulo', () => {
    const r = computeRealProfit({ ...base, withdrawals: [wd] });
    expect(r.withdrawalsNetUsdCents).toBeNull();
    expect(r.realProfitUsdCents).toBeNull();
    expect(r.withdrawnVsDeposited.ratio).toBeNull();
  });

  test('o mesmo aporte com a loja no mapa fecha o lucro; sem loja nenhuma (legado) continua válido', () => {
    expect(computeRealProfit({ ...base, stores: [csfloat()], deposits: [dep] }).realProfitUsdCents).toBe(-9200);
    const legacy = { id: 2, storeId: null, amountStoreCents: null, amountBrlCents: 5432 };
    expect(computeRealProfit({ ...base, deposits: [legacy] }).depositsUsdCents).toBe(1000);
  });

  test('loja fora do mapa não é tratada como estimada (não houve conversão)', () => {
    const r = computeRealProfit({ ...base, deposits: [dep], withdrawals: [wd] });
    expect(r.estimatedParts.deposits).toBe(false);
    expect(r.estimatedParts.withdrawals).toBe(false);
  });
});
