'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { CATALOG_BASE_URL } = require('../../src/config/constants');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, NOW, expectError } = require('../helpers/apiFixtures');
const { CAT, importCatalogFixture } = require('../helpers/catalog');

const API_FIX = path.join(__dirname, '..', 'fixtures', 'csgo-api');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const search = (app, params) => request(app).get('/api/catalog/search').query(params);
const ids = (res) => res.body.data.items.map((i) => i.id);

function fixtureFetch(overrides = {}) {
  return async (url) => {
    const rel = url.slice(CATALOG_BASE_URL.length);
    if (overrides[rel]) return overrides[rel];
    const [lang, file] = rel.split('/');
    const body = fs.readFileSync(path.join(API_FIX, lang, file), 'utf8');
    return { ok: true, status: 200, text: async () => body };
  };
}

describe('GET /api/catalog/search', () => {
  let app;
  beforeEach(() => {
    importCatalogFixture();
    app = makeApp();
  });

  test.each([
    ['sem q', {}],
    ['q com 1 caractere', { q: 'a' }],
    ['q só com símbolos que somem na normalização', { q: '★™' }],
    ['q em branco', { q: '   ' }],
    ['q repetido (array)', 'q=ak&q=red'],
    ['limit 0', { q: 'ak', limit: '0' }],
    ['limit 51', { q: 'ak', limit: '51' }],
    ['limit abc', { q: 'ak', limit: 'abc' }],
    ['limit negativo', { q: 'ak', limit: '-1' }],
    ['limit decimal', { q: 'ak', limit: '1.5' }],
    ['categoria inválida', { q: 'ak', category: 'ARMA' }],
  ])('%s -> INVALID_QUERY', async (_name, params) => {
    const req = request(app).get('/api/catalog/search');
    expectError(await (typeof params === 'string' ? req.query(params) : req.query(params)), 400, 'INVALID_QUERY');
  });

  test('"ak red" acha "AK-47 | Redline" com o contrato completo', async () => {
    const res = await search(app, { q: 'ak red' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([
      {
        id: 'skin-ak-redline', source: 'SKINS', category: 'SKIN', name: 'AK-47 | Redline', namePtBr: 'AK-47 | Linha Vermelha',
        imageUrl: 'https://img.test/skin-ak-redline.png', minFloat: 0.1, maxFloat: 0.7, hasStattrak: true, hasSouvenir: false,
        phase: null, rarity: 'Classified',
      },
    ]);
    expect(res.body.data.meta).toEqual({ catalogUpdatedAt: '2026-11-01T00:00:00.000Z', total: 1 });
  });

  test('acha pelo nome em pt-BR, ignorando maiúsculas, acentos e ★', async () => {
    expect(ids(await search(app, { q: 'LINHA Vermelhá' }))).toEqual([CAT.AK_REDLINE]);
    expect(ids(await search(app, { q: 'faca karambit' }))).toEqual([CAT.KARAMBIT_VANILLA]);
    expect(ids(await search(app, { q: 'adesivo titan' }))).toEqual([CAT.STICKER_TITAN]);
    expect(ids(await search(app, { q: '★ KARAMBIT | fade' }))).toEqual([CAT.KARAMBIT_FADE]);
    expect(ids(await search(app, { q: 'pingente' }))).toEqual([CAT.CHARM_LIL_AVA]);
  });

  test('fases aparecem como entradas separadas', async () => {
    const res = await search(app, { q: 'karambit doppler' });
    expect(ids(res).sort()).toEqual([CAT.KARAMBIT_DOPPLER_P1, CAT.KARAMBIT_DOPPLER_P2]);
    expect(res.body.data.items.map((i) => i.phase).sort()).toEqual(['Phase 1', 'Phase 2']);
  });

  test('% e _ são literais', async () => {
    expect(ids(await search(app, { q: '%%' })).length).toBe(0);
    expect(ids(await search(app, { q: '__' })).length).toBe(0);
    expect((await search(app, { q: 'ak%' })).body.data.meta.total).toBe(0);
  });

  test('filtro de categoria, limit e meta.total antes do limit', async () => {
    const byCat = await search(app, { q: 'karambit', category: 'FACA' });
    expect(byCat.body.data.items.every((i) => i.category === 'FACA')).toBe(true);
    expect(byCat.body.data.meta.total).toBe(4);
    expect(ids(await search(app, { q: 'karambit', category: 'SKIN' }))).toEqual([]);
    const limited = await search(app, { q: 'karambit', limit: '2' });
    expect(limited.body.data.items).toHaveLength(2);
    expect(limited.body.data.meta.total).toBe(4);
  });

  test('ordenação: nome que começa com o termo vem antes, depois o mais curto', async () => {
    const res = await search(app, { q: 'karambit' });
    expect(res.body.data.items[0].name).toBe('★ Karambit');
  });

  test('sem resultado -> lista vazia e total 0', async () => {
    const res = await search(app, { q: 'zzzzzz' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ items: [], meta: { catalogUpdatedAt: '2026-11-01T00:00:00.000Z', total: 0 } });
  });

  test('catálogo vazio -> lista vazia e catalogUpdatedAt nulo', async () => {
    freshDb();
    const res = await search(makeApp(NOW), { q: 'ak' });
    expect(res.body.data).toEqual({ items: [], meta: { catalogUpdatedAt: null, total: 0 } });
  });
});

describe('GET /api/catalog/:id e /status', () => {
  let app;
  beforeEach(() => {
    importCatalogFixture();
    app = makeApp();
  });

  test('devolve o item', async () => {
    const res = await request(app).get(`/api/catalog/${CAT.KARAMBIT_DOPPLER_P2}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: CAT.KARAMBIT_DOPPLER_P2, category: 'FACA', phase: 'Phase 2', name: '★ Karambit | Doppler' });
    expect(Object.keys(res.body.data).sort()).toEqual(
      ['category', 'hasSouvenir', 'hasStattrak', 'id', 'imageUrl', 'maxFloat', 'minFloat', 'name', 'namePtBr', 'phase', 'rarity', 'source']
    );
  });

  test('inexistente -> 404 CATALOG_ITEM_NOT_FOUND', async () => {
    expectError(await request(app).get('/api/catalog/nao-existe'), 404, 'CATALOG_ITEM_NOT_FOUND');
  });

  test.each(['a b', 'a.b', 'a%2Fb', 'x'.repeat(101)])('id inválido %p -> INVALID_ID', async (id) => {
    expectError(await request(app).get(`/api/catalog/${id}`), 400, 'INVALID_ID');
  });

  test('id com 100 caracteres válidos é aceito (404 por não existir)', async () => {
    expectError(await request(app).get(`/api/catalog/${'x'.repeat(100)}`), 404, 'CATALOG_ITEM_NOT_FOUND');
  });

  test('/status vem antes de /:id e traz contagens', async () => {
    const res = await request(app).get('/api/catalog/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      catalogUpdatedAt: '2026-11-01T00:00:00.000Z',
      countsBySource: { SKINS: 12, STICKERS: 2, CRATES: 5, KEYCHAINS: 1, AGENTS: 1 },
      total: 21,
    });
  });

  test('/status com catálogo vazio', async () => {
    freshDb();
    const res = await request(makeApp(NOW)).get('/api/catalog/status');
    expect(res.body.data).toEqual({
      catalogUpdatedAt: null, countsBySource: { SKINS: 0, STICKERS: 0, CRATES: 0, KEYCHAINS: 0, AGENTS: 0 }, total: 0,
    });
  });
});

describe('POST /api/catalog/refresh', () => {
  test('sucesso com fetchFn injetado e relógio injetado', async () => {
    const app = makeApp(NOW, { fetchFn: fixtureFetch() });
    const res = await request(app).post('/api/catalog/refresh');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      catalogUpdatedAt: NOW.toISOString(),
      countsBySource: { SKINS: 8, STICKERS: 2, CRATES: 9, KEYCHAINS: 1, AGENTS: 1 },
      total: 21,
      skipped: 3,
      linkedLegacyItems: 0,
    });
    expect((await request(app).get('/api/catalog/skin-ak-redline')).body.data.namePtBr).toBe('AK-47 | Linha Vermelha');
  });

  test('corpo {} é aceito', async () => {
    const res = await request(makeApp(NOW, { fetchFn: fixtureFetch() })).post('/api/catalog/refresh').send({});
    expect(res.status).toBe(200);
  });

  test('corpo com chave -> UNKNOWN_FIELD; corpo não objeto -> INVALID_BODY', async () => {
    const app = makeApp(NOW, { fetchFn: fixtureFetch() });
    expectError(await request(app).post('/api/catalog/refresh').send({ force: true }), 400, 'UNKNOWN_FIELD');
    expectError(await request(app).post('/api/catalog/refresh').send([]), 400, 'INVALID_BODY');
  });

  test('falha do download -> 502 CATALOG_FETCH_FAILED e catálogo intacto', async () => {
    importCatalogFixture();
    const fetchFn = fixtureFetch({ 'en/skins.json': { ok: false, status: 500, text: async () => '' } });
    const app = makeApp(NOW, { fetchFn });
    const res = await request(app).post('/api/catalog/refresh');
    expectError(res, 502, 'CATALOG_FETCH_FAILED');
    expect(res.body.error.message).toBe('Não foi possível baixar o catálogo. Verifique a conexão com a internet.');
    expect((await request(app).get('/api/catalog/status')).body.data.total).toBe(21);
  });

  test('rede caindo e JSON inválido -> 502', async () => {
    const down = makeApp(NOW, { fetchFn: async () => { throw new TypeError('fetch failed'); } });
    expectError(await request(down).post('/api/catalog/refresh'), 502, 'CATALOG_FETCH_FAILED');
    const bad = makeApp(NOW, { fetchFn: fixtureFetch({ 'en/agents.json': { ok: true, status: 200, text: async () => 'oi' } }) });
    expectError(await request(bad).post('/api/catalog/refresh'), 502, 'CATALOG_INVALID_FORMAT');
  });

  test('atualização simultânea -> 409 CATALOG_REFRESH_IN_PROGRESS', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const base = fixtureFetch();
    const slowFetch = async (url, opts) => {
      if (url.endsWith('en/skins.json')) await gate;
      return base(url, opts);
    };
    const app = makeApp(NOW, { fetchFn: slowFetch });
    const first = request(app).post('/api/catalog/refresh').then((r) => r);
    // espera a primeira chegar ao serviço
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = await request(makeApp(NOW, { fetchFn: base })).post('/api/catalog/refresh');
    expectError(second, 409, 'CATALOG_REFRESH_IN_PROGRESS');
    release();
    expect((await first).status).toBe(200);
  });

  test('sem fetchFn injetado usa o fetch global (aqui simulado, sem rede)', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = fixtureFetch();
    try {
      const res = await request(makeApp()).post('/api/catalog/refresh');
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('errorHandler com UpstreamError', () => {
  test('502 mantém code e message do erro', async () => {
    const { UpstreamError } = require('../../src/errors/AppError');
    const e = new UpstreamError('falhou', 'X_FAILED');
    expect(e).toMatchObject({ status: 502, code: 'X_FAILED', name: 'UpstreamError' });
  });
});
