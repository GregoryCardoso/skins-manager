'use strict';

// Pedido do usuário (D370, v028): "Vendo nesta loja" (`sellsHere`). Padrão ligado, booleano estrito e filtro só do preço mínimo.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');
const { minPricesForItem } = require('../../src/services/pricingService');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const J = 'application/json';
const post = (url, body) => request(app).post(url).set('Content-Type', J).send(body);
const patch = (url, body) => request(app).patch(url).set('Content-Type', J).send(body);
const names = (item) => item.minPrices.map((m) => m.storeName);

test('todas as lojas do seed vêm com sellsHere true; loja nova também (padrão)', async () => {
  const list = (await request(app).get('/api/stores')).body.data;
  expect(list.length).toBeGreaterThan(0);
  expect(list.every((s) => s.sellsHere === true)).toBe(true);
  const created = await post('/api/stores', { name: 'Nova', currency: 'USD' });
  expect(created.status).toBe(201);
  expect(created.body.data.sellsHere).toBe(true);
});

test('criar com sellsHere false e editar de volta', async () => {
  const created = await post('/api/stores', { name: 'So compra', currency: 'USD', sellsHere: false });
  expect(created.body.data.sellsHere).toBe(false);
  const id = created.body.data.id;
  const back = await patch(`/api/stores/${id}`, { sellsHere: true });
  expect(back.status).toBe(200);
  expect(back.body.data.sellsHere).toBe(true);
  expect((await patch(`/api/stores/${id}`, { sellsHere: false })).body.data.sellsHere).toBe(false);
});

test.each([[0], [1], ['false'], [null]])('sellsHere %p é recusado (booleano estrito)', async (value) => {
  const res = await post('/api/stores', { name: 'X', currency: 'USD', sellsHere: value });
  expectError(res, 400, 'INVALID_FIELD');
  const csf = storeId('CSFloat');
  expectError(await patch(`/api/stores/${csf}`, { sellsHere: value }), 400, 'INVALID_FIELD');
});

test('loja desligada some do preço mínimo do item (lista e detalhe) e volta ao religar; as outras ficam', async () => {
  const created = await createItemViaApi(app, purchaseBody());
  const before = (await request(app).get('/api/items')).body.data.items[0];
  expect(names(before)).toContain('Steam');
  await patch(`/api/stores/${storeId('Steam')}`, { sellsHere: false });
  const list = (await request(app).get('/api/items')).body.data.items[0];
  expect(names(list)).not.toContain('Steam');
  expect(names(list)).toEqual(names(before).filter((n) => n !== 'Steam'));
  const detail = (await request(app).get(`/api/items/${created.id}`)).body.data;
  expect(names(detail)).not.toContain('Steam');
  await patch(`/api/stores/${storeId('Steam')}`, { sellsHere: true });
  expect(names((await request(app).get('/api/items')).body.data.items[0])).toContain('Steam');
});

test('a loja desligada continua em /api/stores e aceita compra', async () => {
  const created = await post('/api/stores', { name: 'So compra', currency: 'USD', sellsHere: false });
  const id = created.body.data.id;
  expect((await request(app).get('/api/stores?activeOnly=true')).body.data.map((s) => s.id)).toContain(id);
  const bought = await post('/api/items', purchaseBody({ purchaseStoreId: id }));
  expect(bought.status).toBe(201);
  expect(names(bought.body.data)).not.toContain('So compra');
});

describe('minPricesForItem (puro)', () => {
  const base = { saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeeRounding: 'CEIL', saleMinFeeCents: null, saleFixedFeeCents: 0, currency: 'USD' };
  const stores = [
    { id: 1, name: 'A', isActive: true, sellsHere: true, ...base },
    { id: 2, name: 'B', isActive: true, sellsHere: false, ...base },
    { id: 3, name: 'C', isActive: false, sellsHere: true, ...base },
  ];
  const item = { purchasePriceCents: 1000, purchaseCurrency: 'USD', fxRateAtPurchase: null };
  test('só entram lojas ativas que vendem', () => {
    const out = minPricesForItem({ item, stores, settings: {}, costParts: null });
    expect(out.map((m) => m.storeName)).toEqual(['A']);
  });
});

describe('D370: lojas de fábrica e venda manual em loja só compra', () => {
  test('banco novo (seed): CSFloat vende; Steam e CSMoney nascem só compra', () => {
    freshDb({ factorySellsHere: true });
    const rows = Object.fromEntries(getDb().prepare('SELECT name, sells_here FROM stores').all().map((r) => [r.name, r.sells_here]));
    expect(rows).toEqual({ CSFloat: 1, Steam: 0, CSMoney: 0 });
  });

  const sellIn = (id, store, extra = {}) =>
    post(`/api/items/${id}/sell`, { saleStoreId: storeId(store), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...extra });

  test('venda manual em loja só compra: 409 STORE_NOT_SELLING no campo saleStoreId; o item continua em estoque', async () => {
    const item = await createItemViaApi(app, purchaseBody());
    await patch(`/api/stores/${storeId('Steam')}`, { sellsHere: false });
    expectError(await sellIn(item.id, 'Steam'), 409, 'STORE_NOT_SELLING', { field: 'saleStoreId' });
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.status).toBe('EM_ESTOQUE');
  });

  test('venda em loja que vende passa; editar a venda e desfazer continuam valendo mesmo se a loja virar só compra depois', async () => {
    const item = await createItemViaApi(app, purchaseBody());
    expect((await sellIn(item.id, 'CSFloat')).status).toBe(200);
    await patch(`/api/stores/${storeId('CSFloat')}`, { sellsHere: false });
    const edited = await patch(`/api/items/${item.id}`, { originDetail: 'ajuste' });
    expect(edited.status).toBe(200);
    expect((await post(`/api/items/${item.id}/unsell`, {})).status).toBe(200);
    expectError(await sellIn(item.id, 'CSFloat'), 409, 'STORE_NOT_SELLING', { field: 'saleStoreId' });
  });

  test('serviço: allowBuyOnlyStore (importação) vende numa loja só compra', () => {
    const itemService = require('../../src/services/itemService');
    const Store = require('../../src/models/Store');
    Store.update(storeId('CSFloat'), { sellsHere: false });
    const created = itemService.createItem(purchaseBody({ acquiredAt: '2026-11-01T00:00:00.000Z' }), { now: new Date('2026-11-20T00:00:00.000Z') });
    const input = { saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z' };
    expect(() => itemService.sellItem(created.id, input, { now: new Date('2026-11-20T00:00:00.000Z') })).toThrow(expect.objectContaining({ code: 'STORE_NOT_SELLING' }));
    expect(itemService.sellItem(created.id, input, { now: new Date('2026-11-20T00:00:00.000Z'), allowBuyOnlyStore: true }).item.status).toBe('VENDIDO');
  });
});
