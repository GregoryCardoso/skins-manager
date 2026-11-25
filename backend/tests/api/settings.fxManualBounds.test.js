// Faixa de segurança da cotação digitada à mão (11.3): FX_MANUAL_RATE_BOUNDS por moeda.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, expectError } = require('../helpers/apiFixtures');
const { CURRENCIES, FX_RATE_BOUNDS, FX_MANUAL_RATE_BOUNDS } = require('../../src/config/constants');
const Setting = require('../../src/models/Setting');
const FxRate = require('../../src/models/FxRate');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const putRate = (body) => request(app).put('/api/settings/fx-rate').send(body);
const NON_USD = CURRENCIES.filter((c) => c !== 'USD');

describe('FX_MANUAL_RATE_BOUNDS (constante)', () => {
  test('cobre as 16 moedas não-USD e nenhuma outra', () => {
    expect(Object.keys(FX_MANUAL_RATE_BOUNDS).sort()).toEqual([...NON_USD].sort());
  });

  test.each(NON_USD)('%s: a faixa manual contém a faixa das fontes automáticas e é bem mais larga', (currency) => {
    const manual = FX_MANUAL_RATE_BOUNDS[currency];
    const auto = FX_RATE_BOUNDS[currency];
    expect(manual.min).toBeGreaterThan(0);
    expect(manual.min).toBeLessThan(auto.min);
    expect(manual.max).toBeGreaterThan(auto.max);
  });

  test('o BRL é de 0,5 a 100', () => {
    expect(FX_MANUAL_RATE_BOUNDS.BRL).toEqual({ min: 0.5, max: 100 });
  });
});

describe('PUT /api/settings/fx-rate com a faixa manual', () => {
  test.each(NON_USD)('%s: os limites exatos são aceitos', async (currency) => {
    const { min, max } = FX_MANUAL_RATE_BOUNDS[currency];
    expect((await putRate({ currency, rate: min })).status).toBe(200);
    expect((await putRate({ currency, rate: max })).status).toBe(200);
    expect(FxRate.find(currency).rate).toBe(max);
  });

  test.each(NON_USD)('%s: abaixo do mínimo e acima do máximo -> FX_RATE_OUT_OF_RANGE com a faixa em params', async (currency) => {
    const { min, max } = FX_MANUAL_RATE_BOUNDS[currency];
    for (const rate of [min / 2, max * 2]) {
      const res = await putRate({ currency, rate });
      expectError(res, 400, 'FX_RATE_OUT_OF_RANGE');
      expect(res.body.error.params).toEqual({ currency, min, max });
    }
    expect(FxRate.find(currency)).toBeFalsy();
  });

  test('valor zero ou negativo continua INVALID_FX_RATE (não vira erro de faixa)', async () => {
    expectError(await putRate({ currency: 'BRL', rate: 0 }), 400, 'INVALID_FX_RATE');
    expectError(await putRate({ currency: 'EUR', rate: -1 }), 400, 'INVALID_FX_RATE');
  });

  test('erro de digitação típico do BRL (54 em vez de 5,4 passa; 0,054 e 540 não)', async () => {
    expect((await putRate({ currency: 'BRL', rate: 54 })).status).toBe(200);
    expectError(await putRate({ currency: 'BRL', rate: 0.054 }), 400, 'FX_RATE_OUT_OF_RANGE');
    expectError(await putRate({ currency: 'BRL', rate: 540 }), 400, 'FX_RATE_OUT_OF_RANGE');
  });

  test('rejeitado não altera a cotação gravada', async () => {
    await putRate({ currency: 'BRL', rate: 5.4 });
    expectError(await putRate({ currency: 'BRL', rate: 0.0001 }), 400, 'FX_RATE_OUT_OF_RANGE');
    expect(FxRate.find('BRL').rate).toBe(5.4);
  });

  test('cotação já gravada fora da faixa continua sendo lida sem quebrar nada', async () => {
    FxRate.upsert('BRL', { rate: 0.0001, source: 'MANUAL', quotedAt: null, updatedAt: '2026-11-25T10:00:00.000Z' });
    Setting.update({}, {});
    const settings = await request(app).get('/api/settings');
    expect(settings.status).toBe(200);
    expect(settings.body.data.fxRates.find((r) => r.currency === 'BRL').rate).toBe(0.0001);
    expect((await request(app).get('/api/profit/summary')).status).toBe(200);
    expect((await request(app).get('/api/stores/balances')).status).toBeLessThan(500);
    // e uma nova digitação válida a substitui
    expect((await putRate({ currency: 'BRL', rate: 5.4 })).status).toBe(200);
  });
});
