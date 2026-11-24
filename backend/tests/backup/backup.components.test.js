const fs = require('fs');
const os = require('os');
const path = require('path');

// 10.1 (D343, D353): a migração v17 não perde nada e o backup (exportar/importar) leva a tabela de componentes.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-comp-'));
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

const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const exportBuffer = async () => (await request(app).get('/api/backup/export').buffer(true).parse(binary)).body;

test('exportar e importar leva os componentes; o backup automático antes de importar também', async () => {
  const csfloat = (await request(app).get('/api/stores')).body.data.find((s) => s.name === 'CSFloat').id;
  const created = await request(app).post('/api/items').send({
    catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: csfloat, purchasePriceCents: 100, acquiredAt: '2026-11-10T12:00:00.000Z',
    components: [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 2, wear: 0.3 }, { kind: 'CHARM', catalogId: CAT.CHARM_LIL_AVA, pattern: 9 }],
  });
  expect(created.status).toBe(201);
  const id = created.body.data.id;
  const file = await exportBuffer();

  const copy = path.join(dir, 'export.sqlite');
  fs.writeFileSync(copy, file);
  const db = new Database(copy, { readonly: true });
  expect(db.prepare('SELECT COUNT(*) n FROM item_components').get().n).toBe(2);
  db.close();

  await request(app).patch(`/api/items/${id}`).send({ components: [] });
  expect((await request(app).get(`/api/items/${id}`)).body.data.components).toEqual([]);
  const res = await octet(file);
  expect(res.status).toBe(200);
  const restored = (await request(app).get(`/api/items/${id}`)).body.data;
  expect(restored.components.map((c) => [c.kind, c.slot, c.wear, c.pattern])).toEqual([['STICKER', 2, 0.3, null], ['CHARM', null, null, 9]]);

  const auto = fs.readdirSync(path.join(dir, 'backups')).filter((f) => /before-import/.test(f));
  expect(auto.length).toBeGreaterThan(0);
  const autoDb = new Database(path.join(dir, 'backups', auto[auto.length - 1]), { readonly: true });
  expect(autoDb.prepare('SELECT COUNT(*) n FROM item_components').get().n).toBe(0); // o automático guarda o estado de antes (componentes já limpos): a tabela vem no arquivo
  autoDb.close();
});

test('backup v16 importado migra para a v17 com as tabelas novas vazias e os itens intactos', async () => {
  const v16 = path.join(dir, 'v16.sqlite');
  const old = database.openDatabase(v16, { migrations: MIGRATIONS.filter((m) => m.version <= 16) });
  old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_price_cents, purchase_currency, acquired_at, status, created_at, updated_at)
     VALUES ('Item antigo', 'OUTRO', 'GANHEI', 0, 'USD', '2026-11-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`
  ).run();
  const before = old.prepare('SELECT * FROM items').all();
  old.close();
  const res = await octet(fs.readFileSync(v16));
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ fileVersion: 16, schemaVersion: 21, migrationsApplied: [17, 18, 19, 20, 21] });
  const db = database.getDb();
  for (const table of ['item_components', 'item_operations', 'item_operation_links']) {
    expect(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n).toBe(0);
  }
  const after = db.prepare('SELECT * FROM items').all().map(({ components_imported_at: imported, consumed_at: consumed, ...rest }) => {
    expect(imported).toBeNull();
    return rest;
  });
  expect(after).toEqual(before);
});

test('backup v17 importado migra para a v18: componentes e itens intactos, índice de slot removido, contagens do lote em 0 (10.2, D361)', async () => {
  const v17 = path.join(dir, 'v17.sqlite');
  const old = database.openDatabase(v17, { migrations: MIGRATIONS.filter((m) => m.version <= 17) });
  const item = old.prepare(
    `INSERT INTO items (name, category, variant, acquisition_type, purchase_price_cents, purchase_currency, acquired_at, status, created_at, updated_at)
     VALUES ('M4A1-S | Mud-Spec', 'SKIN', 'NORMAL', 'GANHEI', 0, 'USD', '2026-11-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`
  ).run().lastInsertRowid;
  old.prepare("INSERT INTO item_components (item_id, kind, name, slot, wear, source, created_at, updated_at) VALUES (?, 'STICKER', 'Sticker | Flickshot', 4, 0, 'CSFLOAT', 'c', 'u')").run(item);
  const before = old.prepare('SELECT * FROM item_components').all();
  old.close();
  const res = await octet(fs.readFileSync(v17));
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ fileVersion: 17, schemaVersion: 21, migrationsApplied: [18, 19, 20, 21] });
  const db = database.getDb();
  expect(db.prepare('SELECT * FROM item_components').all()).toEqual(before);
  expect(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'idx_item_components_slot'").get().n).toBe(0);
  expect(db.prepare("SELECT COUNT(*) n FROM pragma_table_info('import_batches') WHERE name IN ('components_filled_count','components_skipped_count')").get().n).toBe(2);
  // o mesmo slot passa a valer
  expect(() => db.prepare("INSERT INTO item_components (item_id, kind, name, slot, wear, source, created_at, updated_at) VALUES (?, 'STICKER', 'x', 4, 0, 'MANUAL', 'c', 'u')").run(item)).not.toThrow();
});

test('v17: tabelas STRICT, restrições do banco e CASCADE', () => {
  const db = database.getDb();
  const strict = db.prepare("SELECT name FROM pragma_table_list WHERE strict = 1 AND name IN ('item_components','item_operations','item_operation_links')").all();
  expect(strict).toHaveLength(3);
  const itemId = db.prepare("SELECT id FROM items LIMIT 1").get().id;
  const insert = (extra) => db.prepare(
    `INSERT INTO item_components (item_id, kind, name, source, created_at, updated_at${extra.cols ?? ''}) VALUES (?, ?, 'n', 'MANUAL', 'c', 'u'${extra.marks ?? ''})`
  ).run(itemId, extra.kind ?? 'STICKER', ...(extra.values ?? []));
  expect(() => insert({ kind: 'OUTRO' })).toThrow();
  expect(() => insert({ cols: ', wear', marks: ', ?', values: [1] })).toThrow();
  expect(() => insert({ cols: ', slot', marks: ', ?', values: [6] })).toThrow();
  expect(() => insert({ cols: ", origin", marks: ", 'APPLIED_FROM_STOCK'" })).toThrow(); // sem unidade de origem nem operação
  insert({ cols: ', slot', marks: ', ?', values: [1] });
  expect(() => insert({ cols: ', slot', marks: ', ?', values: [1] })).not.toThrow(); // slot repetido vale desde a v18 (D361)
  db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
  expect(db.prepare('SELECT COUNT(*) n FROM item_components WHERE item_id = ?').get(itemId).n).toBe(0);
});
