const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const patch = (id, body) => request(app).patch(`/api/items/${id}`).send(body);
const sellItem = (id, body = {}) =>
  request(app).post(`/api/items/${id}/sell`).send({
    saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...body,
  });

describe('PATCH /api/items/:id', () => {
  test('parcial altera só o enviado e null limpa opcionais', async () => {
    const item = await createItemViaApi(app, purchaseBody({ originDetail: 'drop' }));
    const res = await patch(item.id, { name: 'M4A4 | Howl', originDetail: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'M4A4 | Howl', originDetail: null, purchasePriceCents: 100 });
  });

  test('trocar CSFloat -> Steam recalcula moeda e cotação; Steam -> CSFloat zera a cotação', async () => {
    Setting.update({ usdBrlRate: 5 });
    const item = await createItemViaApi(app);
    const toSteam = await patch(item.id, { purchaseStoreId: storeId('Steam'), purchasePriceCents: 500 });
    expect(toSteam.body.data).toMatchObject({ purchaseCurrency: 'BRL', fxRateAtPurchase: 5, purchasePriceCents: 500 });
    Setting.update({ usdBrlRate: 6 });
    const same = await patch(item.id, { purchasePriceCents: 200 });
    expect(same.body.data.fxRateAtPurchase).toBe(5); // mesma loja mantém a cotação gravada
    const back = await patch(item.id, { purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 100 });
    expect(back.body.data).toMatchObject({ purchaseCurrency: 'USD', fxRateAtPurchase: null });
  });

  test('SKIN -> CAIXA sem limpar variant -> ATTRIBUTES_NOT_ALLOWED; limpando funciona', async () => {
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.2 }));
    expectError(await patch(item.id, { category: 'CAIXA' }), 400, 'ATTRIBUTES_NOT_ALLOWED');
    const ok = await patch(item.id, { category: 'CAIXA', variant: null, floatValue: null, exterior: null });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ category: 'CAIXA', variant: null, exterior: null });
  });

  test('COMPRA com purchaseStoreId null; acquiredAt null; corpo vazio', async () => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { purchaseStoreId: null }), 400, 'PURCHASE_STORE_REQUIRED');
    expectError(await patch(item.id, { acquiredAt: null }), 400, 'REQUIRED_FIELD');
    expectError(await patch(item.id, {}), 400, 'INVALID_BODY');
    expectError(await patch(item.id, [1]), 400, 'INVALID_BODY');
    expectError(await patch(999, { name: 'x' }), 404, 'ITEM_NOT_FOUND');
    expectError(await patch(item.id, { acquiredAt: '2026-11-20T03:00:00.000Z' }), 400, 'ACQUIRED_AT_IN_FUTURE');
  });

  describe('item vendido (Q5, D60)', () => {
    test('editar preço de compra recalcula o lucro e mantém o snapshot', async () => {
      const item = await createItemViaApi(app);
      await sellItem(item.id);
      const res = await patch(item.id, { purchasePriceCents: 50 });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ saleProfitUsdCents: 72, netReceivedCents: 122, saleFeeRateApplied: 0.02 });
    });

    test('acquiredAt depois de soldAt -> SOLD_BEFORE_ACQUIRED', async () => {
      const item = await createItemViaApi(app);
      await sellItem(item.id);
      expectError(await patch(item.id, { acquiredAt: '2026-11-19T12:00:00.000Z' }), 400, 'SOLD_BEFORE_ACQUIRED');
    });

    test('PATCH de tradeUnlockAt posterior ao soldAt -> 409 ITEM_TRADE_LOCKED; igual ao soldAt é aceito', async () => {
      const item = await createItemViaApi(app);
      await sellItem(item.id); // soldAt 2026-11-18T12:00Z = 09:00 em Brasília
      const res = await patch(item.id, { tradeUnlockAt: '2026-11-19T14:00:00.000Z' });
      expectError(res, 409, 'ITEM_TRADE_LOCKED');
      expect(res.body.error.message).toBe('Item em trade lock até 19/11/2026 11:00');
      expect((await request(app).get(`/api/items/${item.id}`)).body.data.tradeUnlockAt).toBeNull();
      const equal = await patch(item.id, { tradeUnlockAt: '2026-11-18T12:00:00.000Z' });
      expect(equal.status).toBe(200);
    });

    const LOCKED = ['salePriceCents', 'soldAt', 'saleStoreId', 'netReceivedCents', 'status', 'saleCurrency', 'fxRateAtSale'];
    test.each(LOCKED)('%s -> SALE_FIELDS_LOCKED em item vendido e em estoque', async (field) => {
      const sold = await createItemViaApi(app);
      await sellItem(sold.id);
      const stock = await createItemViaApi(app);
      for (const id of [sold.id, stock.id]) {
        expectError(await patch(id, { [field]: 1, foo: 1 }), 400, 'SALE_FIELDS_LOCKED');
      }
    });

    test('campo inexistente -> UNKNOWN_FIELD', async () => {
      const item = await createItemViaApi(app);
      expectError(await patch(item.id, { foo: 1 }), 400, 'UNKNOWN_FIELD');
    });
  });
});

describe('DELETE /api/items/:id', () => {
  test('em estoque: 200 { id }, depois 404', async () => {
    const item = await createItemViaApi(app);
    const res = await request(app).delete(`/api/items/${item.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: item.id } });
    expectError(await request(app).get(`/api/items/${item.id}`), 404, 'ITEM_NOT_FOUND');
    expectError(await request(app).delete(`/api/items/${item.id}`), 404, 'ITEM_NOT_FOUND');
  });

  test('vendido pode ser excluído (Q9); id inválido', async () => {
    const item = await createItemViaApi(app);
    await sellItem(item.id);
    expect((await request(app).delete(`/api/items/${item.id}`)).status).toBe(200);
    expectError(await request(app).delete('/api/items/abc'), 400, 'INVALID_ID');
  });
});
