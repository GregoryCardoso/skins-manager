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

const post = (body) => request(app).post('/api/items').send(body);

describe('error.field e error.params (D113)', () => {
  test('forma', async () => {
    expectError(await post({ ...purchaseBody(), foo: 1 }), 400, 'UNKNOWN_FIELD', { field: 'foo' });
    expectError(await post(purchaseBody({ acquisitionType: undefined })), 400, 'REQUIRED_FIELD', { field: 'acquisitionType' });
    expectError(await post(purchaseBody({ purchasePriceCents: '100' })), 400, 'INVALID_FIELD', { field: 'purchasePriceCents' });
    expectError(
      await post(purchaseBody({ originDetail: 'x'.repeat(201) })), 400, 'FIELD_TOO_LONG',
      { field: 'originDetail', params: { maxLength: 200 } }
    );
    expectError(
      await post(purchaseBody({ purchasePriceCents: 1e10 + 1 })), 400, 'INVALID_AMOUNT',
      { field: 'purchasePriceCents', params: { maxCents: 1e10, currency: 'USD' } }
    );
  });

  test('regras de aquisição e catálogo', async () => {
    expectError(await post(purchaseBody({ purchaseStoreId: undefined })), 400, 'PURCHASE_STORE_REQUIRED', { field: 'purchaseStoreId' });
    expectError(await post(purchaseBody({ purchasePriceCents: undefined })), 400, 'PURCHASE_PRICE_REQUIRED', { field: 'purchasePriceCents' });
    expectError(await post(purchaseBody({ acquisitionType: 'GANHEI' })), 400, 'GANHEI_COST_NOT_ALLOWED', { field: 'purchasePriceCents' });
    expectError(await post(purchaseBody({ purchaseStoreId: storeId('Steam') })), 400, 'FX_RATE_REQUIRED', { field: 'fxRateAtPurchase' });
    expectError(await post(purchaseBody({ purchaseStoreId: 9999 })), 400, 'STORE_NOT_FOUND', { field: 'purchaseStoreId' });
    expectError(await post(purchaseBody({ name: 'X' })), 400, 'CATALOG_DERIVED_FIELD', { field: 'name' });
    expectError(await post(purchaseBody({ catalogId: 'nao-existe' })), 400, 'CATALOG_ITEM_NOT_FOUND', { field: 'catalogId' });
    expectError(
      await post(purchaseBody({ catalogId: undefined, category: 'SKIN', name: 'Y' })), 400, 'CATALOG_ITEM_REQUIRED',
      { field: 'catalogId' }
    );
  });

  test('atributos e datas', async () => {
    expectError(
      await post(purchaseBody({ floatValue: 0.01 })), 400, 'FLOAT_OUT_OF_RANGE',
      { field: 'floatValue', params: { minFloat: 0.1, maxFloat: 0.7 } }
    );
    expectError(await post(purchaseBody({ floatValue: 0.2, exterior: 'FN' })), 400, 'EXTERIOR_MISMATCH', { field: 'exterior' });
    expectError(
      await post(purchaseBody({ catalogId: CAT.CASE_REVOLVER, variant: 'NORMAL' })), 400, 'ATTRIBUTES_NOT_ALLOWED', { field: 'variant' }
    );
    expectError(await post(purchaseBody({ acquiredAt: 'ontem' })), 400, 'INVALID_DATE', { field: 'acquiredAt' });
    expectError(await post(purchaseBody({ acquiredAt: '2026-12-25T12:00:00.000Z' })), 400, 'ACQUIRED_AT_IN_FUTURE', { field: 'acquiredAt' });
  });

  test('venda: datas, loja, cotação e trade lock', async () => {
    const item = await createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-15T12:00:00.000Z' }));
    const sell = (b) => request(app).post(`/api/items/${item.id}/sell`).send({
      saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...b,
    });
    expectError(
      await sell({ soldAt: '2026-11-14T12:00:00.000Z' }), 409, 'ITEM_TRADE_LOCKED',
      { field: 'soldAt', params: { tradeUnlockAt: '2026-11-15T12:00:00.000Z' } }
    );
    expectError(await sell({ soldAt: '2026-12-25T12:00:00.000Z' }), 400, 'SOLD_AT_IN_FUTURE', { field: 'soldAt' });
    expectError(await sell({ soldAt: 'x' }), 400, 'INVALID_DATE', { field: 'soldAt' });
    expectError(await sell({ saleStoreId: 9999 }), 400, 'STORE_NOT_FOUND', { field: 'saleStoreId' });
    expectError(await sell({ saleStoreId: storeId('Steam') }), 400, 'FX_RATE_REQUIRED', { field: 'fxRateAtSale' });
    expectError(await request(app).get('/api/items/9999'), 404, 'ITEM_NOT_FOUND', { field: null });
  });
});

describe('inspectLink (D114) e limites (T30)', () => {
  test('aceitos', async () => {
    const ok = ['steam://rungame/730/1/+csgo_econ_action_preview%20S1A1D1', 'STEAM://x', 'https://x.y/z', '', null];
    for (const v of ok) expect((await post(purchaseBody({ inspectLink: v }))).status).toBe(201);
    const res = await post(purchaseBody({ inspectLink: '  steam://abc  ' }));
    expect(res.body.data.inspectLink).toBe('steam://abc');
  });

  test('recusados', async () => {
    const bad = ['http://x.y', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x', 'steam:', 'steam://', 'https://', 'abc'];
    for (const v of bad) expectError(await post(purchaseBody({ inspectLink: v })), 400, 'INVALID_FIELD', { field: 'inspectLink' });
  });

  test('tamanho', async () => {
    expectError(
      await post(purchaseBody({ inspectLink: `https://x.y/${'a'.repeat(2048)}` })), 400, 'FIELD_TOO_LONG',
      { field: 'inspectLink', params: { maxLength: 2048 } }
    );
    expectError(await post(purchaseBody({ assetId: 'a'.repeat(65) })), 400, 'FIELD_TOO_LONG', { field: 'assetId', params: { maxLength: 64 } });
    expectError(await post(purchaseBody({ phase: 'a'.repeat(101) })), 400, 'FIELD_TOO_LONG', { field: 'phase', params: { maxLength: 100 } });
  });
});
