const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { CAT, makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const SALE_KEYS = [
  'saleStoreId', 'salePriceCents', 'saleCurrency', 'fxRateAtSale', 'saleFeeTypeApplied', 'saleFeeRateApplied',
  'saleFeeRoundingApplied', 'saleMinFeeCentsApplied', 'saleFixedFeeCentsApplied', 'netReceivedCents', 'soldAt',
];
const sell = (id, body = {}) =>
  request(app).post(`/api/items/${id}/sell`).send({
    saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...body,
  });
const unsell = (id, body) => request(app).post(`/api/items/${id}/unsell`).send(body);

describe('POST /api/items/:id/unsell', () => {
  test('volta a EM_ESTOQUE, limpa os 11 campos de venda e preserva a compra', async () => {
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.2 }));
    await sell(item.id);
    const res = await unsell(item.id);
    expect(res.status).toBe(200);
    const view = res.body.data;
    expect(view.status).toBe('EM_ESTOQUE');
    expect(SALE_KEYS).toHaveLength(11);
    for (const key of SALE_KEYS) expect(view[key]).toBeNull();
    expect(view.aging).toEqual({ daysInInventory: 9, agingBucket: 'EM_GIRO' });
    expect(view.minPrices.find((m) => m.storeName === 'CSFloat').minPriceCents).toBe(103);
    expect(view.saleProfitUsdCents).toBeNull();
    expect(view).toMatchObject({
      purchasePriceCents: 100, purchaseCurrency: 'USD', floatValue: 0.2, exterior: 'FT', acquiredAt: item.acquiredAt,
    });
  });

  test('vender de novo depois funciona com novo snapshot', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id);
    await unsell(item.id);
    const res = await sell(item.id, { salePriceCents: 130 });
    expect(res.status).toBe(200);
    expect(res.body.data.item).toMatchObject({ status: 'VENDIDO', salePriceCents: 130, netReceivedCents: 127 });
  });

  test('erros: em estoque -> 409 ITEM_NOT_SOLD; inexistente 404; id inválido; corpo com campo', async () => {
    const item = await createItemViaApi(app);
    expectError(await unsell(item.id), 409, 'ITEM_NOT_SOLD');
    expectError(await unsell(999), 404, 'ITEM_NOT_FOUND');
    expectError(await unsell('abc'), 400, 'INVALID_ID');
    await sell(item.id);
    expectError(await unsell(item.id, { x: 1 }), 400, 'UNKNOWN_FIELD');
    expect((await unsell(item.id, {})).status).toBe(200);
  });
});
