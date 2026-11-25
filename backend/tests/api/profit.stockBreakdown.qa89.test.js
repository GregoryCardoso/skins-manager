// 8.9 (D283): GET /api/profit/summary com itens em holding. Banco :memory: novo a cada teste.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi, NOW } = require('../helpers/apiFixtures');

let app;
beforeEach(() => { freshDb(); app = makeCatalogApp(); });
afterAll(() => closeDb());

const summary = async () => (await request(app).get('/api/profit/summary')).body.data;
const create = (o = {}) => createItemViaApi(app, purchaseBody({ acquiredAt: new Date(NOW.getTime() - 40 * 86400000).toISOString(), ...o }));
const offSale = (id) => request(app).post(`/api/items/${id}/off-sale`).send({});
const forSale = (id) => request(app).post(`/api/items/${id}/for-sale`).send({});

describe('GET /api/profit/summary: stockBreakdown', () => {
  test('sem itens: partes zeradas', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    const data = await summary();
    expect(data.stockBreakdown).toEqual({
      forSale: { usdCents: 0, estimated: false, approx: 0, count: 0 },
      offSale: { usdCents: 0, estimated: false, approx: 0, count: 0 },
    });
  });

  test('itens à venda e em holding: partes, soma = stockUsdCents e ≈ R$ pela cotação das configurações', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    await create({ purchasePriceCents: 500 });
    await create({ purchasePriceCents: 300 });
    const held = await create({ purchasePriceCents: 1000 });
    await offSale(held.id);
    const data = await summary();
    expect(data.stockUsdCents).toBe(1800);
    expect(data.stockBreakdown.forSale).toEqual({ usdCents: 800, estimated: false, approx: 4000, count: 2 });
    expect(data.stockBreakdown.offSale).toEqual({ usdCents: 1000, estimated: false, approx: 5000, count: 1 });
    expect(data.stockBreakdown.forSale.usdCents + data.stockBreakdown.offSale.usdCents).toBe(data.stockUsdCents);
    expect(data.counts.stockItems).toBe(3);
  });

  test('stockUsdCents e realProfitUsdCents são os mesmos com e sem holding', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    const a = await create({ purchasePriceCents: 500 });
    await create({ purchasePriceCents: 700 });
    const before = await summary();
    await offSale(a.id);
    const after = await summary();
    expect(after.stockUsdCents).toBe(before.stockUsdCents);
    expect(after.realProfitUsdCents).toBe(before.realProfitUsdCents);
    expect(after.stockBreakdown.offSale.count).toBe(1);
    await forSale(a.id);
    expect((await summary()).stockBreakdown).toEqual(before.stockBreakdown);
  });

  test('sem cotação: approx nulo nas duas partes e USD preservado', async () => {
    const held = await create({ purchasePriceCents: 600 });
    await create({ purchasePriceCents: 200 });
    await offSale(held.id);
    const data = await summary();
    expect(data.stockBreakdown.forSale).toMatchObject({ usdCents: 200, approx: null, count: 1 });
    expect(data.stockBreakdown.offSale).toMatchObject({ usdCents: 600, approx: null, count: 1 });
  });

  test('item vendido não entra em nenhuma parte', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    const item = await create({ purchasePriceCents: 400 });
    await request(app).post(`/api/items/${item.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 800, soldAt: NOW.toISOString() });
    const data = await summary();
    expect(data.stockBreakdown.forSale.count + data.stockBreakdown.offSale.count).toBe(0);
  });
});
