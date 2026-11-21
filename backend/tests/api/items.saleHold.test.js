// Snapshot da retenção na venda (D214): gravado em sell, limpo no unsell, travado no PATCH, recusado no corpo da venda.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { buildSaleRecord } = require('../../src/services/itemService');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const sell = (id, body = {}) =>
  request(app).post(`/api/items/${id}/sell`).send({
    saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...body,
  });
const setHold = (name, days) => request(app).patch(`/api/stores/${storeId(name)}`).send({ saleHoldDays: days }).expect(200);
const rowOf = (id) => getDb().prepare('SELECT status, sale_hold_days_applied AS h FROM items WHERE id = ?').get(id);

describe('buildSaleRecord: saleHoldDaysApplied', () => {
  const item = { acquiredAt: '2026-01-01T00:00:00.000Z', tradeUnlockAt: null };
  const store = (saleHoldDays) => ({
    id: 1, currency: 'USD', saleHoldDays, saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeeRounding: 'CEIL',
    saleMinFeeCents: null, saleFixedFeeCents: 0,
  });
  const input = { salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z' };
  const now = new Date('2026-11-19T15:00:00.000Z');

  test.each([[7], [0], [30]])('grava store.saleHoldDays = %p no registro e no bloco sale', (days) => {
    const { record, sale } = buildSaleRecord(item, input, { store: store(days), now });
    expect(record.saleHoldDaysApplied).toBe(days);
    expect(sale.saleHoldDaysApplied).toBe(days);
  });
});

describe('API: snapshot da retenção', () => {
  test('CSFloat (7) e Steam (0): o snapshot vai ao item vendido e ao bloco sale; retenção 0 grava 0, não nulo', async () => {
    const a = await createItemViaApi(app);
    const resA = await sell(a.id);
    expect(resA.status).toBe(200);
    expect(resA.body.data.item.saleHoldDaysApplied).toBe(7);
    expect(resA.body.data.sale.saleHoldDaysApplied).toBe(7);
    expect(rowOf(a.id)).toEqual({ status: 'VENDIDO', h: 7 });

    const b = await createItemViaApi(app, purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 1000, fxRateAtPurchase: 5 }));
    const resB = await sell(b.id, { saleStoreId: storeId('Steam'), salePriceCents: 1150, fxRateAtSale: 5.5 });
    expect(resB.body.data.item.saleHoldDaysApplied).toBe(0);
    expect(resB.body.data.sale.saleHoldDaysApplied).toBe(0);
    expect(rowOf(b.id).h).toBe(0);
  });

  test('o item em estoque tem saleHoldDaysApplied nulo', async () => {
    const item = await createItemViaApi(app);
    expect(item.saleHoldDaysApplied).toBeNull();
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.saleHoldDaysApplied).toBeNull();
  });

  test('alterar a loja depois da venda não muda a venda antiga; a venda nova usa o valor novo', async () => {
    const old = await createItemViaApi(app);
    await sell(old.id);
    await setHold('CSFloat', 3);
    const fresh = await createItemViaApi(app);
    await sell(fresh.id);
    expect(rowOf(old.id).h).toBe(7);
    expect(rowOf(fresh.id).h).toBe(3);
    await setHold('CSFloat', 0);
    expect(rowOf(old.id).h).toBe(7);
    expect((await request(app).get(`/api/items/${old.id}`)).body.data.saleHoldDaysApplied).toBe(7);
    const third = await createItemViaApi(app);
    await sell(third.id);
    expect(rowOf(third.id).h).toBe(0);
  });

  test('unsell limpa o snapshot; vender de novo grava o valor atual da loja', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id);
    expect(rowOf(item.id).h).toBe(7);
    const res = await request(app).post(`/api/items/${item.id}/unsell`).set('Content-Type', 'application/json').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.saleHoldDaysApplied).toBeNull();
    expect(rowOf(item.id)).toEqual({ status: 'EM_ESTOQUE', h: null });
    await setHold('CSFloat', 5);
    await sell(item.id);
    expect(rowOf(item.id).h).toBe(5);
  });

  test('PATCH do item com saleHoldDaysApplied -> SALE_FIELDS_LOCKED (vendido e em estoque)', async () => {
    const item = await createItemViaApi(app);
    expectError(await request(app).patch(`/api/items/${item.id}`).send({ saleHoldDaysApplied: 3 }), 400, 'SALE_FIELDS_LOCKED');
    await sell(item.id);
    expectError(await request(app).patch(`/api/items/${item.id}`).send({ saleHoldDaysApplied: 3 }), 400, 'SALE_FIELDS_LOCKED');
    expect(rowOf(item.id).h).toBe(7);
  });

  test('corpo da venda com saleHoldDaysApplied -> UNKNOWN_FIELD; a venda não é feita', async () => {
    const item = await createItemViaApi(app);
    expectError(await sell(item.id, { saleHoldDaysApplied: 1 }), 400, 'UNKNOWN_FIELD', { field: 'saleHoldDaysApplied' });
    expect(rowOf(item.id)).toEqual({ status: 'EM_ESTOQUE', h: null });
  });
});
