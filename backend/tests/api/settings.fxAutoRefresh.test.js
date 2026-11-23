'use strict';

// D338: atualização da cotação USD→BRL ao abrir o app (POST /api/settings/fx-rate/refresh { trigger: 'AUTO' }). Fetch falso.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, expectError, NOW } = require('../helpers/apiFixtures');
const Setting = require('../../src/models/Setting');
const settingsService = require('../../src/services/settingsService');

const row = { cotacaoCompra: 5.2987, cotacaoVenda: 5.3012, dataHoraCotacao: '2026-11-19 13:04:28.123' };
const ok = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });

let calls;
function appWith(fetchFn = async () => ok({ value: [row] })) {
  calls = 0;
  return makeCatalogApp(NOW, { fetchFn: async (...args) => { calls += 1; return fetchFn(...args); } });
}
const auto = (app) => request(app).post('/api/settings/fx-rate/refresh').set('Content-Type', 'application/json').send({ trigger: 'AUTO' });
const manual = (app) => request(app).post('/api/settings/fx-rate/refresh').set('Content-Type', 'application/json').send({});

beforeEach(() => {
  freshDb();
  settingsService.resetAutoFxForTests();
  Setting.update({ fxRefreshSource: 'PTAX' });
});
afterAll(() => closeDb());

test('fonte automática: atualiza ao abrir, uma vez por processo (um F5 não repete)', async () => {
  const app = appWith();
  const first = await auto(app);
  expect(first.status).toBe(200);
  expect(first.body.data.settings).toMatchObject({ usdBrlRate: 5.3012, usdBrlRateSource: 'PTAX' });
  expect(first.body.data.skipped).toBeUndefined();
  const second = await auto(app);
  expect(second.body.data).toMatchObject({ skipped: 'ALREADY_RAN', quote: null });
  expect(calls).toBe(1);
  // o botão manual continua funcionando normalmente
  expect((await manual(app)).status).toBe(200);
  expect(calls).toBe(2);
});

test('cotação digitada à mão (origem MANUAL) nunca é sobrescrita ao abrir', async () => {
  const app = appWith();
  expect((await request(app).put('/api/settings/fx-rate').set('Content-Type', 'application/json').send({ usdBrlRate: 5.5 })).status).toBe(200);
  const res = await auto(app);
  expect(res.body.data).toMatchObject({ skipped: 'MANUAL_RATE', settings: { usdBrlRate: 5.5, usdBrlRateSource: 'MANUAL' } });
  expect(calls).toBe(0);
});

test('fonte fora do ar: erro curto, nada gravado e não tenta de novo no mesmo processo', async () => {
  Setting.update({ usdBrlRate: 5.1, usdBrlRateSource: 'PTAX' });
  const app = appWith(async () => { throw new TypeError('fetch failed'); });
  const res = await auto(app);
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.body.success).toBe(false);
  expect((await request(app).get('/api/settings')).body.data.usdBrlRate).toBe(5.1);
  expect((await auto(app)).body.data.skipped).toBe('ALREADY_RAN');
});

test('trigger inválido -> INVALID_FIELD', async () => {
  expectError(await request(appWith()).post('/api/settings/fx-rate/refresh').set('Content-Type', 'application/json').send({ trigger: 'X' }), 400, 'INVALID_FIELD', { field: 'trigger' });
});
