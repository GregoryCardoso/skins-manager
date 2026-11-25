// QA 11.3: bordas da faixa manual da cotação (FX_MANUAL_RATE_BOUNDS): epsilon fora, tipos estranhos, minúscula e o formato antigo.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, expectError } = require('../helpers/apiFixtures');
const { CURRENCIES, FX_MANUAL_RATE_BOUNDS } = require('../../src/config/constants');
const FxRate = require('../../src/models/FxRate');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const putRate = (body) => request(app).put('/api/settings/fx-rate').send(body);
const putRaw = (raw) => request(app).put('/api/settings/fx-rate').set('Content-Type', 'application/json').send(raw);
const NON_USD = CURRENCIES.filter((c) => c !== 'USD');

describe('um epsilon fora dos limites', () => {
  test.each(NON_USD)('%s: min - epsilon e max + epsilon são recusados; min e max seguem aceitos', async (currency) => {
    const { min, max } = FX_MANUAL_RATE_BOUNDS[currency];
    const below = min * (1 - 1e-9);
    const above = max * (1 + 1e-9);
    expect(below).toBeLessThan(min);
    expect(above).toBeGreaterThan(max);
    expectError(await putRate({ currency, rate: below }), 400, 'FX_RATE_OUT_OF_RANGE');
    expectError(await putRate({ currency, rate: above }), 400, 'FX_RATE_OUT_OF_RANGE');
    expect(FxRate.find(currency)).toBeFalsy();
    expect((await putRate({ currency, rate: min })).status).toBe(200);
    expect((await putRate({ currency, rate: max })).status).toBe(200);
  });

  test('Number.MIN_VALUE e Number.MAX_VALUE caem na faixa, não no INVALID_FX_RATE', async () => {
    expectError(await putRate({ currency: 'BRL', rate: Number.MIN_VALUE }), 400, 'FX_RATE_OUT_OF_RANGE');
    expectError(await putRaw('{"currency":"BRL","rate":1.7976931348623157e308}'), 400, 'FX_RATE_OUT_OF_RANGE');
  });

  test('1e999 (vira Infinity no parse) e NaN não gravam nada', async () => {
    const res = await putRaw('{"currency":"BRL","rate":1e999}');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.success).toBe(false);
    expect(FxRate.find('BRL')).toBeFalsy();
  });
});

describe('tipos e formas do valor', () => {
  test('string numérica é recusada como INVALID_FIELD (nunca convertida)', async () => {
    for (const rate of ['5.4', '5,4', ' 5.4 ', '1e1']) {
      expectError(await putRate({ currency: 'BRL', rate }), 400, 'INVALID_FIELD');
    }
    expect(FxRate.find('BRL')).toBeFalsy();
  });

  test('null, booleano e array recusados', async () => {
    for (const rate of [null, true, [5.4]]) {
      const res = await putRate({ currency: 'BRL', rate });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
  });

  test('notação científica no JSON é um número: 5.4e0 aceito; 5e-1 (0,5) é o mínimo do BRL; 1e2 (100) é o máximo', async () => {
    expect((await putRaw('{"currency":"BRL","rate":5.4e0}')).status).toBe(200);
    expect(FxRate.find('BRL').rate).toBe(5.4);
    expect((await putRaw('{"currency":"BRL","rate":5e-1}')).status).toBe(200);
    expect((await putRaw('{"currency":"BRL","rate":1e2}')).status).toBe(200);
    expectError(await putRaw('{"currency":"BRL","rate":1.0001e2}'), 400, 'FX_RATE_OUT_OF_RANGE');
    expectError(await putRaw('{"currency":"BRL","rate":4.99e-1}'), 400, 'FX_RATE_OUT_OF_RANGE');
  });

  test('moeda em minúscula, desconhecida ou USD não grava nem passa pela faixa', async () => {
    for (const currency of ['brl', 'Brl', 'XYZ', 'USD', '']) {
      const res = await putRate({ currency, rate: 5.4 });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).not.toBe('FX_RATE_OUT_OF_RANGE');
    }
    expect(FxRate.find('BRL')).toBeFalsy();
  });

  test('currency não-texto é INVALID_FIELD', async () => {
    expectError(await putRate({ currency: 5, rate: 5.4 }), 400, 'INVALID_FIELD');
  });
});

describe('formato antigo { usdBrlRate }', () => {
  test('usa a faixa do BRL: limites aceitos e fora recusado com params do BRL', async () => {
    expect((await putRate({ usdBrlRate: 0.5 })).status).toBe(200);
    expect((await putRate({ usdBrlRate: 100 })).status).toBe(200);
    const low = await putRate({ usdBrlRate: 0.49 });
    expectError(low, 400, 'FX_RATE_OUT_OF_RANGE');
    expect(low.body.error.params).toEqual({ currency: 'BRL', min: 0.5, max: 100 });
    expectError(await putRate({ usdBrlRate: 100.01 }), 400, 'FX_RATE_OUT_OF_RANGE');
    expect(FxRate.find('BRL').rate).toBe(100);
  });

  test('usdBrlRate com currency ou rate junto continua recusado', async () => {
    expectError(await putRate({ usdBrlRate: 5.4, currency: 'BRL' }), 400, 'INVALID_FIELD');
    expectError(await putRate({ usdBrlRate: 5.4, rate: 5.4 }), 400, 'INVALID_FIELD');
  });

  test('usdBrlRate zero e negativo seguem INVALID_FX_RATE', async () => {
    expectError(await putRate({ usdBrlRate: 0 }), 400, 'INVALID_FX_RATE');
    expectError(await putRate({ usdBrlRate: -5 }), 400, 'INVALID_FX_RATE');
  });

  test('sem currency, o BRL é o padrão e a faixa dele vale', async () => {
    expect((await putRate({ rate: 5.4 })).status).toBe(200);
    expectError(await putRate({ rate: 1000 }), 400, 'FX_RATE_OUT_OF_RANGE');
  });

  test('a faixa manual não toca o valor automático: o erro nunca vem de refresh (só PUT)', async () => {
    expect((await putRate({ currency: 'JPY', rate: 10 })).status).toBe(200);
    expect(FxRate.find('JPY').source).toBe('MANUAL');
  });
});
