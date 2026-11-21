// QA de saleHoldDays nas lojas (D213): PATCH parcial, tipos, ordem das validações, loja inativa/em uso e resposta da listagem.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, expectError, purchaseBody, createItemViaApi } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/stores').send(body);
const patch = (id, body) => request(app).patch(`/api/stores/${id}`).send(body);
const dbHold = (id) => getDb().prepare('SELECT sale_hold_days AS d FROM stores WHERE id = ?').get(id).d;

describe('PATCH parcial', () => {
  test('sem o campo mantém o valor (renomear, mudar taxa, desativar)', async () => {
    const id = storeId('CSFloat');
    expect((await patch(id, { name: 'CSFloat 2' })).body.data.saleHoldDays).toBe(7);
    expect((await patch(id, { saleFeeRate: 0.03 })).body.data.saleHoldDays).toBe(7);
    expect((await patch(storeId('CSMoney'), { isActive: false })).body.data.saleHoldDays).toBe(7);
    expect(dbHold(id)).toBe(7);
  });

  test('o campo sozinho altera só ele; as demais taxas e flags ficam', async () => {
    const id = storeId('CSFloat');
    const before = (await request(app).get(`/api/stores/${id}`)).body.data;
    const after = (await patch(id, { saleHoldDays: 12 })).body.data;
    expect({ ...after, saleHoldDays: 7, updatedAt: before.updatedAt }).toEqual(before);
    expect(after.saleHoldDays).toBe(12);
  });

  test('PATCH recusado (valor inválido junto de outro campo válido) não grava nenhum dos dois', async () => {
    const id = storeId('CSFloat');
    expectError(await patch(id, { name: 'Outro Nome', saleHoldDays: 31 }), 400, 'INVALID_SALE_HOLD_DAYS');
    expect((await request(app).get(`/api/stores/${id}`)).body.data).toMatchObject({ name: 'CSFloat', saleHoldDays: 7 });
  });

  test('loja inativa e loja em uso aceitam editar a retenção', async () => {
    const id = storeId('CSMoney');
    await patch(id, { isActive: false }).expect(200);
    expect((await patch(id, { saleHoldDays: 3 })).status).toBe(200);
    await createItemViaApi(app, purchaseBody()); // CSFloat passa a "em uso"
    expect((await patch(storeId('CSFloat'), { saleHoldDays: 1 })).body.data).toMatchObject({ saleHoldDays: 1, inUse: true });
  });

  test('loja inexistente -> 404 e id inválido -> 400, antes de olhar o valor', async () => {
    expectError(await patch(9999, { saleHoldDays: 5 }), 404, 'STORE_NOT_FOUND');
    expectError(await patch('abc', { saleHoldDays: 5 }), 400, 'INVALID_ID');
  });
});

describe('tipos e limites', () => {
  test.each([['7', 'string'], [true, 'boolean'], [[7], 'lista'], [{ v: 7 }, 'objeto']])('%p (%s) -> INVALID_FIELD', async (value) => {
    expectError(await patch(storeId('CSFloat'), { saleHoldDays: value }), 400, 'INVALID_FIELD', { field: 'saleHoldDays' });
    expectError(await post({ name: 'T', currency: 'USD', saleHoldDays: value }), 400, 'INVALID_FIELD', { field: 'saleHoldDays' });
  });

  test('POST com null -> INVALID_FIELD (não anulável) e a loja não é criada', async () => {
    expectError(await post({ name: 'T', currency: 'USD', saleHoldDays: null }), 400, 'INVALID_FIELD', { field: 'saleHoldDays' });
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM stores WHERE name = 'T'").get().n).toBe(0);
  });

  test.each([[30], [0], [1]])('limite %p aceito no POST', async (value) => {
    const res = await post({ name: `L${value}`, currency: 'USD', saleHoldDays: value });
    expect(res.status).toBe(201);
    expect(dbHold(res.body.data.id)).toBe(value);
  });

  test.each([[31], [-1], [0.5], [1e9], [2 ** 53], [1e300]])('%p -> INVALID_SALE_HOLD_DAYS com params min/max', async (value) => {
    expectError(await post({ name: 'T', currency: 'USD', saleHoldDays: value }), 400, 'INVALID_SALE_HOLD_DAYS', {
      field: 'saleHoldDays', params: { min: 0, max: 30 },
    });
    expect(dbHold(storeId('CSFloat'))).toBe(7);
  });

  test('JSON 30.0 e 7e0 são inteiros e passam', async () => {
    const id = storeId('CSFloat');
    const res = await request(app).patch(`/api/stores/${id}`).set('Content-Type', 'application/json').send('{"saleHoldDays": 30.0}');
    expect(res.status).toBe(200);
    expect(dbHold(id)).toBe(30);
  });

  test('erros de nome vêm antes do da retenção (ordem de D213); campo desconhecido é recusado', async () => {
    expectError(await post({ name: '', currency: 'USD', saleHoldDays: 99 }), 400, 'REQUIRED_FIELD');
    expectError(await post({ name: 'T', currency: 'USD', saleHoldDay: 5 }), 400, 'UNKNOWN_FIELD', { field: 'saleHoldDay' });
  });
});

describe('respostas', () => {
  test('GET /api/stores lista saleHoldDays em todas as lojas (inclusive criada sem o campo e inativa)', async () => {
    const created = (await post({ name: 'Sem Campo', currency: 'USD' })).body.data;
    await patch(storeId('CSMoney'), { isActive: false }).expect(200);
    const list = (await request(app).get('/api/stores')).body.data;
    expect(list.every((s) => Number.isInteger(s.saleHoldDays))).toBe(true);
    expect(Object.fromEntries(list.map((s) => [s.name, s.saleHoldDays]))).toEqual({ CSFloat: 7, Steam: 0, CSMoney: 7, 'Sem Campo': 0 });
    expect(created.saleHoldDays).toBe(0);
  });

  test('a edição de retenção não altera item já vendido nem a lista de itens em estoque', async () => {
    const item = await createItemViaApi(app);
    await request(app).post(`/api/items/${item.id}/sell`).send({
      saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z',
    }).expect(200);
    await patch(storeId('CSFloat'), { saleHoldDays: 30 }).expect(200);
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.saleHoldDaysApplied).toBe(7);
  });
});

describe('segurança', () => {
  test('PATCH de loja sem JSON -> 415; Host estranho -> 403; nada muda', async () => {
    const id = storeId('CSFloat');
    expectError(await request(app).patch(`/api/stores/${id}`).set('Content-Type', 'text/plain').send('x'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).patch(`/api/stores/${id}`).set('Host', 'evil.example').send({ saleHoldDays: 1 }), 403, 'FORBIDDEN_HOST');
    expect(dbHold(id)).toBe(7);
  });
});
