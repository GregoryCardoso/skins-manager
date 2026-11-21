'use strict';

// Varredura de rotas e matriz de cabeçalhos: regressão de CSRF (Content-Type), CORS e hostGuard para rotas futuras.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb, storeIdByName } = require('../helpers/fixtures');
const { makeCatalogApp, createItemViaApi, expectError, NOW } = require('../helpers/apiFixtures');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const JSON_TYPE = 'application/json';
const WRITE = ['post', 'patch', 'put'];

// Percorre o router do Express 5 acumulando o caminho (`rawPath` das camadas montadas).
function collectRoutes(stack, prefix = '', out = []) {
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) out.push({ method, path: (prefix + layer.route.path).replace(/(.)\/$/, '$1') });
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      const raw = typeof layer.rawPath === 'string' && layer.rawPath !== '/' ? layer.rawPath : '';
      collectRoutes(layer.handle.stack, prefix + raw, out);
    }
  }
  return out;
}
const appRoutes = (app) => collectRoutes(app.router.stack);
const concrete = (p) => p.replace(/:\w+/g, '1');

describe('varredura: toda rota de escrita exige Content-Type', () => {
  const routes = appRoutes(createApp());
  const writes = routes.filter((r) => WRITE.includes(r.method));

  test('a varredura encontra as rotas conhecidas (sanidade)', () => {
    const keys = writes.map((r) => `${r.method} ${r.path}`);
    expect(keys).toEqual(expect.arrayContaining([
      'post /api/items', 'patch /api/items/:id', 'post /api/items/:id/sell', 'post /api/items/:id/unsell',
      'post /api/stores', 'patch /api/stores/:id', 'patch /api/settings', 'put /api/settings/fx-rate',
      'post /api/settings/fx-rate/refresh', 'post /api/catalog/refresh', 'post /api/backup/import',
    ]));
    expect(writes.length).toBeGreaterThanOrEqual(11);
  });

  test('toda rota de escrita responde 415 sem o tipo certo (backup: só octet-stream)', async () => {
    const app = makeCatalogApp();
    const failures = [];
    for (const { method, path: p } of writes) {
      const url = concrete(p);
      const isBackup = p === '/api/backup/import';
      const attempts = [
        (r) => r,
        (r) => r.set('Content-Type', 'text/plain').send('{}'),
        (r) => r.set('Content-Type', 'application/x-www-form-urlencoded').send('a=1'),
        (r) => r.set('Content-Type', 'multipart/form-data; boundary=x').send('--x--'),
        ...(isBackup ? [(r) => r.set('Content-Type', JSON_TYPE).send({})] : []),
      ];
      for (const attempt of attempts) {
        const res = await attempt(request(app)[method](url));
        if (res.status !== 415 || res.body.error.code !== 'UNSUPPORTED_MEDIA_TYPE') failures.push(`${method} ${p} -> ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('o import de backup aceita octet-stream (não é 415)', async () => {
    const res = await request(makeCatalogApp()).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(Buffer.from('x'));
    expect(res.status).not.toBe(415); // banco :memory: responde 409; o fluxo de arquivo é coberto em tests/backup
  });

  test('só existem métodos conhecidos (um método novo exige revisar a varredura)', () => {
    for (const m of new Set(routes.map((r) => r.method))) expect(['get', 'post', 'patch', 'put', 'delete', 'head']).toContain(m);
  });
});

describe('formatos de Content-Type', () => {
  const send = (app, type) => {
    const r = request(app).patch('/api/settings');
    return r.set('Content-Type', type).send(type.toLowerCase().startsWith('application/json') ? '{"language":"en"}' : 'x');
  };

  test.each(['application/json', 'application/json; charset=utf-8', 'APPLICATION/JSON', 'application/json;charset=UTF-8'])(
    '%p passa',
    async (type) => {
      expect((await send(makeCatalogApp(), type)).status).toBe(200);
    }
  );

  test.each([
    'application/jsonx',
    'application/json-patch+json',
    'multipart/form-data; boundary=x',
    'application/x-www-form-urlencoded',
    'text/plain',
    'text/plain; application/json',
    'application/xjson',
  ])('%p -> 415', async (type) => {
    expectError(await send(makeCatalogApp(), type), 415, 'UNSUPPORTED_MEDIA_TYPE');
  });
});

describe('CORS: preflight', () => {
  test.each([['DELETE', '/api/items/1'], ['PATCH', '/api/items/1'], ['PUT', '/api/settings/fx-rate'], ['POST', '/api/stores']])(
    'OPTIONS %s com Origin hostil não recebe Allow-Origin; origem local recebe',
    async (method, url) => {
      const app = makeCatalogApp();
      for (const origin of ['http://evil.com', 'http://localhost:3001.evil.com', 'null']) {
        const res = await request(app).options(url).set('Origin', origin).set('Access-Control-Request-Method', method);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      }
      const good = await request(app).options(url).set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', method);
      expect(good.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(good.headers['access-control-allow-methods']).toMatch(new RegExp(method));
    }
  );

  test('requisição real com Origin hostil não recebe Allow-Origin', async () => {
    const res = await request(makeCatalogApp()).get('/api/health').set('Origin', 'http://evil.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('hostGuard', () => {
  let app;
  beforeEach(() => {
    app = makeCatalogApp();
  });

  test.each([
    '127.0.0.1.evil.com', 'localhost:abc', 'localhost:123456', 'localhost:', '0.0.0.0', '0.0.0.0:3001', '[::1]:3001', '[::1]',
    'evil.com', 'localhost@evil.com', 'localhost:3001.evil.com', 'localhost evil.com', '127.0.0.1:3001:1',
  ])('Host %p -> 403 FORBIDDEN_HOST (envelope padrão)', async (host) => {
    expectError(await request(app).get('/api/health').set('Host', host), 403, 'FORBIDDEN_HOST');
  });

  test('Host vazio -> 403', async () => {
    expectError(await request(app).get('/api/health').set('Host', ''), 403, 'FORBIDDEN_HOST');
  });

  test.each(['LOCALHOST:3001', 'LocalHost', 'localhost:1', 'localhost:65535', '127.0.0.1:99999', 'localhost:8080'])(
    'Host %p passa (qualquer porta de até 5 dígitos, sem diferenciar maiúsculas)',
    async (host) => {
      expect((await request(app).get('/api/health').set('Host', host)).status).toBe(200);
    }
  );

  test('Host ausente (HTTP/1.0 sem Host) -> 403', async () => {
    const server = http.createServer(app).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const raw = await new Promise((resolve, reject) => {
      const sock = net.connect(server.address().port, '127.0.0.1', () => sock.write('GET /api/health HTTP/1.0\r\n\r\n'));
      let data = '';
      sock.on('data', (d) => { data += d; });
      sock.on('end', () => resolve(data));
      sock.on('error', reject);
    });
    server.close();
    expect(raw).toMatch(/^HTTP\/1\.1 403/);
    expect(raw).toMatch(/FORBIDDEN_HOST/);
  });

  test('cobre /api/health, /api/backup/export, escrita, rota inexistente e estáticos', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-static-'));
    try {
      fs.writeFileSync(path.join(dir, 'index.html'), '<html>ok</html>');
      const withStatic = createApp({ now: () => new Date(NOW.getTime()), staticDir: dir });
      expect((await request(withStatic).get('/')).status).toBe(200);
      for (const [method, url] of [
        ['get', '/'], ['get', '/index.html'], ['get', '/api/health'], ['get', '/api/backup/export'], ['get', '/api/nope'],
        ['get', '/api/items'], ['delete', '/api/items/1'], ['post', '/api/backup/import'],
      ]) {
        expectError(await request(withStatic)[method](url).set('Host', 'evil.com'), 403, 'FORBIDDEN_HOST');
      }
      const exp = await request(withStatic).get('/api/backup/export').set('Host', 'evil.com');
      expect(exp.headers['content-disposition']).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('o 403 não vaza CORS para a origem hostil e não altera o banco', async () => {
    const item = await createItemViaApi(app);
    const res = await request(app).delete(`/api/items/${item.id}`).set('Host', 'evil.com').set('Origin', 'http://evil.com');
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect((await request(app).get(`/api/items/${item.id}`)).status).toBe(200);
  });
});

describe('unsell com JSON {}', () => {
  test('{} e JSON sem corpo funcionam', async () => {
    const app = makeCatalogApp();
    const item = await createItemViaApi(app);
    const sell = () => request(app).post(`/api/items/${item.id}/sell`)
      .send({ saleStoreId: storeIdByName('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z' });
    await sell().expect(200);
    expect((await request(app).post(`/api/items/${item.id}/unsell`).send({})).status).toBe(200);
    await sell().expect(200);
    expect((await request(app).post(`/api/items/${item.id}/unsell`).set('Content-Type', JSON_TYPE)).status).toBe(200);
  });
});

describe('loja principal em banco sem principal', () => {
  const noPrimary = () => getDb().prepare('UPDATE stores SET is_primary = 0').run();
  const primaries = () => getDb().prepare('SELECT COUNT(*) AS n FROM stores WHERE is_primary = 1').get().n;

  test('criar loja INATIVA não a torna principal; a primeira ATIVA depois vira principal', async () => {
    const app = makeCatalogApp();
    noPrimary();
    const inactive = await request(app).post('/api/stores').send({ name: 'Dormente', currency: 'USD', isActive: false });
    expect(inactive.status).toBe(201);
    expect(inactive.body.data.isPrimary).toBe(false);
    expect(primaries()).toBe(0);
    const active = await request(app).post('/api/stores').send({ name: 'Ativa', currency: 'USD' });
    expect(active.body.data.isPrimary).toBe(true);
    expect(primaries()).toBe(1);
  });

  test('criar INATIVA com isPrimary:true segue recusada (PRIMARY_STORE_INACTIVE)', async () => {
    const app = makeCatalogApp();
    noPrimary();
    const res = await request(app).post('/api/stores').send({ name: 'X', currency: 'USD', isActive: false, isPrimary: true });
    expect(res.body.error.code).toBe('PRIMARY_STORE_INACTIVE');
    expect(primaries()).toBe(0);
  });

  test('com principal existente, criar/reativar loja não troca a principal', async () => {
    const app = makeCatalogApp();
    const before = getDb().prepare('SELECT id FROM stores WHERE is_primary = 1').get().id;
    await request(app).post('/api/stores').send({ name: 'Outra', currency: 'USD' }).expect(201);
    const other = getDb().prepare('SELECT id FROM stores WHERE is_primary = 0 LIMIT 1').get().id;
    await request(app).patch(`/api/stores/${other}`).send({ isActive: false }).expect(200);
    await request(app).patch(`/api/stores/${other}`).send({ isActive: true }).expect(200);
    expect(getDb().prepare('SELECT id FROM stores WHERE is_primary = 1').get().id).toBe(before);
    expect(primaries()).toBe(1);
  });

  test('reativar loja em banco sem principal a torna principal', async () => {
    const app = makeCatalogApp();
    const target = getDb().prepare('SELECT id FROM stores WHERE is_primary = 0 LIMIT 1').get().id;
    await request(app).patch(`/api/stores/${target}`).send({ isActive: false }).expect(200);
    noPrimary();
    const res = await request(app).patch(`/api/stores/${target}`).send({ isActive: true });
    expect(res.body.data.isPrimary).toBe(true);
  });

  test('editar uma loja ATIVA já existente (sem mudar isActive) em banco sem principal não a promove', async () => {
    const app = makeCatalogApp();
    noPrimary();
    const target = getDb().prepare('SELECT id FROM stores WHERE is_active = 1 LIMIT 1').get().id;
    const res = await request(app).patch(`/api/stores/${target}`).send({ name: 'Renomeada' });
    expect(res.status).toBe(200);
    expect(res.body.data.isPrimary).toBe(false);
  });
});
