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

describe('aviso na venda importada', () => {
  test('com o BIG no estoque: o aviso aponta a unidade e a entrada oferece APPLY_FROM_STOCK; a venda segue normal', async () => {
    const { deagle, sticker, batch, entry } = await importSale();
    expect(batch.counts).toMatchObject({ salesCreated: 1, failed: 0 });
    expect(entry).toMatchObject({ outcome: 'CREATED', entityId: deagle.id, allowedActions: ['APPLY_FROM_STOCK'] });
    expect(entry.display.componentWarnings).toEqual([
      { code: 'COMPONENT_MAYBE_APPLIED_FROM_STOCK', name: 'Sticker | BIG (Holo) | 2020 RMR', candidateItemId: sticker.id },
    ]);
    expect(await itemOf(deagle.id)).toMatchObject({ status: 'VENDIDO', components: [] });
    expect(await itemOf(sticker.id)).toMatchObject({ status: 'EM_ESTOQUE' }); // nunca automático
  });

  test('sem unidade igual no estoque: nenhum aviso e nenhuma ação', async () => {
    const { entry } = await importSale({ withSticker: false });
    expect(entry.display.componentWarnings).toEqual([]);
    expect(entry.allowedActions).toEqual([]);
  });

  test('unidade adquirida depois da venda não é candidata', async () => {
    const deagle = await createItem(purchase(CAT_EXTRA.DEAGLE_TRIGGER, 1000, { acquiredAt: '2026-10-01T12:00:00.000Z' }));
    await createItem(purchase(CAT_EXTRA.BIG, 200, { acquiredAt: '2026-11-21T12:00:00.000Z' }));
    state.trades = [sale('5001', DEAGLE_4_STICKERS)];
    state.transactions = [credit('5001')];
    const batch = (await post('/api/imports/csfloat/run', { cutoffAt: CUTOFF })).body.data.batch;
    const entry = batch.entries.find((e) => e.entityId === deagle.id);
    expect(entry.allowedActions).toEqual([]);
  });
});

describe('"Aplicar e registrar" (E-P2-Q47)', () => {
  const resolve = (entryId, body) => post(`/api/imports/entries/${entryId}/resolve`, body);

  test('aplica na arma vendida: o lucro da venda e o lucro real caem o custo da unidade; a venda e a entrada não mudam', async () => {
    const { deagle, sticker, entry } = await importSale();
    const before = await profit();
    const soldBefore = await itemOf(deagle.id);
    const res = await resolve(entry.id, { action: 'APPLY_FROM_STOCK', sourceItemId: sticker.id, appliedAt: '2026-11-15T12:00:00.000Z', slot: 0 });
    expect(res.status).toBe(200);
    const target = await itemOf(deagle.id);
    expect(target).toMatchObject({ status: 'VENDIDO', soldAt: soldBefore.soldAt, netReceivedCents: soldBefore.netReceivedCents, purchasePriceCents: 1000 });
    expect(target.cost).toMatchObject({ ownUsdCents: 1000, inheritedUsdCents: 200, effectiveUsdCents: 1200 });
    expect(target.saleProfitUsdCents).toBe(soldBefore.saleProfitUsdCents - 200);
    expect(target.components[0]).toMatchObject({ kind: 'STICKER', origin: 'APPLIED_FROM_STOCK', sourceItemId: sticker.id, slot: 0, undoable: false });
    expect(await itemOf(sticker.id)).toMatchObject({ status: 'CONSUMIDO', consumedAt: '2026-11-15T12:00:00.000Z' });
    const after = await profit();
    expect(after.realProfitUsdCents).toBe(before.realProfitUsdCents - 200); // correção do registro: cai exatamente o custo
    expect(after.stockUsdCents).toBe(before.stockUsdCents - 200);
    expect(after.platformBalanceUsdCents + after.pendingBalanceUsdCents).toBe(before.platformBalanceUsdCents + before.pendingBalanceUsdCents);
    // a entrada perde o aviso tratado, continua não resolvida e a venda continua ligada
    const refreshed = (await get(`/api/imports/batches/${entry.batchId}`)).body.data.entries.find((e) => e.id === entry.id);
    expect(refreshed).toMatchObject({ resolution: null, allowedActions: [] });
    expect(refreshed.display.componentWarnings).toEqual([]);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM external_links WHERE entity_type = 'ITEM_SALE'").get().n).toBe(1);
    // desfazer fica bloqueado enquanto a arma estiver vendida; o botão comum continua recusando
    const ops = (await get(`/api/items/${deagle.id}/operations`)).body.data;
    expectError(await post(`/api/operations/${ops[0].id}/undo`), 409, 'OPERATION_UNDO_BLOCKED', { params: { reason: 'TARGET_SOLD', itemId: deagle.id } });
    const other = await createItem(purchase(CAT_EXTRA.BIG, 50));
    expectError(await post(`/api/items/${deagle.id}/apply-component`, { sourceItemId: other.id }), 409, 'ITEM_NOT_IN_STOCK');
  });

  test('data igual à da venda vale; depois da venda é AFTER_SALE; antes da aquisição das unidades é recusada', async () => {
    const { deagle, sticker, entry } = await importSale();
    expectError(await resolve(entry.id, { action: 'APPLY_FROM_STOCK', sourceItemId: sticker.id, appliedAt: '2026-11-20T10:00:01.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'AFTER_SALE', soldAt: SOLD_AT } });
    expectError(await resolve(entry.id, { action: 'APPLY_FROM_STOCK', sourceItemId: sticker.id, appliedAt: '2026-10-01T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'BEFORE_SOURCE_ACQUIRED', acquiredAt: '2026-10-02T12:00:00.000Z' } });
    expect((await itemOf(sticker.id)).status).toBe('EM_ESTOQUE'); // nada gravado nos erros
    expect((await resolve(entry.id, { action: 'APPLY_FROM_STOCK', sourceItemId: sticker.id, appliedAt: SOLD_AT })).status).toBe(200);
    expect((await itemOf(deagle.id)).components).toHaveLength(1);
  });

  test('só a unidade do aviso vale; sem data ou com campos de outra ação é recusado; ação não oferecida também', async () => {
    const { sticker, entry } = await importSale();
    const stranger = await createItem(purchase(CAT_EXTRA.BIG, 99));
    expectError(await resolve(entry.id, { action: 'APPLY_FROM_STOCK', sourceItemId: stranger.id, appliedAt: SOLD_AT }), 400, 'IMPORT_ENTRY_ACTION_NOT_ALLOWED', { field: 'sourceItemId' });
    expectError(await resolve(entry.id, { action: 'APPLY_FROM_STOCK', sourceItemId: sticker.id }), 400, 'REQUIRED_FIELD', { field: 'appliedAt' });
    expectError(await resolve(entry.id, { action: 'APPLY_FROM_STOCK', appliedAt: SOLD_AT }), 400, 'REQUIRED_FIELD', { field: 'sourceItemId' });
    expectError(await resolve(entry.id, { action: 'IGNORE', sourceItemId: sticker.id }), 400, 'INVALID_FIELD', { field: 'sourceItemId' });
    expectError(await resolve(entry.id, { action: 'KEEP' }), 400, 'IMPORT_ENTRY_ACTION_NOT_ALLOWED');
    expectError(await post('/api/imports/entries/bulk-resolve', { action: 'APPLY_FROM_STOCK', entryIds: [entry.id] }), 400, 'INVALID_FIELD');
    expectError(await resolve(99999, { action: 'APPLY_FROM_STOCK', sourceItemId: sticker.id, appliedAt: SOLD_AT }), 404, 'IMPORT_ENTRY_NOT_FOUND');
  });

  test('depois de desfazer a venda a aplicação pode ser desfeita; a venda importada volta ao estoque com o sticker aplicado', async () => {
    const { deagle, sticker, entry } = await importSale();
    await resolve(entry.id, { action: 'APPLY_FROM_STOCK', sourceItemId: sticker.id, appliedAt: SOLD_AT });
    expect((await post(`/api/items/${deagle.id}/unsell`)).status).toBe(200);
    const [op] = (await get(`/api/items/${deagle.id}/operations`)).body.data;
    expect(op.undoable).toBe(true);
    expect((await post(`/api/operations/${op.id}/undo`)).status).toBe(200);
    expect(await itemOf(sticker.id)).toMatchObject({ status: 'EM_ESTOQUE' });
  });
});
