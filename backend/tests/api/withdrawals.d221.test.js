// D221 (revisão final da Etapa 8): troca de loja no PATCH de saque, casos de borda e ordem dos erros.
const request = require('supertest');
const Withdrawal = require('../../src/models/Withdrawal');
const { closeDb } = require('../../src/config/database');
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
const getOne = async (id) => (await request(app).get('/api/withdrawals')).body.data.withdrawals.find((w) => w.id === id);
const setAllows = (name, allowsWithdrawal) =>
  request(app).patch(`/api/stores/${storeId(name)}`).send({ allowsWithdrawal }).expect(200);
const allowSteam = () => setAllows('Steam', true);
const body = (o = {}) => ({
  storeId: storeId('CSFloat'), amountStoreCents: 10000, feeCents: 250, amountBrlCents: 52000,
  withdrawnAt: '2026-11-10T12:00:00.000Z', ...o,
});
const create = async (o) => (await post(body(o))).body.data;

describe('D221: mesma loja e mesma moeda', () => {
  test('storeId igual ao gravado, sem amountStoreCents -> 200 e valor/taxa mantidos', async () => {
    const w = await create();
    const res = await patch(w.id, { storeId: storeId('CSFloat'), note: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ amountStoreCents: 10000, feeCents: 250, note: 'x' });
  });

  test('USD -> USD: valor e taxa gravados são mantidos (feeCents ausente não zera a taxa)', async () => {
    const w = await create();
    const res = await patch(w.id, { storeId: storeId('CSMoney') });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ storeName: 'CSMoney', currency: 'USD', amountStoreCents: 10000, feeCents: 250 });
  });

  test('USD -> USD com amountStoreCents menor que a taxa gravada -> WITHDRAWAL_FEE_ABOVE_AMOUNT', async () => {
    const w = await create();
    expectError(await patch(w.id, { storeId: storeId('CSMoney'), amountStoreCents: 100 }), 400, 'WITHDRAWAL_FEE_ABOVE_AMOUNT', { field: 'feeCents' });
  });
});

describe('D221: moeda diferente', () => {
  beforeEach(allowSteam);

  test('USD -> BRL sem valor: 400 REQUIRED_FIELD e o registro não muda', async () => {
    const w = await create();
    expectError(await patch(w.id, { storeId: storeId('Steam'), feeCents: 100 }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    expect(await getOne(w.id)).toEqual(w);
  });

  test('BRL -> USD sem valor também exige amountStoreCents', async () => {
    const w = await create({ storeId: storeId('Steam') });
    expectError(await patch(w.id, { storeId: storeId('CSFloat') }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    const ok = await patch(w.id, { storeId: storeId('CSFloat'), amountStoreCents: 9000 });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ currency: 'USD', amountStoreCents: 9000 });
  });

  test('com valor e sem feeCents: a taxa gravada é mantida se couber no valor', async () => {
    const w = await create();
    const res = await patch(w.id, { storeId: storeId('Steam'), amountStoreCents: 52000 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ currency: 'BRL', amountStoreCents: 52000, feeCents: 250 });
  });

  test('valor menor que a taxa gravada sem feeCents -> WITHDRAWAL_FEE_ABOVE_AMOUNT; registro não muda', async () => {
    const w = await create();
    expectError(await patch(w.id, { storeId: storeId('Steam'), amountStoreCents: 100 }), 400, 'WITHDRAWAL_FEE_ABOVE_AMOUNT', { field: 'feeCents' });
    expect(await getOne(w.id)).toEqual(w);
  });

  test('feeCents: null limpa a taxa e o valor menor passa; feeCents: 0 grava zero', async () => {
    const w = await create();
    const a = await patch(w.id, { storeId: storeId('Steam'), amountStoreCents: 100, feeCents: null });
    expect(a.status).toBe(200);
    expect(a.body.data.feeCents).toBeNull();
    const w2 = await create();
    const b = await patch(w2.id, { storeId: storeId('Steam'), amountStoreCents: 100, feeCents: 0 });
    expect(b.body.data.feeCents).toBe(0);
  });

  test('saque com taxa nula: troca de moeda com valor mantém a taxa nula', async () => {
    const w = await create({ feeCents: undefined });
    expect(w.feeCents).toBeNull();
    const res = await patch(w.id, { storeId: storeId('Steam'), amountStoreCents: 100 });
    expect(res.status).toBe(200);
    expect(res.body.data.feeCents).toBeNull();
  });

  test('amountStoreCents: null explícito na troca de moeda nunca dá 200', async () => {
    const w = await create();
    const res = await patch(w.id, { storeId: storeId('Steam'), amountStoreCents: null });
    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe('amountStoreCents');
  });
});

describe('D221: saque antigo sem loja', () => {
  const legacy = () => Withdrawal.create({ amountBrlCents: 30000, withdrawnAt: '2026-01-05T12:00:00.000Z', note: 'antigo' }, { now: NOW });

  test('só nota -> STORE_REQUIRED; storeId sem valor -> REQUIRED_FIELD; com os dois -> 200', async () => {
    const old = legacy();
    expectError(await patch(old.id, { note: 'n' }), 400, 'STORE_REQUIRED', { field: 'storeId' });
    expectError(await patch(old.id, { storeId: storeId('CSFloat') }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    const ok = await patch(old.id, { storeId: storeId('CSFloat'), amountStoreCents: 5000 });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ legacyWithoutStore: false, currency: 'USD', amountStoreCents: 5000, feeCents: null });
  });
});

describe('D221: ordem dos erros no PATCH', () => {
  beforeEach(allowSteam);

  test('STORE_NOT_FOUND antes de tudo (mesmo com valores inválidos)', async () => {
    const w = await create();
    expectError(await patch(w.id, { storeId: 9999, feeCents: 99999999 }), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
  });

  test('WITHDRAWAL_NOT_ALLOWED antes de REQUIRED_FIELD (loja da mesma e de outra moeda)', async () => {
    const w = await create();
    await setAllows('CSMoney', false);
    expectError(await patch(w.id, { storeId: storeId('CSMoney') }), 400, 'WITHDRAWAL_NOT_ALLOWED', { field: 'storeId' });
    await setAllows('Steam', false);
    expectError(await patch(w.id, { storeId: storeId('Steam') }), 400, 'WITHDRAWAL_NOT_ALLOWED', { field: 'storeId' });
  });

  test('REQUIRED_FIELD antes de FEE_ABOVE_AMOUNT e de data futura', async () => {
    const w = await create();
    expectError(
      await patch(w.id, { storeId: storeId('Steam'), feeCents: 99999, withdrawnAt: '2099-01-01T00:00:00.000Z' }),
      400, 'REQUIRED_FIELD', { field: 'amountStoreCents' }
    );
  });

  test('valor inválido antes de FEE_ABOVE_AMOUNT; FEE_ABOVE_AMOUNT antes da data futura', async () => {
    const w = await create();
    expectError(await patch(w.id, { storeId: storeId('Steam'), amountStoreCents: 0, feeCents: 5 }), 400, 'INVALID_AMOUNT', { field: 'amountStoreCents' });
    expectError(
      await patch(w.id, { storeId: storeId('Steam'), amountStoreCents: 100, feeCents: 500, withdrawnAt: '2099-01-01T00:00:00.000Z' }),
      400, 'WITHDRAWAL_FEE_ABOVE_AMOUNT', { field: 'feeCents' }
    );
    expectError(
      await patch(w.id, { storeId: storeId('Steam'), amountStoreCents: 100, feeCents: null, withdrawnAt: '2099-01-01T00:00:00.000Z' }),
      400, 'WITHDRAWN_AT_IN_FUTURE', { field: 'withdrawnAt' }
    );
    expect(await getOne(w.id)).toEqual(w);
  });
});
