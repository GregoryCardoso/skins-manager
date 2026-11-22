// QA dos aportes (D201, D202): limites de valor, datas (virada BRT/UTC e formatos), nota, loja inativa, ordenação por instante.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, storeId, expectError } = require('../helpers/apiFixtures');

// NOW = 2026-11-19T15:00:00Z = 12:00 em Brasília
let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/deposits').send(body);
const patch = (id, body) => request(app).patch(`/api/deposits/${id}`).send(body);
const body = (overrides = {}) => ({ storeId: storeId('CSFloat'), amountStoreCents: 10000, depositedAt: '2026-11-10T12:00:00.000Z', ...overrides });
const rowCount = () => getDb().prepare('SELECT COUNT(*) AS n FROM deposits').get().n;

describe('valor', () => {
  test('limites: 1 e 1e10 aceitos; 1e10+1, 0 e negativos recusados', async () => {
    expect((await post(body({ amountStoreCents: 1 }))).status).toBe(201);
    expect((await post(body({ amountStoreCents: 1e10 }))).status).toBe(201);
    expectError(await post(body({ amountStoreCents: 1e10 + 1 })), 400, 'INVALID_AMOUNT', { field: 'amountStoreCents', params: { maxCents: 1e10 } });
    expectError(await post(body({ amountStoreCents: 0 })), 400, 'INVALID_AMOUNT');
    expectError(await post(body({ amountStoreCents: -100 })), 400, 'INVALID_AMOUNT');
    expect(rowCount()).toBe(2);
  });

  test('valores fora do inteiro seguro e fracionários são INVALID_AMOUNT', async () => {
    expectError(await post(body({ amountStoreCents: 2 ** 53 })), 400, 'INVALID_AMOUNT');
    expectError(await post(body({ amountStoreCents: 1e300 })), 400, 'INVALID_AMOUNT');
    expectError(await post(body({ amountStoreCents: 0.5 })), 400, 'INVALID_AMOUNT');
  });

  test('tipos errados são INVALID_FIELD (booleano, texto, lista, objeto, nulo é REQUIRED_FIELD)', async () => {
    for (const bad of [true, '100', [100], { v: 1 }]) {
      expectError(await post(body({ amountStoreCents: bad })), 400, 'INVALID_FIELD', { field: 'amountStoreCents' });
    }
    expectError(await post(body({ amountStoreCents: null })), 400, 'REQUIRED_FIELD', { field: 'amountStoreCents' });
    expect(rowCount()).toBe(0);
  });

  test('PATCH: limites e tipos valem igualmente', async () => {
    const { id } = (await post(body())).body.data;
    expectError(await patch(id, { amountStoreCents: 1e10 + 1 }), 400, 'INVALID_AMOUNT');
    expectError(await patch(id, { amountStoreCents: '5' }), 400, 'INVALID_FIELD');
    expect((await patch(id, { amountStoreCents: 1e10 })).body.data.amountStoreCents).toBe(1e10);
  });
});

describe('data', () => {
  // NOW = 19/11 12:00 BRT. O dia de Brasília acaba em 2026-11-20T02:59:59.999Z.
  test('virada BRT/UTC: 23:59:59 de hoje em Brasília passa; 00:00 de amanhã em Brasília é futuro (mesmo instante em UTC)', async () => {
    expect((await post(body({ depositedAt: '2026-11-20T02:59:59.999Z' }))).status).toBe(201);
    expect((await post(body({ depositedAt: '2026-11-19T23:59:59-03:00' }))).status).toBe(201);
    expectError(await post(body({ depositedAt: '2026-11-20T03:00:00.000Z' })), 400, 'DEPOSITED_AT_IN_FUTURE', { field: 'depositedAt' });
    expectError(await post(body({ depositedAt: '2026-11-20T00:00:00-03:00' })), 400, 'DEPOSITED_AT_IN_FUTURE');
    // mesmo dia UTC (20/11) mas ainda hoje em outro offset: 2026-11-20T00:30:00+01:00 = 19/11 23:30Z
    expect((await post(body({ depositedAt: '2026-11-20T00:30:00+01:00' }))).status).toBe(201);
  });

  test('hoje mais tarde que "agora" ainda é aceito (a regra é por dia, D53)', async () => {
    expect((await post(body({ depositedAt: '2026-11-19T20:00:00-03:00' }))).status).toBe(201);
  });

  test('formatos inválidos: INVALID_DATE com field', async () => {
    for (const bad of ['', '2026-11-10', '2026-11-10T12:00:00', '10/11/2026', '2026-13-01T00:00:00Z', '2026-02-30T00:00:00Z', 'ontem', '2026-11-10 12:00:00Z']) {
      expectError(await post(body({ depositedAt: bad })), 400, 'INVALID_DATE', { field: 'depositedAt' });
    }
    for (const bad of [20261110, true, [], {}]) {
      expectError(await post(body({ depositedAt: bad })), 400, 'INVALID_FIELD', { field: 'depositedAt' });
    }
    expectError(await post(body({ depositedAt: null })), 400, 'REQUIRED_FIELD', { field: 'depositedAt' });
    expect(rowCount()).toBe(0);
  });

  test('é normalizada para UTC; offset positivo e sem segundos', async () => {
    expect((await post(body({ depositedAt: '2026-11-10T09:30+02:00' }))).body.data.depositedAt).toBe('2026-11-10T07:30:00.000Z');
  });

  test('PATCH: só revalida a data quando ela é enviada; mudar a data para o futuro é recusado e nada muda', async () => {
    const { id } = (await post(body())).body.data;
    // com o relógio ANTES da data gravada, um PATCH de outro campo não deve falhar por data
    const early = makeApp(new Date('2026-11-01T15:00:00.000Z'));
    expect((await request(early).patch(`/api/deposits/${id}`).send({ note: 'ok' })).status).toBe(200);
    expectError(await request(early).patch(`/api/deposits/${id}`).send({ depositedAt: '2026-11-10T12:00:00.000Z' }), 400, 'DEPOSITED_AT_IN_FUTURE');
    expectError(await patch(id, { depositedAt: 'x' }), 400, 'INVALID_DATE');
    expect(getDb().prepare('SELECT deposited_at AS d FROM deposits WHERE id = ?').get(id).d).toBe('2026-11-10T12:00:00.000Z');
  });
});

describe('observação', () => {
  test('trim; 500 após o trim passa; 501 não; só espaços vira null', async () => {
    expect((await post(body({ note: `  ${'x'.repeat(500)}  ` }))).body.data.note).toHaveLength(500);
    expectError(await post(body({ note: 'x'.repeat(501) })), 400, 'FIELD_TOO_LONG', { field: 'note', params: { maxLength: 500 } });
    expect((await post(body({ note: '   \n\t ' }))).body.data.note).toBeNull();
    expect((await post(body({ note: '' }))).body.data.note).toBeNull();
    expect((await post(body({ note: null }))).body.data.note).toBeNull();
  });

  test('PATCH: nota com espaços vira nula; 501 recusada sem alterar', async () => {
    const { id } = (await post(body({ note: 'a' }))).body.data;
    expectError(await patch(id, { note: 'y'.repeat(501) }), 400, 'FIELD_TOO_LONG', { field: 'note' });
    expect(getDb().prepare('SELECT note FROM deposits WHERE id = ?').get(id).note).toBe('a');
    expect((await patch(id, { note: '  ' })).body.data.note).toBeNull();
  });

  test('o texto da nota é preservado (acentos, emoji e aspas), sem escape', async () => {
    const note = 'Pix "Mãe" – R$ 50 \u{1F4B0} <b>';
    expect((await post(body({ note }))).body.data.note).toBe(note);
  });
});

describe('loja (D227, D232: só USD)', () => {
  test('loja inativa em USD é aceita no POST e no PATCH', async () => {
    const csmoney = storeId('CSMoney'); // USD
    await request(app).patch(`/api/stores/${csmoney}`).send({ isActive: false }).expect(200);
    const created = await post(body({ storeId: csmoney }));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ storeId: csmoney, storeName: 'CSMoney', amountStoreCents: 10000 });
    const { id } = (await post(body())).body.data;
    expect((await patch(id, { storeId: csmoney })).status).toBe(200);
  });

  test('loja inexistente, zero e negativo -> STORE_NOT_FOUND; tipos errados -> INVALID_FIELD', async () => {
    for (const bad of [9999, 0, -1]) expectError(await post(body({ storeId: bad })), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    expectError(await post(body({ storeId: storeId('Steam') })), 400, 'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
    for (const bad of ['1', true, [1], 1e300]) expectError(await post(body({ storeId: bad })), 400, 'INVALID_FIELD', { field: 'storeId' });
    expect(rowCount()).toBe(0);
  });

  test('excluir a loja com aporte -> 409 STORE_IN_USE e o aporte continua apontando para ela', async () => {
    const created = await request(app).post('/api/stores').send({ name: 'Outra', currency: 'USD' }).expect(201);
    const sid = created.body.data.id;
    const { id } = (await post(body({ storeId: sid }))).body.data;
    expectError(await request(app).delete(`/api/stores/${sid}`), 409, 'STORE_IN_USE');
    // a moeda da loja com aporte fica travada (o valor está na moeda da loja)
    expectError(await request(app).patch(`/api/stores/${sid}`).send({ currency: 'BRL' }), 409, 'STORE_CURRENCY_LOCKED');
    expect(getDb().prepare('SELECT store_id AS s FROM deposits WHERE id = ?').get(id).s).toBe(sid);
    // aporte sem loja não "usa" nenhuma
    await request(app).delete(`/api/deposits/${id}`).expect(200);
    await request(app).delete(`/api/stores/${sid}`).expect(200);
  });

  test('loja em uso só por aporte: desativar é permitido e o aporte continua exibindo o nome', async () => {
    const created = await request(app).post('/api/stores').send({ name: 'Outra', currency: 'USD' }).expect(201);
    const sid = created.body.data.id;
    await post(body({ storeId: sid }));
    await request(app).patch(`/api/stores/${sid}`).send({ isActive: false }).expect(200);
    expect((await request(app).get('/api/deposits')).body.data.deposits[0].storeName).toBe('Outra');
  });
});

describe('listagem', () => {
  test('ordena pelo instante UTC (não pelo texto do offset), desempata por id DESC; total soma tudo', async () => {
    const a = (await post(body({ depositedAt: '2026-11-10T23:00:00-03:00', amountStoreCents: 1 }))).body.data; // 11/11 02:00Z
    const b = (await post(body({ depositedAt: '2026-11-11T01:00:00Z', amountStoreCents: 2 }))).body.data; // 01:00Z
    const c = (await post(body({ depositedAt: '2026-11-11T02:00:00Z', amountStoreCents: 4 }))).body.data; // mesmo instante de a
    const res = (await request(app).get('/api/deposits')).body.data;
    expect(res.deposits.map((d) => d.id)).toEqual([c.id, a.id, b.id]);
    expect(res.totals).toMatchObject({ count: 3, amountUsdCents: 7 });
  });

  test('o PATCH da data reordena a lista e o total não muda', async () => {
    const a = (await post(body({ depositedAt: '2026-11-01T12:00:00Z', amountStoreCents: 10 }))).body.data;
    const b = (await post(body({ depositedAt: '2026-11-02T12:00:00Z', amountStoreCents: 20 }))).body.data;
    await patch(a.id, { depositedAt: '2026-11-05T12:00:00Z' }).expect(200);
    const res = (await request(app).get('/api/deposits')).body.data;
    expect(res.deposits.map((d) => d.id)).toEqual([a.id, b.id]);
    expect(res.totals.amountUsdCents).toBe(30);
  });

  test('total com valores grandes não perde precisão dentro do limite', async () => {
    await post(body({ amountStoreCents: 1e10 }));
    await post(body({ amountStoreCents: 1e10 }));
    expect((await request(app).get('/api/deposits')).body.data.totals.amountUsdCents).toBe(2e10);
  });
});

describe('segurança: as três escritas', () => {
  test('Content-Type com charset e variações de caixa são aceitos; form-urlencoded e multipart -> 415', async () => {
    const ok = await request(app).post('/api/deposits').set('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body()));
    expect(ok.status).toBe(201);
    const { id } = ok.body.data;
    expectError(await request(app).post('/api/deposits').type('form').send({ amountStoreCents: 1 }), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).patch(`/api/deposits/${id}`).type('form').send({ note: 'x' }), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).post('/api/deposits').set('Content-Type', 'application/octet-stream').send(Buffer.from('{}')), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(rowCount()).toBe(1);
  });

  test('JSON malformado -> 400 (formato padrão) sem gravar', async () => {
    const res = await request(app).post('/api/deposits').set('Content-Type', 'application/json').send('{"amountStoreCents": ');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error.code).toBe('string');
    expect(rowCount()).toBe(0);
  });

  test('Host de outro domínio bloqueia POST, PATCH e DELETE sem alterar nada (inclusive 127.0.0.1 e localhost com porta passam)', async () => {
    const { id } = (await post(body({ note: 'orig' }))).body.data;
    for (const host of ['evil.example', 'localhost.evil.example']) {
      expectError(await request(app).post('/api/deposits').set('Host', host).send(body()), 403, 'FORBIDDEN_HOST');
      expectError(await request(app).patch(`/api/deposits/${id}`).set('Host', host).send({ note: 'x' }), 403, 'FORBIDDEN_HOST');
      expectError(await request(app).delete(`/api/deposits/${id}`).set('Host', host), 403, 'FORBIDDEN_HOST');
    }
    expect(getDb().prepare('SELECT note FROM deposits WHERE id = ?').get(id).note).toBe('orig');
    expect((await request(app).get('/api/deposits').set('Host', '127.0.0.1:3001')).status).toBe(200);
    expect((await request(app).get('/api/deposits').set('Host', 'localhost:3001')).status).toBe(200);
  });

  test('o 415 vem antes da validação do corpo e do id inexistente', async () => {
    expectError(await request(app).patch('/api/deposits/9999').set('Content-Type', 'text/plain').send('x'), 415, 'UNSUPPORTED_MEDIA_TYPE');
  });
});
