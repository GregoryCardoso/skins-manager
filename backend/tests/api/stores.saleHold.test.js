// Retenção do saldo após a venda (D213, D216): saleHoldDays na API e no service de lojas.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { buildStoreRecord } = require('../../src/services/storeService');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, storeId, expectError, purchaseBody, createItemViaApi, makeCatalogApp } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/stores').send(body);
const patch = (id, body) => request(app).patch(`/api/stores/${id}`).send(body);
const PARAMS = { min: 0, max: 30 };

describe('buildStoreRecord: saleHoldDays', () => {
  const build = (saleHoldDays) => buildStoreRecord({ name: 'X', currency: 'USD', saleHoldDays });

  test.each([0, 1, 7, 30])('%p é aceito', (value) => {
    expect(build(value).saleHoldDays).toBe(value);
  });

  test.each([31, -1, 7.5, '7', null, NaN, Infinity, true])('%p -> INVALID_SALE_HOLD_DAYS com field e params', (value) => {
    expect(() => build(value)).toThrow(expect.objectContaining({
      status: 400, code: 'INVALID_SALE_HOLD_DAYS', field: 'saleHoldDays', params: PARAMS,
    }));
  });

  test('ausente na loja nova assume 0; na edição mantém o gravado', () => {
    expect(buildStoreRecord({ name: 'X', currency: 'USD' }).saleHoldDays).toBe(0);
    const existing = { ...buildStoreRecord({ name: 'X', currency: 'USD', saleHoldDays: 9 }) };
    expect(buildStoreRecord({ name: 'Y' }, { existing }).saleHoldDays).toBe(9);
  });

  test('vem depois das validações de centavos (passo 5)', () => {
    expect(() => buildStoreRecord({ name: 'X', currency: 'USD', saleHoldDays: 99, saleFixedFeeCents: -1 }))
      .toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
  });
});

describe('API de lojas: saleHoldDays', () => {
  test('o seed entrega 7/0/7 em GET /api/stores e GET /api/stores/:id', async () => {
    const list = (await request(app).get('/api/stores')).body.data;
    expect(Object.fromEntries(list.map((s) => [s.name, s.saleHoldDays]))).toEqual({ CSFloat: 7, Steam: 0, CSMoney: 7 });
    expect((await request(app).get(`/api/stores/${storeId('CSFloat')}`)).body.data.saleHoldDays).toBe(7);
  });

  test('POST sem o campo grava 0; com o campo grava o valor', async () => {
    const a = await post({ name: 'A', currency: 'USD' });
    expect(a.status).toBe(201);
    expect(a.body.data.saleHoldDays).toBe(0);
    const b = await post({ name: 'B', currency: 'USD', saleHoldDays: 30 });
    expect(b.body.data.saleHoldDays).toBe(30);
  });

  test.each([[31], [-1], [7.5]])('PATCH com %p -> 400 INVALID_SALE_HOLD_DAYS', async (value) => {
    expectError(await patch(storeId('CSFloat'), { saleHoldDays: value }), 400, 'INVALID_SALE_HOLD_DAYS', { field: 'saleHoldDays', params: PARAMS });
    expectError(await post({ name: 'Z', currency: 'USD', saleHoldDays: value }), 400, 'INVALID_SALE_HOLD_DAYS', { field: 'saleHoldDays', params: PARAMS });
  });

  test('texto e nulo são recusados pela forma do corpo: INVALID_FIELD', async () => {
    expectError(await patch(storeId('CSFloat'), { saleHoldDays: '7' }), 400, 'INVALID_FIELD', { field: 'saleHoldDays' });
    expectError(await patch(storeId('CSFloat'), { saleHoldDays: null }), 400, 'INVALID_FIELD', { field: 'saleHoldDays' });
  });

  test('0 e 30 são aceitos no PATCH, e o valor persiste', async () => {
    const id = storeId('CSFloat');
    expect((await patch(id, { saleHoldDays: 0 })).body.data.saleHoldDays).toBe(0);
    expect((await patch(id, { saleHoldDays: 30 })).body.data.saleHoldDays).toBe(30);
    expect((await request(app).get(`/api/stores/${id}`)).body.data.saleHoldDays).toBe(30);
  });

  test('loja em uso aceita o PATCH (sem trava, o snapshot protege o histórico)', async () => {
    const catalogApp = makeCatalogApp();
    const item = await createItemViaApi(catalogApp, purchaseBody());
    expect(item.id).toBeGreaterThan(0);
    const id = storeId('CSFloat');
    const res = await request(catalogApp).patch(`/api/stores/${id}`).send({ saleHoldDays: 3 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ saleHoldDays: 3, inUse: true });
  });
});
