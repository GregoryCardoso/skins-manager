// API de saques (D203): CRUD, erros com field, troca de loja, saque antigo sem loja, sugestão de taxa, 415 e 403.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Withdrawal = require('../../src/models/Withdrawal');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, storeId, expectError, NOW } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/withdrawals').send(body);
const patch = (id, body) => request(app).patch(`/api/withdrawals/${id}`).send(body);
const body = (overrides = {}) => ({
  storeId: storeId('CSFloat'), amountStoreCents: 10000, feeCents: 250, amountBrlCents: 52000,
  withdrawnAt: '2026-11-10T12:00:00.000Z', ...overrides,
});
const legacy = (overrides = {}) =>
  Withdrawal.create({ amountBrlCents: 30000, withdrawnAt: '2026-01-05T12:00:00.000Z', note: 'antigo', ...overrides }, { now: NOW });

describe('GET /api/withdrawals', () => {
  test('vazio: lista vazia e totais zerados', async () => {
    const res = await request(app).get('/api/withdrawals');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { withdrawals: [], totals: { count: 0, legacyCount: 0, withoutFeeCount: 0, netUsdCents: 0, approxCents: null, approxCurrency: 'BRL', estimated: false } },
    });
  });

  test('ordem withdrawnAt DESC e id DESC; totais; saque antigo sem loja na lista', async () => {
    const a = (await post(body({ withdrawnAt: '2026-11-01T12:00:00.000Z', amountStoreCents: 1000, feeCents: 0 }))).body.data;
    const b = (await post(body({ withdrawnAt: '2026-11-05T12:00:00.000Z', amountStoreCents: 2500, feeCents: null }))).body.data;
    const c = (await post(body({ withdrawnAt: '2026-11-05T12:00:00.000Z', amountStoreCents: 500, feeCents: 100 }))).body.data;
    const old = legacy();
    const res = await request(app).get('/api/withdrawals');
    expect(res.body.data.withdrawals.map((w) => w.id)).toEqual([c.id, b.id, a.id, old.id]);
    // sem cotação: o saque antigo (R$ 300,00) não converte; os três com loja somam 1000 + 2500 + 400
    expect(res.body.data.totals).toEqual({
      count: 4, legacyCount: 1, withoutFeeCount: 1, netUsdCents: null, approxCents: null, approxCurrency: 'BRL', estimated: true,
    });
    expect(res.body.data.withdrawals[3]).toEqual({
      id: old.id, storeId: null, storeName: null, currency: null, amountStoreCents: null, feeCents: null, netStoreCents: null,
      amountBrlCents: 30000, withdrawnAt: '2026-01-05T12:00:00.000Z', note: 'antigo', legacyWithoutStore: true,
      amountUsdCents: null, approxCents: 30000, approxCurrency: 'BRL', estimated: true,
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    });
    expect(res.body.data.withdrawals.slice(0, 3).map((w) => w.amountUsdCents)).toEqual([400, 2500, 1000]);
  });

  test('com cotação: líquido em US$, "≈ R$" e o saque antigo convertido (≈) entram nos totais', async () => {
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.4321 }).expect(200);
    await post(body({ amountStoreCents: 10000, feeCents: 250, amountBrlCents: 52037 }));
    legacy({ amountBrlCents: 10000 });
    const res = (await request(app).get('/api/withdrawals')).body.data;
    expect(res.withdrawals.find((w) => !w.legacyWithoutStore)).toMatchObject({
      netStoreCents: 9750, amountUsdCents: 9750, approxCents: 52963, approxCurrency: 'BRL', estimated: false,
    });
    expect(res.withdrawals.find((w) => w.legacyWithoutStore)).toMatchObject({ amountUsdCents: 1841, approxCents: 10000, approxCurrency: 'BRL', estimated: true });
    expect(res.totals).toEqual({ count: 2, legacyCount: 1, withoutFeeCount: 0, netUsdCents: 11591, approxCents: 62963, approxCurrency: 'BRL', estimated: true });
  });
});

describe('POST /api/withdrawals', () => {
  test('201 com a WithdrawalView completa, data em UTC e carimbos do relógio injetado', async () => {
    const res = await post(body({ withdrawnAt: '2026-11-10T09:00:00-03:00', note: '  pix ' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.any(Number),
      storeId: storeId('CSFloat'),
      storeName: 'CSFloat',
      currency: 'USD',
      amountStoreCents: 10000,
      feeCents: 250,
      netStoreCents: 9750,
      amountBrlCents: 52000,
      withdrawnAt: '2026-11-10T12:00:00.000Z',
      note: 'pix',
      legacyWithoutStore: false,
      amountUsdCents: 9750,
      approxCents: null, approxCurrency: 'BRL',
      estimated: false,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  test('taxa ausente ou nula = não informada; 0 = paga zero', async () => {
    expect((await post(body({ feeCents: undefined }))).body.data.feeCents).toBeNull();
    expect((await post(body({ feeCents: null }))).body.data.feeCents).toBeNull();
    expect((await post(body({ feeCents: 0 }))).body.data.feeCents).toBe(0);
  });

  test('erros 400 com code e field', async () => {
    expectError(await post(body({ storeId: undefined })), 400, 'STORE_REQUIRED', { field: 'storeId' });
    expectError(await post(body({ storeId: null })), 400, 'STORE_REQUIRED', { field: 'storeId' });
    expectError(await post(body({ storeId: 9999 })), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    expectError(await post(body({ storeId: 1.5 })), 400, 'INVALID_FIELD', { field: 'storeId' });
    expectError(await post(body({ storeId: storeId('Steam') })), 400, 'WITHDRAWAL_NOT_ALLOWED', { field: 'storeId' });
    expectError(await post(body({ amountStoreCents: undefined })), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    expectError(await post(body({ amountStoreCents: 0 })), 400, 'INVALID_AMOUNT', { field: 'amountStoreCents' });
    expectError(await post(body({ amountStoreCents: '100' })), 400, 'INVALID_FIELD', { field: 'amountStoreCents' });
    expectError(await post(body({ feeCents: 10001 })), 400, 'WITHDRAWAL_FEE_ABOVE_AMOUNT', { field: 'feeCents' });
    expectError(await post(body({ feeCents: -1 })), 400, 'INVALID_AMOUNT', { field: 'feeCents' });
    expectError(await post(body({ amountBrlCents: 0 })), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    expectError(await post(body({ withdrawnAt: undefined })), 400, 'REQUIRED_FIELD', { field: 'withdrawnAt' });
    expectError(await post(body({ withdrawnAt: '10/11/2026' })), 400, 'INVALID_DATE', { field: 'withdrawnAt' });
    expectError(await post(body({ note: 'x'.repeat(501) })), 400, 'FIELD_TOO_LONG', { field: 'note', params: { maxLength: 500 } });
    expectError(await post(body({ extra: 1 })), 400, 'UNKNOWN_FIELD', { field: 'extra' });
    expectError(await post([]), 400, 'INVALID_BODY');
    expect((await request(app).get('/api/withdrawals')).body.data.totals.count).toBe(0);
  });

  test('data futura -> WITHDRAWN_AT_IN_FUTURE; hoje em Brasília (até 23:59) passa', async () => {
    expectError(await post(body({ withdrawnAt: '2026-11-20T03:00:00.000Z' })), 400, 'WITHDRAWN_AT_IN_FUTURE', { field: 'withdrawnAt' });
    expect((await post(body({ withdrawnAt: '2026-11-19T23:59:00-03:00' }))).status).toBe(201);
  });

  test('loja inativa com "permite saque" é aceita', async () => {
    await request(app).patch(`/api/stores/${storeId('CSMoney')}`).send({ isActive: false }).expect(200);
    expect((await post(body({ storeId: storeId('CSMoney'), feeCents: undefined }))).status).toBe(201);
  });
});

describe('PATCH /api/withdrawals/:id', () => {
  test('parcial atualiza só o enviado e o updatedAt; createdAt fica', async () => {
    const created = (await post(body({ note: 'a' }))).body.data;
    const later = new Date('2026-11-19T18:00:00.000Z');
    const res = await request(makeApp(later)).patch(`/api/withdrawals/${created.id}`).send({ amountBrlCents: 60000 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      amountBrlCents: 60000, amountStoreCents: 10000, feeCents: 250, note: 'a',
      createdAt: NOW.toISOString(), updatedAt: later.toISOString(),
    });
  });

  test('feeCents: null limpa a taxa; note: null limpa a nota', async () => {
    const created = (await post(body({ note: 'a' }))).body.data;
    const res = await patch(created.id, { feeCents: null, note: null });
    expect(res.body.data).toMatchObject({ feeCents: null, note: null });
  });

  test('erros 400 com field; nada é gravado', async () => {
    const { id } = (await post(body())).body.data;
    expectError(await patch(id, {}), 400, 'INVALID_BODY');
    expectError(await patch(id, { foo: 1 }), 400, 'UNKNOWN_FIELD', { field: 'foo' });
    expectError(await patch(id, { storeId: null }), 400, 'STORE_REQUIRED', { field: 'storeId' });
    expectError(await patch(id, { storeId: 9999 }), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    expectError(await patch(id, { amountStoreCents: null }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    expectError(await patch(id, { amountStoreCents: 100 }), 400, 'WITHDRAWAL_FEE_ABOVE_AMOUNT', { field: 'feeCents' });
    expectError(await patch(id, { feeCents: 20000 }), 400, 'WITHDRAWAL_FEE_ABOVE_AMOUNT', { field: 'feeCents' });
    expectError(await patch(id, { amountBrlCents: 0 }), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    expectError(await patch(id, { withdrawnAt: '2027-01-01T00:00:00.000Z' }), 400, 'WITHDRAWN_AT_IN_FUTURE', { field: 'withdrawnAt' });
    expect(getDb().prepare('SELECT amount_brl_cents AS v FROM withdrawals WHERE id = ?').get(id).v).toBe(52000);
  });

  test('trocar para loja sem saque -> WITHDRAWAL_NOT_ALLOWED; para loja com saque, aceito', async () => {
    const { id } = (await post(body())).body.data;
    expectError(await patch(id, { storeId: storeId('Steam') }), 400, 'WITHDRAWAL_NOT_ALLOWED', { field: 'storeId' });
    const res = await patch(id, { storeId: storeId('CSMoney'), feeCents: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ storeId: storeId('CSMoney'), storeName: 'CSMoney' });
  });

  test('D221: trocar para loja de outra moeda exige amountStoreCents; sem a troca de moeda, não', async () => {
    await request(app).patch(`/api/stores/${storeId('Steam')}`).send({ allowsWithdrawal: true }).expect(200);
    const { id } = (await post(body())).body.data; // CSFloat (USD)
    expectError(await patch(id, { storeId: storeId('Steam') }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    const ok = await patch(id, { storeId: storeId('Steam'), amountStoreCents: 52000, feeCents: 250 });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ currency: 'BRL', amountStoreCents: 52000 });
    // fee <= amount continua valendo no registro mesclado
    expectError(await patch(id, { storeId: storeId('Steam'), amountStoreCents: 100 }), 400, 'WITHDRAWAL_FEE_ABOVE_AMOUNT', { field: 'feeCents' });
    // mesma moeda (USD -> USD): mantém o valor gravado
    const { id: id2 } = (await post(body())).body.data;
    const same = await patch(id2, { storeId: storeId('CSMoney'), feeCents: null });
    expect(same.body.data.amountStoreCents).toBe(10000);
  });

  test('manter a loja é aceito mesmo depois de a loja deixar de permitir saque', async () => {
    const { id } = (await post(body())).body.data;
    await request(app).patch(`/api/stores/${storeId('CSFloat')}`).send({ allowsWithdrawal: false }).expect(200);
    const res = await patch(id, { note: 'ainda editável' });
    expect(res.status).toBe(200);
    expect(res.body.data.note).toBe('ainda editável');
    expect((await request(app).delete(`/api/withdrawals/${id}`)).status).toBe(200);
  });

  test('saque antigo sem loja: só a nota -> STORE_REQUIRED; precisa de loja e valor sacado', async () => {
    const old = legacy();
    expectError(await patch(old.id, { note: 'x' }), 400, 'STORE_REQUIRED', { field: 'storeId' });
    expectError(await patch(old.id, { storeId: storeId('CSFloat') }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    expectError(await patch(old.id, { storeId: storeId('Steam'), amountStoreCents: 500 }), 400, 'WITHDRAWAL_NOT_ALLOWED', { field: 'storeId' });
    const res = await patch(old.id, { storeId: storeId('CSFloat'), amountStoreCents: 6000, feeCents: 150 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      storeId: storeId('CSFloat'), currency: 'USD', amountStoreCents: 6000, feeCents: 150, amountBrlCents: 30000,
      legacyWithoutStore: false, note: 'antigo',
    });
  });

  test('404 WITHDRAWAL_NOT_FOUND e 400 INVALID_ID', async () => {
    expectError(await patch(9999, { note: 'x' }), 404, 'WITHDRAWAL_NOT_FOUND');
    expectError(await patch('abc', { note: 'x' }), 400, 'INVALID_ID');
    expectError(await patch(0, { note: 'x' }), 400, 'INVALID_ID');
  });
});

describe('DELETE /api/withdrawals/:id', () => {
  test('200 { id }; some da lista; segunda exclusão -> 404', async () => {
    const { id } = (await post(body())).body.data;
    const res = await request(app).delete(`/api/withdrawals/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id } });
    expect((await request(app).get('/api/withdrawals')).body.data.totals.count).toBe(0);
    expectError(await request(app).delete(`/api/withdrawals/${id}`), 404, 'WITHDRAWAL_NOT_FOUND');
    expectError(await request(app).delete('/api/withdrawals/xyz'), 400, 'INVALID_ID');
  });

  test('saque antigo sem loja pode ser excluído', async () => {
    const old = legacy();
    expect((await request(app).delete(`/api/withdrawals/${old.id}`)).status).toBe(200);
  });
});

describe('GET /api/withdrawals/fee-suggestion', () => {
  const get = (query) => request(app).get('/api/withdrawals/fee-suggestion').query(query);

  test('CSFloat 2,5%: arredonda para cima e limita ao valor', async () => {
    const id = storeId('CSFloat');
    expect((await get({ storeId: id, amountStoreCents: 10000 })).body).toEqual({
      success: true, data: { storeId: id, amountStoreCents: 10000, suggestedFeeCents: 250, warningCode: null },
    });
    expect((await get({ storeId: id, amountStoreCents: 3333 })).body.data.suggestedFeeCents).toBe(84);
    expect((await get({ storeId: id, amountStoreCents: 1 })).body.data.suggestedFeeCents).toBe(1);
  });

  test('inclui a taxa fixa da loja', async () => {
    const id = storeId('CSFloat');
    await request(app).patch(`/api/stores/${id}`).send({ withdrawalFixedFeeCents: 30 }).expect(200);
    expect((await get({ storeId: id, amountStoreCents: 10000 })).body.data.suggestedFeeCents).toBe(280);
  });

  test('loja sem taxa configurada -> nulo e FEES_NOT_CONFIGURED', async () => {
    const res = await get({ storeId: storeId('CSMoney'), amountStoreCents: 10000 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ suggestedFeeCents: null, warningCode: 'FEES_NOT_CONFIGURED' });
  });

  test('query inválida -> INVALID_QUERY com field; loja inexistente -> STORE_NOT_FOUND', async () => {
    expectError(await get({ amountStoreCents: 100 }), 400, 'INVALID_QUERY', { field: 'storeId' });
    expectError(await get({ storeId: 1 }), 400, 'INVALID_QUERY', { field: 'amountStoreCents' });
    expectError(await get({ storeId: 'x', amountStoreCents: 100 }), 400, 'INVALID_QUERY', { field: 'storeId' });
    expectError(await get({ storeId: 1, amountStoreCents: '1.5' }), 400, 'INVALID_QUERY', { field: 'amountStoreCents' });
    expectError(await get({ storeId: 1, amountStoreCents: 0 }), 400, 'INVALID_QUERY', { field: 'amountStoreCents' });
    expectError(await get({ storeId: 9999, amountStoreCents: 100 }), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
  });
});

describe('segurança (D167)', () => {
  test('POST e PATCH sem Content-Type JSON -> 415', async () => {
    const { id } = (await post(body())).body.data;
    expectError(await request(app).post('/api/withdrawals').set('Content-Type', 'text/plain').send('x'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).post('/api/withdrawals'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).patch(`/api/withdrawals/${id}`).set('Content-Type', 'text/plain').send('x'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).patch(`/api/withdrawals/${id}`), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect((await request(app).get('/api/withdrawals')).body.data.totals.count).toBe(1);
  });

  test('DELETE sem Content-Type funciona', async () => {
    const { id } = (await post(body())).body.data;
    expect((await request(app).delete(`/api/withdrawals/${id}`)).status).toBe(200);
  });

  test.each(['evil.example', 'localhost.evil.example:3001', '10.0.0.5'])('Host %p -> 403 FORBIDDEN_HOST em todas as rotas', async (host) => {
    const { id } = (await post(body())).body.data;
    expectError(await request(app).get('/api/withdrawals').set('Host', host), 403, 'FORBIDDEN_HOST');
    expectError(await request(app).get('/api/withdrawals/fee-suggestion?storeId=1&amountStoreCents=1').set('Host', host), 403, 'FORBIDDEN_HOST');
    expectError(await request(app).post('/api/withdrawals').set('Host', host).send(body()), 403, 'FORBIDDEN_HOST');
    expectError(await request(app).patch(`/api/withdrawals/${id}`).set('Host', host).send({ note: 'x' }), 403, 'FORBIDDEN_HOST');
    expectError(await request(app).delete(`/api/withdrawals/${id}`).set('Host', host), 403, 'FORBIDDEN_HOST');
    expect((await request(app).get('/api/withdrawals')).body.data.totals.count).toBe(1);
  });
});
