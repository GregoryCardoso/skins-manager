const express = require('express');
const request = require('supertest');
const app = require('../../src/app');
const { closeDb } = require('../../src/config/database');
const { errorHandler, notFoundHandler } = require('../../src/middlewares/errorHandler');

afterAll(() => closeDb());

function buildApp(thrower) {
  const a = express();
  a.use(express.json());
  a.get('/boom', (req, res, next) => thrower(next));
  a.get('/boom-async', async () => {
    const err = new Error('falhou async');
    err.status = 409;
    err.code = 'CONFLICT';
    throw err;
  });
  a.use(notFoundHandler);
  a.use(errorHandler);
  return a;
}

function expectErrorShape(body, code) {
  expect(body).toEqual({ success: false, error: { code, message: expect.any(String) } });
  expect(body.error.message.length).toBeGreaterThan(0);
}

describe('errorHandler (app real)', () => {
  test('GET /api/health no formato padrão', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok', timestamp: expect.any(String), app: 'skins-manager', version: expect.any(String) } });
    expect(new Date(res.body.data.timestamp).toISOString()).toBe(res.body.data.timestamp);
  });

  test('rota inexistente → 404 NOT_FOUND "Rota não encontrada"', async () => {
    const res = await request(app).post('/api/inexistente');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } });
  });

  test('JSON malformado → 400 INVALID_JSON', async () => {
    const res = await request(app).post('/api/qualquer').set('Content-Type', 'application/json').send('{"a":');
    expect(res.status).toBe(400);
    expectErrorShape(res.body, 'INVALID_JSON');
  });

  test.each(['http://localhost:3000', 'http://127.0.0.1:3000'])('CORS libera a origem %s', async (origin) => {
    const res = await request(app).get('/api/health').set('Origin', origin);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  test('CORS não libera origem não permitida', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://evil.example:3000');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('CORS responde ao preflight PATCH com JSON para 127.0.0.1', async () => {
    const res = await request(app).options('/api/settings')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3000');
    expect(res.headers['access-control-allow-methods']).toMatch(/PATCH/);
  });

  test.each(['http://localhost:3000', 'http://127.0.0.1:3000'])('preflight PATCH com Content-Type para %s', async (origin) => {
    const res = await request(app).options('/api/settings')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    expect(res.headers['access-control-allow-methods']).toMatch(/PATCH/);
    expect(res.headers['access-control-allow-headers']).toMatch(/content-type/i);
  });

  test('preflight de origem não permitida não recebe Allow-Origin', async () => {
    const res = await request(app).options('/api/settings')
      .set('Origin', 'http://evil.example:3000')
      .set('Access-Control-Request-Method', 'PATCH');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('sem cabeçalho Origin não há Allow-Origin e a resposta é normal', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('porta/esquema diferentes não são aceitos', async () => {
    for (const origin of ['http://localhost:3001', 'https://localhost:3000', 'http://localhost']) {
      const res = await request(app).get('/api/health').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});

describe('CORS com CORS_ORIGIN em lista (app real recarregado)', () => {
  function loadAppWith(corsOrigin) {
    const previous = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = corsOrigin;
    let loaded;
    jest.isolateModules(() => {
      loaded = require('../../src/app');
    });
    process.env.CORS_ORIGIN = previous;
    return loaded;
  }

  test('lista com espaços, barra final e itens vazios', async () => {
    const a = loadAppWith(' http://a.test:1/ , http://b.test:2,, ');
    for (const origin of ['http://a.test:1', 'http://b.test:2']) {
      const res = await request(a).get('/api/health').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    }
    // com lista explícita, as origens padrão deixam de valer
    const res = await request(a).get('/api/health').set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('só vírgulas/espaços cai no padrão', async () => {
    const a = loadAppWith(' , ,');
    const res = await request(a).get('/api/health').set('Origin', 'http://127.0.0.1:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3000');
  });
});

describe('errorHandler (app de teste)', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  test('erro inesperado → 500 INTERNAL_ERROR sem stack nem mensagem interna', async () => {
    const a = buildApp((next) => next(new Error('segredo interno SQLITE_xyz')));
    const res = await request(a).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' } });
    expect(JSON.stringify(res.body)).not.toMatch(/segredo|stack|at /);
  });

  test('erro com status e code próprios é respeitado', async () => {
    const a = buildApp((next) => {
      const err = new Error('Item não encontrado');
      err.status = 404;
      err.code = 'ITEM_NOT_FOUND';
      next(err);
    });
    const res = await request(a).get('/boom');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: { code: 'ITEM_NOT_FOUND', message: 'Item não encontrado' } });
  });

  test('erro lançado em handler async (Express 5) também é tratado', async () => {
    const res = await request(buildApp(() => {})).get('/boom-async');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: { code: 'CONFLICT', message: 'falhou async' } });
  });

  test('code SQLITE_CONSTRAINT* sem status → 409 CONSTRAINT_VIOLATION (D48)', async () => {
    const a = buildApp((next) => next(Object.assign(new Error('x'), { code: 'SQLITE_CONSTRAINT_CHECK' })));
    const res = await request(a).get('/boom');
    expect(res.status).toBe(409);
    expectErrorShape(res.body, 'CONSTRAINT_VIOLATION');
  });

  test('status fora de 4xx/5xx ou code não-string → 500', async () => {
    const a1 = buildApp((next) => next(Object.assign(new Error('x'), { status: 200, code: 'OK' })));
    const a3 = buildApp((next) => next(Object.assign(new Error('x'), { code: 123 })));
    for (const a of [a1, a3]) {
      const res = await request(a).get('/boom');
      expect(res.status).toBe(500);
      expectErrorShape(res.body, 'INTERNAL_ERROR');
    }
  });

  test('4xx sem code string próprio → BAD_REQUEST genérico (413/415 específicos)', async () => {
    const a = buildApp((next) => next(Object.assign(new Error('x'), { status: 400, code: 123 })));
    const res = await request(a).get('/boom');
    expect(res.status).toBe(400);
    expectErrorShape(res.body, 'BAD_REQUEST');
    const r413 = await request(buildApp((next) => next(Object.assign(new Error('x'), { status: 413 })))).get('/boom');
    expect(r413.status).toBe(413);
    expectErrorShape(r413.body, 'PAYLOAD_TOO_LARGE');
    const r415 = await request(buildApp((next) => next(Object.assign(new Error('x'), { status: 415 })))).get('/boom');
    expect(r415.status).toBe(415);
    expectErrorShape(r415.body, 'UNSUPPORTED_MEDIA_TYPE');
  });

  test('valor não-Error lançado → 500', async () => {
    const res = await request(buildApp((next) => next('string solta'))).get('/boom');
    expect(res.status).toBe(500);
    expectErrorShape(res.body, 'INTERNAL_ERROR');
  });
});
