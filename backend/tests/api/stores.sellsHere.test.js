'use strict';

// Pedido do usuário (D370, v028): "Vendo nesta loja" (`sellsHere`). Padrão ligado, booleano estrito e filtro só do preço mínimo.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
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
