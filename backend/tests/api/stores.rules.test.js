// Regras 1 a 9 da D156 (lojas): código HTTP, `code` e `field`. Complementa stores.crud.test.js.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, makeCatalogApp, storeId, expectError, purchaseBody, createItemViaApi } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/stores').send(body);
const patch = (id, body) => request(app).patch(`/api/stores/${id}`).send(body);
const insertWonItem = (storeIdValue) => getDb().prepare(
  `INSERT INTO items (name, category, acquisition_type, purchase_store_id, acquired_at, created_at, updated_at)
   VALUES ('Caixa', 'CAIXA', 'GANHEI', ?, '2026-01-01T00:00:00.000Z', 'c', 'u')`
).run(storeIdValue);

describe('D156 regras 1 a 3', () => {
  test('regra 1: nome vazio, só espaços, longo demais, 50 ok, duplicado ao editar', async () => {
    expectError(await post({ name: '   ', currency: 'USD' }), 400, 'REQUIRED_FIELD', { field: 'name' });
    expectError(await post({ currency: 'USD' }), 400, 'REQUIRED_FIELD', { field: 'name' });
    expectError(await post({ name: 'x'.repeat(51), currency: 'USD' }), 400, 'FIELD_TOO_LONG', { field: 'name', params: { maxLength: 50 } });
    expect((await post({ name: 'x'.repeat(50), currency: 'USD' })).status).toBe(201);
    expectError(await patch(storeId('Steam'), { name: ' CSFLOAT ' }), 409, 'STORE_NAME_TAKEN', { field: 'name' });
    expect((await patch(storeId('Steam'), { name: 'STEAM' })).body.data.name).toBe('STEAM'); // o próprio nome, outra caixa
  });

  test('regras 2 e 3: moeda e listas inválidas', async () => {
    expectError(await post({ name: 'A' }), 400, 'REQUIRED_FIELD', { field: 'currency' });
    expectError(await post({ name: 'A', currency: 'XXX' }), 400, 'INVALID_CURRENCY', { field: 'currency' });
    expectError(await post({ name: 'A', currency: 'usd' }), 400, 'INVALID_CURRENCY', { field: 'currency' });
    expectError(await patch(storeId('Steam'), { saleFeeType: 'X' }), 400, 'INVALID_FEE_TYPE', { field: 'saleFeeType' });
    expectError(await patch(storeId('Steam'), { saleFeeRounding: 'UP' }), 400, 'INVALID_ROUNDING', { field: 'saleFeeRounding' });
  });

  test('moeda travada na loja informativa de um item GANHEI; liberada se o item some', async () => {
    const id = storeId('CSMoney');
    insertWonItem(id);
    expectError(await patch(id, { currency: 'BRL' }), 409, 'STORE_CURRENCY_LOCKED', { field: 'currency' });
    expect((await patch(id, { currency: 'USD', name: 'CSMoney 2' })).status).toBe(200); // mesma moeda passa
    getDb().prepare('DELETE FROM items').run();
    expect((await patch(id, { currency: 'BRL' })).body.data.currency).toBe('BRL');
  });

  test('moeda travada por saque e aporte; exclusão recusada', async () => {
    const db = getDb();
    const csm = storeId('CSMoney');
    db.prepare("INSERT INTO withdrawals (store_id, amount_store_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, 1, 1, 'w', 'c', 'u')").run(csm);
    expectError(await patch(csm, { currency: 'BRL' }), 409, 'STORE_CURRENCY_LOCKED');
    const steam = storeId('Steam');
    db.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, created_at, updated_at) VALUES (1, 'd', ?, 'c', 'u')").run(steam);
    expectError(await patch(steam, { currency: 'USD' }), 409, 'STORE_CURRENCY_LOCKED');
    expectError(await request(app).delete(`/api/stores/${steam}`), 409, 'STORE_IN_USE');
    expectError(await request(app).delete(`/api/stores/${csm}`), 409, 'STORE_IN_USE');
  });

  test('loja de compra e de venda de itens reais contam como uso (lista traz inUse)', async () => {
    Setting.update({ usdBrlRate: 5 });
    const a = makeCatalogApp();
    const item = await createItemViaApi(a, purchaseBody());
    const sold = await request(a).post(`/api/items/${item.id}/sell`)
      .send({ saleStoreId: storeId('Steam'), salePriceCents: 115, soldAt: '2026-11-18T12:00:00.000Z' });
    expect(sold.status).toBe(200);
    const list = (await request(a).get('/api/stores')).body.data;
    expect(Object.fromEntries(list.map((s) => [s.name, s.inUse]))).toEqual({ CSFloat: true, Steam: true, CSMoney: false });
    expectError(await request(a).delete(`/api/stores/${storeId('Steam')}`), 409, 'STORE_IN_USE');
  });
});

describe('D156 regras 4 a 6', () => {
  test('regra 4: taxa de saque segue a mesma regra e informa o field', async () => {
    for (const rate of [1, -0.01, 0.0000001]) {
      expectError(await patch(storeId('CSFloat'), { withdrawalFeeRate: rate }), 400, 'INVALID_RATE', { field: 'withdrawalFeeRate' });
    }
    expectError(await patch(storeId('CSFloat'), { saleFeeRate: 1 }), 400, 'INVALID_RATE', { field: 'saleFeeRate' });
    expectError(await patch(storeId('CSFloat'), { withdrawalFeeRate: '0.02' }), 400, 'INVALID_FIELD', { field: 'withdrawalFeeRate' });
    const ok = await patch(storeId('CSFloat'), { withdrawalFeeRate: 0.000001, saleFeeRate: 0.999999 });
    expect(ok.body.data).toMatchObject({ withdrawalFeeRate: 0.000001, saleFeeRate: 0.999999 });
    expect((await patch(storeId('CSFloat'), { saleFeeRate: 0.025 })).body.data.saleFeeRate).toBe(0.025);
  });

  test('regra 5: centavos inválidos', async () => {
    for (const field of ['saleMinFeeCents', 'saleFixedFeeCents', 'withdrawalFixedFeeCents']) {
      for (const v of [-1, 1.5, 1e15]) {
        expectError(await patch(storeId('Steam'), { [field]: v }), 400, 'INVALID_AMOUNT', { field });
      }
    }
    expectError(await patch(storeId('Steam'), { saleFixedFeeCents: '5' }), 400, 'INVALID_FIELD', { field: 'saleFixedFeeCents' });
    expectError(await patch(storeId('Steam'), { saleFixedFeeCents: null }), 400, 'INVALID_FIELD', { field: 'saleFixedFeeCents' });
    expect((await patch(storeId('Steam'), { saleMinFeeCents: 30 })).body.data.saleMinFeeCents).toBe(30);
    expect((await patch(storeId('Steam'), { saleMinFeeCents: null })).body.data.saleMinFeeCents).toBeNull();
  });

  test('regra 6: par avaliado sobre o registro mesclado; null nos dois limpa', async () => {
    const id = storeId('Steam'); // ADDED 0.15
    expectError(await patch(id, { saleFeeType: null }), 400, 'SALE_FEE_INCOMPLETE', { field: 'saleFeeType' });
    expectError(await patch(id, { saleFeeRate: null }), 400, 'SALE_FEE_INCOMPLETE', { field: 'saleFeeRate' });
    const cleared = await patch(id, { saleFeeType: null, saleFeeRate: null });
    expect(cleared.body.data).toMatchObject({ saleFeeType: null, saleFeeRate: null, saleFeesConfigured: false });
    expectError(await patch(storeId('CSMoney'), { saleFeeType: 'DEDUCTED' }), 400, 'SALE_FEE_INCOMPLETE', { field: 'saleFeeRate' });
    expectError(await patch(storeId('CSMoney'), { saleFeeRate: 0.1 }), 400, 'SALE_FEE_INCOMPLETE', { field: 'saleFeeType' });
  });

  test('taxa 0 e null são diferentes: 0 é configurado, null não', async () => {
    const zero = await post({ name: 'Zero', currency: 'USD', saleFeeType: 'DEDUCTED', saleFeeRate: 0 });
    expect(zero.body.data).toMatchObject({ saleFeeRate: 0, saleFeesConfigured: true });
    const nul = await post({ name: 'Nulo', currency: 'USD' });
    expect(nul.body.data).toMatchObject({ saleFeeRate: null, saleFeesConfigured: false });
  });
});

describe('D156 forma do corpo', () => {
  test('UNKNOWN_FIELD para id, inUse, createdAt, updatedAt, saleFeesConfigured (POST e PATCH)', async () => {
    for (const field of ['id', 'inUse', 'createdAt', 'updatedAt', 'saleFeesConfigured']) {
      expectError(await post({ name: 'Z', currency: 'USD', [field]: 1 }), 400, 'UNKNOWN_FIELD', { field });
      expectError(await patch(storeId('Steam'), { [field]: 1 }), 400, 'UNKNOWN_FIELD', { field });
    }
    expectError(await post([]), 400, 'INVALID_BODY');
    expectError(await post({ name: null, currency: 'USD' }), 400, 'INVALID_FIELD', { field: 'name' });
    expectError(await patch(storeId('Steam'), { isActive: 'true' }), 400, 'INVALID_FIELD', { field: 'isActive' });
  });

  test('loja inexistente e id inválido', async () => {
    expectError(await request(app).get('/api/stores/9999'), 404, 'STORE_NOT_FOUND');
    expectError(await patch(9999, { name: 'X' }), 404, 'STORE_NOT_FOUND');
    expectError(await request(app).get('/api/stores/abc'), 400, 'INVALID_ID');
    expectError(await request(app).delete('/api/stores/abc'), 400, 'INVALID_ID');
  });
});

describe('D156 regras 7 a 9', () => {
  test('transferir a principal: exatamente uma no banco, updatedAt das duas com now', async () => {
    const now = new Date('2026-06-01T09:00:00.000Z');
    app = makeApp(now);
    expect((await patch(storeId('Steam'), { isPrimary: true })).status).toBe(200);
    const rows = getDb().prepare('SELECT name, is_primary AS p, updated_at AS u FROM stores ORDER BY name').all();
    expect(rows.filter((r) => r.p === 1).map((r) => r.name)).toEqual(['Steam']);
    expect(rows.find((r) => r.name === 'CSFloat').u).toBe(now.toISOString());
    expect(rows.find((r) => r.name === 'Steam').u).toBe(now.toISOString());
    expect(rows.find((r) => r.name === 'CSMoney').u).not.toBe(now.toISOString());
  });

  test('POST com isPrimary:true cria já principal; inativa+principal recusado', async () => {
    const res = await post({ name: 'Nova', currency: 'USD', isPrimary: true });
    expect(res.body.data.isPrimary).toBe(true);
    expect(getDb().prepare('SELECT name FROM stores WHERE is_primary = 1').all()).toEqual([{ name: 'Nova' }]);
    expectError(await post({ name: 'Outra', currency: 'USD', isPrimary: true, isActive: false }), 409, 'PRIMARY_STORE_INACTIVE');
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM stores WHERE is_primary = 1').get().n).toBe(1);
  });

  test('PATCH que falha ao tornar principal não deixa o banco sem principal', async () => {
    expectError(await patch(storeId('Steam'), { isPrimary: true, name: 'CSFloat' }), 409, 'STORE_NAME_TAKEN');
    expect(getDb().prepare('SELECT name FROM stores WHERE is_primary = 1').all()).toEqual([{ name: 'CSFloat' }]);
  });

  test('desativar principal, isPrimary:false e isPrimary+isActive:false no mesmo PATCH', async () => {
    expectError(await patch(storeId('CSFloat'), { isActive: false }), 409, 'PRIMARY_STORE_INACTIVE');
    expectError(await patch(storeId('CSFloat'), { isPrimary: false }), 409, 'PRIMARY_STORE_REQUIRED', { field: 'isPrimary' });
    expectError(await patch(storeId('Steam'), { isPrimary: true, isActive: false }), 409, 'PRIMARY_STORE_INACTIVE');
    expect(getDb().prepare('SELECT name FROM stores WHERE is_primary = 1').all()).toEqual([{ name: 'CSFloat' }]);
    expect(getDb().prepare("SELECT is_active AS a FROM stores WHERE name = 'Steam'").get().a).toBe(1);
  });

  test('desativar loja comum e reativar; inativa não vira principal', async () => {
    const id = storeId('CSMoney');
    expect((await patch(id, { isActive: false })).body.data.isActive).toBe(false);
    expectError(await patch(id, { isPrimary: true }), 409, 'PRIMARY_STORE_INACTIVE');
    expect((await request(app).get('/api/stores?activeOnly=true')).body.data.map((s) => s.name)).not.toContain('CSMoney');
    expect((await patch(id, { isActive: true })).body.data.isActive).toBe(true);
  });

  test('regra 8: sem saque, as taxas de saque continuam gravadas', async () => {
    const id = storeId('CSFloat');
    expect((await patch(id, { allowsWithdrawal: false })).body.data)
      .toMatchObject({ allowsWithdrawal: false, withdrawalFeeRate: 0.025, withdrawalFixedFeeCents: 0 });
    expect((await patch(id, { withdrawalFixedFeeCents: 50 })).body.data)
      .toMatchObject({ allowsWithdrawal: false, withdrawalFixedFeeCents: 50, withdrawalFeeRate: 0.025 });
    const created = await post({ name: 'Sem saque', currency: 'USD', allowsWithdrawal: false, withdrawalFeeRate: 0.03, withdrawalFixedFeeCents: 10 });
    expect(created.body.data).toMatchObject({ allowsWithdrawal: false, withdrawalFeeRate: 0.03, withdrawalFixedFeeCents: 10 });
  });

  test('regra 9: exclusão remove a linha; excluir de novo dá 404; principal 409', async () => {
    const id = (await post({ name: 'Temp', currency: 'USD' })).body.data.id;
    expect((await request(app).delete(`/api/stores/${id}`)).status).toBe(200);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM stores WHERE id = ?').get(id).n).toBe(0);
    expectError(await request(app).delete(`/api/stores/${id}`), 404, 'STORE_NOT_FOUND');
    expectError(await request(app).delete(`/api/stores/${storeId('CSFloat')}`), 409, 'PRIMARY_STORE_REQUIRED');
  });

  test('exclusão de loja usada só em item GANHEI -> STORE_IN_USE', async () => {
    const id = storeId('CSMoney');
    insertWonItem(id);
    expectError(await request(app).delete(`/api/stores/${id}`), 409, 'STORE_IN_USE');
  });
});

describe('now injetado (T26/T41)', () => {
  test('PATCH de loja atualiza updatedAt e preserva createdAt', async () => {
    const t1 = new Date('2026-05-01T10:00:00.000Z');
    const t2 = new Date('2026-05-02T10:00:00.000Z');
    app = makeApp(t1);
    const created = (await post({ name: 'Nova', currency: 'USD' })).body.data;
    app = makeApp(t2);
    const edited = (await patch(created.id, { saleMinFeeCents: 5 })).body.data;
    expect(edited.createdAt).toBe(t1.toISOString());
    expect(edited.updatedAt).toBe(t2.toISOString());
  });

  test('itens: createdAt na criação, updatedAt na edição e na venda', async () => {
    const t1 = new Date('2026-11-10T10:00:00.000Z');
    const t2 = new Date('2026-11-11T10:00:00.000Z');
    const t3 = new Date('2026-11-12T10:00:00.000Z');
    const created = await createItemViaApi(makeCatalogApp(t1), purchaseBody());
    expect(created).toMatchObject({ createdAt: t1.toISOString(), updatedAt: t1.toISOString() });
    const edited = (await request(makeApp(t2)).patch(`/api/items/${created.id}`).send({ purchasePriceCents: 200 })).body.data;
    expect(edited).toMatchObject({ createdAt: t1.toISOString(), updatedAt: t2.toISOString() });
    const sold = (await request(makeApp(t3)).post(`/api/items/${created.id}/sell`)
      .send({ saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-11T12:00:00.000Z' })).body.data.item;
    expect(sold.updatedAt).toBe(t3.toISOString());
  });

  test('linkLegacyItems usa o now recebido no updatedAt dos itens vinculados', () => {
    const catalogService = require('../../src/services/catalogService');
    const Item = require('../../src/models/Item');
    const { CAT, importCatalogFixture } = require('../helpers/catalog');
    importCatalogFixture();
    const legacy = Item.create({
      name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'),
      purchasePriceCents: 100, purchaseCurrency: 'USD', acquiredAt: '2026-11-10T12:00:00.000Z',
    });
    const now = new Date('2026-08-08T08:00:00.000Z');
    expect(catalogService.linkLegacyItems({ now })).toBe(1);
    const row = getDb().prepare('SELECT catalog_id AS c, updated_at AS u FROM items WHERE id = ?').get(legacy.id);
    expect(row).toEqual({ c: CAT.AK_REDLINE, u: now.toISOString() });
  });
});
