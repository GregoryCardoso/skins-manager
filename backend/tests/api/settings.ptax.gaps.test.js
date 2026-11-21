'use strict';

// Lacunas da PTAX pela API (D147): cotação anterior intacta após falha, timeout total, Content-Type.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, expectError, NOW } = require('../helpers/apiFixtures');
const settingsService = require('../../src/services/settingsService');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const row = (extra = {}) => ({ cotacaoCompra: 5.1, cotacaoVenda: 5.3012, dataHoraCotacao: '2026-11-19 13:04:28.123', ...extra });
const ok = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
const post = (app) => request(app).post('/api/settings/fx-rate/ptax').set('Content-Type', 'application/json').send({});
const getSettings = async (app) => (await request(app).get('/api/settings')).body.data;

describe('PTAX pela API: falhas preservam a cotação anterior', () => {
  const keep = ['usdBrlRate', 'usdBrlRateSource', 'ptaxQuotedAt', 'usdBrlRateUpdatedAt'];
  const pick = (s) => Object.fromEntries(keep.map((k) => [k, s[k]]));

  test.each([
    ['rede', async () => { throw new TypeError('x'); }, 'PTAX_FETCH_FAILED'],
    ['HTTP 500', async () => ({ ok: false, status: 500, text: async () => '' }), 'PTAX_FETCH_FAILED'],
    ['JSON inválido', async () => ({ ok: true, status: 200, text: async () => '<' }), 'PTAX_INVALID_RESPONSE'],
    ['valor fora da faixa', async () => ok({ value: [row({ cotacaoVenda: 99 })] }), 'PTAX_INVALID_RESPONSE'],
    ['venda ausente', async () => ok({ value: [{ cotacaoCompra: 5, dataHoraCotacao: '2026-11-19 13:00:00.000' }] }), 'PTAX_INVALID_RESPONSE'],
    ['sem cotação', async () => ok({ value: [] }), 'PTAX_NOT_FOUND'],
  ])('após PTAX bem-sucedida, falha por %s deixa tudo como estava', async (_n, failing, code) => {
    let fetchFn = async () => ok({ value: [row()] });
    const app = makeCatalogApp(NOW, { fetchFn: (...a) => fetchFn(...a) });
    expect((await post(app)).status).toBe(200);
    const before = pick(await getSettings(app));
    expect(before).toMatchObject({ usdBrlRate: 5.3012, usdBrlRateSource: 'PTAX', ptaxQuotedAt: '2026-11-19T16:04:28.123Z' });
    fetchFn = failing;
    expectError(await post(app), 502, code);
    expect(pick(await getSettings(app))).toEqual(before);
  });

  test('nova PTAX bem-sucedida sobrescreve a anterior (venda e data da cotação)', async () => {
    let fetchFn = async () => ok({ value: [row()] });
    const app = makeCatalogApp(NOW, { fetchFn: (...a) => fetchFn(...a) });
    await post(app);
    fetchFn = async () => ok({ value: [row({ cotacaoVenda: 5.5, dataHoraCotacao: '2026-11-19 14:00:00.000' })] });
    const res = await post(app);
    expect(res.body.data.settings).toMatchObject({ usdBrlRate: 5.5, usdBrlRateSource: 'PTAX', ptaxQuotedAt: '2026-11-19T17:00:00.000Z' });
  });

  test('PTAX, edição manual e PTAX de novo: a origem acompanha', async () => {
    const app = makeCatalogApp(NOW, { fetchFn: async () => ok({ value: [row()] }) });
    await post(app);
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5 });
    expect(await getSettings(app)).toMatchObject({ usdBrlRateSource: 'MANUAL', ptaxQuotedAt: null });
    await post(app);
    expect(await getSettings(app)).toMatchObject({ usdBrlRateSource: 'PTAX', ptaxQuotedAt: '2026-11-19T16:04:28.123Z' });
  });
});

describe('PTAX pela API: Content-Type e timeout total', () => {
  test.each(['application/json', 'application/json; charset=utf-8'])('aceita %s', async (type) => {
    const app = makeCatalogApp(NOW, { fetchFn: async () => ok({ value: [row()] }) });
    expect((await request(app).post('/api/settings/fx-rate/ptax').set('Content-Type', type).send('{}')).status).toBe(200);
  });

  test.each(['application/x-www-form-urlencoded', 'text/plain'])('recusa %s com 415 sem tocar a rede', async (type) => {
    const fetchFn = jest.fn();
    const app = makeCatalogApp(NOW, { fetchFn });
    expectError(await request(app).post('/api/settings/fx-rate/ptax').set('Content-Type', type).send('x=1'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(settingsService.isPtaxRefreshInProgress()).toBe(false);
  });

  test('timeout total encerra a série e libera a trava', async () => {
    const fetchFn = jest.fn(() => new Promise((resolve) => setTimeout(() => resolve(ok({ value: [] })), 40)));
    await expect(
      settingsService.refreshFxRateFromPtax({ fetchFn, now: NOW, timeouts: { callTimeoutMs: 1000, totalTimeoutMs: 100 } })
    ).rejects.toMatchObject({ code: 'PTAX_FETCH_FAILED' });
    expect(fetchFn.mock.calls.length).toBeLessThan(6);
    expect(settingsService.isPtaxRefreshInProgress()).toBe(false);
  });
});
