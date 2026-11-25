'use strict';

// 10.9 (D368, QA, E-P2-Q63): patch antigo em OUTRO ("Patch | X") sem o catálogo PATCH não é religado; o sync do catálogo embutido
// (inicialização, importação de backup) religa por nome exato, sem mexer em custo/datas/loja, e de forma idempotente. Sem o banco real.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, createItemViaApi, storeId } = require('../helpers/apiFixtures');
const catalogService = require('../../src/services/catalogService');
const { normalizeSearchText } = require('../../src/services/catalog/csgoApiAdapter');

const NAME = 'Patch | Legado Q63';
const patchRow = (id, name) => ({
  id, source: 'PATCHES', category: 'PATCH', name, nameKey: normalizeSearchText(name), searchText: normalizeSearchText(name),
  minFloat: null, maxFloat: null, hasStattrak: false, hasSouvenir: false,
});

let app;
let dir;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-q63-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
afterAll(() => closeDb());

const snapshotWith = (rows, generatedAt) => {
  const file = path.join(dir, 'snapshot.jsonl');
  fs.writeFileSync(file, catalogService.serializeSnapshot(rows, { now: new Date(generatedAt) }));
  return file;
};
const itemOf = async (id) => (await request(app).get(`/api/items/${id}`)).body.data;

test('sem PATCH de mesmo nome não religa; o sync com o PATCH religa por nome exato e é idempotente', async () => {
  const legacy = await createItemViaApi(app, {
    category: 'OUTRO', name: NAME, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 37,
    acquiredAt: '2026-10-05T12:00:00.000Z',
  });
  const near = await createItemViaApi(app, { category: 'OUTRO', name: 'Patch | Legado Q6', acquisitionType: 'GANHEI' }); // nome parecido: nunca liga
  const before = await itemOf(legacy.id);

  // Catálogo ainda sem o PATCH (banco antigo): nada a religar.
  expect(catalogService.linkLegacyItems({ now: new Date('2026-11-20T00:00:00.000Z') })).toBe(0);
  expect(await itemOf(legacy.id)).toMatchObject({ category: 'OUTRO', catalogId: null });

  // Sync do catálogo embutido mais novo, agora com o PATCH.
  const snapshot = snapshotWith([patchRow('patch-q63', NAME)], '2030-01-01T00:00:00.000Z');
  const first = catalogService.syncBundledCatalog({ now: new Date('2026-11-25T10:00:00.000Z'), snapshotPath: snapshot });
  expect(first.error).toBeNull();
  expect(first.linkedLegacyItems).toBe(1);
  const after = await itemOf(legacy.id);
  expect(after).toMatchObject({ category: 'PATCH', catalogId: 'patch-q63', name: NAME });
  for (const field of ['purchasePriceCents', 'purchaseCurrency', 'purchaseStoreId', 'acquiredAt', 'acquisitionType', 'status']) {
    expect(after[field]).toEqual(before[field]);
  }
  expect(await itemOf(near.id)).toMatchObject({ category: 'OUTRO', catalogId: null });

  // Segunda carga (snapshot já importado): não religa de novo nem regrava o item.
  const second = catalogService.syncBundledCatalog({ now: new Date('2026-11-26T10:00:00.000Z'), snapshotPath: snapshot });
  expect(second).toMatchObject({ imported: 0, linkedLegacyItems: 0, error: null });
  expect((await itemOf(legacy.id)).updatedAt).toBe(after.updatedAt);
});

test('snapshot inválido ou ausente não impede o religamento com o catálogo já gravado', async () => {
  const legacy = await createItemViaApi(app, { category: 'OUTRO', name: 'Patch | Crazy Banana Q63', acquisitionType: 'GANHEI' });
  require('../../src/models/CatalogItem').upsertMany([patchRow('patch-cb', 'Patch | Crazy Banana Q63')]);
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const result = catalogService.syncBundledCatalog({ snapshotPath: path.join(dir, 'nao-existe.jsonl') });
  spy.mockRestore();
  expect(result.error).not.toBeNull();
  expect(result.linkedLegacyItems).toBe(1);
  expect(await itemOf(legacy.id)).toMatchObject({ category: 'PATCH', catalogId: 'patch-cb' });
});
