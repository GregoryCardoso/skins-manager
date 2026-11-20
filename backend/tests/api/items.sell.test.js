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

const sellBody = (overrides = {}) => ({
  saleStoreId: storeId('CSFloat'),
  salePriceCents: 125,
  soldAt: '2026-11-18T12:00:00.000Z',
  ...overrides,
});
const sell = (id, body) => request(app).post(`/api/items/${id}/sell`).send(body);

describe('POST /api/items/:id/sell', () => {
  test('CSFloat 125 -> líquido 122, snapshot completo, lucro 22, sem warnings', async () => {
    const item = await createItemViaApi(app);
    const res = await sell(item.id, sellBody());
    expect(res.status).toBe(200);
    expect(res.body.data.sale).toEqual({ netReceivedCents: 122, feeCents: 3, saleProfitUsdCents: 22, netReceivedManual: false });
    expect(res.body.data).not.toHaveProperty('warnings');
    expect(res.body.data.item).toMatchObject({
      status: 'VENDIDO', saleStoreId: storeId('CSFloat'), salePriceCents: 125, saleCurrency: 'USD', fxRateAtSale: null,
      saleFeeTypeApplied: 'DEDUCTED', saleFeeRateApplied: 0.02, saleFeeRoundingApplied: 'CEIL',
      saleMinFeeCentsApplied: null, saleFixedFeeCentsApplied: 0, netReceivedCents: 122,
      soldAt: '2026-11-18T12:00:00.000Z', saleProfitUsdCents: 22, minPrices: null,
    });
  });

  test('Steam 115 -> líquido 100 em BRL com cotação; sem cotação -> FX_RATE_REQUIRED', async () => {
    const item = await createItemViaApi(app);
    const steam = sellBody({ saleStoreId: storeId('Steam'), salePriceCents: 115 });
    expectError(await sell(item.id, steam), 400, 'FX_RATE_REQUIRED');
    Setting.update({ usdBrlRate: 5 });
    const res = await sell(item.id, steam);
    expect(res.status).toBe(200);
    expect(res.body.data.item).toMatchObject({ saleCurrency: 'BRL', fxRateAtSale: 5, netReceivedCents: 100 });
    // 100 BRL / 5 = 20 USD cents; custo 100 USD cents -> -80
    expect(res.body.data.sale.saleProfitUsdCents).toBe(-80);
  });

  test('USD + cotação informada -> FX_RATE_NOT_ALLOWED', async () => {
    const item = await createItemViaApi(app);
    expectError(await sell(item.id, sellBody({ fxRateAtSale: 5 })), 400, 'FX_RATE_NOT_ALLOWED');
  });

  test('CSMoney -> FEES_NOT_CONFIGURED; loja inexistente -> STORE_NOT_FOUND', async () => {
    const item = await createItemViaApi(app);
    expectError(await sell(item.id, sellBody({ saleStoreId: storeId('CSMoney') })), 400, 'FEES_NOT_CONFIGURED');
    expectError(await sell(item.id, sellBody({ saleStoreId: 999 })), 400, 'STORE_NOT_FOUND');
  });

  test('vender duas vezes -> 409 ITEM_ALREADY_SOLD; item inexistente -> 404', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id, sellBody());
    expectError(await sell(item.id, sellBody()), 409, 'ITEM_ALREADY_SOLD');
    expectError(await sell(999, sellBody()), 404, 'ITEM_NOT_FOUND');
  });

  test('datas: soldAt = acquiredAt ok; 1 ms antes recusado; futuro recusado; inválido', async () => {
    const item = await createItemViaApi(app);
    expectError(await sell(item.id, sellBody({ soldAt: '2026-11-10T11:59:59.999Z' })), 400, 'SOLD_BEFORE_ACQUIRED');
    expectError(await sell(item.id, sellBody({ soldAt: '2026-11-20T03:00:00.000Z' })), 400, 'SOLD_AT_IN_FUTURE');
    expectError(await sell(item.id, sellBody({ soldAt: 'nunca' })), 400, 'INVALID_DATE');
    const ok = await sell(item.id, sellBody({ soldAt: '2026-11-10T12:00:00.000Z' }));
    expect(ok.status).toBe(200);
    expect(ok.body.data.item.aging).toEqual({ turnaroundDays: 0, turnaroundBucket: 'GIRO_RAPIDO' });
  });

  test('23:59 BRT de hoje aceito', async () => {
    const item = await createItemViaApi(app);
    expect((await sell(item.id, sellBody({ soldAt: '2026-11-20T02:59:00.000Z' }))).status).toBe(200);
  });

  test('minFee 50 e preço 10 -> NET_RECEIVED_NEGATIVE; preço inválido -> INVALID_AMOUNT', async () => {
    Store.update(storeId('CSFloat'), { saleMinFeeCents: 50 });
    const item = await createItemViaApi(app);
    expectError(await sell(item.id, sellBody({ salePriceCents: 10 })), 400, 'NET_RECEIVED_NEGATIVE');
    expectError(await sell(item.id, sellBody({ salePriceCents: 0 })), 400, 'INVALID_AMOUNT');
    expectError(await sell(item.id, sellBody({ salePriceCents: 1.5 })), 400, 'INVALID_AMOUNT');
  });

  test('alterar a taxa da loja depois não muda o snapshot (D18)', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id, sellBody());
    Store.update(storeId('CSFloat'), { saleFeeRate: 0.1 });
    const view = (await request(app).get(`/api/items/${item.id}`)).body.data;
    expect(view).toMatchObject({ saleFeeRateApplied: 0.02, netReceivedCents: 122 });
  });

  test('campo faltando -> REQUIRED_FIELD; campo extra -> UNKNOWN_FIELD; string -> INVALID_FIELD', async () => {
    const item = await createItemViaApi(app);
    for (const key of ['saleStoreId', 'salePriceCents', 'soldAt']) {
      expectError(await sell(item.id, sellBody({ [key]: undefined })), 400, 'REQUIRED_FIELD');
    }
    expectError(await sell(item.id, sellBody({ netReceivedManual: true })), 400, 'UNKNOWN_FIELD');
    expectError(await sell(item.id, sellBody({ salePriceCents: '125' })), 400, 'INVALID_FIELD');
  });

  test('venda em loja inativa aceita (Q2)', async () => {
    const item = await createItemViaApi(app);
    Store.update(storeId('Steam'), { isActive: false });
    Setting.update({ usdBrlRate: 5 });
    expect((await sell(item.id, sellBody({ saleStoreId: storeId('Steam'), salePriceCents: 115 }))).status).toBe(200);
  });

  describe('trade lock (D59 revisada): venda bloqueada antes do unlock', () => {
    const lockedItem = () => createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-15T12:00:00.000Z' }));

    test('soldAt antes do unlock -> 409 ITEM_TRADE_LOCKED, mesmo com now depois do unlock; item segue em estoque', async () => {
      const item = await lockedItem();
      const res = await sell(item.id, sellBody({ soldAt: '2026-11-14T12:00:00.000Z' }));
      expectError(res, 409, 'ITEM_TRADE_LOCKED');
      expect(res.body.error.message).toBe('Item em trade lock até 15/11/2026 09:00');
      const view = (await request(app).get(`/api/items/${item.id}`)).body.data;
      expect(view.status).toBe('EM_ESTOQUE');
      expect(view.saleStoreId).toBeNull();
    });

    test('soldAt exatamente no unlock -> ok', async () => {
      const item = await lockedItem();
      expect((await sell(item.id, sellBody({ soldAt: '2026-11-15T12:00:00.000Z' }))).status).toBe(200);
    });

    test('soldAt depois do unlock -> ok', async () => {
      const item = await lockedItem();
      expect((await sell(item.id, sellBody({ soldAt: '2026-11-16T12:00:00.000Z' }))).status).toBe(200);
    });

    test('sem tradeUnlockAt -> ok', async () => {
      const item = await createItemViaApi(app);
      expect((await sell(item.id, sellBody())).status).toBe(200);
    });

    test('trava ainda ativa em now (futura) e soldAt posterior ao unlock é impossível sem data futura; soldAt hoje antes do unlock -> 409', async () => {
      const item = await createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-19T20:00:00.000Z' }));
      expectError(await sell(item.id, sellBody({ soldAt: '2026-11-19T15:00:00.000Z' })), 409, 'ITEM_TRADE_LOCKED');
      expect((await sell(item.id, sellBody({ soldAt: '2026-11-19T20:00:00.000Z' }))).status).toBe(200);
    });
  });
});
