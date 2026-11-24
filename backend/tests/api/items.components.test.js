// 10.1 (D344, D352, D353): componentes aplicados pela API de itens.
const request = require('supertest');
const { freshDb } = require('../helpers/fixtures');
const { getDb, closeDb } = require('../../src/config/database');
const { CAT, makeCatalogApp, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/items').send(body);
const patch = (id, body) => request(app).patch(`/api/items/${id}`).send(body);
const get = (path) => request(app).get(path);
const two = [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 0, wear: 0.1 }, { kind: 'STICKER', catalogId: CAT.STICKER_CROWN, slot: 1 }];
const charm = { kind: 'CHARM', catalogId: CAT.CHARM_LIL_AVA, pattern: 42 };

describe('POST/PATCH /api/items com components', () => {
  test('cria uma AK com 2 stickers e um chaveiro e devolve components e componentSummary', async () => {
    const res = await post(purchaseBody({ components: [...two, charm] }));
    expect(res.status).toBe(201);
    const item = res.body.data;
    expect(item.components).toHaveLength(3);
    expect(item.components[0]).toMatchObject({ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 0, wear: 0.1, source: 'MANUAL' });
    expect(item.components[0]).toHaveProperty('imageUrl');
    expect(item.components[2]).toMatchObject({ kind: 'CHARM', pattern: 42 });
    expect(item.componentSummary).toEqual({ stickers: 2, charms: 1 });
    const again = (await get(`/api/items/${item.id}`)).body.data;
    expect(again.components.map((c) => c.id)).toEqual(item.components.map((c) => c.id));
  });

  test('sem components: lista vazia e resumo zerado; ausente no PATCH não mexe; [] limpa', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: two }));
    const plain = await createItemViaApi(app);
    expect(plain.components).toEqual([]);
    expect(plain.componentSummary).toEqual({ stickers: 0, charms: 0 });
    const untouched = (await patch(item.id, { originDetail: 'x' })).body.data;
    expect(untouched.components).toHaveLength(2);
    const swapped = (await patch(item.id, { components: [charm] })).body.data;
    expect(swapped.components.map((c) => c.kind)).toEqual(['CHARM']);
    const cleared = (await patch(item.id, { components: [] })).body.data;
    expect(cleared.components).toEqual([]);
  });

  test('trocar o chaveiro por um Sticker Slab', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: [charm] }));
    const res = await patch(item.id, { components: [{ kind: 'STICKER_SLAB', catalogId: CAT.STICKER_CROWN, pattern: 5 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.components[0]).toMatchObject({ kind: 'STICKER_SLAB', name: expect.stringMatching(/^Sticker Slab \| /), wear: null, pattern: 5 });
    expect(res.body.data.componentSummary).toEqual({ stickers: 0, charms: 1 });
  });

  test('erros: faca, luva e caixa recusam; limite; catálogo; campos (slot repetido vale, D361)', async () => {
    expectError(await post({ catalogId: CAT.KARAMBIT_FADE, acquisitionType: 'GANHEI', components: two }), 400, 'COMPONENTS_NOT_ALLOWED');
    expectError(await post({ catalogId: CAT.SPORT_GLOVES_PANDORA, acquisitionType: 'GANHEI', components: two }), 400, 'COMPONENTS_NOT_ALLOWED');
    expectError(await post({ catalogId: CAT.CASE_REVOLVER, acquisitionType: 'GANHEI', components: [charm] }), 400, 'COMPONENTS_NOT_ALLOWED');
    const six = Array.from({ length: 6 }, (_, i) => ({ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: i }));
    expectError(await post(purchaseBody({ components: six })), 400, 'COMPONENT_LIMIT_EXCEEDED');
    expectError(await post(purchaseBody({ components: [charm, { kind: 'STICKER_SLAB', catalogId: CAT.STICKER_TITAN }] })), 400, 'COMPONENT_LIMIT_EXCEEDED');
    const sameSlot = await post(purchaseBody({ components: [two[0], { ...two[1], slot: 0 }] }));
    expect(sameSlot.status).toBe(201);
    expect(sameSlot.body.data.components.map((c) => c.slot)).toEqual([0, 0]);
    expectError(await post(purchaseBody({ components: [{ kind: 'STICKER' }] })), 400, 'COMPONENT_CATALOG_REQUIRED');
    expectError(await post(purchaseBody({ components: [{ kind: 'STICKER', catalogId: CAT.AK_REDLINE }] })), 400, 'COMPONENT_CATALOG_MISMATCH');
    expectError(await post(purchaseBody({ components: [{ kind: 'STICKER_SLAB', catalogId: CAT.CHARM_LIL_AVA }] })), 400, 'COMPONENT_CATALOG_MISMATCH');
    expectError(await post(purchaseBody({ components: [{ ...charm, wear: 0.1 }] })), 400, 'INVALID_COMPONENT_FIELD');
    expectError(await post(purchaseBody({ components: [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, pattern: 1 }] })), 400, 'INVALID_COMPONENT_FIELD');
    expectError(await post(purchaseBody({ components: [{ kind: 'PATCH', catalogId: CAT.STICKER_TITAN }] })), 400, 'COMPONENTS_NOT_ALLOWED');
  });

  test('forma: não-lista, elemento inválido, chave desconhecida, tipo errado e mais de 6', async () => {
    expectError(await post(purchaseBody({ components: 'x' })), 400, 'INVALID_FIELD', { field: 'components' });
    expectError(await post(purchaseBody({ components: null })), 400, 'INVALID_FIELD', { field: 'components' });
    expectError(await post(purchaseBody({ components: [1] })), 400, 'INVALID_FIELD');
    expectError(await post(purchaseBody({ components: [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, price: 1 }] })), 400, 'UNKNOWN_FIELD');
    expectError(await post(purchaseBody({ components: [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, wear: 'a' }] })), 400, 'INVALID_COMPONENT_FIELD');
    expectError(await post(purchaseBody({ components: Array(7).fill(two[0]) })), 400, 'COMPONENT_LIMIT_EXCEEDED');
  });

  test('erro de componente não cria o item (nada gravado)', async () => {
    await post(purchaseBody({ components: [{ kind: 'STICKER' }] }));
    expect((await get('/api/items')).body.data.items).toHaveLength(0);
  });

  test('trocar a categoria com componentes gravados é recusado sem perder nada; com [] funciona', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: two }));
    expectError(await patch(item.id, { catalogId: CAT.KARAMBIT_FADE }), 400, 'COMPONENTS_NOT_ALLOWED');
    expect((await get(`/api/items/${item.id}`)).body.data.components).toHaveLength(2);
    const res = await patch(item.id, { catalogId: CAT.KARAMBIT_FADE, components: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.components).toEqual([]);
  });

  test('editar componentes muda updated_at', async () => {
    const item = await createItemViaApi(app);
    const later = makeCatalogApp(new Date('2026-11-20T15:00:00.000Z'));
    const res = await request(later).patch(`/api/items/${item.id}`).send({ components: two });
    expect(res.body.data.updatedAt > item.updatedAt).toBe(true);
  });
});

describe('visões e neutralidade', () => {
  test('lista, grupos (componentUnits) e vendas trazem os componentes', async () => {
    const a = await createItemViaApi(app, purchaseBody({ components: two }));
    await createItemViaApi(app);
    const list = (await get('/api/items')).body.data.items;
    expect(list.find((i) => i.id === a.id).components).toHaveLength(2);
    const groups = (await get('/api/items/groups')).body.data.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ componentUnits: 1 });
    expect(groups[0].units.map((u) => u.componentSummary.stickers).sort()).toEqual([0, 2]);
    const sold = await request(app).post(`/api/items/${a.id}/sell`).send({ saleStoreId: a.purchaseStoreId, salePriceCents: 200, soldAt: '2026-11-18T12:00:00.000Z' });
    expect(sold.status).toBe(200);
    expect(sold.body.data.item.components).toHaveLength(2);
    const sales = (await get('/api/items/sales')).body.data.items;
    expect(sales[0].components).toHaveLength(2);
    const unsold = await request(app).post(`/api/items/${a.id}/unsell`).send({});
    expect(unsold.body.data.components).toHaveLength(2);
  });

  test('componentes não mudam custo, preço mínimo, stats, chave do grupo nem lucro real', async () => {
    const plain = await createItemViaApi(app);
    const withComp = await createItemViaApi(app, purchaseBody({ components: [...two, charm] }));
    for (const key of ['purchasePriceCents', 'purchaseCurrency', 'minPrices', 'aging', 'tradeLock']) {
      expect(withComp[key]).toEqual(plain[key]);
    }
    const groups = (await get('/api/items/groups')).body.data.groups;
    expect(groups).toHaveLength(1);
    expect(withComp.stats.unitCount).toBe(2); // mesma chave do histórico (2.7): os componentes não a mudam
    const profit = (await get('/api/profit/summary')).body.data;
    await patch(withComp.id, { components: [] });
    expect((await get('/api/profit/summary')).body.data).toEqual(profit);
  });

  test('excluir o item apaga os componentes (CASCADE)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: two }));
    expect(getDb().prepare('SELECT COUNT(*) n FROM item_components').get().n).toBe(2);
    expect((await request(app).delete(`/api/items/${item.id}`)).status).toBe(200);
    expect(getDb().prepare('SELECT COUNT(*) n FROM item_components').get().n).toBe(0);
  });
});
