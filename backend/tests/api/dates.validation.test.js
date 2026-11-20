// Datas: só ISO 8601 com Z ou offset explícito (2.0, D7). Outros formatos -> 400 INVALID_DATE.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, purchaseBody, createItemViaApi, expectError, storeId } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const post = (acquiredAt) => request(app).post('/api/items').send(purchaseBody({ acquiredAt }));

describe('datas fora do ISO 8601 com fuso', () => {
  test.each([
    '10/11/2026', '1', 'November 10, 2026', '2026-11-10', '2026-11-10T09:00', '2026-11-10T09:00:00',
    '2026-02-30T10:00:00Z', '2026-13-01T10:00:00Z', '2026-11-10T25:00:00Z', '2026-11-10T09:00:00+3', '',
  ])('acquiredAt %p -> 400 INVALID_DATE', async (value) => {
    expectError(await post(value), 400, 'INVALID_DATE');
  });

  test('soldAt "11/18/2026" -> 400 INVALID_DATE', async () => {
    const item = await createItemViaApi(app, purchaseBody({ acquiredAt: '2026-01-01T12:00:00.000Z' }));
    const res = await request(app)
      .post(`/api/items/${item.id}/sell`)
      .send({ saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '11/18/2026' });
    expectError(res, 400, 'INVALID_DATE');
  });

  test('tradeUnlockAt sem fuso -> 400 INVALID_DATE (também no PATCH)', async () => {
    expectError(await request(app).post('/api/items').send(purchaseBody({ tradeUnlockAt: '2026-11-25T10:00' })), 400, 'INVALID_DATE');
    const item = await createItemViaApi(app);
    expectError(await request(app).patch(`/api/items/${item.id}`).send({ tradeUnlockAt: '25/11/2026' }), 400, 'INVALID_DATE');
  });
});

describe('formatos aceitos', () => {
  test.each([
    ['2026-11-10T15:00:00Z', '2026-11-10T15:00:00.000Z'],
    ['2026-11-10T15:00:00.123Z', '2026-11-10T15:00:00.123Z'],
    ['2026-11-10T12:00:00-03:00', '2026-11-10T15:00:00.000Z'],
    ['2026-11-10T15:00Z', '2026-11-10T15:00:00.000Z'],
    ['2024-02-29T10:00:00Z', '2024-02-29T10:00:00.000Z'],
  ])('acquiredAt %s', async (input, expected) => {
    const res = await post(input);
    expect(res.status).toBe(201);
    expect(res.body.data.acquiredAt).toBe(expected);
  });
});
