const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const Store = require('../../src/models/Store');
const Withdrawal = require('../../src/models/Withdrawal');
const { freshDb } = require('../helpers/fixtures');
const { CAT, makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const get = (url) => request(app).get(url);
const minOf = (item, name) => item.minPrices.find((m) => m.storeName === name);

describe('GET /api/items/:id', () => {
  test('tradeLock bloqueado, liberado e nulo', async () => {
    const locked = await createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-22T05:20:00.000Z' }));
    expect(locked.tradeLock).toEqual({
      isLocked: true,
      remainingMs: expect.any(Number),
      formatted: '2d 14h 20min restantes',
      tradeUnlockAt: '2026-11-22T05:20:00.000Z',
    });
    const free = await createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-18T00:00:00.000Z' }));
    expect(free.tradeLock).toMatchObject({ isLocked: false, formatted: 'Liberado' });
    const none = await createItemViaApi(app, purchaseBody());
    expect(none.tradeLock).toEqual({ isLocked: false, remainingMs: 0, formatted: 'Liberado', tradeUnlockAt: null });
  });

  test('minPrices: CSFloat 100 -> 103, custo 0 -> 1, CSMoney e Steam sem configuração', async () => {
    const item = await createItemViaApi(app, purchaseBody());
    expect(minOf(item, 'CSFloat')).toMatchObject({ minPriceCents: 103, warning: null, warningCode: null, currency: 'USD' });
    expect(minOf(item, 'CSMoney')).toMatchObject({ minPriceCents: null, warning: 'taxas não configuradas', warningCode: 'FEES_NOT_CONFIGURED' });
    expect(minOf(item, 'Steam')).toMatchObject({ minPriceCents: null, warning: 'cotação não configurada' });
    const zero = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 0 }));
    expect(minOf(zero, 'CSFloat').minPriceCents).toBe(1);
  });

  test('loja inativa omitida; sem chaves de saque; saque e taxa de saque não alteram minPrices', async () => {
    const item = await createItemViaApi(app, purchaseBody());
    const before = (await get(`/api/items/${item.id}`)).body.data.minPrices;
    Withdrawal.create({
      storeId: storeId('CSFloat'), amountStoreCents: 1000, amountBrlCents: 5000, withdrawnAt: '2026-11-15T12:00:00.000Z',
    });
    Store.update(storeId('CSFloat'), { withdrawalFeeRate: 0.1, withdrawalFixedFeeCents: 77 });
    const after = (await get(`/api/items/${item.id}`)).body.data.minPrices;
    expect(after).toEqual(before);
    for (const entry of after) {
      expect(Object.keys(entry).sort()).toEqual(['approx', 'currency', 'minPriceCents', 'storeId', 'storeName', 'warning', 'warningCode']);
      expect(Object.keys(entry).some((k) => /sac|withdraw/i.test(k))).toBe(false);
    }
    Store.update(storeId('Steam'), { isActive: false });
    const filtered = (await get(`/api/items/${item.id}`)).body.data;
    expect(filtered.minPrices.map((m) => m.storeName)).toEqual(['CSFloat', 'CSMoney']);
  });

  test('aging e stats por chave (o nome canônico vem do catálogo)', async () => {
    const a = await createItemViaApi(app, purchaseBody({ floatValue: 0.2 }));
    await createItemViaApi(app, purchaseBody({ floatValue: 0.3, purchasePriceCents: 300 }));
    const view = (await get(`/api/items/${a.id}`)).body.data;
    expect(view.aging).toEqual({ daysInInventory: 9, daysForSale: 9, agingBucket: 'EM_GIRO' });
    expect(view.stats).toMatchObject({ soldCount: 0, avgPurchaseCostUsdCents: 200, avgDaysToSell: null });
  });

  test('GET /stats por chave, vazio e erros', async () => {
    await createItemViaApi(app, purchaseBody({ floatValue: 0.2 }));
    const res = await get('/api/items/stats?name=ak-47%20%7C%20REDLINE&category=SKIN&variant=NORMAL&exterior=FT');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ key: 'ak-47 | redline|SKIN|NORMAL|FT|', soldCount: 0, avgPurchaseCostUsdCents: 100 });
    const empty = await get('/api/items/stats?name=nada&category=SKIN');
    expect(empty.body.data).toMatchObject({ soldCount: 0, avgPurchaseCostUsdCents: null, avgProfitUsdCents: null });
    expectError(await get('/api/items/stats?category=SKIN'), 400, 'INVALID_QUERY');
    expectError(await get('/api/items/stats?name=x&category=ZZ'), 400, 'INVALID_QUERY');
  });

  test('404 e INVALID_ID', async () => {
    expectError(await get('/api/items/999'), 404, 'ITEM_NOT_FOUND');
    for (const id of ['abc', '0', '1.5']) expectError(await get(`/api/items/${id}`), 400, 'INVALID_ID');
  });

  test('vendido: minPrices null e saleProfitUsdCents', async () => {
    const item = await createItemViaApi(app, purchaseBody());
    const res = await request(app).post(`/api/items/${item.id}/sell`).send({
      saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z',
    });
    expect(res.body.data.item).toMatchObject({ minPrices: null, saleProfitUsdCents: 22 });
    const view = (await get(`/api/items/${item.id}`)).body.data;
    expect(view.minPrices).toBeNull();
    expect(view.stats.soldCount).toBe(1);
  });
});
