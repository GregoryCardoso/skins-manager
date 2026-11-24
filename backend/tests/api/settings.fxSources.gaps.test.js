'use strict';

// Lacunas da rota única POST /api/settings/fx-rate/refresh (D162): fetch falso, nunca a rede real.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, expectError, NOW } = require('../helpers/apiFixtures');
const backupService = require('../../src/services/backupService');
const settingsService = require('../../src/services/settingsService');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const awesome = (extra = {}) => ({
  USDBRL: { code: 'USD', codein: 'BRL', bid: '5.1234', ask: '5.1254', timestamp: '1763650800', ...extra },
});
const ptax = () => ({ value: [{ cotacaoCompra: 5.2987, cotacaoVenda: 5.3012, dataHoraCotacao: '2026-11-19 13:04:28.123' }] });
const ok = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
const refresh = (app) => request(app).post('/api/settings/fx-rate/refresh').set('Content-Type', 'application/json').send({});
const patch = (app, body) => request(app).patch('/api/settings').send(body);
const getSettings = async (app) => (await request(app).get('/api/settings')).body.data;
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

// fetch que serve cada fonte pela URL e registra as chamadas.
function routedFetch() {
  const urls = [];
  const fn = async (url) => {
    urls.push(String(url));
    return String(url).includes('awesomeapi') ? ok(awesome()) : ok(ptax());
  };
  fn.urls = urls;
  return fn;
}

describe('rota única com cada fonte', () => {
  test('a fonte salva decide qual provedor é chamado; trocar a fonte não altera a cotação até atualizar', async () => {
    const fetchFn = routedFetch();
    const app = makeCatalogApp(NOW, { fetchFn });
    await refresh(app);
    expect(fetchFn.urls.every((u) => u.includes('awesomeapi'))).toBe(true);
    const afterAwesome = await getSettings(app);
    expect(afterAwesome).toMatchObject({ usdBrlRate: 5.1254, usdBrlRateSource: 'AWESOMEAPI' });

    fetchFn.urls.length = 0;
    await patch(app, { fxRefreshSource: 'PTAX' });
    expect(fetchFn.urls).toEqual([]); // PATCH não consulta a rede
    expect(await getSettings(app)).toMatchObject({ usdBrlRate: 5.1254, usdBrlRateSource: 'AWESOMEAPI', fxRefreshSource: 'PTAX' });

    const res = await refresh(app);
    expect(fetchFn.urls.length).toBeGreaterThan(0);
    expect(fetchFn.urls.every((u) => !u.includes('awesomeapi'))).toBe(true);
    expect(res.body.data.settings).toMatchObject({ usdBrlRate: 5.3012, usdBrlRateSource: 'PTAX', fxRefreshSource: 'PTAX' });

    await patch(app, { fxRefreshSource: 'AWESOMEAPI' });
    expect((await refresh(app)).body.data.settings).toMatchObject({ usdBrlRate: 5.1254, usdBrlRateSource: 'AWESOMEAPI' });
  });

  test('AWESOMEAPI não grava bid: com ask e bid diferentes só o ask vira cotação', async () => {
    const app = makeCatalogApp(NOW, { fetchFn: async () => ok(awesome({ bid: '4.0000', ask: '6.0000' })) });
    const res = await refresh(app);
    expect(res.body.data.settings.usdBrlRate).toBe(6);
    expect(res.body.data.quote).toMatchObject({ rate: 6, buyRate: 4, sellRate: 6 });
  });
});

describe('INVALID_FX_SOURCE', () => {
  test.each([[null], [1], [true], [{}], [['PTAX']]])('fxRefreshSource que não é texto (%p) -> 400 INVALID_FIELD e nada muda', async (value) => {
    const app = makeCatalogApp(NOW, { fetchFn: jest.fn() });
    expectError(await patch(app, { fxRefreshSource: value }), 400, 'INVALID_FIELD', { field: 'fxRefreshSource' });
    expect((await getSettings(app)).fxRefreshSource).toBe('AWESOMEAPI');
  });

  test.each([[''], ['ptax'], ['MANUAL'], [' PTAX']])('fxRefreshSource %p -> 400 INVALID_FX_SOURCE e nada muda', async (value) => {
    const app = makeCatalogApp(NOW, { fetchFn: jest.fn() });
    const res = await patch(app, { fxRefreshSource: value });
    expectError(res, 400, 'INVALID_FX_SOURCE', { field: 'fxRefreshSource' });
    expect((await getSettings(app)).fxRefreshSource).toBe('AWESOMEAPI');
  });

  test('a fonte inválida junto com um campo válido não grava nenhum dos dois', async () => {
    const app = makeCatalogApp(NOW, { fetchFn: jest.fn() });
    expectError(await patch(app, { fxRefreshSource: 'X', theme: 'DARK' }), 400, 'INVALID_FX_SOURCE');
    expect(await getSettings(app)).toMatchObject({ theme: 'SYSTEM', fxRefreshSource: 'AWESOMEAPI' });
  });
});

describe('concorrência e BACKUP_BUSY', () => {
  function gated(json) {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    return { fetchFn: async () => { await gate; return ok(json); }, release };
  }

  test('mesma fonte (AWESOMEAPI): a segunda chamada recebe 409 com params.source e a primeira conclui', async () => {
    const { fetchFn, release } = gated(awesome());
    const app = makeCatalogApp(NOW, { fetchFn });
    const first = refresh(app).then((r) => r);
    await tick();
    expectError(await refresh(app), 409, 'FX_REFRESH_IN_PROGRESS', { params: { source: 'AWESOMEAPI' } });
    release();
    expect((await first).status).toBe(200);
    expect(settingsService.isFxRefreshInProgress()).toBe(false);
  });

  test('falha com a trava presa não ocorre: erro de rede libera e a próxima chamada passa', async () => {
    let fail = true;
    const app = makeCatalogApp(NOW, {
      fetchFn: async () => {
        if (fail) throw new TypeError('offline');
        return ok(awesome());
      },
    });
    expectError(await refresh(app), 502, 'FX_FETCH_FAILED', { params: { source: 'AWESOMEAPI' } });
    fail = false;
    expect((await refresh(app)).status).toBe(200);
  });
});

describe('falhas não gravam nada', () => {
  test.each([
    ['AWESOMEAPI', async () => ok({ USDBRL: null }), 'FX_INVALID_RESPONSE'],
    ['AWESOMEAPI', async () => ({ ok: false, status: 429 }), 'FX_RATE_LIMITED'],
    ['PTAX', async () => ok({ value: [{ cotacaoCompra: 1, cotacaoVenda: 0, dataHoraCotacao: '2026-11-19 13:04:28.123' }] }), 'FX_INVALID_RESPONSE'],
    ['PTAX', async () => ({ ok: false, status: 500 }), 'FX_SOURCE_UNAVAILABLE'],
  ])('fonte %s com falha %s: banco idêntico e params.source', async (source, failing, code) => {
    const app = makeCatalogApp(NOW, { fetchFn: (...args) => failing(...args) });
    await patch(app, { fxRefreshSource: source });
    const before = await getSettings(app);
    expectError(await refresh(app), 502, code, { params: { source } });
    expect(await getSettings(app)).toEqual(before);
  });

  test('falha também não altera uma cotação manual existente', async () => {
    const app = makeCatalogApp(NOW, { fetchFn: async () => ({ ok: false, status: 500 }) });
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.5 });
    const before = await getSettings(app);
    await refresh(app);
    expect(await getSettings(app)).toEqual(before);
    expect(before).toMatchObject({ usdBrlRateSource: 'MANUAL', rateQuotedAt: null });
  });
});

describe('rotas antigas e edição manual', () => {
  test.each([
    ['post', '/api/settings/fx-rate/ptax'],
    ['get', '/api/settings/fx-rate/ptax'],
    ['post', '/api/settings/fx-rate/awesomeapi'],
  ])('%s %s -> 404', async (method, url) => {
    const app = makeCatalogApp(NOW, { fetchFn: jest.fn() });
    const res = await request(app)[method](url).set('Content-Type', 'application/json').send(method === 'post' ? {} : undefined);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  test('manual -> fonte -> manual: a origem acompanha e a fonte do botão não muda com a edição manual', async () => {
    const app = makeCatalogApp(NOW, { fetchFn: async () => ok(awesome()) });
    await patch(app, { fxRefreshSource: 'PTAX' });
    await refresh(app).catch(() => {});
    const manual = await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.5 });
    expect(manual.body.data).toMatchObject({ usdBrlRate: 5.5, usdBrlRateSource: 'MANUAL', rateQuotedAt: null, fxRefreshSource: 'PTAX' });
  });
});
