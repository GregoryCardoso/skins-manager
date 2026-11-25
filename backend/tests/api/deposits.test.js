// API de aportes (D202, D227, D232): CRUD, erros com field, 404, 415 e 403 por Host.
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
const body = (overrides = {}) => ({ storeId: storeId('CSFloat'), amountStoreCents: 10000, depositedAt: '2026-11-10T12:00:00.000Z', ...overrides });

describe('GET /api/deposits', () => {
  test('vazio: lista vazia e totais zerados', async () => {
    const res = await request(app).get('/api/deposits');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { deposits: [], totals: { count: 0, legacyCount: 0, feeCents: 0, feeMissingCount: 0, amountUsdCents: 0, approxCents: null, approxCurrency: 'BRL', estimated: false } },
    });
  });

  test('ordem depositedAt DESC e id DESC; totais somam todos; storeName vem da loja', async () => {
    const a = (await post(body({ depositedAt: '2026-11-01T12:00:00.000Z', amountStoreCents: 100, storeId: storeId('CSMoney') }))).body.data;
    const b = (await post(body({ depositedAt: '2026-11-05T12:00:00.000Z', amountStoreCents: 250, storeId: storeId('CSFloat') }))).body.data;
    const c = (await post(body({ depositedAt: '2026-11-05T12:00:00.000Z', amountStoreCents: 50 }))).body.data;
    const res = await request(app).get('/api/deposits');
    expect(res.body.data.deposits.map((d) => d.id)).toEqual([c.id, b.id, a.id]);
    expect(res.body.data.totals).toEqual({ count: 3, legacyCount: 0, feeCents: 0, feeMissingCount: 3, amountUsdCents: 400, approxCents: null, approxCurrency: 'BRL', estimated: false });
    expect(res.body.data.deposits[1]).toMatchObject({ storeId: storeId('CSFloat'), storeName: 'CSFloat', currency: 'USD' });
    expect(res.body.data.deposits[2]).toMatchObject({ storeId: storeId('CSMoney'), storeName: 'CSMoney' });
  });

  test('com cotação: "≈ R$" por aporte e no total vêm do backend (total convertido uma vez)', async () => {
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.4321 }).expect(200);
    await post(body({ amountStoreCents: 9200, amountBrlCents: 1 }));
    const res = (await request(app).get('/api/deposits')).body.data;
    expect(res.deposits[0]).toMatchObject({ amountUsdCents: 9200, approxCents: 49975, approxCurrency: 'BRL', estimated: false, legacy: false });
    expect(res.totals).toEqual({ count: 1, legacyCount: 0, feeCents: 0, feeMissingCount: 1, amountUsdCents: 9200, approxCents: 49975, approxCurrency: 'BRL', estimated: false });
  });

  test('aporte legado entra convertido (≈) e sem cotação deixa o total nulo', async () => {
    const now = NOW.toISOString();
    getDb().prepare(
      "INSERT INTO deposits (store_id, amount_store_cents, amount_brl_cents, deposited_at, created_at, updated_at) VALUES (NULL, NULL, 30000, '2026-11-01T12:00:00.000Z', ?, ?)"
    ).run(now, now);
    await post(body({ amountStoreCents: 9200 }));
    let res = (await request(app).get('/api/deposits')).body.data;
    expect(res.totals).toEqual({ count: 2, legacyCount: 1, feeCents: 0, feeMissingCount: 1, amountUsdCents: null, approxCents: null, approxCurrency: 'BRL', estimated: true });
    expect(res.deposits[1]).toMatchObject({ legacy: true, amountStoreCents: null, amountBrlCents: 30000, amountUsdCents: null, estimated: true });
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.4321 }).expect(200);
    res = (await request(app).get('/api/deposits')).body.data;
    expect(res.deposits[1]).toMatchObject({ amountUsdCents: 5523, approxCents: 30000, approxCurrency: 'BRL', estimated: true });
    expect(res.totals).toEqual({ count: 2, legacyCount: 1, feeCents: 0, feeMissingCount: 1, amountUsdCents: 14723, approxCents: 79977, approxCurrency: 'BRL', estimated: true });
  });
});

describe('POST /api/deposits', () => {
  test('201 com a DepositView completa, data em UTC e carimbos do relógio injetado', async () => {
    const res = await post(body({ depositedAt: '2026-11-10T09:00:00-03:00', note: '  pix ', amountBrlCents: 50000 }));
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      id: expect.any(Number),
      storeId: storeId('CSFloat'),
      storeName: 'CSFloat',
      currency: 'USD',
      amountStoreCents: 10000,
      feeCents: null,
      amountBrlCents: 50000, amountBrlCurrency: 'BRL',
      depositedAt: '2026-11-10T12:00:00.000Z',
      note: 'pix',
      legacy: false,
      amountUsdCents: 10000,
      approxCents: null, approxCurrency: 'BRL',
      estimated: false,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  test('mínimo: sem valor pago em R$ e sem nota', async () => {
    const res = await post(body());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ storeId: storeId('CSFloat'), amountBrlCents: null, note: null });
  });

  test('loja em BRL (Steam) -> 400 DEPOSIT_STORE_CURRENCY_NOT_ALLOWED (E8-Q16); sem loja -> STORE_REQUIRED', async () => {
    expectError(await post(body({ storeId: storeId('Steam') })), 400, 'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
    expectError(await post({ amountStoreCents: 100, depositedAt: body().depositedAt }), 400, 'STORE_REQUIRED', { field: 'storeId' });
    expectError(await post(body({ storeId: null })), 400, 'STORE_REQUIRED', { field: 'storeId' });
    expect((await request(app).get('/api/deposits')).body.data.totals.count).toBe(0);
  });

  test('o valor pago em R$ é só informativo: não muda o US$ do aporte', async () => {
    const res = await post(body({ amountBrlCents: 999999 }));
    expect(res.body.data).toMatchObject({ amountStoreCents: 10000, amountUsdCents: 10000 });
  });

  test('o aporte em loja inativa é aceito', async () => {
    await request(app).patch(`/api/stores/${storeId('CSMoney')}`).send({ isActive: false }).expect(200);
    expect((await post(body({ storeId: storeId('CSMoney') }))).status).toBe(201);
  });

  test('erros 400 com code e field', async () => {
    expectError(await post({ storeId: storeId('CSFloat'), depositedAt: body().depositedAt }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    expectError(await post({ storeId: storeId('CSFloat'), amountStoreCents: 100 }), 400, 'REQUIRED_FIELD', { field: 'depositedAt' });
    expectError(await post(body({ amountBrlCents: 0 })), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    expectError(await post(body({ amountStoreCents: 0 })), 400, 'INVALID_AMOUNT', { field: 'amountStoreCents' });
    expectError(await post(body({ amountStoreCents: -1 })), 400, 'INVALID_AMOUNT', { field: 'amountStoreCents' });
    expectError(await post(body({ amountStoreCents: 10.5 })), 400, 'INVALID_AMOUNT', { field: 'amountStoreCents' });
    expectError(await post(body({ amountStoreCents: 1e10 + 1 })), 400, 'INVALID_AMOUNT', { field: 'amountStoreCents' });
    expectError(await post(body({ amountStoreCents: '100' })), 400, 'INVALID_FIELD', { field: 'amountStoreCents' });
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
    const res = await request(laterApp).patch(`/api/deposits/${created.id}`).send({ amountStoreCents: 20000 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      amountStoreCents: 20000, note: 'a', storeId: storeId('CSFloat'), createdAt: NOW.toISOString(), updatedAt: later.toISOString(),
    });
  });

  test('null limpa o valor pago em R$ e a nota; loja nula é recusada (STORE_REQUIRED)', async () => {
    const created = (await post(body({ note: 'a', amountBrlCents: 500 }))).body.data;
    const res = await patch(created.id, { note: null, amountBrlCents: null });
    expect(res.body.data).toMatchObject({ note: null, amountBrlCents: null, storeName: 'CSFloat' });
    expectError(await patch(created.id, { storeId: null }), 400, 'STORE_REQUIRED', { field: 'storeId' });
  });

  test('trocar para loja BRL -> DEPOSIT_STORE_CURRENCY_NOT_ALLOWED; entre lojas USD o valor é mantido', async () => {
    const created = (await post(body())).body.data;
    expectError(await patch(created.id, { storeId: storeId('Steam') }), 400, 'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
    const res = await patch(created.id, { storeId: storeId('CSMoney') });
    expect(res.body.data).toMatchObject({ storeName: 'CSMoney', amountStoreCents: 10000 });
  });

  test('aporte legado: só a nota recusa; informar loja USD e valor creditado tira do estado legado', async () => {
    const now = NOW.toISOString();
    const id = getDb().prepare(
      "INSERT INTO deposits (store_id, amount_store_cents, amount_brl_cents, deposited_at, created_at, updated_at) VALUES (NULL, NULL, 30000, '2026-11-01T12:00:00.000Z', ?, ?)"
    ).run(now, now).lastInsertRowid;
    expectError(await patch(id, { note: 'x' }), 400, 'STORE_REQUIRED', { field: 'storeId' });
    expectError(await patch(id, { storeId: storeId('CSFloat') }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    expectError(await patch(id, { storeId: storeId('Steam'), amountStoreCents: 5000 }), 400, 'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
    const res = await patch(id, { storeId: storeId('CSFloat'), amountStoreCents: 5200 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ legacy: false, amountStoreCents: 5200, amountBrlCents: 30000, amountUsdCents: 5200 });
    await request(app).delete("/api/deposits/" + id).expect(200);
  });

  test('corpo vazio, campo desconhecido, data futura, loja inexistente e valor inválido', async () => {
    const { id } = (await post(body())).body.data;
    expectError(await patch(id, {}), 400, 'INVALID_BODY');
    expectError(await patch(id, { foo: 1 }), 400, 'UNKNOWN_FIELD', { field: 'foo' });
    expectError(await patch(id, { depositedAt: '2027-01-01T00:00:00.000Z' }), 400, 'DEPOSITED_AT_IN_FUTURE', { field: 'depositedAt' });
    expectError(await patch(id, { storeId: 9999 }), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    expectError(await patch(id, { amountStoreCents: 0 }), 400, 'INVALID_AMOUNT', { field: 'amountStoreCents' });
    expectError(await patch(id, { amountStoreCents: null }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    expect(getDb().prepare('SELECT amount_store_cents AS v FROM deposits WHERE id = ?').get(id).v).toBe(10000);
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
