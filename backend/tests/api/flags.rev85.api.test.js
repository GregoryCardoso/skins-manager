// Conferência da revisão da 8.5 (API): flags de estimado de /current x /summary.estimatedParts, loja fora do mapa
// (lucro nulo) e ordem dos erros do POST /api/deposits quando faltam campos do corpo.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const StoreBalance = require('../../src/models/StoreBalance');
const Item = require('../../src/models/Item');
const { freshDb, wonSkin, soldFields } = require('../helpers/fixtures');
const { makeApp, storeId, expectError } = require('../helpers/apiFixtures');

const NOW = new Date('2026-11-21T12:00:00.000Z');
let app;
let csf;
let steam;
beforeEach(() => {
  freshDb();
  app = makeApp(NOW);
  csf = storeId('CSFloat');
  steam = storeId('Steam');
  Setting.update({ usdBrlRate: 5.4321 }, { now: NOW });
});
afterAll(() => closeDb());

const get = async (url) => (await request(app).get(url)).body.data;
const post = (body) => request(app).post('/api/deposits').send(body);

describe('flags de estimado: /current e /summary dizem o mesmo', () => {
  const check = async () => {
    const summary = await get('/api/profit/summary');
    const current = await get('/api/store-balances/current');
    expect(summary.estimatedParts.platformBalance).toBe(current.totals.availableEstimated);
    expect(summary.estimatedParts.pendingBalance).toBe(current.totals.pendingEstimated);
    expect(summary.estimatedParts.releasedAfterBalance).toBe(current.totals.releasedAfterBalanceEstimated);
    return { summary, current };
  };

  test('sem nada: nenhum flag', async () => {
    const { current } = await check();
    expect(Object.values(current.totals).filter((v) => typeof v === 'boolean').every((v) => v === false)).toBe(true);
  });

  test('só saldo disponível na Steam (BRL): disponível estimado; pendente e liberado não', async () => {
    StoreBalance.create({ storeId: steam, balanceCents: 4591, fxRate: 5.4321, recordedAt: '2026-11-21T09:00:00.000Z' }, { now: NOW });
    const { summary, current } = await check();
    expect(current.totals).toMatchObject({ availableEstimated: true, pendingEstimated: false, releasedAfterBalanceEstimated: false });
    expect(current.totals.nonWithdrawableEstimated).toBe(true); // a Steam não permite saque
    expect(summary.estimatedParts).toMatchObject({ platformBalance: true, pendingBalance: false, releasedAfterBalance: false });
    const row = current.stores.find((s) => s.storeId === steam);
    expect(row.pending).toMatchObject({ usdCents: 0, estimated: false });
  });

  test('só saldo na CSFloat (USD) e venda pendente: nada estimado', async () => {
    StoreBalance.create({ storeId: csf, balanceCents: 12346, fxRate: null, recordedAt: '2026-11-20T15:00:00.000Z' }, { now: NOW });
    Item.create(wonSkin({
      name: 'pendente', ...soldFields(csf, { soldAt: '2026-11-20T18:00:00.000Z', netReceivedCents: 2500, salePriceCents: 2500, saleHoldDaysApplied: 7 }),
      acquiredAt: '2026-10-01T12:00:00.000Z',
    }), { now: NOW });
    const { summary, current } = await check();
    expect(current.totals.pendingUsdCents).toBe(2500);
    expect(current.totals.estimated).toBe(false);
    expect(summary.estimated).toBe(false);
  });

  test('sem cotação: Steam com saldo fica nula e os flags continuam iguais nos dois endpoints', async () => {
    StoreBalance.create({ storeId: steam, balanceCents: 4591, fxRate: null, recordedAt: '2026-11-21T09:00:00.000Z' }, { now: NOW });
    Setting.update({ usdBrlRate: null }, { now: NOW });
    const { summary, current } = await check();
    expect(current.totals.availableUsdCents).toBeNull();
    expect(summary.realProfitUsdCents).toBeNull();
    expect(summary.platformBalanceUsdCents).toBeNull();
  });
});

describe('loja fora do mapa (dado inconsistente) no resumo', () => {
  test('aporte apontando para loja inexistente: depositsUsdCents e lucro nulos, sem erro 500', async () => {
    const db = require('../../src/config/database').getDb();
    db.pragma('foreign_keys = OFF');
    db.prepare(
      'INSERT INTO deposits (store_id, amount_store_cents, amount_brl_cents, deposited_at, note, created_at, updated_at) VALUES (?, ?, NULL, ?, NULL, ?, ?)'
    ).run(99999, 1000, '2026-11-01T12:00:00.000Z', NOW.toISOString(), NOW.toISOString());
    db.pragma('foreign_keys = ON');
    const res = await request(app).get('/api/profit/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.depositsUsdCents).toBeNull();
    expect(res.body.data.realProfitUsdCents).toBeNull();
    expect(res.body.data.approxBrl.realProfit).toBeNull();
  });
});

describe('POST /api/deposits: ordem dos erros com campos ausentes (validador x service)', () => {
  const date = '2026-11-10T12:00:00.000Z';

  test('sem storeId e sem amountStoreCents, com data: STORE_REQUIRED (service decide antes de REQUIRED_FIELD)', async () => {
    expectError(await post({ depositedAt: date }), 400, 'STORE_REQUIRED', { field: 'storeId' });
  });
  test('storeId null explícito: STORE_REQUIRED', async () => {
    expectError(await post({ storeId: null, amountStoreCents: 100, depositedAt: date }), 400, 'STORE_REQUIRED', { field: 'storeId' });
  });
  test('loja ok, sem amountStoreCents: REQUIRED_FIELD em amountStoreCents', async () => {
    expectError(await post({ storeId: csf, depositedAt: date }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
  });
  test('amountStoreCents null explícito: REQUIRED_FIELD em amountStoreCents (rejeitado pelo validador)', async () => {
    expectError(await post({ storeId: csf, amountStoreCents: null, depositedAt: date }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
  });
  test('sem depositedAt, com loja e valor: REQUIRED_FIELD em depositedAt', async () => {
    expectError(await post({ storeId: csf, amountStoreCents: 100 }), 400, 'REQUIRED_FIELD', { field: 'depositedAt' });
  });
  test('corpo vazio: STORE_REQUIRED vem antes de REQUIRED_FIELD depositedAt (D227: loja primeiro)', async () => {
    expectError(await post({}), 400, 'STORE_REQUIRED', { field: 'storeId' });
  });
  test('loja BRL e sem valor: DEPOSIT_STORE_CURRENCY_NOT_ALLOWED antes do REQUIRED_FIELD do valor', async () => {
    expectError(await post({ storeId: steam, depositedAt: date }), 400, 'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
  });
  test('tipo inválido (string em storeId) é INVALID_FIELD do validador, antes de tudo', async () => {
    expectError(await post({ storeId: 'x', depositedAt: date }), 400, 'INVALID_FIELD', { field: 'storeId' });
  });
});
