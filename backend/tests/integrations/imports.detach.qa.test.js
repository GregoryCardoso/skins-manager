'use strict';

// 10.7 (D366), QA: arma importada do CSFloat com chaveiro que veio junto. Separar não é refeito pela "Varredura completa" (componentsImportedAt),
// o lote que criou a arma fica bloqueado (ITEM_IN_OPERATION) enquanto a separação estiver ativa e, depois de desfazê-la, o lote desfaz e apaga tudo.
// API com fetchFn falso roteado, banco em memória, nenhuma chamada real.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, seedComponentCatalog } = require('../helpers/catalog');
const { expectError } = require('../helpers/apiFixtures');
const { KEY, meBody, fakeTrade, fakeTransaction, purchaseTx, routedFetch, GLOCK_ST_CHARM } = require('../helpers/csfloatFixtures');

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
  seedComponentCatalog();
  state = { me: meBody(), trades: [], transactions: [] };
  app = createApp({ now: () => new Date(NOW.getTime()), fetchFn: routedFetch(state), sleepFn: async () => {} });
  await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY });
});
afterAll(() => closeDb());

async function importWithCharm() {
  state.trades = [fakeTrade({ id: '7401', item: GLOCK_ST_CHARM.item, reference: GLOCK_ST_CHARM.reference, createdAt: '2026-11-20T14:00:00.000Z' })];
  state.transactions = [purchaseTx('97401', 1250)];
  const batch = (await post('/api/imports/csfloat/run', { cutoffAt: '2026-11-01T00:00:00.000Z' })).body.data.batch;
  const item = (await get('/api/items')).body.data.items.find((i) => i.externalSource);
  return { batch, item };
}

test('separar o chaveiro da arma importada: a varredura completa não recoloca e o lote fica bloqueado até desfazer a separação', async () => {
  const { batch, item } = await importWithCharm();
  const charm = item.components.find((c) => c.kind === 'CHARM');
  expect(charm).toMatchObject({ source: 'CSFLOAT', origin: 'CAME_WITH', detachable: true });

  // compra "legada" (sem a marca de já preenchida): sem a marca da separação, a varredura recolocaria o chaveiro
  getDb().prepare('UPDATE items SET components_imported_at = NULL WHERE id = ?').run(item.id);
  const res = await post(`/api/items/${item.id}/components/${charm.id}/detach`, { hangingShareBp: 2000, detachedAt: '2026-11-21T12:00:00.000Z' });
  expect(res.status).toBe(201);
  const generated = res.body.data.detachedItem;
  expect(res.body.data.item.components.find((c) => c.kind === 'CHARM')).toBeUndefined();
  expect(res.body.data.item.cost.effectiveUsdCents + generated.cost.effectiveUsdCents).toBe(item.cost.effectiveUsdCents);

  // "Varredura completa" (e uma nova rodada) não devolve o chaveiro separado
  const scan = await post('/api/imports/csfloat/run', { fullScan: true });
  expect(scan.status).toBe(200);
  expect(scan.body.data.batch.counts.componentsFilled).toBe(0);
  expect((await get(`/api/items/${item.id}`)).body.data.components.find((c) => c.kind === 'CHARM')).toBeUndefined();

  // lote bloqueado
  const preview = (await get(`/api/imports/batches/${batch.id}/undo-preview`)).body.data;
  expect(preview.undoable).toBe(false);
  expect(preview.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ITEM_IN_OPERATION', itemId: item.id })]));
  expectError(await post(`/api/imports/batches/${batch.id}/undo`, { confirmWarnings: true }), 409, 'IMPORT_UNDO_CONFLICT');
  expect((await get(`/api/items/${item.id}`)).body.data.status).toBe('EM_ESTOQUE');
  expect((await get(`/api/items/${generated.id}`)).status).toBe(200);

  // desfeita a separação o lote desfaz e apaga a arma e as operações (a gerada já saiu no desfazer)
  expect((await post(`/api/operations/${res.body.data.operation.id}/undo`)).status).toBe(200);
  const after = (await get(`/api/imports/batches/${batch.id}/undo-preview`)).body.data;
  expect(after.blockers).toEqual([]);
  expect(after.undoable).toBe(true);
  expect((await post(`/api/imports/batches/${batch.id}/undo`, { confirmWarnings: true })).status).toBe(200);
  expect((await get(`/api/items/${item.id}`)).status).toBe(404);
  expect(getDb().prepare('SELECT COUNT(*) AS n FROM item_operations').get().n).toBe(0);
  expect(getDb().prepare('SELECT COUNT(*) AS n FROM item_operation_links').get().n).toBe(0);
  expect(getDb().prepare("SELECT COUNT(*) AS n FROM items WHERE acquisition_type = 'GERADO'").get().n).toBe(0);
  expect(getDb().pragma('foreign_key_check')).toEqual([]);
});

test('a separada vendida no CSFloat é uma venda comum (casa só com unidades em estoque); a arma importada continua separável sem a gerada', async () => {
  const { item } = await importWithCharm();
  const charm = item.components.find((c) => c.kind === 'CHARM');
  const res = await post(`/api/items/${item.id}/components/${charm.id}/detach`, { hangingShareBp: 1000, detachedAt: '2026-11-21T12:00:00.000Z' });
  const generated = res.body.data.detachedItem;
  expect(generated.externalSource ?? null).toBeNull();
  // vender a separada manualmente e desfazer a separação: bloqueado (TARGET_SOLD)
  const sold = await post(`/api/items/${generated.id}/sell`, { saleStoreId: item.purchaseStoreId, salePriceCents: 300, soldAt: '2026-11-21T18:00:00.000Z' });
  expect(sold.status).toBe(200);
  expectError(await post(`/api/operations/${res.body.data.operation.id}/undo`), 409, 'OPERATION_UNDO_BLOCKED');
});
