'use strict';

// Fontes da cotação (D162) pela API, com fetch falso: AWESOMEAPI (padrão) e PTAX, troca de fonte, trava única.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, expectError, NOW } = require('../helpers/apiFixtures');
const backupService = require('../../src/services/backupService');
const settingsService = require('../../src/services/settingsService');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const awesome = (extra = {}) => ({
  USDBRL: { code: 'USD', codein: 'BRL', bid: '5.1234', ask: '5.1254', timestamp: '1763650800', create_date: '2026-11-20 12:00:00', ...extra },
});
const ptax = () => ({ value: [{ cotacaoCompra: 5.2987, cotacaoVenda: 5.3012, dataHoraCotacao: '2026-11-19 13:04:28.123' }] });
const ok = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
const refresh = (app) => request(app).post('/api/settings/fx-rate/refresh').set('Content-Type', 'application/json').send({});
const patch = (app, body) => request(app).patch('/api/settings').send(body);
const getSettings = async (app) => (await request(app).get('/api/settings')).body.data;

describe('fonte padrão e troca de fonte', () => {
  test('o padrão é AWESOMEAPI; PATCH aceita PTAX e recusa outro valor com INVALID_FX_SOURCE', async () => {
    const app = makeCatalogApp(NOW, { fetchFn: jest.fn() });
    expect((await getSettings(app)).fxRefreshSource).toBe('AWESOMEAPI');
    expect((await patch(app, { fxRefreshSource: 'PTAX' })).body.data.fxRefreshSource).toBe('PTAX');
    expectError(await patch(app, { fxRefreshSource: 'MANUAL' }), 400, 'INVALID_FX_SOURCE', { field: 'fxRefreshSource' });
    expectError(await patch(app, { fxRefreshSource: 'x' }), 400, 'INVALID_FX_SOURCE');
    expect((await getSettings(app)).fxRefreshSource).toBe('PTAX');
  });
});

describe('POST /api/settings/fx-rate/refresh', () => {
  test('AWESOMEAPI: grava ask, origem, data da cotação e now', async () => {
    const fetchFn = jest.fn(async () => ok(awesome()));
    const app = makeCatalogApp(NOW, { fetchFn });
    const res = await refresh(app);
    expect(res.status).toBe(200);
    expect(fetchFn.mock.calls[0][0]).toBe('https://economia.awesomeapi.com.br/json/last/USD-BRL');
    expect(res.body.data.quote).toEqual({
      source: 'AWESOMEAPI', rate: 5.1254, buyRate: 5.1234, sellRate: 5.1254, quotedAt: '2025-11-20T15:00:00.000Z',
    });
    expect(res.body.data.settings).toMatchObject({
      usdBrlRate: 5.1254,
      usdBrlRateSource: 'AWESOMEAPI',
      rateQuotedAt: '2025-11-20T15:00:00.000Z',
      usdBrlRateUpdatedAt: NOW.toISOString(),
    });
  });

  test('PTAX quando é a fonte salva', async () => {
    const app = makeCatalogApp(NOW, { fetchFn: async () => ok(ptax()) });
    await patch(app, { fxRefreshSource: 'PTAX' });
    const res = await refresh(app);
    expect(res.body.data.settings).toMatchObject({ usdBrlRate: 5.3012, usdBrlRateSource: 'PTAX' });
  });

  test.each([
    ['rede', async () => { throw new TypeError('x'); }, 502, 'FX_FETCH_FAILED'],
    ['HTTP 500', async () => ({ ok: false, status: 500 }), 502, 'FX_SOURCE_UNAVAILABLE'],
    ['HTTP 429', async () => ({ ok: false, status: 429 }), 502, 'FX_RATE_LIMITED'],
    ['ask inválido', async () => ok(awesome({ ask: '0' })), 502, 'FX_INVALID_RESPONSE'],
  ])('falha (%s) mantém a cotação e a data salvas e informa a fonte', async (_n, failing, status, code) => {
    let fetchFn = async () => ok(awesome());
    const app = makeCatalogApp(NOW, { fetchFn: (...args) => fetchFn(...args) });
    await refresh(app);
    const before = await getSettings(app);
    fetchFn = failing;
    expectError(await refresh(app), status, code, { params: { source: 'AWESOMEAPI' } });
    expect(await getSettings(app)).toEqual(before);
  });

  test('trava única entre fontes: 409 durante a atualização, BACKUP_BUSY, e libera depois', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const app = makeCatalogApp(NOW, { fetchFn: async () => { await gate; return ok(awesome()); } });
    const first = refresh(app).then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settingsService.isFxRefreshInProgress()).toBe(true);
    expect(backupService.isBackupBusy()).toBe(true);
    await patch(app, { fxRefreshSource: 'PTAX' }); // outra fonte, mesma trava
    expectError(await refresh(app), 409, 'FX_REFRESH_IN_PROGRESS', { params: { source: 'PTAX' } });
    release();
    expect((await first).status).toBe(200);
    expect(settingsService.isFxRefreshInProgress()).toBe(false);
    expect(backupService.isBackupBusy()).toBe(false);
  });

  test('a rota antiga /fx-rate/ptax dá 404', async () => {
    const app = makeCatalogApp(NOW, { fetchFn: jest.fn() });
    expectError(await request(app).post('/api/settings/fx-rate/ptax').set('Content-Type', 'application/json').send({}), 404, 'NOT_FOUND');
  });

  test('edição manual depois de AWESOMEAPI: origem MANUAL e rateQuotedAt nula', async () => {
    const app = makeCatalogApp(NOW, { fetchFn: async () => ok(awesome()) });
    await refresh(app);
    const res = await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.5 });
    expect(res.body.data).toMatchObject({ usdBrlRate: 5.5, usdBrlRateSource: 'MANUAL', rateQuotedAt: null });
  });
});
