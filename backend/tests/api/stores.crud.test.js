const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, storeId, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/stores').send(body);
const patch = (id, body) => request(app).patch(`/api/stores/${id}`).send(body);

describe('CRUD de lojas', () => {
  test('cria com padrões, now injetado e inUse = false', async () => {
    const now = new Date('2026-05-01T10:00:00.000Z');
    app = makeApp(now);
    const res = await post({ name: '  Nova ', currency: 'BRL' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Nova', currency: 'BRL', isActive: true, isPrimary: false, saleFeeType: null, saleFeeRate: null,
      saleFeeRounding: 'CEIL', saleFixedFeeCents: 0, allowsWithdrawal: false, saleFeesConfigured: false, inUse: false,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    });
  });

  test('nome duplicado com outra caixa -> 409', async () => {
    expectError(await post({ name: 'csfloat', currency: 'USD' }), 409, 'STORE_NAME_TAKEN', { field: 'name' });
  });

  test('taxas: 0.15 e 0.025 ok; 1, -0.01, 7 casas e string recusados', async () => {
    expect((await post({ name: 'A', currency: 'USD', saleFeeType: 'ADDED', saleFeeRate: 0.15 })).status).toBe(201);
    expect((await post({ name: 'B', currency: 'USD', saleFeeType: 'ADDED', saleFeeRate: 0.025 })).status).toBe(201);
    for (const rate of [1, -0.01, 0.0000001]) {
      expectError(await post({ name: 'C', currency: 'USD', saleFeeType: 'ADDED', saleFeeRate: rate }), 400, 'INVALID_RATE');
    }
    expectError(await post({ name: 'C', currency: 'USD', saleFeeType: 'ADDED', saleFeeRate: '0.02' }), 400, 'INVALID_FIELD');
  });

  test('par incompleto, campo desconhecido e corpo vazio', async () => {
    expectError(await post({ name: 'A', currency: 'USD', saleFeeRate: 0.1 }), 400, 'SALE_FEE_INCOMPLETE', { field: 'saleFeeType' });
    expectError(await post({ name: 'A', currency: 'USD', inUse: true }), 400, 'UNKNOWN_FIELD');
    expectError(await patch(storeId('Steam'), {}), 400, 'INVALID_BODY');
  });

  test('moeda: travada se em uso, livre sem uso', async () => {
    const free = (await post({ name: 'Livre', currency: 'USD' })).body.data;
    expect((await patch(free.id, { currency: 'BRL' })).body.data.currency).toBe('BRL');
    getDb().prepare(
      `INSERT INTO items (name, category, acquisition_type, purchase_store_id, acquired_at, created_at, updated_at)
       VALUES ('Caixa', 'CAIXA', 'GANHEI', ?, '2026-01-01T00:00:00.000Z', 'c', 'u')`
    ).run(storeId('Steam'));
    expectError(await patch(storeId('Steam'), { currency: 'USD' }), 409, 'STORE_CURRENCY_LOCKED', { field: 'currency' });
    const used = await request(app).get(`/api/stores/${storeId('Steam')}`);
    expect(used.body.data.inUse).toBe(true);
  });

  test('tornar principal move a marca; desativar principal e isPrimary:false -> 409', async () => {
    const res = await patch(storeId('Steam'), { isPrimary: true });
    expect(res.body.data.isPrimary).toBe(true);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM stores WHERE is_primary = 1').get().n).toBe(1);
    expectError(await patch(storeId('Steam'), { isActive: false }), 409, 'PRIMARY_STORE_INACTIVE');
    expectError(await patch(storeId('Steam'), { isPrimary: false }), 409, 'PRIMARY_STORE_REQUIRED');
    expectError(await patch(storeId('CSMoney'), { isPrimary: true, isActive: false }), 409, 'PRIMARY_STORE_INACTIVE');
  });

  test('excluir: sem uso ok, principal e em uso -> 409, inexistente -> 404', async () => {
    const moneyId = storeId('CSMoney');
    expect((await request(app).delete(`/api/stores/${moneyId}`)).body.data).toEqual({ id: moneyId });
    expectError(await request(app).delete(`/api/stores/${storeId('CSFloat')}`), 409, 'PRIMARY_STORE_REQUIRED');
    getDb().prepare("INSERT INTO store_balances (store_id, kind, balance_cents, recorded_at, created_at) VALUES (?, 'CHECK', 1, ?, ?)")
      .run(storeId('Steam'), 'a', 'b');
    expectError(await request(app).delete(`/api/stores/${storeId('Steam')}`), 409, 'STORE_IN_USE');
    expectError(await request(app).delete('/api/stores/9999'), 404, 'STORE_NOT_FOUND');
  });

  test('PUT /settings/fx-rate grava origem MANUAL e rateQuotedAt nula', async () => {
    getDb().prepare("UPDATE settings SET usd_brl_rate_source = 'PTAX', rate_quoted_at = 'x'").run();
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.5 });
    expect(getDb().prepare('SELECT usd_brl_rate_source AS s, rate_quoted_at AS p FROM settings').get()).toEqual({ s: 'MANUAL', p: null });
  });
});
