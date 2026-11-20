// D65: regra simplificada de GANHEI e função única de atributos de arma. Banco :memory: (tests/setup.js).
const request = require('supertest');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { closeDb } = require('../../src/config/database');
const { CAT, makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/items').send(body);
const patch = (id, body) => request(app).patch(`/api/items/${id}`).send(body);
const won = (o = {}) => ({ catalogId: CAT.CASE_REVOLVER, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z', ...o });

describe('D65 GANHEI: custo fixo US$ 0,00', () => {
  test('POST sem preço: custo 0, USD, cotação null', async () => {
    const res = await post(won());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ purchasePriceCents: 0, purchaseCurrency: 'USD', fxRateAtPurchase: null });
  });

  test.each([null, 0, 500])('POST com purchasePriceCents=%p -> GANHEI_COST_NOT_ALLOWED', async (v) => {
    const res = await post(won({ purchasePriceCents: v }));
    expectError(res, 400, 'GANHEI_COST_NOT_ALLOWED');
    expect(res.body.error.message).toBe('Item ganho tem custo fixo US$ 0,00; não informe preço de compra.');
  });

  test('POST com fxRateAtPurchase -> FX_RATE_NOT_ALLOWED (com loja USD ou BRL, ou sem loja)', async () => {
    expectError(await post(won({ fxRateAtPurchase: 5 })), 400, 'FX_RATE_NOT_ALLOWED');
    expectError(await post(won({ fxRateAtPurchase: 5, purchaseStoreId: storeId('Steam') })), 400, 'FX_RATE_NOT_ALLOWED');
  });

  test('POST com loja BRL e sem cotação salva: 201, USD, sem cotação (loja só informativa)', async () => {
    const res = await post(won({ purchaseStoreId: storeId('Steam') }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ purchaseStoreId: storeId('Steam'), purchaseCurrency: 'USD', purchasePriceCents: 0, fxRateAtPurchase: null });
  });

  test('PATCH de GANHEI com preço (null, 0, valor) ou cotação no corpo é recusado e nada muda', async () => {
    const item = await createItemViaApi(app, won());
    for (const v of [null, 0, 300]) {
      expectError(await patch(item.id, { purchasePriceCents: v }), 400, 'GANHEI_COST_NOT_ALLOWED');
    }
    expectError(await patch(item.id, { fxRateAtPurchase: 5 }), 400, 'FX_RATE_NOT_ALLOWED');
    const same = await request(app).get(`/api/items/${item.id}`);
    expect(same.body.data).toMatchObject({ purchasePriceCents: 0, purchaseCurrency: 'USD', fxRateAtPurchase: null });
  });

  test('COMPRA -> GANHEI com loja BRL e cotação gravada: custo 0, USD, cotação null', async () => {
    Setting.update({ usdBrlRate: 5 });
    const item = await createItemViaApi(app, purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 500 }));
    expect(item.fxRateAtPurchase).toBe(5);
    const res = await patch(item.id, { acquisitionType: 'GANHEI' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ acquisitionType: 'GANHEI', purchasePriceCents: 0, purchaseCurrency: 'USD', fxRateAtPurchase: null });
  });

  test('COMPRA -> GANHEI com preço no corpo: GANHEI_COST_NOT_ALLOWED', async () => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { acquisitionType: 'GANHEI', purchasePriceCents: 100 }), 400, 'GANHEI_COST_NOT_ALLOWED');
  });
});

describe('D65 GANHEI -> COMPRA', () => {
  const winItem = () => createItemViaApi(app, won({ catalogId: CAT.AK_REDLINE }));

  test('sem preço: PURCHASE_PRICE_REQUIRED; sem loja: PURCHASE_STORE_REQUIRED', async () => {
    const item = await winItem();
    expectError(await patch(item.id, { acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat') }), 400, 'PURCHASE_PRICE_REQUIRED');
    expectError(await patch(item.id, { acquisitionType: 'COMPRA', purchasePriceCents: 100 }), 400, 'PURCHASE_STORE_REQUIRED');
    expectError(await patch(item.id, { acquisitionType: 'COMPRA', purchaseStoreId: null, purchasePriceCents: 100 }), 400, 'PURCHASE_STORE_REQUIRED');
    expectError(await patch(item.id, { acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: null }), 400, 'PURCHASE_PRICE_REQUIRED');
  });

  test('T33 (D73): a loja já gravada vale como loja de compra; sem loja gravada nem enviada -> PURCHASE_STORE_REQUIRED', async () => {
    const item = await createItemViaApi(app, won({ purchaseStoreId: storeId('CSFloat'), catalogId: CAT.AK_REDLINE }));
    const res = await patch(item.id, { acquisitionType: 'COMPRA', purchasePriceCents: 100 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 100, purchaseCurrency: 'USD',
    });
    const noStore = await winItem();
    expectError(await patch(noStore.id, { acquisitionType: 'COMPRA', purchasePriceCents: 100 }), 400, 'PURCHASE_STORE_REQUIRED');
  });

  test('loja USD com preço: COMPRA em USD', async () => {
    const item = await winItem();
    const res = await patch(item.id, { acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 250 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ acquisitionType: 'COMPRA', purchasePriceCents: 250, purchaseCurrency: 'USD', fxRateAtPurchase: null });
  });

  test('loja BRL: exige cotação informada ou salva', async () => {
    const item = await winItem();
    const body = { acquisitionType: 'COMPRA', purchaseStoreId: storeId('Steam'), purchasePriceCents: 1000 };
    expectError(await patch(item.id, body), 400, 'FX_RATE_REQUIRED');
    const informed = await patch(item.id, { ...body, fxRateAtPurchase: 5.5 });
    expect(informed.body.data).toMatchObject({ purchaseCurrency: 'BRL', purchasePriceCents: 1000, fxRateAtPurchase: 5.5 });
    Setting.update({ usdBrlRate: 5 });
    const item2 = await winItem();
    const saved = await patch(item2.id, body);
    expect(saved.body.data).toMatchObject({ purchaseCurrency: 'BRL', fxRateAtPurchase: 5 });
  });
});

describe('D65 GANHEI vendido e preço mínimo', () => {
  test('lucro = netReceived num GANHEI vendido', async () => {
    const item = await createItemViaApi(app, won({ catalogId: CAT.AK_REDLINE }));
    const sold = await request(app)
      .post(`/api/items/${item.id}/sell`)
      .send({ saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z' });
    expect(sold.status).toBe(200);
    const view = sold.body.data.item;
    expect(view.saleProfitUsdCents).toBe(view.netReceivedCents);
    expect(sold.body.data.sale.saleProfitUsdCents).toBe(view.netReceivedCents);
  });

  test('minPrices com custo 0: CSFloat = 1 centavo', async () => {
    const item = await createItemViaApi(app, won());
    expect(item.minPrices.find((m) => m.storeName === 'CSFloat').minPriceCents).toBe(1);
  });
});

