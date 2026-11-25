'use strict';

// Lacunas de D86 nas rotas do catálogo e nas preferências (PATCH /api/settings).
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { CATALOG_BASE_URL } = require('../../src/config/constants');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, NOW, expectError } = require('../helpers/apiFixtures');
const { CAT, importCatalogFixture } = require('../helpers/catalog');

const API_FIX = path.join(__dirname, '..', 'fixtures', 'csgo-api');
const FILES = ['skins', 'stickers', 'crates', 'keychains', 'agents', 'patches'];

beforeEach(() => freshDb());
afterAll(() => closeDb());

function fixtureFetch(overrides = {}) {
  return async (url, opts) => {
    const rel = url.slice(CATALOG_BASE_URL.length);
    if (Object.prototype.hasOwnProperty.call(overrides, rel)) {
      const o = overrides[rel];
      return typeof o === 'function' ? o(url, opts) : o;
    }
    const [lang, file] = rel.split('/');
    if (!require('fs').existsSync(require('path').join(API_FIX, lang))) return { ok: false, status: 404, text: async () => '[]' }; // pasta de idioma não hospedada
    const body = fs.readFileSync(path.join(API_FIX, lang, file), 'utf8');
    return { ok: true, status: 200, text: async () => body };
  };
}
const status = (code) => ({ ok: code >= 200 && code < 300, status: code, text: async () => '[]' });

describe('GET /api/catalog/search: bordas de forma', () => {
  let app;
  beforeEach(() => {
    importCatalogFixture();
    app = makeApp();
  });
  const search = (qs) => request(app).get(`/api/catalog/search?${qs}`);

  test.each(['limit=', 'limit=%205', 'limit=5%20', 'limit=%2B5', 'limit=1e1', 'limit=0x10', 'limit=5.0', 'limit=99999999999999999999', 'limit=5&limit=6'])(
    '%s -> INVALID_QUERY',
    async (qs) => {
      expectError(await search(`q=ak&${qs}`), 400, 'INVALID_QUERY');
    }
  );

  test('limit 1 e 50 são aceitos; zeros à esquerda ("010") valem 10', async () => {
    expect((await search('q=ak&limit=1')).body.data.items).toHaveLength(1);
    expect((await search('q=ak&limit=50')).status).toBe(200);
    expect((await search('q=ak&limit=010')).status).toBe(200);
  });

  test.each(['category=', 'category=skin', 'category=SKIN&category=FACA', 'category=SKIN%20'])(
    '%s -> INVALID_QUERY',
    async (qs) => {
      expectError(await search(`q=ak&${qs}`), 400, 'INVALID_QUERY');
    }
  );

  test('q como objeto (q[a]=b), q vazio e q só com espaços/símbolos -> INVALID_QUERY', async () => {
    for (const qs of ['q[a]=b', 'q=', 'q=%20%20', 'q=%E2%98%85', 'q=%E2%84%A2%20%C2%AE', 'q=%E2%98%85a']) {
      expectError(await search(qs), 400, 'INVALID_QUERY');
    }
  });

  test('q com exatamente 2 caracteres úteis é aceito; símbolos extras não contam', async () => {
    expect((await search('q=ak')).status).toBe(200);
    expect((await search('q=%E2%98%85ak%E2%84%A2')).status).toBe(200);
  });

  test('acentos e maiúsculas codificados na URL; termos repetidos e espaços extras', async () => {
    const res = await search(`q=${encodeURIComponent('  LINHÁ   VERMÉLHA  vermelha ')}`);
    expect(res.body.data.items.map((i) => i.id)).toEqual([CAT.AK_REDLINE]);
  });

  test('★ no termo é descartado: "★ karambit" e "karambit" dão o mesmo resultado', async () => {
    const a = await search(`q=${encodeURIComponent('★ karambit')}`);
    const b = await search('q=karambit');
    expect(a.body.data.items.map((i) => i.id)).toEqual(b.body.data.items.map((i) => i.id));
    expect(a.body.data.meta.total).toBe(4);
  });

  test('categoria + limit: meta.total conta todos, items respeita o limit', async () => {
    const res = await search('q=karambit&category=FACA&limit=2');
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.meta.total).toBe(4);
    expect(res.body.data.meta.catalogUpdatedAt).toBe(Setting.get().catalogUpdatedAt);
  });

  test('só aceita GET: POST /search -> 404 no formato padrão', async () => {
    const res = await request(app).post('/api/catalog/search').send({});
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/catalog/refresh: bordas', () => {
  test('falha só em pt-BR (500) -> 200 com aviso em skippedLanguages; 404 só em pt-BR -> 200 sem aviso', async () => {
    importCatalogFixture();
    const bad = makeApp(NOW, { fetchFn: fixtureFetch({ 'pt-BR/stickers.json': status(500) }) });
    const warned = await request(bad).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({});
    expect(warned.status).toBe(200);
    expect(warned.body.data.skippedLanguages).toEqual([{ language: 'pt-BR', reason: 'CATALOG_FETCH_FAILED' }]);
    const tolerated = makeApp(NOW, { fetchFn: fixtureFetch({ 'pt-BR/stickers.json': status(404) }) });
    const ok = await request(tolerated).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data.catalogUpdatedAt).toBe(NOW.toISOString());
    expect(ok.body.data.skippedLanguages).toEqual([]);
  });

  test('404 no en -> 502; JSON inválido -> 502 CATALOG_INVALID_FORMAT', async () => {
    const a = makeApp(NOW, { fetchFn: fixtureFetch({ 'en/crates.json': status(404) }) });
    expectError(await request(a).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({}), 502, 'CATALOG_FETCH_FAILED');
    const b = makeApp(NOW, { fetchFn: fixtureFetch({ 'en/crates.json': { ok: true, status: 200, text: async () => '<html>' } }) });
    expectError(await request(b).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({}), 502, 'CATALOG_INVALID_FORMAT');
  });

  test('sem corpo é aceito; corpo array -> INVALID_BODY; chave -> UNKNOWN_FIELD e o fetch não é chamado', async () => {
    let calls = 0;
    const fetchFn = async (...a) => {
      calls += 1;
      return fixtureFetch()(...a);
    };
    const app = makeApp(NOW, { fetchFn });
    expectError(await request(app).post('/api/catalog/refresh').set('Content-Type', 'application/json').send([]), 400, 'INVALID_BODY');
    expectError(await request(app).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({ force: true }), 400, 'UNKNOWN_FIELD');
    expect(calls).toBe(0);
    expect((await request(app).post('/api/catalog/refresh').set('Content-Type', 'application/json')).status).toBe(200);
  });

  test('refresh simultâneo pela API: o segundo recebe 409 e depois da conclusão um novo refresh dá 200', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const slow = fixtureFetch({
      'en/skins.json': async (url, opts) => {
        await gate;
        return fixtureFetch()(url, opts);
      },
    });
    const app = makeApp(NOW, { fetchFn: slow });
    const first = request(app).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({}).then((r) => r);
    await new Promise((r) => setTimeout(r, 50));
    expectError(await request(app).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({}), 409, 'CATALOG_REFRESH_IN_PROGRESS');
    release();
    expect((await first).status).toBe(200);
    expect((await request(app).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({})).status).toBe(200);
  });

  test('resposta traz o contrato completo e /status reflete o refresh', async () => {
    const app = makeApp(NOW, { fetchFn: fixtureFetch() });
    const res = await request(app).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({});
    expect(Object.keys(res.body.data).sort()).toEqual(['catalogUpdatedAt', 'countsBySource', 'linkedLegacyItems', 'skipped', 'skippedLanguages', 'total']);
    const st = await request(app).get('/api/catalog/status');
    expect(st.body.data).toEqual({ catalogUpdatedAt: NOW.toISOString(), countsBySource: res.body.data.countsBySource, total: res.body.data.total });
  });

  test('refresh sem catálogo prévio deixa o catálogo utilizável na busca', async () => {
    const app = makeApp(NOW, { fetchFn: fixtureFetch() });
    await request(app).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({});
    const res = await request(app).get('/api/catalog/search').query({ q: 'redline' });
    expect(res.body.data.items.map((i) => i.id)).toEqual(['skin-ak-redline']);
    expect(res.body.data.meta.catalogUpdatedAt).toBe(NOW.toISOString());
  });

  test('refresh com pt-BR em 404 não apaga traduções que já estavam gravadas', async () => {
    importCatalogFixture();
    const app = makeApp(NOW, { fetchFn: fixtureFetch(Object.fromEntries(FILES.map((f) => [`pt-BR/${f}.json`, status(404)]))) });
    await request(app).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({});
    Setting.update({ language: 'pt-BR' });
    const res = await request(app).get('/api/catalog/skin-ak-redline');
    expect(res.body.data.localizedName).toBe('AK-47 | Linha Vermelha');
  });
});

describe('GET /api/catalog/:id e /status: bordas', () => {
  test('id válido de outra caixa não existe (sensível a maiúsculas); existente é devolvido', async () => {
    const app = makeApp();
    importCatalogFixture();
    expectError(await request(app).get('/api/catalog/SKIN-AK-REDLINE'), 404, 'CATALOG_ITEM_NOT_FOUND');
    expect((await request(app).get(`/api/catalog/${CAT.AK_REDLINE}`)).status).toBe(200);
  });

  test('/status com tudo zerado devolve as 5 fontes', async () => {
    const res = await request(makeApp()).get('/api/catalog/status');
    expect(res.body.data).toEqual({
      catalogUpdatedAt: null, countsBySource: { SKINS: 0, STICKERS: 0, CRATES: 0, KEYCHAINS: 0, AGENTS: 0, PATCHES: 0 }, total: 0,
    });
  });
});

describe('PATCH /api/settings: preferências (bordas)', () => {
  const patch = (app, body) => request(app).patch('/api/settings').send(body);

  test.each([
    [{ theme: 1 }, 'INVALID_FIELD'],
    [{ theme: null }, 'INVALID_FIELD'],
    [{ theme: ['DARK'] }, 'INVALID_FIELD'],
    [{ language: false }, 'INVALID_FIELD'],
    [{ language: null }, 'INVALID_FIELD'],
    [{ theme: {} }, 'INVALID_FIELD'],
    [{ theme: 'DARK', language: null }, 'INVALID_FIELD'],
    [{ theme: 'DARK', extra: 1 }, 'UNKNOWN_FIELD'],
    [{ theme: 'DARK', usdBrlRate: 5 }, 'UNKNOWN_FIELD'],
    [{ id: 1 }, 'UNKNOWN_FIELD'],
    [{ updatedAt: 'x' }, 'UNKNOWN_FIELD'],
    [{}, 'INVALID_BODY'],
    [[], 'INVALID_BODY'],
    [[{ theme: 'DARK' }], 'INVALID_BODY'],
    [{ theme: '' }, 'INVALID_THEME'],
    [{ theme: 'light' }, 'INVALID_THEME'],
    [{ theme: ' DARK' }, 'INVALID_THEME'],
    [{ theme: 'SYSTEM ' }, 'INVALID_THEME'],
    [{ language: '' }, 'INVALID_LANGUAGE'],
    [{ language: 'pt-br' }, 'INVALID_LANGUAGE'],
    [{ language: 'PT-BR' }, 'INVALID_LANGUAGE'],
    [{ language: 'pt' }, 'INVALID_LANGUAGE'],
    [{ language: 'EN' }, 'INVALID_LANGUAGE'],
    [{ theme: 'BLUE', language: 'sv' }, 'INVALID_THEME'],
  ])('%j -> %s e nada muda', async (body, code) => {
    const app = makeApp();
    const before = (await request(app).get('/api/settings')).body.data;
    expectError(await patch(app, body), 400, code);
    expect((await request(app).get('/api/settings')).body.data).toEqual(before);
  });

  test('um valor válido com outro inválido não aplica o válido', async () => {
    const app = makeApp();
    expectError(await patch(app, { theme: 'DARK', language: 'sv' }), 400, 'INVALID_LANGUAGE');
    expect((await request(app).get('/api/settings')).body.data.theme).toBe('SYSTEM');
  });

  test('todos os valores permitidos; resposta é Settings completo com updatedAt = relógio injetado', async () => {
    const app = makeApp();
    for (const theme of ['LIGHT', 'DARK', 'SYSTEM']) {
      const res = await patch(app, { theme });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ theme });
      expect(Object.keys(res.body.data).sort()).toEqual(['agingThresholdsAdjusted', 'catalogUpdatedAt', 'displayCurrency', 'fastTurnoverDays', 'fastTurnoverDaysCustom', 'fastTurnoverDaysDefault', 'fxRates', 'fxRefreshSource', 'inventoryView', 'language', 'rateQuotedAt', 'requiredFxCurrencies', 'slowItemDays', 'slowItemDaysCustom', 'slowItemDaysDefault', 'steamStoreId', 'theme', 'updatedAt', 'usdBrlRate', 'usdBrlRateSource', 'usdBrlRateUpdatedAt']);
    }
    for (const language of ['en', 'pt-BR']) {
      expect((await patch(app, { language })).body.data.language).toBe(language);
    }
  });

  test('persistência entre requisições e não altera cotação nem catalogUpdatedAt', async () => {
    const app = makeApp();
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.4 });
    importCatalogFixture();
    const before = (await request(app).get('/api/settings')).body.data;
    await patch(app, { theme: 'DARK', language: 'en' });
    const after = (await request(app).get('/api/settings')).body.data;
    expect(after).toMatchObject({
      theme: 'DARK', language: 'en', usdBrlRate: 5.4, usdBrlRateUpdatedAt: before.usdBrlRateUpdatedAt, catalogUpdatedAt: before.catalogUpdatedAt,
    });
  });

  test('o refresh do catálogo não altera tema nem idioma', async () => {
    const app = makeApp(NOW, { fetchFn: fixtureFetch() });
    await patch(app, { theme: 'LIGHT', language: 'en' });
    await request(app).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({});
    expect((await request(app).get('/api/settings')).body.data).toMatchObject({ theme: 'LIGHT', language: 'en', catalogUpdatedAt: NOW.toISOString() });
  });

  test('JSON malformado no PATCH -> 400 no formato padrão', async () => {
    const res = await request(makeApp()).patch('/api/settings').set('Content-Type', 'application/json').send('{"theme":');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: expect.any(String) } });
  });
});
