const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const Store = require('../../src/models/Store');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, storeId, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

describe('GET /api/stores', () => {
  test('lista as 3 lojas do seed por nome com saleFeesConfigured', async () => {
    const res = await request(app).get('/api/stores');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.map((s) => s.name)).toEqual(['CSFloat', 'CSMoney', 'Steam']);
    const by = Object.fromEntries(res.body.data.map((s) => [s.name, s]));
    expect(by.CSFloat.saleFeesConfigured).toBe(true);
    expect(by.Steam.saleFeesConfigured).toBe(true);
    expect(by.CSMoney.saleFeesConfigured).toBe(false);
    expect(by.CSFloat).toMatchObject({ currency: 'USD', isPrimary: true, isActive: true });
  });

  test('activeOnly=true omite inativas', async () => {
    Store.update(storeId('Steam'), { isActive: false });
    const res = await request(app).get('/api/stores?activeOnly=true');
    expect(res.body.data.map((s) => s.name)).toEqual(['CSFloat', 'CSMoney']);
    const all = await request(app).get('/api/stores?activeOnly=false');
    expect(all.body.data).toHaveLength(3);
  });

  test('activeOnly inválido -> 400 INVALID_QUERY', async () => {
    expectError(await request(app).get('/api/stores?activeOnly=x'), 400, 'INVALID_QUERY');
  });

  test('POST /api/stores não existe nesta etapa', async () => {
    expectError(await request(app).post('/api/stores').send({ name: 'X' }), 404, 'NOT_FOUND');
  });
});
