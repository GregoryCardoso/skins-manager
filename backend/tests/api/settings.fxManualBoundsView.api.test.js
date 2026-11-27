// `fxManualRateBounds` em toda resposta de configurações (12.8): aditivo, igual a FX_MANUAL_RATE_BOUNDS.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp } = require('../helpers/apiFixtures');
const { CURRENCIES, FX_MANUAL_RATE_BOUNDS } = require('../../src/config/constants');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const expectBounds = (data) => {
  expect(Object.keys(data.fxManualRateBounds).sort()).toEqual(CURRENCIES.filter((c) => c !== 'USD').sort());
  expect(Object.keys(data.fxManualRateBounds)).toHaveLength(41);
  expect(data.fxManualRateBounds).not.toHaveProperty('USD');
  expect(data.fxManualRateBounds).toEqual(JSON.parse(JSON.stringify(FX_MANUAL_RATE_BOUNDS)));
};

describe('GET, PATCH e PUT fx-rate', () => {
  test('GET /api/settings', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expectBounds(res.body.data);
  });
  test('PATCH /api/settings', async () => {
    const res = await request(app).patch('/api/settings').send({ theme: 'DARK' });
    expect(res.status).toBe(200);
    expectBounds(res.body.data);
  });
  test('PUT /api/settings/fx-rate', async () => {
    const res = await request(app).put('/api/settings/fx-rate').send({ currency: 'EUR', rate: 0.9 });
    expect(res.status).toBe(200);
    expectBounds(res.body.data);
  });
  test('os campos de antes continuam', async () => {
    const { data } = (await request(app).get('/api/settings')).body;
    for (const key of ['fxRates', 'requiredFxCurrencies', 'fastTurnoverDays', 'slowItemDays', 'displayCurrency', 'theme', 'language']) {
      expect(data).toHaveProperty(key);
    }
  });
});
