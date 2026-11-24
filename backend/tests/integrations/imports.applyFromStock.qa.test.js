'use strict';

// 10.3 (D362 item 9, E-P2-Q30 e Q47): venda importada de arma com componente que ela não tem no app e unidade igual no estoque: aviso
// COMPONENT_MAYBE_APPLIED_FROM_STOCK e a ação "Aplicar e registrar" (aplicação retroativa na arma já vendida). API com fetchFn falso.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, seedComponentCatalog, CAT_EXTRA } = require('../helpers/catalog');
const { storeId, expectError } = require('../helpers/apiFixtures');
const { KEY, meBody, fakeTrade, fakeTransaction, routedFetch, DEAGLE_4_STICKERS } = require('../helpers/csfloatFixtures');

jest.setTimeout(60000);

const JSON_TYPE = 'application/json';
const NOW = new Date('2026-11-22T15:00:00.000Z');
const CUTOFF = '2026-11-01T00:00:00.000Z';
const SOLD_AT = '2026-11-20T10:00:00.000Z';

let app;
let state;
const post = (url, body = {}) => request(app).post(url).set('Content-Type', JSON_TYPE).send(body);
const get = (url) => request(app).get(url);
const sale = (id, preset) => fakeTrade({
  id, direction: 'SELL', state: 'verified', protectionEndsAt: null, price: 1500, createdAt: SOLD_AT, item: preset.item, reference: preset.reference,
});
const credit = (id) => fakeTransaction({
  id: `tx-sold-${id}`, type: 'contract_sold', pendingOffset: 1470, createdAt: '2026-11-20T10:00:05.000Z', details: { contract_id: `9${id}`, fee_amount: '30' },
});
const createItem = async (body) => {
  const res = await post('/api/items', body);
  expect(res.status).toBe(201);
  return res.body.data;
};
const purchase = (catalogId, price, extra = {}) => ({
  catalogId, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: price, acquiredAt: '2026-10-02T12:00:00.000Z', ...extra,
});
const profit = async () => (await get('/api/profit/summary')).body.data;
const itemOf = async (id) => (await get(`/api/items/${id}`)).body.data;

// Uma Desert Eagle (1000) e um sticker BIG (200) em estoque; importa a venda da Deagle com os 4 stickers do trade.
async function importSale({ withSticker = true } = {}) {
  const deagle = await createItem(purchase(CAT_EXTRA.DEAGLE_TRIGGER, 1000, { acquiredAt: '2026-10-01T12:00:00.000Z' }));
  const sticker = withSticker ? await createItem(purchase(CAT_EXTRA.BIG, 200)) : null;
  state.trades = [sale('5001', DEAGLE_4_STICKERS)];
  state.transactions = [credit('5001')];
  const batch = (await post('/api/imports/csfloat/run', { cutoffAt: CUTOFF })).body.data.batch;
  const entry = batch.entries.find((e) => e.entityType === 'ITEM_SALE');
  return { deagle, sticker, batch, entry };
}

beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  seedComponentCatalog();
  state = { me: meBody(), trades: [], transactions: [] };
  app = createApp({ now: () => new Date(NOW.getTime()), fetchFn: routedFetch(state), sleepFn: async () => {} });
  const res = await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY });
  expect(res.status).toBe(200);
  await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 100000, depositedAt: '2026-10-01T00:00:00.000Z' });
});
afterAll(() => closeDb());

describe('aplicação retroativa, lacunas', () => {
  const resolve = (entryId, body) => post(`/api/imports/entries/${entryId}/resolve`, body);

  test('data antes da aquisição do ALVO vendido é recusada e nada é gravado', async () => {
    const deagle = await createItem(purchase(CAT_EXTRA.DEAGLE_TRIGGER, 1000, { acquiredAt: '2026-10-10T12:00:00.000Z' }));
    const sticker = await createItem(purchase(CAT_EXTRA.BIG, 200, { acquiredAt: '2026-10-02T12:00:00.000Z' }));
    state.trades = [sale('5001', DEAGLE_4_STICKERS)];
    state.transactions = [credit('5001')];
    const batch = (await post('/api/imports/csfloat/run', { cutoffAt: CUTOFF })).body.data.batch;
    const entry = batch.entries.find((e) => e.entityType === 'ITEM_SALE');
    const before = await profit();
    const res = await resolve(entry.id, { action: 'APPLY_FROM_STOCK', sourceItemId: sticker.id, appliedAt: '2026-10-05T12:00:00.000Z' });
    expectError(res, 422, 'OPERATION_DATE_INVALID');
    expect((await itemOf(sticker.id)).status).toBe('EM_ESTOQUE');
    expect(await profit()).toEqual(before);
    expect((await itemOf(deagle.id)).components).toEqual([]);
  });

  test('segunda aplicação da mesma entrada: o aviso já foi tratado (ação não oferecida) e a unidade consumida não é reaproveitada', async () => {
    const { sticker, entry } = await importSale();
    const first = await resolve(entry.id, { action: 'APPLY_FROM_STOCK', sourceItemId: sticker.id, appliedAt: SOLD_AT });
    expect(first.status).toBe(200);
    const again = await resolve(entry.id, { action: 'APPLY_FROM_STOCK', sourceItemId: sticker.id, appliedAt: SOLD_AT });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('IMPORT_ENTRY_ACTION_NOT_ALLOWED');
  });

  test('a ação não toca saldos: venda e líquido idênticos; só o lucro real e o estoque caem o custo efetivo', async () => {
    const { deagle, sticker, entry } = await importSale();
    const before = await profit();
    const balances = (p) => p.balancesByStore.map((b) => [b.storeId, b.availableCents, b.pendingCents]);
    await resolve(entry.id, { action: 'APPLY_FROM_STOCK', sourceItemId: sticker.id, appliedAt: '2026-11-18T12:00:00.000Z' });
    const after = await profit();
    expect(balances(after)).toEqual(balances(before));
    expect(after.realProfitUsdCents - before.realProfitUsdCents).toBe(-200);
    expect(after.stockUsdCents - before.stockUsdCents).toBe(-200);
    const sales = (await get('/api/items/sales')).body.data;
    expect(sales.items.find((i) => i.id === deagle.id).saleProfitUsdCents).toBe((await itemOf(deagle.id)).saleProfitUsdCents);
    expect(sales.summary.totalPurchaseCostUsdCents).toBe(1200);
  });
});
