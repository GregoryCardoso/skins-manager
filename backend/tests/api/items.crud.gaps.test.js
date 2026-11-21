// Lacunas da D56 para criação, edição, exclusão e unsell (testador, revisão independente da Etapa 3).
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { CAT, makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/items').send(body);
const patch = (id, body) => request(app).patch(`/api/items/${id}`).send(body);
const sell = (id, body = {}) =>
  request(app).post(`/api/items/${id}/sell`).send({
    saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...body,
  });
const getItem = async (id) => (await request(app).get(`/api/items/${id}`)).body.data;

describe('POST /api/items (lacunas)', () => {
  test('resposta 201 no formato padrão, apenas { success, data }', async () => {
    const res = await post(purchaseBody());
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: expect.any(Number), status: 'EM_ESTOQUE', createdAt: expect.any(String), updatedAt: expect.any(String),
    });
  });

  test('nome só com espaços ou nulo -> REQUIRED_FIELD', async () => {
    const free = (o = {}) => purchaseBody({ catalogId: undefined, category: 'OUTRO', ...o });
    expectError(await post(free({ name: '   ' })), 400, 'REQUIRED_FIELD');
    expectError(await post(free({ name: null })), 400, 'REQUIRED_FIELD');
    expectError(await post(free({ name: undefined })), 400, 'REQUIRED_FIELD');
    expectError(await post(purchaseBody({ catalogId: undefined, name: 'X', category: null })), 400, 'INVALID_CATEGORY');
    expectError(await post(purchaseBody({ catalogId: undefined, name: 'X', category: undefined })), 400, 'REQUIRED_FIELD');
    expectError(await post(purchaseBody({ acquisitionType: undefined })), 400, 'REQUIRED_FIELD');
  });

  test('GANHEI: purchasePriceCents no corpo (null, 0 ou valor) -> GANHEI_COST_NOT_ALLOWED; loja opcional não define a moeda', async () => {
    const won = { catalogId: CAT.CASE_REVOLVER, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' };
    for (const purchasePriceCents of [null, 0, 500]) {
      const res = await post({ ...won, purchasePriceCents });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GANHEI_COST_NOT_ALLOWED');
    }
    const withStore = await createItemViaApi(app, { ...won, purchaseStoreId: storeId('CSFloat') });
    expect(withStore).toMatchObject({ purchaseStoreId: storeId('CSFloat'), purchaseCurrency: 'USD', purchasePriceCents: 0 });
  });

  test('GANHEI sem preço: preço mínimo CSFloat = 1 (custo 0 não é mínimo 0, D25)', async () => {
    const item = await createItemViaApi(app, { catalogId: CAT.CASE_REVOLVER, acquisitionType: 'GANHEI' });
    expect(item.minPrices.find((m) => m.storeName === 'CSFloat').minPriceCents).toBe(1);
  });

  test('cotação de compra inválida em BRL -> INVALID_FX_RATE', async () => {
    const steam = purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 500 });
    expectError(await post({ ...steam, fxRateAtPurchase: 0 }), 400, 'INVALID_FX_RATE');
    expectError(await post({ ...steam, fxRateAtPurchase: -5 }), 400, 'INVALID_FX_RATE');
  });

  test('tradeUnlockAt inválido -> INVALID_DATE; tradeUnlockAt nulo aceito', async () => {
    expectError(await post(purchaseBody({ tradeUnlockAt: 'amanhã' })), 400, 'INVALID_DATE');
    expect((await post(purchaseBody({ tradeUnlockAt: null }))).body.data.tradeUnlockAt).toBeNull();
  });

  test('atributos fora da faixa', async () => {
    expectError(await post(purchaseBody({ floatValue: 1.5 })), 400, 'INVALID_FLOAT');
    expectError(await post(purchaseBody({ floatValue: -0.1 })), 400, 'INVALID_FLOAT');
    expectError(await post(purchaseBody({ paintSeed: 1001 })), 400, 'INVALID_PAINT_SEED');
    expectError(await post(purchaseBody({ paintSeed: 1.5 })), 400, 'INVALID_PAINT_SEED');
    expectError(await post(purchaseBody({ exterior: 'XX' })), 400, 'INVALID_EXTERIOR');
    expect((await post(purchaseBody({ catalogId: CAT.BAYONET_BLUE_STEEL_A, floatValue: 1, paintSeed: 1000 }))).body.data).toMatchObject({ exterior: 'BS', paintSeed: 1000 });
    expect((await post(purchaseBody({ catalogId: CAT.BAYONET_BLUE_STEEL_A, floatValue: 0, paintSeed: 0 }))).body.data).toMatchObject({ exterior: 'FN', paintSeed: 0 });
  });

  test('ID inexistente de loja em GANHEI -> STORE_NOT_FOUND', async () => {
    expectError(await post({ catalogId: CAT.CASE_REVOLVER, acquisitionType: 'GANHEI', purchaseStoreId: 999 }), 400, 'STORE_NOT_FOUND');
  });

  test('erro de validação não grava nada', async () => {
    await post(purchaseBody({ purchasePriceCents: -1 }));
    expect((await request(app).get('/api/items')).body.data.items).toEqual([]);
  });
});

describe('PATCH /api/items/:id (lacunas)', () => {
  const SNAPSHOT_FIELDS = [
    'saleFeeTypeApplied', 'saleFeeRateApplied', 'saleFeeRoundingApplied', 'saleMinFeeCentsApplied', 'saleFixedFeeCentsApplied',
  ];
  test.each(SNAPSHOT_FIELDS)('%s -> SALE_FIELDS_LOCKED', async (field) => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { [field]: null }), 400, 'SALE_FIELDS_LOCKED');
  });

  test('status sozinho (mesmo valor atual) -> SALE_FIELDS_LOCKED com a mensagem da D60', async () => {
    const item = await createItemViaApi(app);
    const res = await patch(item.id, { status: 'EM_ESTOQUE' });
    expectError(res, 400, 'SALE_FIELDS_LOCKED');
    expect(res.body.error.message).toBe('Dados de venda não podem ser editados. Desfaça a venda e venda novamente.');
  });

  test('item vendido: acquiredAt = soldAt aceito; loja inexistente -> STORE_NOT_FOUND; falha não altera nada', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id);
    expectError(await patch(item.id, { purchaseStoreId: 999 }), 400, 'STORE_NOT_FOUND');
    expectError(await patch(item.id, { acquiredAt: '2026-11-18T12:00:00.001Z' }), 400, 'SOLD_BEFORE_ACQUIRED');
    const unchanged = await getItem(item.id);
    expect(unchanged).toMatchObject({ acquiredAt: '2026-11-10T12:00:00.000Z', purchaseStoreId: storeId('CSFloat') });
    const ok = await patch(item.id, { acquiredAt: '2026-11-18T12:00:00.000Z' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'VENDIDO', aging: { turnaroundDays: 0, turnaroundBucket: 'GIRO_RAPIDO', daysHeld: 0 } });
  });

  test('item vendido: trocar COMPRA -> GANHEI zera o custo e recalcula o lucro', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id);
    const res = await patch(item.id, { acquisitionType: 'GANHEI', purchaseStoreId: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ purchasePriceCents: 0, purchaseCurrency: 'USD', saleProfitUsdCents: 122, netReceivedCents: 122 });
  });

  test('cotação de compra informada no PATCH vence a salva; trocar para loja USD com cotação -> FX_RATE_NOT_ALLOWED', async () => {
    Setting.update({ usdBrlRate: 5 });
    const item = await createItemViaApi(app);
    const res = await patch(item.id, { purchaseStoreId: storeId('Steam'), purchasePriceCents: 500, fxRateAtPurchase: 5.4 });
    expect(res.body.data).toMatchObject({ purchaseCurrency: 'BRL', fxRateAtPurchase: 5.4 });
    expectError(await patch(item.id, { purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 100, fxRateAtPurchase: 5.4 }), 400, 'FX_RATE_NOT_ALLOWED');
  });

  test('tipos inválidos no PATCH -> INVALID_FIELD; name nulo -> REQUIRED_FIELD', async () => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { purchasePriceCents: '50' }), 400, 'INVALID_FIELD');
    expectError(await patch(item.id, { purchaseStoreId: 1.5 }), 400, 'INVALID_FIELD');
    // Item do catálogo: o nome é derivado (D78); item de nome livre: obrigatório.
    expectError(await patch(item.id, { name: null }), 400, 'CATALOG_DERIVED_FIELD');
    expectError(await patch(item.id, { name: '  ' }), 400, 'CATALOG_DERIVED_FIELD');
    const free = await createItemViaApi(app, purchaseBody({ catalogId: undefined, name: 'Livre', category: 'OUTRO' }));
    expectError(await patch(free.id, { name: null }), 400, 'REQUIRED_FIELD');
    expectError(await patch(free.id, { name: '  ' }), 400, 'REQUIRED_FIELD');
  });
});

describe('DELETE e unsell (lacunas)', () => {
  test('excluir item vendido remove da listagem e das estatísticas', async () => {
    const a = await createItemViaApi(app);
    const b = await createItemViaApi(app);
    await sell(a.id);
    expect((await getItem(b.id)).stats.soldCount).toBe(1);
    expect((await request(app).delete(`/api/items/${a.id}`)).body).toEqual({ success: true, data: { id: a.id } });
    const list = (await request(app).get('/api/items')).body.data;
    expect(list.items.map((i) => i.id)).toEqual([b.id]);
    expect(list.items[0].stats.soldCount).toBe(0);
  });

  test('unsell sem corpo e sem Content-Type -> 200; recalcula aging de estoque', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id);
    const res = await request(app).post(`/api/items/${item.id}/unsell`).set('Content-Type', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body.data.aging).toEqual({ daysInInventory: 9, daysForSale: 9, agingBucket: 'EM_GIRO' });
    expect(res.body.data).not.toHaveProperty('turnaroundDays');
  });

  test('unsell duas vezes -> 409 ITEM_NOT_SOLD com a mensagem; corpo array -> INVALID_BODY', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id);
    expectError(await request(app).post(`/api/items/${item.id}/unsell`).send([1]), 400, 'INVALID_BODY');
    await request(app).post(`/api/items/${item.id}/unsell`).set('Content-Type', 'application/json');
    const res = await request(app).post(`/api/items/${item.id}/unsell`).set('Content-Type', 'application/json');
    expectError(res, 409, 'ITEM_NOT_SOLD');
    expect(res.body.error.message).toBe('Item não está vendido.');
  });

  test('mensagens de 409 ITEM_ALREADY_SOLD e 404 ITEM_NOT_FOUND', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id);
    expect((await sell(item.id)).body.error.message).toBe('Item já vendido.');
    expect((await request(app).get('/api/items/999')).body.error.message).toBe('Item não encontrado.');
  });
});
