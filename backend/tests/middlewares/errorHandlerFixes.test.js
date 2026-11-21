// Complementa errorHandler.test.js com os casos das correções pós-revisão da Etapa 1.
const http = require('http');
const express = require('express');
const request = require('supertest');
const app = require('../../src/app');
const { closeDb } = require('../../src/config/database');
const { errorHandler, notFoundHandler } = require('../../src/middlewares/errorHandler');
const { AppError, ValidationError } = require('../../src/errors/AppError');
const Item = require('../../src/models/Item');
const { freshDb, wonSkin } = require('../helpers/fixtures');

afterAll(() => closeDb());

let errorSpy;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe('errorHandler - headersSent', () => {
  test('unitário: com headersSent delega para next(err) sem escrever resposta', () => {
    const err = new Error('tarde demais');
    const res = { headersSent: true, status: jest.fn(), json: jest.fn() };
    const next = jest.fn();
    errorHandler(err, {}, res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  function buildApp(delegated) {
    const a = express();
    a.get('/json-then-error', (req, res, next) => {
      res.json({ success: true, data: 'ok' });
      next(new Error('depois da resposta'));
    });
    a.get('/partial-then-error', (req, res, next) => {
      res.status(200).set('Content-Type', 'text/plain');
      res.write('parcial');
      next(new Error('no meio do stream'));
    });
    a.get('/ok', (req, res) => res.json({ success: true }));
    a.use(errorHandler);
    // Observa a delegação: deve receber o mesmo erro, com headers já enviados.
    a.use((err, req, res, next) => {
      delegated.push({ message: err.message, headersSent: res.headersSent });
      next(err);
    });
    return a;
  }

  test('res.json e depois next(err): cliente recebe a 1ª resposta intacta, sem 2ª resposta nem crash', async () => {
    const delegated = [];
    const a = buildApp(delegated);
    const res = await request(a).get('/json-then-error');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: 'ok' });
    expect(delegated).toEqual([{ message: 'depois da resposta', headersSent: true }]);
    // Servidor continua operando.
    const again = await request(a).get('/ok');
    expect(again.status).toBe(200);
  });

  test('res.write parcial e depois next(err): não envia JSON de erro e o app segue vivo', async () => {
    const delegated = [];
    const a = buildApp(delegated);
    // http cru: o Express (finalhandler) destrói o socket quando os headers já foram enviados,
    // o que é o comportamento esperado; só coletamos o que chegou.
    const server = await new Promise((resolve) => {
      const s = a.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { status, body } = await new Promise((resolve) => {
      let data = '';
      let st = null;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve({ status: st, body: data }); } };
      const req = http.get({ host: '127.0.0.1', port: server.address().port, path: '/partial-then-error' }, (r) => {
        st = r.statusCode;
        r.setEncoding('utf8');
        r.on('data', (c) => { data += c; });
        r.on('end', finish);
        r.on('aborted', finish);
        r.on('error', finish);
        r.on('close', finish);
      });
      req.on('error', finish);
    });
    expect(status).toBe(200);
    expect(body).toBe('parcial');
    expect(body).not.toMatch(/INTERNAL_ERROR|success/);
    await new Promise((resolve) => server.close(resolve));
    expect(delegated).toEqual([{ message: 'no meio do stream', headersSent: true }]);
    const again = await request(a).get('/ok');
    expect(again.status).toBe(200);
  });
});

describe('errorHandler - erros reais do express.json (app real)', () => {
  test('corpo JSON > 100kb → 413 PAYLOAD_TOO_LARGE', async () => {
    const big = JSON.stringify({ data: 'x'.repeat(110 * 1024) });
    const res = await request(app).post('/api/qualquer').set('Content-Type', 'application/json').send(big);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: expect.any(String) } });
  });

  test('corpo JSON pouco abaixo de 100kb não gera 413 (cai no 404 da rota)', async () => {
    const ok = JSON.stringify({ data: 'x'.repeat(90 * 1024) });
    const res = await request(app).post('/api/qualquer').set('Content-Type', 'application/json').send(ok);
    expect(res.status).toBe(404);
  });

  test('charset não suportado no Content-Type → 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await request(app)
      .post('/api/qualquer')
      .set('Content-Type', 'application/json; charset=latin1')
      .send('{"a":1}');
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ success: false, error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: expect.any(String) } });
  });

  test('Content-Encoding não suportado → 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await request(app)
      .post('/api/qualquer')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'compress-xyz')
      .send('{"a":1}');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  test('mensagens 413/415 não vazam o texto interno do body-parser', async () => {
    const res = await request(app)
      .post('/api/qualquer')
      .set('Content-Type', 'application/json; charset=latin1')
      .send('{"a":1}');
    expect(res.body.error.message).not.toMatch(/unsupported charset|LATIN1/i);
  });
});

describe('errorHandler - AppError/ValidationError e 4xx genéricos', () => {
  function buildApp(handler) {
    const a = express();
    a.use(express.json());
    a.all('/r', handler);
    a.use(notFoundHandler);
    a.use(errorHandler);
    return a;
  }

  test('AppError chega com status e code próprios, mensagem preservada', async () => {
    const a = buildApp(() => {
      throw new AppError(409, 'ITEM_ALREADY_SOLD', 'Item já foi vendido');
    });
    const res = await request(a).get('/r');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: { code: 'ITEM_ALREADY_SOLD', message: 'Item já foi vendido' } });
  });

  test('ValidationError → 400 com o código e a mensagem', async () => {
    const a = buildApp((req, res, next) => next(new ValidationError('Nome é obrigatório', 'REQUIRED_FIELD')));
    const res = await request(a).get('/r');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: { code: 'REQUIRED_FIELD', message: 'Nome é obrigatório' } });
  });

  test('violação real de CHECK do SQLite → 409 CONSTRAINT_VIOLATION (sem 500)', async () => {
    freshDb();
    const a = buildApp((req, res) => res.status(201).json({ success: true, data: Item.create(req.body) }));
    const res = await request(a).post('/r').send(wonSkin({ acquisitionType: 'COMPRA', purchaseStoreId: null }));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: { code: 'CONSTRAINT_VIOLATION', message: expect.any(String) } });
  });

  test('UNKNOWN_FIELD vindo do model (fluxo real) → 400 e nada gravado', async () => {
    freshDb();
    const a = buildApp((req, res) => res.status(201).json({ success: true, data: Item.create(req.body) }));
    const res = await request(a).post('/r').send(wonSkin({ purchasePrice: 1234 }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: { code: 'UNKNOWN_FIELD', message: 'Campo desconhecido: purchasePrice' } });
    expect(Item.findAll()).toEqual([]);
  });

  test.each([401, 403, 404, 405, 409, 422, 429, 499])('status %i sem code → BAD_REQUEST com o mesmo status', async (status) => {
    const a = buildApp((req, res, next) => next(Object.assign(new Error('interno'), { status })));
    const res = await request(a).get('/r');
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ success: false, error: { code: 'BAD_REQUEST', message: 'Requisição inválida' } });
  });

  test('4xx sem code não é logado como erro interno', async () => {
    const a = buildApp((req, res, next) => next(Object.assign(new Error('x'), { status: 404 })));
    await request(a).get('/r');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('5xx sem code → 500 INTERNAL_ERROR e é logado', async () => {
    const a = buildApp((req, res, next) => next(Object.assign(new Error('x'), { status: 503 })));
    const res = await request(a).get('/r');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('field e params (D113)', () => {
  const { AppError, ValidationError } = require('../../src/errors/AppError');
  const run = (err) => {
    const res = { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn() };
    require('../../src/middlewares/errorHandler').errorHandler(err, {}, res, jest.fn());
    return res.json.mock.calls[0][0];
  };

  test('inclui field e params só quando presentes', () => {
    expect(run(new ValidationError('m', 'X', { field: 'f', params: { a: 1 } })).error).toEqual({ code: 'X', message: 'm', field: 'f', params: { a: 1 } });
    expect(run(new AppError(400, 'X', 'm')).error).toEqual({ code: 'X', message: 'm' });
  });
});
