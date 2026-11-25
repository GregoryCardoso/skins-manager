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

// Saldo BRL da Steam vem de uma venda já liberada (aporte só existe em loja USD, D224).
const steamSale = (steam, net) => Item.create(wonSkin({
  name: 'steam', ...soldFields(steam, { soldAt: '2026-11-21T09:00:00.000Z', netReceivedCents: net, salePriceCents: net, saleCurrency: 'BRL', fxRateAtSale: 5.4321, saleHoldDaysApplied: 0 }),
}), { now: NOW });

describe('GET /api/profit/summary: complemento 8.4', () => {
  test('Steam BRL sem cotação: não converte (nulo + aviso); com cotação entra convertida', async () => {
    const steam = storeId('Steam');
    steamSale(steam, 4590);
    const data = await get('/api/profit/summary');
    expect(data.platformBalanceUsdCents).toBeNull();
    expect(data.realProfitUsdCents).toBeNull();
    expect(data.warnings).toContainEqual({ source: 'STORE', storeId: steam, storeName: 'Steam', code: 'FX_NOT_CONFIGURED', text: expect.any(String) });
    Setting.update({ usdBrlRate: 5.4321 }, { now: NOW });
    const withFx = await get('/api/profit/summary');
    expect(withFx.platformBalanceUsdCents).toBe(845);
    expect(withFx.realProfitUsdCents).toBe(845);
    expect(withFx.estimated).toBe(true);
    expect(withFx.warnings).toEqual([]);
  });

  test('saldo USD sem cotação: exato (1000); a Steam (BRL) fica sem US$ e o "≈ R$" nativo continua em balancesByStore', async () => {
    Deposit.create({ storeId: storeId('CSFloat'), amountStoreCents: 1000, amountBrlCents: null, depositedAt: '2026-11-21T09:00:00.000Z', note: null }, { now: NOW });
    steamSale(storeId('Steam'), 4590);
    const data = await get('/api/profit/summary');
    expect(data.platformBalanceUsdCents).toBeNull();
    expect(data.realProfitUsdCents).toBeNull();
    expect(data.balancesByStore.find((r) => r.storeName === 'CSFloat')).toMatchObject({ availableUsdCents: 1000, availableApproxCents: null });
    expect(data.balancesByStore.find((r) => r.storeName === 'Steam')).toMatchObject({ availableUsdCents: null, availableApproxCents: 4590 });
    expect(data.warnings).toContainEqual({ source: 'STORE', storeId: storeId('Steam'), storeName: 'Steam', code: 'FX_NOT_CONFIGURED', text: expect.any(String) });
  });

  test('loja inativa (CSMoney) com saldo e venda retida continua contando', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    const csm = storeId('CSMoney');
    Deposit.create({ storeId: csm, amountStoreCents: 1000, amountBrlCents: null, depositedAt: '2026-11-20T15:00:00.000Z', note: null }, { now: NOW });
    Item.create(wonSkin({ name: 'R', ...soldFields(csm, { soldAt: '2026-11-20T18:00:00.000Z', netReceivedCents: 200, saleHoldDaysApplied: 7 }) }), { now: NOW });
    const before = await get('/api/profit/summary');
    getDb().prepare('UPDATE stores SET is_active = 0 WHERE id = ?').run(csm);
    const after = await get('/api/profit/summary');
    expect(after.realProfitUsdCents).toBe(200); // saldo 1000 do aporte + pendente 200 − aporte 1000
    expect(after.realProfitUsdCents).toBe(before.realProfitUsdCents);
    expect(after.pendingBalanceUsdCents).toBe(200);
  });

  test('a taxa paga do saque reduz só o saque líquido; o valor recebido em R$ não entra', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    const csf = storeId('CSFloat');
    Deposit.create({ storeId: csf, amountStoreCents: 10000, amountBrlCents: null, depositedAt: '2026-11-01T12:00:00.000Z', note: null }, { now: NOW });
    const w = Withdrawal.create({ storeId: csf, amountStoreCents: 10000, feeCents: 250, amountBrlCents: 40000, withdrawnAt: '2026-11-10T12:00:00.000Z' }, { now: NOW });
    const a = await get('/api/profit/summary');
    expect(a.realProfitUsdCents).toBe(-250); // saque líquido 9750 + saldo 0 − aporte 10000
    getDb().prepare('UPDATE withdrawals SET fee_cents = 9000, amount_brl_cents = NULL WHERE id = ?').run(w.id);
    const b = await get('/api/profit/summary');
    expect(b.realProfitUsdCents).toBe(-9000); // saque líquido 1000 + saldo 0 − aporte 10000
  });

  test('só aportes (sem saques): ratio 0 e lucro negativo; sem aportes: ratio null', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    const csf = storeId('CSFloat');
    Deposit.create({ storeId: csf, amountStoreCents: 2000, amountBrlCents: null, depositedAt: '2026-11-01T12:00:00.000Z', note: null }, { now: NOW });
    // o aporte credita a loja (8.6); a perda vem de um ajuste confirmado numa conferência (taxa não registrada)
    StoreBalance.create({
      kind: 'CHECK', storeId: csf, balanceCents: 1500, computedCents: 2000, adjustmentCents: -500, fxRate: null, note: 'taxa', recordedAt: '2026-11-05T12:00:00.000Z',
    }, { now: NOW });
    const data = await get('/api/profit/summary');
    expect(data.realProfitUsdCents).toBe(-500);
    expect(data.approx.realProfit).toBe(-2500);
    expect(data.withdrawnVsDeposited.ratio).toBe(0);
  });

  test('consistência: balancesByStore e fx batem com /current e com as configurações', async () => {
    Setting.update({ usdBrlRate: 5.4321 }, { now: NOW });
    const csf = storeId('CSFloat');
    Deposit.create({ storeId: csf, amountStoreCents: 12346, amountBrlCents: null, depositedAt: '2026-11-20T15:00:00.000Z', note: null }, { now: NOW });
    Item.create(wonSkin({ name: 'B', ...soldFields(csf, { soldAt: '2026-11-20T18:00:00.000Z', netReceivedCents: 2500, saleHoldDaysApplied: 7 }) }), { now: NOW });
    const summary = await get('/api/profit/summary');
    const current = await get('/api/store-balances/current');
    expect(summary.balancesByStore).toEqual(current.stores);
    const sum = (pick) => current.stores.reduce((acc, row) => acc + pick(row), 0);
    expect(summary.platformBalanceUsdCents).toBe(sum((r) => r.availableUsdCents));
    expect(summary.pendingBalanceUsdCents).toBe(sum((r) => r.pending.usdCents));
    expect(summary.approx.platformBalance).toBe(current.totals.approx.available);
    expect(summary.approx.pendingBalance).toBe(current.totals.approx.pending);
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
