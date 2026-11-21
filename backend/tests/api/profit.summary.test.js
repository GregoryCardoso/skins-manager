// GET /api/profit/summary (8.4: D205, D206, D210/T48, D211). Exemplo de D206 centavo a centavo.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Item = require('../../src/models/Item');
const Withdrawal = require('../../src/models/Withdrawal');
const Deposit = require('../../src/models/Deposit');
const StoreBalance = require('../../src/models/StoreBalance');
const Setting = require('../../src/models/Setting');
const { freshDb, wonSkin, soldFields } = require('../helpers/fixtures');
const { makeApp, storeId, expectError } = require('../helpers/apiFixtures');

const D206_NOW = new Date('2026-11-21T12:00:00.000Z');
let app;

afterAll(() => closeDb());

const summary = async () => {
  const res = await request(app).get('/api/profit/summary');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  return res.body.data;
};

function seedD206({ rate = 5.4321 } = {}) {
  const csf = storeId('CSFloat');
  const steam = storeId('Steam');
  const csm = storeId('CSMoney');
  Setting.update({ usdBrlRate: rate }, { now: D206_NOW });
  const mk = (name, saleStoreId, soldAt, net, days, currency = 'USD') =>
    Item.create(
      wonSkin({
        name,
        ...soldFields(saleStoreId, {
          soldAt, netReceivedCents: net, salePriceCents: net, saleCurrency: currency, saleHoldDaysApplied: days,
          fxRateAtSale: currency === 'BRL' ? 5.4321 : null,
        }),
        acquiredAt: '2026-10-01T12:00:00.000Z',
      }),
      { now: D206_NOW }
    );
  mk('B', csf, '2026-11-20T18:00:00.000Z', 2500, 7);
  mk('C', csf, '2026-11-21T01:30:00.000Z', 2000, 7);
  mk('G', csf, '2026-11-18T09:00:00.000Z', 3000, 7);
  mk('F', csf, '2026-11-13T20:00:00.000Z', 1200, 7);
  mk('D', csf, '2026-11-12T10:00:00.000Z', 1500, 7);
  mk('E', csm, '2026-11-19T12:00:00.000Z', 1000, 7);
  mk('I', csm, '2026-11-10T12:00:00.000Z', 600, 7);
  mk('H', steam, '2026-11-21T10:00:00.000Z', 800, 0, 'BRL');
  Item.create(wonSkin({
    name: 'estoque usd', acquisitionType: 'COMPRA', purchaseStoreId: csf, purchasePriceCents: 1000, purchaseCurrency: 'USD',
    acquiredAt: '2026-11-01T12:00:00.000Z', status: 'EM_ESTOQUE',
  }), { now: D206_NOW });
  Item.create(wonSkin({
    name: 'estoque brl', acquisitionType: 'COMPRA', purchaseStoreId: steam, purchasePriceCents: 2500, purchaseCurrency: 'BRL',
    fxRateAtPurchase: 5.4321, acquiredAt: '2026-11-01T12:00:00.000Z', status: 'EM_ESTOQUE',
  }), { now: D206_NOW });
  Item.create(wonSkin({ name: 'estoque ganhei', status: 'EM_ESTOQUE' }), { now: D206_NOW });
  Deposit.create({ amountBrlCents: 50000, depositedAt: '2026-10-01T12:00:00.000Z', storeId: null, note: null }, { now: D206_NOW });
  Deposit.create({ amountBrlCents: 30000, depositedAt: '2026-10-05T12:00:00.000Z', storeId: csf, note: null }, { now: D206_NOW });
  Withdrawal.create({ storeId: csf, amountStoreCents: 10000, feeCents: 250, amountBrlCents: 52037, withdrawnAt: '2026-11-10T12:00:00.000Z' }, { now: D206_NOW });
  Withdrawal.create({ storeId: null, amountStoreCents: null, feeCents: null, amountBrlCents: 10000, withdrawnAt: '2026-11-02T12:00:00.000Z' }, { now: D206_NOW });
  StoreBalance.create({ storeId: csf, balanceCents: 12346, fxRate: null, recordedAt: '2026-11-20T15:00:00.000Z' }, { now: D206_NOW });
  StoreBalance.create({ storeId: steam, balanceCents: 4590, fxRate: 5.4321, recordedAt: '2026-11-21T09:00:00.000Z' }, { now: D206_NOW });
  return { csf, steam, csm };
}

describe('GET /api/profit/summary: vazio', () => {
  beforeEach(() => { freshDb(); app = makeApp(D206_NOW); });

  test('tudo zerado, ratio nulo, sem avisos e lojas do seed sem saldo', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: D206_NOW });
    const data = await summary();
    expect(data).toMatchObject({
      depositsBrlCents: 0, withdrawalsBrlCents: 0, platformBalanceEstimatedBrlCents: 0, pendingBalanceEstimatedBrlCents: 0,
      releasedAfterBalanceEstimatedBrlCents: 0, nextReleaseAt: null, stockEstimatedBrlCents: 0, realProfitBrlCents: 0,
      realProfitUsdCentsApprox: 0, warnings: [], computedAt: '2026-11-21T12:00:00.000Z',
      withdrawnVsDeposited: { withdrawnBrlCents: 0, depositedBrlCents: 0, ratio: null },
      counts: { deposits: 0, withdrawals: 0, legacyWithdrawals: 0, stockItems: 0, pendingSales: 0, releasedAfterBalanceSales: 0 },
    });
    expect(data.balancesByStore).toHaveLength(3);
  });

  test('sem cotação: tudo zerado continua 0 (parcelas 0 nunca ficam nulas)', async () => {
    const data = await summary();
    expect(data.realProfitBrlCents).toBe(0);
    expect(data.realProfitUsdCentsApprox).toBeNull();
    expect(data.fx).toEqual({ usdBrlRate: null, source: null, updatedAt: null, quotedAt: null });
  });

  test('Host estranho -> 403; POST -> 404 padrão', async () => {
    expectError(await request(app).get('/api/profit/summary').set('Host', 'evil.example'), 403, 'FORBIDDEN_HOST');
    expect((await request(app).post('/api/profit/summary').send({})).status).toBe(404);
  });
});

describe('GET /api/profit/summary: exemplo de D206 centavo a centavo', () => {
  let ids;
  beforeEach(() => { freshDb(); app = makeApp(D206_NOW); ids = seedD206(); });

  test('parcelas, lucro real 117575 e ≈ US$ 21644', async () => {
    const data = await summary();
    expect(data).toMatchObject({
      depositsBrlCents: 80000,
      withdrawalsBrlCents: 62037,
      platformBalanceEstimatedBrlCents: 71655,
      pendingBalanceEstimatedBrlCents: 46173,
      releasedAfterBalanceEstimatedBrlCents: 9778,
      nextReleaseAt: '2026-11-25T09:00:00.000Z',
      stockEstimatedBrlCents: 7932,
      realProfitBrlCents: 117575,
      realProfitUsdCentsApprox: 21644,
      counts: { deposits: 2, withdrawals: 2, legacyWithdrawals: 1, stockItems: 3, pendingSales: 4, releasedAfterBalanceSales: 2 },
      fx: { usdBrlRate: 5.4321 },
    });
    expect(data.withdrawnVsDeposited).toEqual({ withdrawnBrlCents: 62037, depositedBrlCents: 80000, ratio: 62037 / 80000 });
    expect(data.withdrawnVsDeposited.ratio).toBeCloseTo(0.7754625, 7);
  });

  test('sem pendente e sem liberado o resultado seria 61624 (referência de D206)', async () => {
    const data = await summary();
    expect(data.realProfitBrlCents - data.pendingBalanceEstimatedBrlCents - data.releasedAfterBalanceEstimatedBrlCents).toBe(61624);
  });

  test('balancesByStore tem o formato do /current', async () => {
    const data = await summary();
    const current = (await request(app).get('/api/store-balances/current')).body.data;
    expect(data.balancesByStore).toEqual(current.stores);
  });

  test('warnings: objetos com source, storeId, storeName, code e text (BALANCE_MAYBE_OUTDATED da CSFloat e da Steam)', async () => {
    const data = await summary();
    expect(data.warnings).toEqual([
      { source: 'STORE', storeId: ids.csf, storeName: 'CSFloat', code: 'BALANCE_MAYBE_OUTDATED', text: expect.any(String) },
      { source: 'STORE', storeId: ids.steam, storeName: 'Steam', code: 'BALANCE_MAYBE_OUTDATED', text: expect.any(String) },
    ]);
  });

  test('loja não sacável entra no lucro e trocar allowsWithdrawal não muda nada', async () => {
    const before = await summary();
    getDb().prepare('UPDATE stores SET allows_withdrawal = 1 WHERE id = ?').run(ids.steam);
    getDb().prepare('UPDATE stores SET allows_withdrawal = 0 WHERE id = ?').run(ids.csf);
    const after = await summary();
    expect(after.realProfitBrlCents).toBe(117575);
    expect(after.realProfitBrlCents).toBe(before.realProfitBrlCents);
    expect(after.platformBalanceEstimatedBrlCents).toBe(71655);
  });

  test('mudar a taxa de saque da loja não muda o resumo', async () => {
    getDb().prepare('UPDATE stores SET withdrawal_fee_rate = 0.5 WHERE id = ?').run(ids.csf);
    expect((await summary()).realProfitBrlCents).toBe(117575);
  });

  test('unsell de uma venda pendente tira o valor do pendente e do lucro na hora', async () => {
    const g = getDb().prepare("SELECT id FROM items WHERE name = 'G'").get().id;
    expect((await request(app).post(`/api/items/${g}/unsell`).send({})).status).toBe(200);
    const data = await summary();
    // G (3000 USD) sai do pendente e volta ao estoque com custo 0 (GANHEI): CSFloat 4500 -> 24444, CSMoney 5432
    expect(data.pendingBalanceEstimatedBrlCents).toBe(24444 + 5432);
    expect(data.counts.pendingSales).toBe(3);
  });
});

describe('GET /api/profit/summary: sem cotação', () => {
  beforeEach(() => { freshDb(); app = makeApp(D206_NOW); });

  test('pendente USD sem cotação -> parcela e lucro nulos, aviso FX_NOT_CONFIGURED da loja', async () => {
    const csf = storeId('CSFloat');
    Item.create(wonSkin({
      name: 'P', ...soldFields(csf, { soldAt: '2026-11-20T18:00:00.000Z', netReceivedCents: 2500, saleHoldDaysApplied: 7 }),
    }), { now: D206_NOW });
    const data = await summary();
    expect(data.pendingBalanceEstimatedBrlCents).toBeNull();
    expect(data.platformBalanceEstimatedBrlCents).toBe(0);
    expect(data.realProfitBrlCents).toBeNull();
    expect(data.realProfitUsdCentsApprox).toBeNull();
    expect(data.warnings).toEqual([
      { source: 'STORE', storeId: csf, storeName: 'CSFloat', code: 'FX_NOT_CONFIGURED', text: expect.any(String) },
    ]);
  });

  test('liberado após o registro USD sem cotação -> lucro nulo', async () => {
    const csf = storeId('CSFloat');
    StoreBalance.create({ storeId: csf, balanceCents: 0, fxRate: null, recordedAt: '2026-11-01T12:00:00.000Z' }, { now: D206_NOW });
    Item.create(wonSkin({
      name: 'R', ...soldFields(csf, { soldAt: '2026-11-10T12:00:00.000Z', netReceivedCents: 2500, saleHoldDaysApplied: 7 }),
    }), { now: D206_NOW });
    const data = await summary();
    expect(data.releasedAfterBalanceEstimatedBrlCents).toBeNull();
    expect(data.realProfitBrlCents).toBeNull();
    expect(data.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['FX_NOT_CONFIGURED', 'BALANCE_MAYBE_OUTDATED']));
  });

  test('estoque USD com custo > 0 sem cotação -> aviso com source STOCK e lucro nulo', async () => {
    Item.create(wonSkin({
      name: 'S', acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 1000, purchaseCurrency: 'USD', status: 'EM_ESTOQUE',
    }), { now: D206_NOW });
    const data = await summary();
    expect(data.stockEstimatedBrlCents).toBeNull();
    expect(data.realProfitBrlCents).toBeNull();
    expect(data.warnings).toContainEqual({ source: 'STOCK', storeId: null, storeName: null, code: 'FX_NOT_CONFIGURED', text: expect.any(String) });
  });

  test('aportes e saques nunca ficam nulos', async () => {
    Deposit.create({ amountBrlCents: 1000, depositedAt: '2026-11-01T12:00:00.000Z', storeId: null, note: null }, { now: D206_NOW });
    const data = await summary();
    expect(data.depositsBrlCents).toBe(1000);
    expect(data.realProfitBrlCents).toBe(-1000);
  });
});
