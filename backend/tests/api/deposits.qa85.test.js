// QA 8.5 (API de aportes): ordem dos erros, loja BRL no POST e no PATCH, loja inativa USD, STORE_CURRENCY_LOCKED, R$ opcional
// (ausente, null, 0).
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const Deposit = require('../../src/models/Deposit');
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
const ok = (overrides = {}) => ({ storeId: storeId('CSFloat'), amountStoreCents: 10000, depositedAt: '2026-11-10T12:00:00.000Z', ...overrides });
const legacy = (overrides = {}) => Deposit.create(
  { storeId: null, amountStoreCents: null, amountBrlCents: 30000, depositedAt: '2026-10-05T12:00:00.000Z', note: 'pix', ...overrides }, { now: NOW }
);

describe('ordem dos erros (POST)', () => {
  const wrong = { amountStoreCents: 0, amountBrlCents: 0, depositedAt: '2099-01-01T00:00:00.000Z', note: 'x'.repeat(501) };

  test('moeda da loja vem antes de valor, valor pago, data e nota', async () => {
    expectError(await post({ ...wrong, storeId: storeId('Steam') }), 400, 'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
  });
  test('loja inexistente vem antes de tudo; sem loja também', async () => {
    expectError(await post({ ...wrong, storeId: 99999 }), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    expectError(await post({ ...wrong }), 400, 'STORE_REQUIRED', { field: 'storeId' });
  });
  test('valor creditado antes do valor pago, da data e da nota', async () => {
    expectError(await post({ ...wrong, storeId: storeId('CSFloat') }), 400, 'INVALID_AMOUNT', { field: 'amountStoreCents' });
  });
  test('valor pago 0 antes da data futura e da nota', async () => {
    expectError(await post({ ...wrong, storeId: storeId('CSFloat'), amountStoreCents: 1 }), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
  });
  test('data futura antes da nota', async () => {
    expectError(await post({ ...wrong, storeId: storeId('CSFloat'), amountStoreCents: 1, amountBrlCents: null }), 400, 'DEPOSITED_AT_IN_FUTURE', { field: 'depositedAt' });
  });
  test('nota longa por último', async () => {
    expectError(await post({ ...wrong, storeId: storeId('CSFloat'), amountStoreCents: 1, amountBrlCents: null, depositedAt: '2026-11-10T12:00:00.000Z' }), 400, 'FIELD_TOO_LONG', { field: 'note' });
  });
  test('valor creditado ausente é REQUIRED_FIELD; o valor pago ausente nunca é erro', async () => {
    expectError(await post({ storeId: storeId('CSFloat'), depositedAt: '2026-11-10T12:00:00.000Z' }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    expect((await post(ok())).status).toBe(201);
  });
});

describe('valor pago em R$ opcional', () => {
  test('ausente, null e omitido gravam null; 0 e negativo -> INVALID_AMOUNT em amountBrlCents', async () => {
    expect((await post(ok())).body.data.amountBrlCents).toBeNull();
    expect((await post(ok({ amountBrlCents: null }))).body.data.amountBrlCents).toBeNull();
    expectError(await post(ok({ amountBrlCents: 0 })), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    expectError(await post(ok({ amountBrlCents: -1 })), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    expectError(await post(ok({ amountBrlCents: 1.5 })), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    expect((await post(ok({ amountBrlCents: 1 }))).body.data.amountBrlCents).toBe(1);
  });
  test('PATCH: null limpa; 0 recusado e nada é gravado', async () => {
    const created = (await post(ok({ amountBrlCents: 50000 }))).body.data;
    expectError(await patch(created.id, { amountBrlCents: 0 }), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    expect(Deposit.findById(created.id).amountBrlCents).toBe(50000);
    expect((await patch(created.id, { amountBrlCents: null })).body.data.amountBrlCents).toBeNull();
  });
  test('o valor pago não muda o US$ nem o "≈ R$" do aporte', async () => {
    Setting.update({ usdBrlRate: 5.4321 }, { now: NOW });
    const a = (await post(ok({ amountBrlCents: 1 }))).body.data;
    const b = (await post(ok({ amountBrlCents: 99999999 }))).body.data;
    expect([a.amountUsdCents, b.amountUsdCents]).toEqual([10000, 10000]);
    expect(a.approxCents).toBe(b.approxCents);
  });
});

describe('loja: PATCH e travas', () => {
  test('loja inativa em USD aceita no POST e no PATCH; BRL inativa recusada', async () => {
    const inactiveUsd = storeId('CSMoney');
    await request(app).patch(`/api/stores/${inactiveUsd}`).send({ isActive: false }).expect(200);
    const created = await post(ok({ storeId: inactiveUsd }));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ storeName: 'CSMoney', currency: 'USD' });
    const normal = (await post(ok())).body.data;
    expect((await patch(normal.id, { storeId: inactiveUsd })).status).toBe(200);
  });

  test('PATCH para loja BRL -> DEPOSIT_STORE_CURRENCY_NOT_ALLOWED e o aporte não muda', async () => {
    const normal = (await post(ok())).body.data;
    expectError(await patch(normal.id, { storeId: storeId('Steam') }), 400, 'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
    expect(Deposit.findById(normal.id).storeId).toBe(storeId('CSFloat'));
  });

  test('loja com aporte não troca de moeda: STORE_CURRENCY_LOCKED (o valor está na moeda da loja)', async () => {
    const csf = storeId('CSFloat');
    await post(ok());
    const res = await request(app).patch(`/api/stores/${csf}`).send({ currency: 'BRL' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STORE_CURRENCY_LOCKED');
    expect(getDb().prepare('SELECT currency FROM stores WHERE id = ?').get(csf).currency).toBe('USD');
  });

  test('amountStoreCents: tipos errados no corpo e nulo no PATCH', async () => {
    const normal = (await post(ok())).body.data;
    for (const bad of ['100', true, [], {}]) expect((await post(ok({ amountStoreCents: bad }))).status).toBe(400);
    expectError(await patch(normal.id, { amountStoreCents: null }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    expectError(await patch(normal.id, { amountStoreCents: 0 }), 400, 'INVALID_AMOUNT', { field: 'amountStoreCents' });
  });
});

describe('aporte legado pela API', () => {
  test('sem loja: só a nota -> STORE_REQUIRED; loja USD sem valor -> REQUIRED_FIELD; loja e valor -> deixa de ser legado', async () => {
    const old = legacy();
    expectError(await patch(old.id, { note: 'x' }), 400, 'STORE_REQUIRED', { field: 'storeId' });
    expectError(await patch(old.id, { storeId: storeId('CSFloat') }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    expect(Deposit.findById(old.id).amountStoreCents).toBeNull();
    const done = await patch(old.id, { storeId: storeId('CSFloat'), amountStoreCents: 5523 });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ legacy: false, amountStoreCents: 5523, amountBrlCents: 30000, amountUsdCents: 5523, estimated: false });
  });

  test('loja informativa BRL (Steam): editar só o valor ou só a nota -> DEPOSIT_STORE_CURRENCY_NOT_ALLOWED; com loja USD, aceito', async () => {
    const old = legacy({ storeId: storeId('Steam') });
    const view = (await request(app).get('/api/deposits')).body.data.deposits[0];
    expect(view).toMatchObject({ legacy: true, storeName: 'Steam', currency: 'BRL' });
    expectError(await patch(old.id, { amountStoreCents: 100 }), 400, 'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
    expectError(await patch(old.id, { note: 'x' }), 400, 'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
    const done = await patch(old.id, { storeId: storeId('CSFloat'), amountStoreCents: 5523 });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ legacy: false, storeName: 'CSFloat' });
  });

  test('exclusão do legado é sempre aceita (inclusive com loja BRL informativa)', async () => {
    const old = legacy({ storeId: storeId('Steam') });
    expect((await request(app).delete(`/api/deposits/${old.id}`)).status).toBe(200);
    expect(Deposit.findById(old.id)).toBeNull();
  });
});

describe('POST sem loja e sem valor (D227): o service decide a ordem', () => {
  test('sem storeId e sem amountStoreCents -> STORE_REQUIRED (não REQUIRED_FIELD do valor)', async () => {
    expectError(await post({ depositedAt: '2026-11-10T12:00:00.000Z' }), 400, 'STORE_REQUIRED', { field: 'storeId' });
  });
  test('com loja e sem valor -> REQUIRED_FIELD em amountStoreCents', async () => {
    expectError(await post({ storeId: storeId('CSFloat'), depositedAt: '2026-11-10T12:00:00.000Z' }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
  });
});
