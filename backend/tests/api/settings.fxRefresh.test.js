'use strict';

// POST /api/settings/fx-rate/refresh (D147) com fetch falso: nunca chama a API real do BCB.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, purchaseBody, createItemViaApi, expectError, NOW } = require('../helpers/apiFixtures');
const settingsService = require('../../src/services/settingsService');

beforeEach(() => {
  freshDb();
  require('../../src/models/Setting').update({ fxRefreshSource: 'PTAX' });
});
afterAll(() => closeDb());

const row = (extra = {}) => ({ cotacaoCompra: 5.2987, cotacaoVenda: 5.3012, dataHoraCotacao: '2026-11-19 13:04:28.123', ...extra });
const ok = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });

function appWith(fetchFn, now = NOW) {
  return makeCatalogApp(now, { fetchFn });
}
const post = (app) => request(app).post('/api/settings/fx-rate/refresh').set('Content-Type', 'application/json').send({});
const getSettings = async (app) => (await request(app).get('/api/settings')).body.data;

describe('POST /api/settings/fx-rate/refresh', () => {
  test('grava a PTAX de VENDA, origem PTAX, data da cotação e now; devolve settings e ptax', async () => {
    const app = appWith(async () => ok({ value: [row()] }));
    const res = await post(app);
    expect(res.status).toBe(200);
    expect(res.body.data.quote).toEqual({
      source: 'PTAX',
      rate: 5.3012, buyRate: 5.2987, sellRate: 5.3012, quotedAt: '2026-11-19T16:04:28.123Z'
    });
    expect(res.body.data.settings).toMatchObject({
      usdBrlRate: 5.3012,
      usdBrlRateSource: 'PTAX',
      rateQuotedAt: '2026-11-19T16:04:28.123Z',
      usdBrlRateUpdatedAt: '2026-11-19T15:00:00.000Z',
    });
    expect(await getSettings(app)).toMatchObject({ usdBrlRate: 5.3012, usdBrlRateSource: 'PTAX' });
  });

  test('feriado (value vazio) recua para o dia útil anterior', async () => {
    const urls = [];
    const app = appWith(async (url) => {
      urls.push(url);
      return urls.length === 1 ? ok({ value: [] }) : ok({ value: [row({ dataHoraCotacao: '2026-11-18 13:05:00.000' })] });
    });
    const res = await post(app);
    expect(res.status).toBe(200);
    expect(res.body.data.settings.rateQuotedAt).toBe('2026-11-18T16:05:00.000Z');
    expect(urls).toHaveLength(2);
  });

  test('sábado: não consulta sábado nem domingo', async () => {
    const urls = [];
    const app = appWith(async (url) => {
      urls.push(url);
      return ok({ value: [row({ dataHoraCotacao: '2026-11-20 13:05:00.000' })] });
    }, new Date('2026-11-21T15:00:00.000Z'));
    await post(app);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("@dataCotacao='11-20-2026'");
  });

  test('7 dias sem cotação → 502 PTAX_NOT_FOUND e nada é gravado', async () => {
    const app = appWith(async () => ok({ value: [] }));
    expectError(await post(app), 502, 'PTAX_NOT_FOUND');
    expect(await getSettings(app)).toMatchObject({ usdBrlRate: null, usdBrlRateSource: null });
  });

  test('HTTP 500 → 502 FX_SOURCE_UNAVAILABLE (a fonte respondeu com erro: não é falta de internet)', async () => {
    const app = appWith(async () => ({ ok: false, status: 500, text: async () => '' }));
    expectError(await post(app), 502, 'FX_SOURCE_UNAVAILABLE');
  });

  test('rede fora → 502 FX_FETCH_FAILED e a cotação anterior é mantida', async () => {
    const app = appWith(async () => {
      throw new TypeError('fetch failed');
    });
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5 });
    expectError(await post(app), 502, 'FX_FETCH_FAILED');
    expect(await getSettings(app)).toMatchObject({ usdBrlRate: 5, usdBrlRateSource: 'MANUAL' });
  });

  test.each([0, -1, 51, 530])('valor %p → 502 FX_INVALID_RESPONSE', async (cotacaoVenda) => {
    const app = appWith(async () => ok({ value: [row({ cotacaoVenda })] }));
    expectError(await post(app), 502, 'FX_INVALID_RESPONSE');
  });

  test('JSON inválido → 502 FX_INVALID_RESPONSE', async () => {
    const app = appWith(async () => ({ ok: true, status: 200, text: async () => 'oops' }));
    expectError(await post(app), 502, 'FX_INVALID_RESPONSE');
  });

  test('resposta acima de 64 KB → 502 FX_INVALID_RESPONSE', async () => {
    const app = appWith(async () => ({ ok: true, status: 200, text: async () => 'x'.repeat(65 * 1024) }));
    expectError(await post(app), 502, 'FX_INVALID_RESPONSE');
  });

  test('chamadas simultâneas → a segunda recebe 409 FX_REFRESH_IN_PROGRESS; depois libera', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const app = appWith(async () => {
      await gate;
      return ok({ value: [row()] });
    });
    const first = post(app).then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settingsService.isFxRefreshInProgress()).toBe(true);
    expectError(await post(app), 409, 'FX_REFRESH_IN_PROGRESS');
    release();
    expect((await first).status).toBe(200);
    expect(settingsService.isFxRefreshInProgress()).toBe(false);
    expect((await post(app)).status).toBe(200);
  });

  test('a trava é liberada depois de uma falha', async () => {
    const app = appWith(async () => ({ ok: false, status: 503, text: async () => '' }));
    expectError(await post(app), 502, 'FX_SOURCE_UNAVAILABLE');
    expect(settingsService.isFxRefreshInProgress()).toBe(false);
  });

  test('sem Content-Type JSON → 415 UNSUPPORTED_MEDIA_TYPE e nenhuma chamada de rede', async () => {
    const fetchFn = jest.fn();
    const app = appWith(fetchFn);
    expectError(await request(app).post('/api/settings/fx-rate/refresh'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).post('/api/settings/fx-rate/refresh').set('Content-Type', 'text/plain').send('{}'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('corpo com campo desconhecido ou que não é objeto → 400', async () => {
    const fetchFn = jest.fn();
    const app = appWith(fetchFn);
    expectError(
      await request(app).post('/api/settings/fx-rate/refresh').set('Content-Type', 'application/json').send({ x: 1 }),
      400, 'UNKNOWN_FIELD', { field: 'x' }
    );
    expectError(
      await request(app).post('/api/settings/fx-rate/refresh').set('Content-Type', 'application/json').send('[1]'),
      400, 'INVALID_BODY'
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('edição manual depois da PTAX → origem MANUAL e rateQuotedAt nula', async () => {
    const app = appWith(async () => ok({ value: [row()] }));
    await post(app);
    const res = await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.5 });
    expect(res.body.data).toMatchObject({ usdBrlRate: 5.5, usdBrlRateSource: 'MANUAL', rateQuotedAt: null });
  });

  test('cotações já gravadas em itens não mudam', async () => {
    const app = appWith(async () => ok({ value: [row()] }));
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5 });
    const { storeIdByName } = require('../helpers/fixtures');
    const item = await createItemViaApi(
      app,
      purchaseBody({ purchaseStoreId: storeIdByName('Steam'), purchasePriceCents: 1000 })
    );
    expect(item.fxRateAtPurchase).toBe(5);
    await post(app);
    const after = (await request(app).get(`/api/items/${item.id}`)).body.data;
    expect(after.fxRateAtPurchase).toBe(5);
    expect((await getSettings(app)).usdBrlRate).toBe(5.3012);
  });

  test('GET e PUT não consultam a rede', async () => {
    const fetchFn = jest.fn();
    const app = appWith(fetchFn);
    await request(app).get('/api/settings');
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5 });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('settingsService.refreshFxRate (timeouts injetáveis)', () => {
  test('timeout por chamada → FX_FETCH_FAILED e libera a trava', async () => {
    freshDb();
    await expect(
      settingsService.refreshFxRate({
        fetchFn: () => new Promise(() => {}),
        now: NOW,
        timeouts: { callTimeoutMs: 30 },
      })
    ).rejects.toMatchObject({ code: 'FX_FETCH_FAILED' });
    expect(settingsService.isFxRefreshInProgress()).toBe(false);
  });
});
