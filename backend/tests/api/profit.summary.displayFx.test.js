// GET /api/profit/summary: `fx.display` traz a cotação da MOEDA DE CONVERSÃO (12.12, pedido do usuário). Antes a nota da tela usava
// sempre os campos do BRL, mesmo com outra moeda escolhida. Aditivo: os campos antigos (`usdBrlRate` etc.) continuam iguais.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const FxRate = require('../../src/models/FxRate');
const { freshDb } = require('../helpers/fixtures');
const { makeApp } = require('../helpers/apiFixtures');

const NOW = new Date('2026-11-27T15:15:00.000Z');
let app;

afterAll(() => closeDb());
beforeEach(() => { freshDb(); app = makeApp(NOW); });

const summaryFx = async () => {
  const res = await request(app).get('/api/profit/summary');
  expect(res.status).toBe(200);
  return res.body.data.fx;
};

describe('GET /api/profit/summary: fx.display (cotação da moeda de conversão)', () => {
  test('BRL: display traz a cotação do real, igual aos campos antigos', async () => {
    Setting.update({ displayCurrency: 'BRL', usdBrlRate: 5.5431, usdBrlRateSource: 'AWESOMEAPI', rateQuotedAt: '2026-11-27T15:15:00.000Z' }, { now: NOW });
    const fx = await summaryFx();
    expect(fx.displayCurrency).toBe('BRL');
    expect(fx.display).toEqual({ currency: 'BRL', rate: 5.5431, source: 'AWESOMEAPI', quotedAt: '2026-11-27T15:15:00.000Z', updatedAt: expect.any(String) });
    expect(fx.usdBrlRate).toBe(5.5431);
  });

  test('EUR: display traz a cotação do euro, não a do real (que continua nos campos antigos)', async () => {
    Setting.update({ displayCurrency: 'EUR', usdBrlRate: 5.5431 }, { now: NOW });
    FxRate.upsert('EUR', { rate: 0.92, source: 'MANUAL', quotedAt: null, updatedAt: NOW.toISOString() });
    const fx = await summaryFx();
    expect(fx.displayCurrency).toBe('EUR');
    expect(fx.display).toMatchObject({ currency: 'EUR', rate: 0.92, source: 'MANUAL' });
    expect(fx.usdBrlRate).toBe(5.5431);
  });

  test('moeda de conversão sem cotação: display com rate nulo', async () => {
    Setting.update({ displayCurrency: 'JPY' }, { now: NOW });
    const fx = await summaryFx();
    expect(fx.display).toEqual({ currency: 'JPY', rate: null, source: null, quotedAt: null, updatedAt: null });
  });

  test('USD: sem cotação (é a base), mesmo havendo cotação do real gravada', async () => {
    Setting.update({ displayCurrency: 'USD', usdBrlRate: 5.5431 }, { now: NOW });
    const fx = await summaryFx();
    expect(fx.display).toEqual({ currency: 'USD', rate: null, source: null, quotedAt: null, updatedAt: null });
  });
});
