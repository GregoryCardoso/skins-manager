'use strict';

// Segurança local: CSRF (Content-Type obrigatório em escritas), DNS rebinding (Host), CORS e débitos da revisão da Etapa 6.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const Database = require('better-sqlite3');
const { closeDb, getDb, inspectDatabaseFile } = require('../../src/config/database');
const Item = require('../../src/models/Item');
const settingsService = require('../../src/services/settingsService');
const { freshDb, wonSkin, storeIdByName } = require('../helpers/fixtures');
const { makeCatalogApp, purchaseBody, createItemViaApi, expectError, NOW } = require('../helpers/apiFixtures');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const JSON_TYPE = 'application/json';
const itemsCount = () => getDb().prepare('SELECT COUNT(*) AS n FROM items').get().n;
const snapshot = () =>
  JSON.stringify(getDb().prepare('SELECT * FROM stores').all()) + JSON.stringify(getDb().prepare('SELECT * FROM settings').all());

describe('CSRF: POST/PATCH/PUT exigem Content-Type JSON', () => {
  test('unsell sem Content-Type e com text/plain -> 415 e a venda continua', async () => {
    const app = makeCatalogApp();
    const item = await createItemViaApi(app);
    await request(app).post(`/api/items/${item.id}/sell`).set('Content-Type', JSON_TYPE)
      .send({ saleStoreId: storeIdByName('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z' })
      .expect(200);
    expectError(await request(app).post(`/api/items/${item.id}/unsell`), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(
      await request(app).post(`/api/items/${item.id}/unsell`).set('Content-Type', 'text/plain').send('{}'),
      415, 'UNSUPPORTED_MEDIA_TYPE'
    );
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.status).toBe('VENDIDO');
    await request(app).post(`/api/items/${item.id}/unsell`).set('Content-Type', JSON_TYPE).expect(200);
  });

  test.each([
    ['post', '/api/items'],
    ['patch', '/api/items/1'],
    ['post', '/api/items/1/sell'],
    ['post', '/api/items/1/unsell'],
    ['post', '/api/stores'],
    ['patch', '/api/stores/1'],
    ['patch', '/api/settings'],
    ['put', '/api/settings/fx-rate'],
    ['post', '/api/settings/fx-rate/refresh'],
    ['post', '/api/catalog/refresh'],
  ])('%s %s sem Content-Type e com text/plain -> 415 sem alterar o banco', async (method, url) => {
    const app = makeCatalogApp();
    const before = snapshot();
    expectError(await request(app)[method](url), 415, 'UNSUPPORTED_MEDIA_TYPE');
    const res = await request(app)[method](url).set('Content-Type', 'text/plain').send(JSON.stringify(purchaseBody()));
    expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(itemsCount()).toBe(0);
    expect(snapshot()).toBe(before);
  });

  test('import de backup continua exigindo application/octet-stream', async () => {
    const app = makeCatalogApp();
    expectError(
      await request(app).post('/api/backup/import').set('Content-Type', JSON_TYPE).send({}),
      415, 'UNSUPPORTED_MEDIA_TYPE'
    );
  });

  test('DELETE não exige Content-Type (protegido por preflight de CORS)', async () => {
    const app = makeCatalogApp();
    const item = await createItemViaApi(app);
    expect((await request(app).delete(`/api/items/${item.id}`)).status).toBe(200);
  });
});

describe('CORS', () => {
  test('origem desconhecida não recebe Access-Control-Allow-Origin, inclusive no preflight de DELETE', async () => {
    const app = makeCatalogApp();
    const bad = await request(app).options('/api/items/1').set('Origin', 'https://evil.com')
      .set('Access-Control-Request-Method', 'DELETE');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const good = await request(app).options('/api/items/1').set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'DELETE');
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });
});

describe('DNS rebinding: Host', () => {
  const app = makeCatalogApp();

  test.each(['evil.com', 'evil.com:3001', 'localhost.evil.com', 'localhost.evil.com:3001', '127.0.0.1.evil.com', '[::1]:3001'])(
    'Host %p -> 403 FORBIDDEN_HOST',
    async (host) => {
      expectError(await request(app).get('/api/health').set('Host', host), 403, 'FORBIDDEN_HOST');
    }
  );

  test.each(['localhost', 'localhost:3001', '127.0.0.1', '127.0.0.1:3001', 'LOCALHOST:3000'])('Host %p passa', async (host) => {
    expect((await request(app).get('/api/health').set('Host', host)).status).toBe(200);
  });

  test('vale também para rotas de escrita e para o frontend estático', async () => {
    expectError(await request(app).get('/').set('Host', 'evil.com'), 403, 'FORBIDDEN_HOST');
    expectError(
      await request(app).post('/api/items').set('Host', 'evil.com').set('Content-Type', JSON_TYPE).send({}),
      403, 'FORBIDDEN_HOST'
    );
  });
});

describe('T27: candidatos do histórico com "|" no nome e na fase', () => {
  test('Item.findStatsCandidates não interpreta "|"', () => {
    const a = Item.create(wonSkin({ name: 'Foo | Bar | Baz', phase: 'Fase | 1' }));
    Item.create(wonSkin({ name: 'Foo | Qux' }));
    expect(Item.findStatsCandidates({ category: 'SKIN', name: 'Foo | Bar | Baz' }).map((i) => i.id)).toEqual([a.id]);
  });

  test('GET /items/:id e /items/stats agrupam corretamente', async () => {
    const app = makeCatalogApp();
    const mk = (extra) => Item.create(wonSkin({ name: 'Foo | Bar | Baz', exterior: 'FT', phase: 'Fase | 1', ...extra }));
    const a = mk({});
    mk({});
    mk({ phase: 'Fase | 2' });
    const view = await request(app).get(`/api/items/${a.id}`);
    expect(view.body.data.stats.unitCount).toBe(2);
    const stats = await request(app).get('/api/items/stats').query({
      name: 'Foo | Bar | Baz', category: 'SKIN', variant: 'NORMAL', exterior: 'FT', phase: 'Fase | 1',
    });
    expect(stats.status).toBe(200);
    expect(stats.body.data.unitCount).toBe(2);
  });
});

describe('Menores da revisão', () => {
  test('PUT /fx-rate durante refresh em andamento -> 409 FX_REFRESH_IN_PROGRESS', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetchFn = async () => {
      await gate;
      return { ok: false, status: 503, text: async () => '' };
    };
    const app = makeCatalogApp(NOW, { fetchFn });
    const first = request(app).post('/api/settings/fx-rate/refresh').set('Content-Type', JSON_TYPE).send({}).then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settingsService.isFxRefreshInProgress()).toBe(true);
    const put = await request(app).put('/api/settings/fx-rate').set('Content-Type', JSON_TYPE).send({ usdBrlRate: 5 });
    expectError(put, 409, 'FX_REFRESH_IN_PROGRESS');
    expect((await request(app).get('/api/settings')).body.data.usdBrlRate).toBeNull();
    release();
    await first;
    expect(settingsService.isFxRefreshInProgress()).toBe(false);
    expect((await request(app).put('/api/settings/fx-rate').set('Content-Type', JSON_TYPE).send({ usdBrlRate: 5 })).status).toBe(200);
  });

  test('banco legado sem loja principal: loja criada ou ativada vira a principal', async () => {
    const app = makeCatalogApp();
    const clearPrimary = () => getDb().prepare('UPDATE stores SET is_primary = 0').run();
    clearPrimary();
    const created = await request(app).post('/api/stores').set('Content-Type', JSON_TYPE).send({ name: 'Nova', currency: 'USD' });
    expect(created.status).toBe(201);
    expect(created.body.data.isPrimary).toBe(true);

    const id = storeIdByName('Steam');
    await request(app).patch(`/api/stores/${id}`).set('Content-Type', JSON_TYPE).send({ isActive: false }).expect(200);
    clearPrimary();
    const activated = await request(app).patch(`/api/stores/${id}`).set('Content-Type', JSON_TYPE).send({ isActive: true });
    expect(activated.status).toBe(200);
    expect(activated.body.data.isPrimary).toBe(true);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM stores WHERE is_primary = 1').get().n).toBe(1);
  });

  test('inspectDatabaseFile não deixa -wal/-shm de um arquivo em modo WAL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-inspect-'));
    try {
      const file = path.join(dir, 'x.sqlite');
      const db = new Database(file);
      db.pragma('journal_mode = WAL');
      db.exec('CREATE TABLE t (a)');
      db.close();
      expect(inspectDatabaseFile(file).quickCheck).toBe('ok');
      expect(fs.readdirSync(dir)).toEqual(['x.sqlite']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
