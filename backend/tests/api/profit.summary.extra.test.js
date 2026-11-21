// GET /api/profit/summary: complemento do bloco 8.4 de D211 (consistência com /current, bordas e sem cotação).
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Item = require('../../src/models/Item');
const Withdrawal = require('../../src/models/Withdrawal');
const Deposit = require('../../src/models/Deposit');
const StoreBalance = require('../../src/models/StoreBalance');
const Setting = require('../../src/models/Setting');
const { freshDb, wonSkin, soldFields } = require('../helpers/fixtures');
const { makeApp, storeId } = require('../helpers/apiFixtures');

const NOW = new Date('2026-11-21T12:00:00.000Z');
let app;

afterAll(() => closeDb());
beforeEach(() => { freshDb(); app = makeApp(NOW); });

const get = async (url) => {
  const res = await request(app).get(url);
  expect(res.status).toBe(200);
  return res.body.data;
};

describe('GET /api/profit/summary: complemento 8.4', () => {
  test('Steam BRL continua somada sem cotação e CSFloat USD zerada não anula o lucro', async () => {
    const steam = storeId('Steam');
    StoreBalance.create({ storeId: steam, balanceCents: 4590, fxRate: null, recordedAt: '2026-11-21T09:00:00.000Z' }, { now: NOW });
    const data = await get('/api/profit/summary');
    expect(data.platformBalanceEstimatedBrlCents).toBe(4590);
    expect(data.realProfitBrlCents).toBe(4590);
    expect(data.warnings).toEqual([]);
  });

  test('saldo USD sem cotação: parcela e lucro nulos, Steam (BRL) continua 4590 em balancesByStore', async () => {
    StoreBalance.create({ storeId: storeId('CSFloat'), balanceCents: 1000, fxRate: null, recordedAt: '2026-11-21T09:00:00.000Z' }, { now: NOW });
    StoreBalance.create({ storeId: storeId('Steam'), balanceCents: 4590, fxRate: null, recordedAt: '2026-11-21T09:00:00.000Z' }, { now: NOW });
    const data = await get('/api/profit/summary');
    expect(data.platformBalanceEstimatedBrlCents).toBeNull();
    expect(data.realProfitBrlCents).toBeNull();
    expect(data.balancesByStore.find((r) => r.storeName === 'Steam').availableEstimatedBrlCents).toBe(4590);
    expect(data.warnings).toContainEqual({ source: 'STORE', storeId: storeId('CSFloat'), storeName: 'CSFloat', code: 'FX_NOT_CONFIGURED', text: expect.any(String) });
  });

  test('loja inativa (CSMoney) com saldo e venda retida continua contando', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    const csm = storeId('CSMoney');
    StoreBalance.create({ storeId: csm, balanceCents: 1000, fxRate: null, recordedAt: '2026-11-20T15:00:00.000Z' }, { now: NOW });
    Item.create(wonSkin({ name: 'R', ...soldFields(csm, { soldAt: '2026-11-20T18:00:00.000Z', netReceivedCents: 200, saleHoldDaysApplied: 7 }) }), { now: NOW });
    const before = await get('/api/profit/summary');
    getDb().prepare('UPDATE stores SET is_active = 0 WHERE id = ?').run(csm);
    const after = await get('/api/profit/summary');
    expect(after.realProfitBrlCents).toBe(6000);
    expect(after.realProfitBrlCents).toBe(before.realProfitBrlCents);
    expect(after.pendingBalanceEstimatedBrlCents).toBe(1000);
  });

  test('taxa paga do saque não entra: mudar feeCents não muda o resumo', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    const csf = storeId('CSFloat');
    const w = Withdrawal.create({ storeId: csf, amountStoreCents: 10000, feeCents: 250, amountBrlCents: 40000, withdrawnAt: '2026-11-10T12:00:00.000Z' }, { now: NOW });
    const a = await get('/api/profit/summary');
    getDb().prepare('UPDATE withdrawals SET fee_cents = 9000 WHERE id = ?').run(w.id);
    const b = await get('/api/profit/summary');
    expect(b.realProfitBrlCents).toBe(a.realProfitBrlCents);
    expect(b.realProfitBrlCents).toBe(40000);
  });

  test('só aportes (sem saques): ratio 0 e lucro negativo; sem aportes: ratio null', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    Deposit.create({ amountBrlCents: 10000, depositedAt: '2026-11-01T12:00:00.000Z', storeId: null, note: null }, { now: NOW });
    const data = await get('/api/profit/summary');
    expect(data.realProfitBrlCents).toBe(-10000);
    expect(data.realProfitUsdCentsApprox).toBe(-2000);
    expect(data.withdrawnVsDeposited.ratio).toBe(0);
  });

  test('consistência: balancesByStore e fx batem com /current e com as configurações', async () => {
    Setting.update({ usdBrlRate: 5.4321 }, { now: NOW });
    const csf = storeId('CSFloat');
    StoreBalance.create({ storeId: csf, balanceCents: 12346, fxRate: null, recordedAt: '2026-11-20T15:00:00.000Z' }, { now: NOW });
    Item.create(wonSkin({ name: 'B', ...soldFields(csf, { soldAt: '2026-11-20T18:00:00.000Z', netReceivedCents: 2500, saleHoldDaysApplied: 7 }) }), { now: NOW });
    const summary = await get('/api/profit/summary');
    const current = await get('/api/store-balances/current');
    expect(summary.balancesByStore).toEqual(current.stores);
    const sum = (pick) => current.stores.reduce((acc, row) => acc + pick(row), 0);
    expect(summary.platformBalanceEstimatedBrlCents).toBe(sum((r) => r.availableEstimatedBrlCents));
    expect(summary.pendingBalanceEstimatedBrlCents).toBe(sum((r) => r.pending.estimatedBrlCents));
    expect(summary.releasedAfterBalanceEstimatedBrlCents).toBe(sum((r) => r.releasedAfterBalance.estimatedBrlCents));
    expect(summary.counts.pendingSales).toBe(1);
    expect(summary.nextReleaseAt).toBe('2026-11-27T18:00:00.000Z');
    expect(summary.fx.usdBrlRate).toBe(5.4321);
    expect(summary.fx).toHaveProperty('quotedAt');
  });

  test('ausência de campos removidos (lucro sacável)', async () => {
    const data = await get('/api/profit/summary');
    for (const key of ['withdrawableBalanceBrlCents', 'nonWithdrawableBalanceBrlCents', 'withdrawableRealProfitBrlCents']) {
      expect(data).not.toHaveProperty(key);
    }
    expect(data.balancesByStore.every((row) => !('withdrawable' in row))).toBe(true);
  });
});
