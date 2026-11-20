const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

describe('/api/settings', () => {
  test('GET inicial sem id (T1)', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ usdBrlRate: null, usdBrlRateUpdatedAt: null, updatedAt: expect.any(String) });
    expect(res.body.data).not.toHaveProperty('id');
  });

  test('PUT /fx-rate grava com o relógio injetado e o GET devolve o valor', async () => {
    const res = await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.25 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      usdBrlRate: 5.25,
      usdBrlRateUpdatedAt: '2026-11-19T15:00:00.000Z',
      updatedAt: '2026-11-19T15:00:00.000Z',
    });
    expect((await request(app).get('/api/settings')).body.data.usdBrlRate).toBe(5.25);
  });

  test.each([0, -1])('cotação %p -> INVALID_FX_RATE', async (v) => {
    expectError(await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: v }), 400, 'INVALID_FX_RATE');
  });

  test.each(['5.25', true, null])('cotação %p -> INVALID_FIELD', async (v) => {
    expectError(await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: v }), 400, 'INVALID_FIELD');
  });

  test('{} -> REQUIRED_FIELD; campo extra -> UNKNOWN_FIELD; array -> INVALID_BODY', async () => {
    expectError(await request(app).put('/api/settings/fx-rate').send({}), 400, 'REQUIRED_FIELD');
    expectError(await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5, foo: 1 }), 400, 'UNKNOWN_FIELD');
    expectError(await request(app).put('/api/settings/fx-rate').send([1]), 400, 'INVALID_BODY');
  });

  test('PUT /api/settings não existe', async () => {
    expectError(await request(app).put('/api/settings').send({ usdBrlRate: 5 }), 404, 'NOT_FOUND');
  });

  describe('integração com itens', () => {
    const steamBuy = () => purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 1000 });

    test('Steam sem cotação -> FX_RATE_REQUIRED; depois do PUT usa a cotação; nova cotação não muda o item gravado', async () => {
      expectError(await request(app).post('/api/items').send(steamBuy()), 400, 'FX_RATE_REQUIRED');
      await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5 });
      const created = await createItemViaApi(app, steamBuy());
      expect(created).toMatchObject({ purchaseCurrency: 'BRL', fxRateAtPurchase: 5 });
      await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 6 });
      const again = (await request(app).get(`/api/items/${created.id}`)).body.data;
      expect(again.fxRateAtPurchase).toBe(5);
    });

    test('minPrices Steam de item USD passa de "cotação não configurada" a valor após o PUT', async () => {
      const item = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 1000 }));
      const steamBefore = item.minPrices.find((m) => m.storeName === 'Steam');
      expect(steamBefore).toMatchObject({ minPriceCents: null, warning: 'cotação não configurada' });
      await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5 });
      const after = (await request(app).get(`/api/items/${item.id}`)).body.data;
      expect(after.minPrices.find((m) => m.storeName === 'Steam')).toMatchObject({ minPriceCents: 5750, warning: null });
    });
  });
});
