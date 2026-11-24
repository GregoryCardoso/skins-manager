const fs = require('fs');
const os = require('os');
const path = require('path');

// 10.1 (D343, D353): a migração v17 não perde nada e o backup (exportar/importar) leva a tabela de componentes.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-comp-qa-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(60000);
let request;
let database;
let app;
let Database;
let CAT;
let MIGRATIONS;

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
  Database = require('better-sqlite3');
  database = require('../../src/config/database');
  ({ CAT } = require('../helpers/catalog'));
  ({ MIGRATIONS } = require('../../src/config/migrations'));
  const catalogService = require('../../src/services/catalogService');
  catalogService.setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  database.getDb();
  require('../helpers/catalog').importCatalogFixture();
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => new Date('2026-11-19T15:00:00.000Z') });
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => require('../helpers/catalog').importCatalogFixture()); // a importação de outro backup troca o catálogo também

const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const exportBuffer = async () => (await request(app).get('/api/backup/export').buffer(true).parse(binary)).body;

test('ida e volta com vários itens (em estoque, fora de venda, vendido): ids, ordem e conteúdo dos componentes idênticos', async () => {
  const csfloat = (await request(app).get('/api/stores')).body.data.find((s) => s.name === 'CSFloat').id;
  const make = async (components) => (await request(app).post('/api/items').send({
    catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: csfloat, purchasePriceCents: 100, acquiredAt: '2026-11-10T12:00:00.000Z', components,
  })).body.data;
  const a = await make([{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 0, wear: 0.05 }, { kind: 'STICKER_SLAB', catalogId: CAT.STICKER_CROWN, pattern: 1 }]);
  const b = await make([{ kind: 'CHARM', catalogId: CAT.CHARM_LIL_AVA, pattern: 999999 }]);
  const c = await make([{ kind: 'STICKER', catalogId: CAT.STICKER_CROWN, slot: 4 }]);
  await make([]);
  await request(app).post(`/api/items/${b.id}/off-sale`).send({});
  await request(app).post(`/api/items/${c.id}/sell`).send({ saleStoreId: csfloat, salePriceCents: 300, soldAt: '2026-11-18T12:00:00.000Z' });
  const snapshot = async () => (await request(app).get('/api/items')).body.data.items.map((i) => [i.id, i.components, i.componentSummary]);
  const before = await snapshot();
  const file = await exportBuffer();
  for (const item of [a, b, c]) await request(app).patch(`/api/items/${item.id}`).send({ components: [] });
  expect((await snapshot()).every(([, comps]) => comps.length === 0)).toBe(true);
  expect((await octet(file)).status).toBe(200);
  expect(await snapshot()).toEqual(before);
  const db = database.getDb();
  expect(db.prepare('SELECT COUNT(*) n FROM item_components').get().n).toBe(4);
  expect(db.pragma('foreign_key_check')).toEqual([]);
});

test('importar um backup v16 depois de ter componentes: a tabela fica vazia (o backup é a verdade) e o app segue aceitando componentes', async () => {
  const csfloat = (await request(app).get('/api/stores')).body.data.find((s) => s.name === 'CSFloat').id;
  await request(app).post('/api/items').send({
    catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: csfloat, purchasePriceCents: 100, acquiredAt: '2026-11-10T12:00:00.000Z',
    components: [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 0 }],
  });
  const v16 = path.join(dir, 'v16b.sqlite');
  const old = database.openDatabase(v16, { migrations: MIGRATIONS.filter((m) => m.version <= 16) });
  old.close();
  const res = await octet(fs.readFileSync(v16));
  expect(res.status).toBe(200);
  expect(database.getDb().prepare('SELECT COUNT(*) n FROM item_components').get().n).toBe(0);
  require('../helpers/catalog').importCatalogFixture(); // o backup v16 vazio trouxe um catálogo vazio
  const created = await request(app).post('/api/items').send({
    catalogId: CAT.AK_REDLINE, acquisitionType: 'GANHEI', components: [{ kind: 'CHARM', catalogId: CAT.CHARM_LIL_AVA }],
  });
  expect(created.status).toBe(201);
  expect(created.body.data.components).toHaveLength(1);
});

test('arquivo que não é um banco (ou com a tabela de componentes quebrada) é recusado e os dados atuais ficam', async () => {
  const csfloat = (await request(app).get('/api/stores')).body.data.find((s) => s.name === 'CSFloat').id;
  const item = (await request(app).post('/api/items').send({
    catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: csfloat, purchasePriceCents: 100, acquiredAt: '2026-11-10T12:00:00.000Z',
    components: [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 0 }],
  })).body.data;
  const res = await octet(Buffer.from('isto não é um banco sqlite'));
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.body.success).toBe(false);
  expect((await request(app).get(`/api/items/${item.id}`)).body.data.components).toHaveLength(1);
});
