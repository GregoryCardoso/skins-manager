// 8.8 (D271 a D276): GET /api/items/groups e a preferência inventoryView. Banco :memory: novo a cada teste, relógio controlado.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError, NOW, CAT } = require('../helpers/apiFixtures');

let app;
beforeEach(() => { freshDb(); app = makeCatalogApp(); });
afterAll(() => closeDb());

const DAY = 86400000;
const iso = (days) => new Date(NOW.getTime() + days * DAY).toISOString();
const groups = async (query = '') => (await request(app).get(`/api/items/groups${query}`)).body.data;
const list = async (query = '') => (await request(app).get(`/api/items${query}`)).body.data;
const create = (overrides = {}) => createItemViaApi(app, purchaseBody({ acquiredAt: iso(-40), ...overrides }));
const offSale = (id) => request(app).post(`/api/items/${id}/off-sale`).send({});
const unitIds = (data) => data.groups.flatMap((g) => g.units.map((u) => u.id));

describe('GET /api/items/groups', () => {
  test('inventário vazio', async () => {
    const data = await groups();
    expect(data.groups).toEqual([]);
    expect(data.meta).toMatchObject({ count: 0, groupCount: 0, saleStateCounts: { forSale: 0, offSale: 0 } });
  });

  test('agrupa pela chave do itemStats, soma o custo e conta a situação do estoque', async () => {
    const a = await create({ purchasePriceCents: 1000 });
    const b = await create({ purchasePriceCents: 500, tradeUnlockAt: iso(3) });
    const c = await create({ purchasePriceCents: 100 });
    await create({ catalogId: CAT.AWP_DLORE, purchasePriceCents: 300 });
    await offSale(c.id);
    const data = await groups();
    expect(data.meta).toMatchObject({ count: 4, groupCount: 2 });
    const ak = data.groups.find((g) => g.name === a.name);
    expect(ak).toMatchObject({
      quantity: 3, totalCostUsdCents: 1600, avgCostUsdCents: 533, costUsesRecordedFx: false,
      stock: { forSale: 1, tradeLocked: 1, offSale: 1, nextUnlockAt: iso(3) },
    });
    expect(ak.units.map((u) => u.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(ak.catalog).toMatchObject({ id: CAT.AK_REDLINE });
  });

  test('a ordem dos grupos segue a lista individual (invariante D272), nos dois saleState e com stagnantOnly', async () => {
    await create({ catalogId: CAT.AWP_DLORE, acquiredAt: iso(-10) });
    await create({ acquiredAt: iso(-60) });
    await create({ acquiredAt: iso(-5) });
    const off = await create({ catalogId: CAT.AWP_DLORE, acquiredAt: iso(-90) });
    await offSale(off.id);
    for (const q of ['', 'saleState=FOR_SALE', 'saleState=OFF_SALE', 'stagnantOnly=true', 'order=asc', 'order=desc', 'category=SKIN&saleState=FOR_SALE']) {
      const grouped = await groups(`?sortBy=age&${q}`);
      const flat = await list(`?status=EM_ESTOQUE&sortBy=age&${q}`);
      const flatIds = flat.items.map((i) => i.id);
      // mesmas unidades; os grupos seguem a ordem da primeira aparição de cada chave na lista individual
      expect(unitIds(grouped).sort()).toEqual([...flatIds].sort());
      const firstSeen = [];
      for (const i of flat.items) if (!firstSeen.includes(i.name)) firstSeen.push(i.name);
      expect(grouped.groups.map((g) => g.name)).toEqual(firstSeen);
      for (const g of grouped.groups) expect(g.units.map((u) => u.id)).toEqual(flatIds.filter((id) => g.units.some((u) => u.id === id)));
    }
  });

  test('stock conta a outra aba; um grupo só com unidades na outra aba não aparece', async () => {
    const a = await create();
    const b = await create({ catalogId: CAT.AWP_DLORE });
    await offSale(b.id);
    const forSale = await groups('?saleState=FOR_SALE');
    expect(forSale.groups.map((g) => g.name)).toEqual([a.name]);
    expect(forSale.meta.saleStateCounts).toEqual({ forSale: 1, offSale: 1 });
    const off = await groups('?saleState=OFF_SALE');
    expect(off.groups).toHaveLength(1);
    expect(off.groups[0].stock).toMatchObject({ forSale: 0, offSale: 1 });
  });

  test('stagnantOnly conta só as unidades agarradas; com OFF_SALE a lista é vazia', async () => {
    await create({ acquiredAt: iso(-60) });
    await create({ acquiredAt: iso(-2) });
    const data = await groups('?stagnantOnly=true');
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]).toMatchObject({ quantity: 1, stagnantCount: 1 });
    expect((await groups('?stagnantOnly=true&saleState=OFF_SALE')).groups).toEqual([]);
  });

  test('vendidos nunca aparecem; desfazer a venda devolve a unidade ao grupo', async () => {
    const a = await create();
    await create();
    await request(app).post(`/api/items/${a.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 200, soldAt: NOW.toISOString() });
    expect((await groups()).groups[0].quantity).toBe(1);
    await request(app).post(`/api/items/${a.id}/unsell`).send({});
    expect((await groups()).groups[0].quantity).toBe(2);
  });

  test('compra em BRL: marca costUsesRecordedFx e converte pela cotação gravada', async () => {
    await create({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 1080, fxRateAtPurchase: 5.4 });
    const g = (await groups()).groups[0];
    expect(g).toMatchObject({ costUsesRecordedFx: true, totalCostUsdCents: 200, avgCostUsdCents: 200 });
  });

  test.each([
    ['?status=EM_ESTOQUE', 'status'],
    ['?sortBy=turnaround', 'sortBy'],
    ['?order=asc', 'order'],
    ['?saleState=X', 'saleState'],
  ])('%s -> 400 INVALID_QUERY', async (q, field) => {
    expectError(await request(app).get(`/api/items/groups${q}`), 400, 'INVALID_QUERY', { field });
  });

  test('Host estranho -> 403', async () => {
    const res = await request(app).get('/api/items/groups').set('Host', 'evil.example.com');
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/settings inventoryView (D276)', () => {
  const patch = (body) => request(app).patch('/api/settings').send(body);

  test('padrão GROUPED; INDIVIDUAL e GROUPED são aceitos e o GET devolve o valor', async () => {
    expect((await request(app).get('/api/settings')).body.data.inventoryView).toBe('GROUPED');
    expect((await patch({ inventoryView: 'INDIVIDUAL' })).body.data.inventoryView).toBe('INDIVIDUAL');
    expect((await request(app).get('/api/settings')).body.data.inventoryView).toBe('INDIVIDUAL');
    expect((await patch({ inventoryView: 'GROUPED' })).body.data.inventoryView).toBe('GROUPED');
  });

  test.each([[null], [''], ['LIST'], [5]])('%j -> 400 INVALID_INVENTORY_VIEW', async (value) => {
    expectError(await patch({ inventoryView: value }), 400, 'INVALID_INVENTORY_VIEW');
  });

  test('junto com outros campos de preferência', async () => {
    const res = await patch({ inventoryView: 'INDIVIDUAL', theme: 'DARK', language: 'en' });
    expect(res.body.data).toMatchObject({ inventoryView: 'INDIVIDUAL', theme: 'DARK', language: 'en' });
  });
});
