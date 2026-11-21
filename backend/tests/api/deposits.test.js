// API de aportes (D202): CRUD, erros com field, 404, 415 e 403 por Host.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, storeId, expectError, NOW } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/deposits').send(body);
const patch = (id, body) => request(app).patch(`/api/deposits/${id}`).send(body);
const body = (overrides = {}) => ({ amountBrlCents: 10000, depositedAt: '2026-11-10T12:00:00.000Z', ...overrides });

describe('GET /api/deposits', () => {
  test('vazio: lista vazia e totais zerados', async () => {
    const res = await request(app).get('/api/deposits');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { deposits: [], totals: { count: 0, amountBrlCents: 0 } } });
  });

  test('ordem depositedAt DESC e id DESC; totais somam todos; storeName vem da loja', async () => {
    const a = (await post(body({ depositedAt: '2026-11-01T12:00:00.000Z', amountBrlCents: 100 }))).body.data;
    const b = (await post(body({ depositedAt: '2026-11-05T12:00:00.000Z', amountBrlCents: 250, storeId: storeId('CSFloat') }))).body.data;
    const c = (await post(body({ depositedAt: '2026-11-05T12:00:00.000Z', amountBrlCents: 50 }))).body.data;
    const res = await request(app).get('/api/deposits');
    expect(res.body.data.deposits.map((d) => d.id)).toEqual([c.id, b.id, a.id]);
    expect(res.body.data.totals).toEqual({ count: 3, amountBrlCents: 400 });
    expect(res.body.data.deposits[1]).toMatchObject({ storeId: storeId('CSFloat'), storeName: 'CSFloat' });
    expect(res.body.data.deposits[0]).toMatchObject({ storeId: null, storeName: null });
  });
});

describe('POST /api/deposits', () => {
  test('201 com a DepositView completa, data em UTC e carimbos do relógio injetado', async () => {
    const res = await post(body({ depositedAt: '2026-11-10T09:00:00-03:00', note: '  pix ', storeId: storeId('Steam') }));
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      id: expect.any(Number),
      amountBrlCents: 10000,
      depositedAt: '2026-11-10T12:00:00.000Z',
      storeId: storeId('Steam'),
      storeName: 'Steam',
      note: 'pix',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  test('mínimo: sem loja e sem nota', async () => {
    const res = await post(body());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ storeId: null, storeName: null, note: null });
  });

  test('o aporte em loja inativa é aceito', async () => {
    await request(app).patch(`/api/stores/${storeId('CSMoney')}`).send({ isActive: false }).expect(200);
    expect((await post(body({ storeId: storeId('CSMoney') }))).status).toBe(201);
  });

  test('erros 400 com code e field', async () => {
    expectError(await post({ depositedAt: body().depositedAt }), 400, 'REQUIRED_FIELD', { field: 'amountBrlCents' });
    expectError(await post({ amountBrlCents: 100 }), 400, 'REQUIRED_FIELD', { field: 'depositedAt' });
    expectError(await post(body({ amountBrlCents: 0 })), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    expectError(await post(body({ amountBrlCents: -1 })), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    expectError(await post(body({ amountBrlCents: 10.5 })), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    expectError(await post(body({ amountBrlCents: 1e10 + 1 })), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    expectError(await post(body({ amountBrlCents: '100' })), 400, 'INVALID_FIELD', { field: 'amountBrlCents' });
    expectError(await post(body({ depositedAt: '10/11/2026' })), 400, 'INVALID_DATE', { field: 'depositedAt' });
    expectError(await post(body({ depositedAt: 5 })), 400, 'INVALID_FIELD', { field: 'depositedAt' });
    expectError(await post(body({ storeId: 9999 })), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    expectError(await post(body({ storeId: 1.5 })), 400, 'INVALID_FIELD', { field: 'storeId' });
    expectError(await post(body({ note: 'x'.repeat(501) })), 400, 'FIELD_TOO_LONG', { field: 'note', params: { maxLength: 500 } });
    expectError(await post(body({ note: 7 })), 400, 'INVALID_FIELD', { field: 'note' });
    expectError(await post(body({ extra: 1 })), 400, 'UNKNOWN_FIELD', { field: 'extra' });
    expectError(await post([]), 400, 'INVALID_BODY');
    expect((await request(app).get('/api/deposits')).body.data.totals.count).toBe(0);
  });

  test('data futura -> DEPOSITED_AT_IN_FUTURE; hoje em Brasília (até 23:59) passa', async () => {
    // NOW = 19/11 12:00 em Brasília
    expectError(await post(body({ depositedAt: '2026-11-20T03:00:00.000Z' })), 400, 'DEPOSITED_AT_IN_FUTURE', { field: 'depositedAt' });
    expectError(await post(body({ depositedAt: '2027-01-01T00:00:00.000Z' })), 400, 'DEPOSITED_AT_IN_FUTURE', { field: 'depositedAt' });
    expect((await post(body({ depositedAt: '2026-11-19T23:59:00-03:00' }))).status).toBe(201);
  });
});

describe('PATCH /api/deposits/:id', () => {
  test('parcial atualiza só o enviado e o updatedAt; createdAt fica', async () => {
    const created = (await post(body({ note: 'a', storeId: storeId('CSFloat') }))).body.data;
    const later = new Date('2026-11-19T18:00:00.000Z');
    const laterApp = makeApp(later);
    const res = await request(laterApp).patch(`/api/deposits/${created.id}`).send({ amountBrlCents: 20000 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      amountBrlCents: 20000, note: 'a', storeId: storeId('CSFloat'), createdAt: NOW.toISOString(), updatedAt: later.toISOString(),
    });
  });

  test('null limpa loja e nota', async () => {
    const created = (await post(body({ note: 'a', storeId: storeId('CSFloat') }))).body.data;
    const res = await patch(created.id, { note: null, storeId: null });
    expect(res.body.data).toMatchObject({ note: null, storeId: null, storeName: null });
  });

  test('corpo vazio, campo desconhecido, data futura, loja inexistente e valor inválido', async () => {
    const { id } = (await post(body())).body.data;
    expectError(await patch(id, {}), 400, 'INVALID_BODY');
    expectError(await patch(id, { foo: 1 }), 400, 'UNKNOWN_FIELD', { field: 'foo' });
    expectError(await patch(id, { depositedAt: '2027-01-01T00:00:00.000Z' }), 400, 'DEPOSITED_AT_IN_FUTURE', { field: 'depositedAt' });
    expectError(await patch(id, { storeId: 9999 }), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    expectError(await patch(id, { amountBrlCents: 0 }), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    expectError(await patch(id, { amountBrlCents: null }), 400, 'REQUIRED_FIELD', { field: 'amountBrlCents' });
    expect(getDb().prepare('SELECT amount_brl_cents AS v FROM deposits WHERE id = ?').get(id).v).toBe(10000);
  });

  test('404 DEPOSIT_NOT_FOUND e 400 INVALID_ID', async () => {
    expectError(await patch(9999, { note: 'x' }), 404, 'DEPOSIT_NOT_FOUND');
    expectError(await patch('abc', { note: 'x' }), 400, 'INVALID_ID');
    expectError(await patch(0, { note: 'x' }), 400, 'INVALID_ID');
  });
});

describe('DELETE /api/deposits/:id', () => {
  test('200 { id } e o aporte some; segunda exclusão -> 404', async () => {
    const { id } = (await post(body())).body.data;
    const res = await request(app).delete(`/api/deposits/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id } });
    expect((await request(app).get('/api/deposits')).body.data.totals.count).toBe(0);
    expectError(await request(app).delete(`/api/deposits/${id}`), 404, 'DEPOSIT_NOT_FOUND');
    expectError(await request(app).delete('/api/deposits/xyz'), 400, 'INVALID_ID');
  });

  test('a loja do aporte passa a ser "em uso" (STORE_IN_USE ao excluir) e volta a poder ser excluída sem ele', async () => {
    const created = await request(app).post('/api/stores').send({ name: 'Nova', currency: 'USD' }).expect(201);
    const newStore = created.body.data.id;
    const { id } = (await post(body({ storeId: newStore }))).body.data;
    expectError(await request(app).delete(`/api/stores/${newStore}`), 409, 'STORE_IN_USE');
    await request(app).delete(`/api/deposits/${id}`).expect(200);
    await request(app).delete(`/api/stores/${newStore}`).expect(200);
  });
});

describe('segurança (D167)', () => {
  test('POST e PATCH sem Content-Type JSON -> 415; com texto também', async () => {
    const { id } = (await post(body())).body.data;
    expectError(await request(app).post('/api/deposits').set('Content-Type', 'text/plain').send('x'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).post('/api/deposits'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).patch(`/api/deposits/${id}`).set('Content-Type', 'text/plain').send('x'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).patch(`/api/deposits/${id}`), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect((await request(app).get('/api/deposits')).body.data.totals.count).toBe(1);
  });

  test('DELETE sem Content-Type funciona', async () => {
    const { id } = (await post(body())).body.data;
    expect((await request(app).delete(`/api/deposits/${id}`)).status).toBe(200);
  });

  test.each(['evil.example', 'localhost.evil.example:3001', '10.0.0.5'])('Host %p -> 403 FORBIDDEN_HOST em todas as rotas', async (host) => {
    const { id } = (await post(body())).body.data;
    expectError(await request(app).get('/api/deposits').set('Host', host), 403, 'FORBIDDEN_HOST');
    expectError(await request(app).post('/api/deposits').set('Host', host).send(body()), 403, 'FORBIDDEN_HOST');
    expectError(await request(app).patch(`/api/deposits/${id}`).set('Host', host).send({ note: 'x' }), 403, 'FORBIDDEN_HOST');
    expectError(await request(app).delete(`/api/deposits/${id}`).set('Host', host), 403, 'FORBIDDEN_HOST');
    expect((await request(app).get('/api/deposits')).body.data.totals.count).toBe(1);
  });
});
