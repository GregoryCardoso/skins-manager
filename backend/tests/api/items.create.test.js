const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const Store = require('../../src/models/Store');
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

describe('POST /api/items', () => {
  test('GANHEI sem loja e sem preço -> USD, 0, acquiredAt = now (Q6)', async () => {
    const res = await post({ catalogId: CAT.CASE_REVOLVER, acquisitionType: 'GANHEI' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      purchasePriceCents: 0, purchaseCurrency: 'USD', fxRateAtPurchase: null, purchaseStoreId: null,
      acquiredAt: '2026-11-19T15:00:00.000Z', status: 'EM_ESTOQUE', variant: null,
    });
  });

  test('COMPRA com preço 0 aceita (Q8); compra em loja inativa aceita (Q2)', async () => {
    expect((await post(purchaseBody({ purchasePriceCents: 0 }))).status).toBe(201);
    Store.update(storeId('CSFloat'), { isPrimary: false });
    Store.update(storeId('CSFloat'), { isActive: false });
    expect((await post(purchaseBody())).status).toBe(201);
  });

  test('COMPRA sem loja / sem preço', async () => {
    expectError(await post(purchaseBody({ purchaseStoreId: undefined })), 400, 'PURCHASE_STORE_REQUIRED');
    expectError(await post(purchaseBody({ purchasePriceCents: undefined })), 400, 'PURCHASE_PRICE_REQUIRED');
  });

  test('Steam usa a cotação das configurações; sem cotação -> FX_RATE_REQUIRED; cotação informada vence', async () => {
    const steam = purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 500 });
    expectError(await post(steam), 400, 'FX_RATE_REQUIRED');
    Setting.update({ usdBrlRate: 5 });
    expect((await post(steam)).body.data).toMatchObject({ purchaseCurrency: 'BRL', fxRateAtPurchase: 5 });
    expect((await post({ ...steam, fxRateAtPurchase: 5.5 })).body.data.fxRateAtPurchase).toBe(5.5);
  });

  test('USD + cotação -> FX_RATE_NOT_ALLOWED; loja 999 -> STORE_NOT_FOUND', async () => {
    expectError(await post(purchaseBody({ fxRateAtPurchase: 5 })), 400, 'FX_RATE_NOT_ALLOWED');
    expectError(await post(purchaseBody({ purchaseStoreId: 999 })), 400, 'STORE_NOT_FOUND');
  });

  test.each([[1.5, 'INVALID_AMOUNT'], [-1, 'INVALID_AMOUNT'], [2 ** 53, 'INVALID_AMOUNT'], ['100', 'INVALID_FIELD']])(
    'preço %p -> %s',
    async (price, code) => {
      expectError(await post(purchaseBody({ purchasePriceCents: price })), 400, code);
    }
  );

  test('campos proibidos / formato do corpo', async () => {
    expectError(await post(purchaseBody({ status: 'VENDIDO' })), 400, 'UNKNOWN_FIELD');
    expectError(await post(purchaseBody({ netReceivedCents: 1 })), 400, 'UNKNOWN_FIELD');
    expectError(await post(purchaseBody({ purchaseCurrency: 'BRL' })), 400, 'UNKNOWN_FIELD');
    expectError(await post(purchaseBody({ catalogId: undefined })), 400, 'REQUIRED_FIELD');
    expectError(await post(purchaseBody({ name: 5 })), 400, 'INVALID_FIELD');
    expectError(await post([1]), 400, 'INVALID_BODY');
  });

  test('atributos: float deriva exterior, variant padrão NORMAL', async () => {
    const res = await post(purchaseBody({ floatValue: 0.1 }));
    expect(res.body.data).toMatchObject({ exterior: 'MW', variant: 'NORMAL', floatValue: 0.1 });
  });

  test('atributos inválidos', async () => {
    expectError(await post(purchaseBody({ floatValue: 0.1, exterior: 'FN' })), 400, 'EXTERIOR_MISMATCH');
    expectError(await post(purchaseBody({ catalogId: CAT.CASE_REVOLVER, floatValue: 0.1 })), 400, 'ATTRIBUTES_NOT_ALLOWED');
    expectError(await post(purchaseBody({ catalogId: CAT.SPORT_GLOVES_PANDORA, variant: 'STATTRAK' })), 400, 'INVALID_VARIANT');
    expectError(await post(purchaseBody({ catalogId: CAT.KARAMBIT_FADE, variant: 'SOUVENIR' })), 400, 'INVALID_VARIANT');
    expectError(await post(purchaseBody({ catalogId: undefined, name: 'X', category: 'XYZ' })), 400, 'INVALID_CATEGORY');
    expectError(await post(purchaseBody({ acquisitionType: 'X' })), 400, 'INVALID_ACQUISITION_TYPE');
  });

  test('acquiredAt: 23:59 BRT de hoje aceito; 00:00 BRT de amanhã recusado; inválida', async () => {
    expect((await post(purchaseBody({ acquiredAt: '2026-11-20T02:59:00.000Z' }))).status).toBe(201);
    expectError(await post(purchaseBody({ acquiredAt: '2026-11-20T03:00:00.000Z' })), 400, 'ACQUIRED_AT_IN_FUTURE');
    expectError(await post(purchaseBody({ acquiredAt: 'ontem' })), 400, 'INVALID_DATE');
  });

  test('data com fuso é salva em UTC', async () => {
    const res = await post(purchaseBody({ acquiredAt: '2026-11-10T09:00:00-03:00', tradeUnlockAt: '2026-11-21T09:00:00-03:00' }));
    expect(res.body.data.acquiredAt).toBe('2026-11-10T12:00:00.000Z');
    expect(res.body.data.tradeUnlockAt).toBe('2026-11-21T12:00:00.000Z');
  });

  test('strings opcionais: trim e vazio vira null', async () => {
    const item = await createItemViaApi(app, purchaseBody({ inspectLink: '  ', assetId: ' 123 ', originDetail: 'drop' }));
    expect(item).toMatchObject({ inspectLink: null, assetId: '123', originDetail: 'drop' });
  });
});
