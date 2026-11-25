// QA da 8.2 (saques): ordem das validações, formas da entrada, datas, PATCH parcial, listagem, loja em uso,
// saque antigo sem loja. Complementa withdrawals.test.js. A sugestão de taxa fica em withdrawals.feeSuggestion.qa.test.js.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Withdrawal = require('../../src/models/Withdrawal');
const { MAX_AMOUNT_CENTS } = require('../../src/config/constants');
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
const list = async () => (await request(app).get('/api/withdrawals')).body.data;
const body = (overrides = {}) => ({
  storeId: storeId('CSFloat'), amountStoreCents: 10000, feeCents: 250, amountBrlCents: 52000,
  withdrawnAt: '2026-11-10T12:00:00.000Z', ...overrides,
});
const legacy = (overrides = {}) =>
  Withdrawal.create({ amountBrlCents: 30000, withdrawnAt: '2026-01-05T12:00:00.000Z', note: 'antigo', ...overrides }, { now: NOW });
const rowOf = (id) => getDb().prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);

describe('ordem das validações (POST)', () => {
  test('loja inexistente vem antes de valor, taxa, recebido e data inválidos', async () => {
    expectError(
      await post(body({ storeId: 9999, amountStoreCents: 0, feeCents: -1, amountBrlCents: 0, withdrawnAt: '2030-01-01T00:00:00Z' })),
      400, 'STORE_NOT_FOUND', { field: 'storeId' }
    );
  });

  test('loja sem saque vem antes dos demais erros de valor', async () => {
    expectError(
      await post(body({ storeId: storeId('Steam'), amountStoreCents: 0, amountBrlCents: 0 })),
      400, 'WITHDRAWAL_NOT_ALLOWED', { field: 'storeId' }
    );
  });

  test('valor sacado inválido vem antes da taxa e do recebido', async () => {
    expectError(await post(body({ amountStoreCents: 0, feeCents: -1, amountBrlCents: 0 })), 400, 'INVALID_AMOUNT', { field: 'amountStoreCents' });
  });

  test('taxa (negativa ou acima) vem antes do recebido e da data', async () => {
    expectError(await post(body({ feeCents: -1, amountBrlCents: 0, withdrawnAt: 'x' })), 400, 'INVALID_AMOUNT', { field: 'feeCents' });
    expectError(await post(body({ feeCents: 10001, amountBrlCents: 0, withdrawnAt: 'x' })), 400, 'WITHDRAWAL_FEE_ABOVE_AMOUNT', { field: 'feeCents' });
  });

  test('recebido vem antes da data; data vem antes da nota', async () => {
    expectError(await post(body({ amountBrlCents: 0, withdrawnAt: 'x' })), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    expectError(await post(body({ withdrawnAt: 'x', note: 'n'.repeat(501) })), 400, 'INVALID_DATE', { field: 'withdrawnAt' });
  });

  test('erro de forma (tipo) vem antes de qualquer regra do service', async () => {
    expectError(await post(body({ storeId: 9999, note: 5 })), 400, 'INVALID_FIELD', { field: 'note' });
    expectError(await post(body({ storeId: 'x' })), 400, 'INVALID_FIELD', { field: 'storeId' });
  });

  test('campo desconhecido tem prioridade sobre campo obrigatório ausente', async () => {
    expectError(await post({ foo: 1 }), 400, 'UNKNOWN_FIELD', { field: 'foo' });
  });

  test('ausentes: loja (service), depois valor sacado e data (nessa ordem); o recebido em R$ é opcional', async () => {
    expectError(await post({ amountStoreCents: 5, amountBrlCents: 5, withdrawnAt: '2026-11-10T12:00:00.000Z' }), 400, 'STORE_REQUIRED', { field: 'storeId' });
    expectError(await post({ storeId: null, amountStoreCents: 5, amountBrlCents: 5, withdrawnAt: '2026-11-10T12:00:00.000Z' }), 400, 'STORE_REQUIRED', { field: 'storeId' });
    expectError(await post({ storeId: storeId('CSFloat') }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    expectError(await post({ storeId: storeId('CSFloat'), amountStoreCents: 5 }), 400, 'REQUIRED_FIELD', { field: 'withdrawnAt' });
    expectError(await post({ storeId: storeId('CSFloat'), amountStoreCents: 5, amountBrlCents: 5 }), 400, 'REQUIRED_FIELD', { field: 'withdrawnAt' });
    const ok = await post({ storeId: storeId('CSFloat'), amountStoreCents: 5, withdrawnAt: '2026-11-10T12:00:00.000Z' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ amountBrlCents: null, netStoreCents: 5, amountUsdCents: 5 });
  });
});

describe('loja ao criar', () => {
  test('id 0, negativo e muito grande -> STORE_NOT_FOUND', async () => {
    for (const id of [0, -1, 2 ** 40]) expectError(await post(body({ storeId: id })), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
  });

  test('storeId como string numérica, booleano, objeto ou array -> INVALID_FIELD', async () => {
    for (const v of ['1', true, {}, [1]]) expectError(await post(body({ storeId: v })), 400, 'INVALID_FIELD', { field: 'storeId' });
  });

  test('loja inativa sem "permite saque" -> WITHDRAWAL_NOT_ALLOWED', async () => {
    await request(app).patch(`/api/stores/${storeId('Steam')}`).send({ isActive: false }).expect(200);
    expectError(await post(body({ storeId: storeId('Steam') })), 400, 'WITHDRAWAL_NOT_ALLOWED', { field: 'storeId' });
  });

  test('loja que perdeu "permite saque": novo saque recusado', async () => {
    await request(app).patch(`/api/stores/${storeId('CSFloat')}`).send({ allowsWithdrawal: false }).expect(200);
    expectError(await post(body()), 400, 'WITHDRAWAL_NOT_ALLOWED', { field: 'storeId' });
  });
});

describe('valores e taxa', () => {
  test('limites do valor sacado e do recebido: 1 e MAX aceitos; MAX+1, 0, negativo e decimal recusados', async () => {
    expect((await post(body({ amountStoreCents: 1, feeCents: 1 }))).status).toBe(201);
    expect((await post(body({ amountStoreCents: MAX_AMOUNT_CENTS, feeCents: null, amountBrlCents: MAX_AMOUNT_CENTS }))).status).toBe(201);
    for (const v of [MAX_AMOUNT_CENTS + 1, 0, -1, 1.5]) {
      expectError(await post(body({ amountStoreCents: v, feeCents: null })), 400, 'INVALID_AMOUNT', { field: 'amountStoreCents' });
      expectError(await post(body({ amountBrlCents: v })), 400, 'INVALID_AMOUNT', { field: 'amountBrlCents' });
    }
  });

  test('taxa: 0, igual ao valor e nula aceitas; valor+1, negativa e decimal recusadas', async () => {
    expect((await post(body({ feeCents: 0 }))).body.data.feeCents).toBe(0);
    expect((await post(body({ feeCents: 10000 }))).body.data.feeCents).toBe(10000);
    expectError(await post(body({ feeCents: 10001 })), 400, 'WITHDRAWAL_FEE_ABOVE_AMOUNT', { field: 'feeCents' });
    expectError(await post(body({ feeCents: -1 })), 400, 'INVALID_AMOUNT', { field: 'feeCents' });
    expectError(await post(body({ feeCents: 2.5 })), 400, 'INVALID_AMOUNT', { field: 'feeCents' });
    expectError(await post(body({ feeCents: '250' })), 400, 'INVALID_FIELD', { field: 'feeCents' });
    expectError(await post(body({ feeCents: 2 ** 60 })), 400, 'INVALID_AMOUNT', { field: 'feeCents' });
  });

  test('sem validação cruzada: recebido em BRL muito maior ou menor que o sacado é aceito', async () => {
    expect((await post(body({ amountBrlCents: 1 }))).status).toBe(201);
    expect((await post(body({ amountBrlCents: 99999999 }))).status).toBe(201);
  });

  test('valor sacado e data nulos -> REQUIRED_FIELD; recebido em R$ nulo é aceito (informativo)', async () => {
    for (const key of ['amountStoreCents', 'withdrawnAt']) {
      expectError(await post(body({ [key]: null })), 400, 'REQUIRED_FIELD', { field: key });
    }
    expect((await post(body({ amountBrlCents: null }))).body.data.amountBrlCents).toBeNull();
  });
});

describe('datas', () => {
  test.each([
    ['somente data', '2026-11-10'],
    ['sem fuso', '2026-11-10T12:00:00'],
    ['dia impossível', '2026-02-30T10:00:00Z'],
    ['mês 13', '2026-13-01T10:00:00Z'],
    ['hora 24', '2026-11-10T24:00:00Z'],
    ['barra', '10/11/2026'],
    ['vazia', ''],
    ['offset fora da faixa', '2026-11-10T12:00:00+25:00'],
  ])('formato inválido (%s) -> INVALID_DATE', async (_name, value) => {
    expectError(await post(body({ withdrawnAt: value })), 400, 'INVALID_DATE', { field: 'withdrawnAt' });
  });

  test('tipo errado (número, booleano) -> INVALID_FIELD', async () => {
    expectError(await post(body({ withdrawnAt: 1731240000000 })), 400, 'INVALID_FIELD', { field: 'withdrawnAt' });
    expectError(await post(body({ withdrawnAt: true })), 400, 'INVALID_FIELD', { field: 'withdrawnAt' });
  });

  test('offsets são normalizados para UTC (+05:30, -03:00, sem segundos)', async () => {
    expect((await post(body({ withdrawnAt: '2026-11-10T12:00:00+05:30' }))).body.data.withdrawnAt).toBe('2026-11-10T06:30:00.000Z');
    expect((await post(body({ withdrawnAt: '2026-11-10T09:00-03:00' }))).body.data.withdrawnAt).toBe('2026-11-10T12:00:00.000Z');
  });

  test('virada BRT/UTC (agora = 19/11 12:00 em Brasília): 02:59:59Z do dia 20 passa, 03:00:00Z não', async () => {
    expect((await post(body({ withdrawnAt: '2026-11-20T02:59:59.999Z' }))).status).toBe(201);
    expectError(await post(body({ withdrawnAt: '2026-11-20T03:00:00.000Z' })), 400, 'WITHDRAWN_AT_IN_FUTURE', { field: 'withdrawnAt' });
    expect((await post(body({ withdrawnAt: '2026-11-19T23:59:00-03:00' }))).status).toBe(201);
    expectError(await post(body({ withdrawnAt: '2026-11-20T00:00:00-03:00' })), 400, 'WITHDRAWN_AT_IN_FUTURE', { field: 'withdrawnAt' });
    // +14:00: 20/11 10:00 local = 19/11 20:00Z = 19/11 17:00 em Brasília -> ainda hoje
    expect((await post(body({ withdrawnAt: '2026-11-20T10:00:00+14:00' }))).status).toBe(201);
  });

  test('"hoje" segue o relógio injetado: 01:00Z do dia 20 ainda é dia 19 em Brasília', async () => {
    const lateApp = makeApp(new Date('2026-11-20T01:00:00.000Z'));
    const ok = await request(lateApp).post('/api/withdrawals').send(body({ withdrawnAt: '2026-11-19T23:30:00-03:00' }));
    expect(ok.status).toBe(201);
    expectError(
      await request(lateApp).post('/api/withdrawals').send(body({ withdrawnAt: '2026-11-20T00:00:00-03:00' })),
      400, 'WITHDRAWN_AT_IN_FUTURE'
    );
  });
});

describe('nota', () => {
  test('trim, vazia vira null, 500 aceita (inclusive com espaços ao redor), 501 recusada, tipo errado', async () => {
    expect((await post(body({ note: '  oi  ' }))).body.data.note).toBe('oi');
    expect((await post(body({ note: '   ' }))).body.data.note).toBeNull();
    expect((await post(body({ note: 'x'.repeat(500) }))).status).toBe(201);
    expect((await post(body({ note: `  ${'x'.repeat(500)}  ` }))).status).toBe(201);
    expectError(await post(body({ note: 'x'.repeat(501) })), 400, 'FIELD_TOO_LONG', { field: 'note' });
    expectError(await post(body({ note: 12 })), 400, 'INVALID_FIELD', { field: 'note' });
    expect((await post(body({ note: null }))).body.data.note).toBeNull();
  });

  test('PATCH: nota com trim, vazia vira null, longa recusada', async () => {
    const { id } = (await post(body({ note: 'a' }))).body.data;
    expect((await patch(id, { note: ' b ' })).body.data.note).toBe('b');
    expect((await patch(id, { note: '' })).body.data.note).toBeNull();
    expectError(await patch(id, { note: 'x'.repeat(501) }), 400, 'FIELD_TOO_LONG', { field: 'note' });
  });
});

describe('PATCH parcial', () => {
  test('só revalida a data quando ela é enviada (data gravada futura não bloqueia outras edições)', async () => {
    const future = Withdrawal.create(
      { storeId: storeId('CSFloat'), amountStoreCents: 100, feeCents: null, amountBrlCents: 500, withdrawnAt: '2030-01-01T00:00:00.000Z', note: null },
      { now: NOW }
    );
    expect((await patch(future.id, { note: 'ok' })).status).toBe(200);
    expect(rowOf(future.id).withdrawn_at).toBe('2030-01-01T00:00:00.000Z');
    expectError(await patch(future.id, { withdrawnAt: '2030-01-01T00:00:00.000Z' }), 400, 'WITHDRAWN_AT_IN_FUTURE', { field: 'withdrawnAt' });
    expect((await patch(future.id, { withdrawnAt: '2026-11-01T00:00:00.000Z' })).status).toBe(200);
  });

  test('enviar a data com offset normaliza para UTC', async () => {
    const { id } = (await post(body())).body.data;
    expect((await patch(id, { withdrawnAt: '2026-11-11T09:00:00-03:00' })).body.data.withdrawnAt).toBe('2026-11-11T12:00:00.000Z');
  });

  test('valor sacado abaixo da taxa gravada recusado; igual aceito; junto com taxa menor aceito', async () => {
    const { id } = (await post(body())).body.data; // taxa 250
    expectError(await patch(id, { amountStoreCents: 249 }), 400, 'WITHDRAWAL_FEE_ABOVE_AMOUNT', { field: 'feeCents' });
    expect((await patch(id, { amountStoreCents: 250 })).status).toBe(200);
    expect((await patch(id, { amountStoreCents: 100, feeCents: 0 })).body.data).toMatchObject({ amountStoreCents: 100, feeCents: 0 });
    expectError(await patch(id, { feeCents: 101 }), 400, 'WITHDRAWAL_FEE_ABOVE_AMOUNT', { field: 'feeCents' });
    expectError(await patch(id, { feeCents: -1 }), 400, 'INVALID_AMOUNT', { field: 'feeCents' });
    expectError(await patch(id, { feeCents: 0.5 }), 400, 'INVALID_AMOUNT', { field: 'feeCents' });
  });

  test('nulos: storeId (STORE_REQUIRED), feeCents, amountBrlCents e note aceitam null; os demais -> REQUIRED_FIELD', async () => {
    const { id } = (await post(body())).body.data;
    for (const key of ['amountStoreCents', 'withdrawnAt']) {
      expectError(await patch(id, { [key]: null }), 400, 'REQUIRED_FIELD', { field: key });
    }
    expect((await patch(id, { amountBrlCents: null })).body.data.amountBrlCents).toBeNull();
    expectError(await patch(id, { storeId: null }), 400, 'STORE_REQUIRED', { field: 'storeId' });
  });

  test('loja: reenviar a mesma é aceito sem "permite saque"; trocar para outra sem saque é recusado; para inativa com saque, aceito', async () => {
    const csf = storeId('CSFloat');
    const { id } = (await post(body())).body.data;
    await request(app).patch(`/api/stores/${csf}`).send({ allowsWithdrawal: false }).expect(200);
    expect((await patch(id, { storeId: csf, note: 'igual' })).status).toBe(200);
    expectError(await patch(id, { storeId: storeId('Steam') }), 400, 'WITHDRAWAL_NOT_ALLOWED', { field: 'storeId' });
    await request(app).patch(`/api/stores/${storeId('CSMoney')}`).send({ isActive: false }).expect(200);
    const res = await patch(id, { storeId: storeId('CSMoney') });
    expect(res.status).toBe(200);
    expect(res.body.data.storeName).toBe('CSMoney');
  });

  test('loja inexistente -> 400 STORE_NOT_FOUND; nada gravado', async () => {
    const { id } = (await post(body())).body.data;
    expectError(await patch(id, { storeId: 9999 }), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    expect(rowOf(id).store_id).toBe(storeId('CSFloat'));
  });

  test('corpo vazio e não objeto -> INVALID_BODY; JSON malformado -> INVALID_JSON', async () => {
    const { id } = (await post(body())).body.data;
    expectError(await patch(id, {}), 400, 'INVALID_BODY');
    expectError(await patch(id, []), 400, 'INVALID_BODY');
    const res = await request(app).patch(`/api/withdrawals/${id}`).set('Content-Type', 'application/json').send('{"note":');
    expectError(res, 400, 'INVALID_JSON');
  });

  test('PATCH não altera createdAt nem campos não enviados, e não cria linha nova', async () => {
    const created = (await post(body({ note: 'n' }))).body.data;
    await patch(created.id, { amountBrlCents: 1 });
    const after = await list();
    expect(after.totals.count).toBe(1);
    expect(after.withdrawals[0]).toMatchObject({ createdAt: created.createdAt, note: 'n', feeCents: 250, amountStoreCents: 10000 });
  });
});

describe('ids e erros HTTP', () => {
  test.each(['abc', '0', '-1', '1.5', '1e2', '99999999999999999999'])('id %p -> 400 INVALID_ID (PATCH e DELETE)', async (id) => {
    expectError(await request(app).patch(`/api/withdrawals/${encodeURIComponent(id)}`).send({ note: 'x' }), 400, 'INVALID_ID');
    expectError(await request(app).delete(`/api/withdrawals/${encodeURIComponent(id)}`), 400, 'INVALID_ID');
  });

  test('id válido inexistente: 404 em PATCH e DELETE', async () => {
    expectError(await patch(123456, { note: 'x' }), 404, 'WITHDRAWAL_NOT_FOUND');
    expectError(await request(app).delete('/api/withdrawals/123456'), 404, 'WITHDRAWAL_NOT_FOUND');
  });

  test('POST aceita application/json com charset; form-urlencoded -> 415 em POST e PATCH', async () => {
    const { id } = (await post(body())).body.data;
    const ok = await request(app).post('/api/withdrawals').set('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body()));
    expect(ok.status).toBe(201);
    expectError(
      await request(app).post('/api/withdrawals').set('Content-Type', 'application/x-www-form-urlencoded').send('storeId=1'),
      415, 'UNSUPPORTED_MEDIA_TYPE'
    );
    expectError(
      await request(app).patch(`/api/withdrawals/${id}`).set('Content-Type', 'application/x-www-form-urlencoded').send('note=x'),
      415, 'UNSUPPORTED_MEDIA_TYPE'
    );
  });

  test('o tipo é checado antes do 404 no PATCH; DELETE sem tipo em id inexistente é 404', async () => {
    expectError(await request(app).patch('/api/withdrawals/9999').set('Content-Type', 'text/plain').send('x'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).delete('/api/withdrawals/9999'), 404, 'WITHDRAWAL_NOT_FOUND');
  });

  test('Host inválido não grava nada; hosts locais passam', async () => {
    const { id } = (await post(body())).body.data;
    expectError(await request(app).post('/api/withdrawals').set('Host', 'evil.example').send(body()), 403, 'FORBIDDEN_HOST');
    expectError(await request(app).patch(`/api/withdrawals/${id}`).set('Host', 'evil.example').send({ note: 'x' }), 403, 'FORBIDDEN_HOST');
    expectError(await request(app).delete(`/api/withdrawals/${id}`).set('Host', 'evil.example'), 403, 'FORBIDDEN_HOST');
    expect((await list()).totals.count).toBe(1);
    for (const host of ['localhost:3001', '127.0.0.1:3001', 'localhost']) {
      expect((await request(app).get('/api/withdrawals').set('Host', host)).status).toBe(200);
    }
  });
});

describe('listagem', () => {
  test('desempate: mesma data -> id DESC; data maior primeiro independente da ordem de criação', async () => {
    const mid = (await post(body({ withdrawnAt: '2026-11-05T12:00:00.000Z' }))).body.data;
    const newest = (await post(body({ withdrawnAt: '2026-11-09T12:00:00.000Z' }))).body.data;
    const oldest = (await post(body({ withdrawnAt: '2026-10-01T12:00:00.000Z' }))).body.data;
    const midTwin = (await post(body({ withdrawnAt: '2026-11-05T12:00:00.000Z' }))).body.data;
    expect((await list()).withdrawals.map((w) => w.id)).toEqual([newest.id, midTwin.id, mid.id, oldest.id]);
  });

  test('datas informadas com offsets diferentes ordenam pelo instante real (gravadas em UTC)', async () => {
    const a = (await post(body({ withdrawnAt: '2026-11-05T23:00:00-03:00' }))).body.data; // 06/11 02:00Z
    const b = (await post(body({ withdrawnAt: '2026-11-06T01:00:00Z' }))).body.data; // 06/11 01:00Z
    expect((await list()).withdrawals.map((w) => w.id)).toEqual([a.id, b.id]);
  });

  test('totais somam o líquido em US$ (inclui saque antigo convertido) e acompanham PATCH e DELETE', async () => {
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5 }).expect(200);
    const a = (await post(body({ amountStoreCents: 1000, feeCents: 0 }))).body.data;
    await post(body({ amountStoreCents: 2500, feeCents: 500 }));
    legacy({ amountBrlCents: 7000 }); // 7000 / 5 = 1400
    const totals = async () => { const t = (await list()).totals; return [t.count, t.netUsdCents, t.approxCents]; };
    expect(await totals()).toEqual([3, 1000 + 2000 + 1400, 22000]);
    await patch(a.id, { amountStoreCents: 1500 });
    expect(await totals()).toEqual([3, 1500 + 2000 + 1400, 24500]);
    await request(app).delete(`/api/withdrawals/${a.id}`);
    expect(await totals()).toEqual([2, 2000 + 1400, 17000]);
  });

  test('a view traz a moeda da loja (BRL) e currency nula no saque antigo', async () => {
    await request(app).patch(`/api/stores/${storeId('Steam')}`).send({ allowsWithdrawal: true }).expect(200);
    await post(body({ storeId: storeId('Steam') }));
    const old = legacy();
    const { withdrawals } = await list();
    expect(withdrawals.find((w) => w.storeName === 'Steam').currency).toBe('BRL');
    expect(withdrawals.find((w) => w.id === old.id)).toMatchObject({ currency: null, storeName: null, legacyWithoutStore: true });
  });
});

describe('loja em uso', () => {
  test('excluir loja com saque -> 409 STORE_IN_USE; depois de excluir o saque, a loja pode ser excluída', async () => {
    const sid = storeId('CSMoney');
    const { id } = (await post(body({ storeId: sid, feeCents: null }))).body.data;
    expectError(await request(app).delete(`/api/stores/${sid}`), 409, 'STORE_IN_USE');
    expect((await list()).totals.count).toBe(1);
    await request(app).delete(`/api/withdrawals/${id}`).expect(200);
    expect((await request(app).delete(`/api/stores/${sid}`)).status).toBe(200);
  });

  test('trocar a moeda de loja com saque -> STORE_CURRENCY_LOCKED', async () => {
    await post(body());
    const res = await request(app).patch(`/api/stores/${storeId('CSFloat')}`).send({ currency: 'BRL' });
    expectError(res, 409, 'STORE_CURRENCY_LOCKED');
  });
});

describe('saque antigo sem loja', () => {
  test('listagem e exclusão funcionam; o antigo entra nos totais', async () => {
    const old = legacy();
    const data = await list();
    expect(data.withdrawals).toHaveLength(1);
    expect(data.withdrawals[0].legacyWithoutStore).toBe(true);
    expect(data.totals).toEqual({ count: 1, legacyCount: 1, withoutFeeCount: 0, netUsdCents: null, approxCents: null, approxCurrency: 'BRL', estimated: true });
    expect((await request(app).delete(`/api/withdrawals/${old.id}`)).status).toBe(200);
  });

  test('PATCH só da nota -> 400 STORE_REQUIRED com a mensagem genérica de loja obrigatória; nada é gravado', async () => {
    const old = legacy();
    const res = await patch(old.id, { note: 'corrigida' });
    expectError(res, 400, 'STORE_REQUIRED', { field: 'storeId' });
    expect(res.body.error.message).toBe('A loja do saque é obrigatória.');
    expect(rowOf(old.id).note).toBe('antigo');
  });

  test('PATCH só de recebido ou data também exige loja e valor sacado', async () => {
    const old = legacy();
    expectError(await patch(old.id, { amountBrlCents: 1 }), 400, 'STORE_REQUIRED', { field: 'storeId' });
    expectError(await patch(old.id, { withdrawnAt: '2026-01-06T12:00:00Z' }), 400, 'STORE_REQUIRED', { field: 'storeId' });
    expectError(await patch(old.id, { storeId: storeId('CSFloat'), note: 'x' }), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    expectError(await patch(old.id, { amountStoreCents: 100 }), 400, 'STORE_REQUIRED', { field: 'storeId' });
  });

  test('com loja e valor, o antigo vira normal; a data antiga não é revalidada', async () => {
    const old = legacy({ withdrawnAt: '2030-05-05T12:00:00.000Z' });
    const res = await patch(old.id, { storeId: storeId('CSFloat'), amountStoreCents: 5000, note: 'ok' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ legacyWithoutStore: false, withdrawnAt: '2030-05-05T12:00:00.000Z', feeCents: null, note: 'ok' });
  });

  test('taxa acima do valor informado na regularização -> WITHDRAWAL_FEE_ABOVE_AMOUNT', async () => {
    const old = legacy();
    expectError(
      await patch(old.id, { storeId: storeId('CSFloat'), amountStoreCents: 100, feeCents: 101 }),
      400, 'WITHDRAWAL_FEE_ABOVE_AMOUNT', { field: 'feeCents' }
    );
  });
});
