'use strict';

// 10.3 (D362 item 7), QA: desfazer o lote de importação cuja compra criada participa de uma operação ativa é bloqueado
// (ITEM_IN_OPERATION); depois de desfazer a operação o lote pode ser desfeito e as operações desfeitas são apagadas junto.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, CAT } = require('../helpers/catalog');
const { storeId, expectError } = require('../helpers/apiFixtures');
const { KEY, meBody, fakeTrade, routedFetch } = require('../helpers/csfloatFixtures');

jest.setTimeout(60000);
const JSON_TYPE = 'application/json';
const NOW = new Date('2026-11-22T15:00:00.000Z');
let app;
let state;

const post = (url, body = {}) => request(app).post(url).set('Content-Type', JSON_TYPE).send(body);
const get = (url) => request(app).get(url);

beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  state = { me: meBody(), trades: [], transactions: [] };
  app = createApp({ now: () => new Date(NOW.getTime()), fetchFn: routedFetch(state), sleepFn: async () => {} });
  await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY });
});
afterAll(() => closeDb());

async function importAk() {
  state.trades = [fakeTrade({ id: '7301' })];
  const batch = (await post('/api/imports/csfloat/run', { cutoffAt: '2026-11-01T00:00:00.000Z' })).body.data.batch;
  const items = (await get('/api/items')).body.data.items;
  const ak = items.find((i) => i.externalSource);
  return { batch, ak };
}

test('alvo criado pelo lote com operação ativa: bloqueio ITEM_IN_OPERATION; desfeita a operação, o lote desfaz e apaga tudo', async () => {
  const { batch, ak } = await importAk();
  expect(ak).toBeTruthy();
  const sticker = (await post('/api/items', {
    catalogId: CAT.STICKER_TITAN, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 50, acquiredAt: '2026-11-10T12:00:00.000Z',
  })).body.data;
  const applied = await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: sticker.id, appliedAt: '2026-11-21T12:00:00.000Z' });
  expect(applied.status).toBe(201);
  const preview = (await get(`/api/imports/batches/${batch.id}/undo-preview`)).body.data;
  expect(preview.undoable).toBe(false);
  expect(preview.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ITEM_IN_OPERATION', itemId: ak.id })]));
  expectError(await post(`/api/imports/batches/${batch.id}/undo`, { confirmWarnings: true }), 409, 'IMPORT_UNDO_CONFLICT');
  expect((await get(`/api/items/${ak.id}`)).body.data.status).toBe('EM_ESTOQUE');

  expect((await post(`/api/operations/${applied.body.data.operation.id}/undo`)).status).toBe(200);
  const after = (await get(`/api/imports/batches/${batch.id}/undo-preview`)).body.data;
  expect(after.blockers).toEqual([]);
  expect(after.undoable).toBe(true);
  const undone = await post(`/api/imports/batches/${batch.id}/undo`, { confirmWarnings: true });
  expect(undone.status).toBe(200);
  expect((await get(`/api/items/${ak.id}`)).status).toBe(404);
  expect(getDb().prepare('SELECT COUNT(*) AS n FROM item_operations').get().n).toBe(0);
  expect(getDb().prepare('SELECT COUNT(*) AS n FROM item_operation_links').get().n).toBe(0);
  expect((await get(`/api/items/${sticker.id}`)).body.data.status).toBe('EM_ESTOQUE');
});
