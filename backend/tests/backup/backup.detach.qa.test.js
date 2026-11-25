const fs = require('fs');
const os = require('os');
const path = require('path');

// 10.7 (D366), QA: backup ida e volta com separações (SPLIT e RETURN), aplicação encerrada, separação desfeita e a coluna nova
// `ended_by_operation_id`; backup da v21 importado migra para a v22 e a separação funciona nele. Só bancos temporários.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-detach-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(60000);
let request;
let database;
let app;
let CAT;
let MIGRATIONS;

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
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
const json = async (url) => (await request(app).get(url)).body.data;
const storeIdOf = async (name) => (await json('/api/stores')).find((s) => s.name === name).id;
const post = (url, body = {}) => request(app).post(url).send(body);

test('exportar e importar leva a separação SPLIT, a RETURN com aplicação encerrada, a desfeita e continua desfazível', async () => {
  const csfloat = await storeIdOf('CSFloat');
  const make = async (body) => {
    const created = await post('/api/items', { acquisitionType: 'COMPRA', purchaseStoreId: csfloat, acquiredAt: '2026-11-10T12:00:00.000Z', ...body });
    if (created.status !== 201) throw new Error(JSON.stringify(created.body));
    return created.body.data;
  };
  await post('/api/deposits', { storeId: csfloat, amountStoreCents: 100000, depositedAt: '2026-11-01T12:00:00.000Z' });
  const charm = (pattern) => ({ kind: 'CHARM', catalogId: CAT.CHARM_LIL_AVA, pattern });
  const splitWeapon = await make({ catalogId: CAT.AK_REDLINE, exterior: 'FT', purchasePriceCents: 1001, components: [charm(1)] });
  const returnWeapon = await make({ catalogId: CAT.AK_REDLINE, exterior: 'FT', purchasePriceCents: 2000 });
  const unit = await make({ catalogId: CAT.CHARM_LIL_AVA, purchasePriceCents: 301 });
  const undoneWeapon = await make({ catalogId: CAT.AK_REDLINE, exterior: 'FT', purchasePriceCents: 500, components: [charm(3)] });
  const slabWeapon = await make({ catalogId: CAT.AK_REDLINE, exterior: 'FT', purchasePriceCents: 400, components: [{ kind: 'STICKER_SLAB', catalogId: CAT.STICKER_TITAN, pattern: 9 }] });

  const hanging = (view) => view.components.find((c) => c.kind === 'CHARM' || c.kind === 'STICKER_SLAB');
  const detach = async (item, body) => {
    const res = await post(`/api/items/${item.id}/components/${hanging(item).id}/detach`, { detachedAt: '2026-11-17T12:00:00.000Z', ...body });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body.data;
  };
  const split = await detach(splitWeapon, { hangingShareBp: 3333, tradeUnlockAt: '2026-11-25T12:00:00.000Z', note: 'primeira' });
  const slab = await detach(slabWeapon, { hangingShareBp: 2500 });
  const applied = await post(`/api/items/${returnWeapon.id}/apply-component`, { sourceItemId: unit.id, appliedAt: '2026-11-15T12:00:00.000Z', pattern: 5 });
  expect(applied.status).toBe(201);
  const returned = await detach(applied.body.data.item, {});
  const toUndo = await detach(undoneWeapon, { hangingShareBp: 1000 });
  expect((await post(`/api/operations/${toUndo.operation.id}/undo`)).status).toBe(200);

  const snapshot = async () => ({
    profit: await json('/api/profit/summary'),
    items: (await json('/api/items?status=EM_ESTOQUE')).items.map((i) => ({ ...i, components: i.components.map(({ id, ...c }) => c) })), // eslint-disable-line no-unused-vars
    groups: await json('/api/items/groups'),
    split: await json(`/api/items/${split.detachedItem.id}`),
    slab: await json(`/api/items/${slab.detachedItem.id}`),
    returned: await json(`/api/items/${unit.id}`),
    opsWeapon: await json(`/api/items/${splitWeapon.id}/operations`),
    opsUnit: await json(`/api/items/${unit.id}/operations`),
    opsUndone: await json(`/api/items/${undoneWeapon.id}/operations`),
    ended: database.getDb().prepare('SELECT id, ended_by_operation_id AS endedBy, undone_at AS undoneAt FROM item_operations ORDER BY id').all(),
    market: await json('/api/market-values/summary'),
  });
  const before = await snapshot();
  expect(before.ended.filter((o) => o.endedBy !== null)).toEqual([{ id: applied.body.data.operation.id, endedBy: returned.operation.id, undoneAt: null }]);
  expect(before.returned).toMatchObject({ status: 'EM_ESTOQUE', detachedFrom: { mode: 'RETURN' } });
  const file = await exportBuffer();

  // estraga o estado: desfaz a separação SPLIT e a RETURN
  expect((await post(`/api/operations/${split.operation.id}/undo`)).status).toBe(200);
  expect((await post(`/api/operations/${returned.operation.id}/undo`)).status).toBe(200);
  expect((await snapshot()).profit.stockUsdCents).toBe(before.profit.stockUsdCents);

  const res = await octet(file);
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ schemaVersion: 24 });
  expect(database.getDb().pragma('foreign_key_check')).toEqual([]);
  const after = await snapshot();
  expect(after).toEqual(before);
  expect(after.opsUnit.find((o) => o.kind === 'APPLY_COMPONENT')).toMatchObject({ undoable: false, undoBlockedReason: 'DETACHED' });

  // restaurados, continuam funcionando: a RETURN desfaz e a aplicação volta a ser desfazível; a SPLIT desfaz e some a gerada
  expect((await post(`/api/operations/${returned.operation.id}/undo`)).status).toBe(200);
  expect(database.getDb().prepare('SELECT ended_by_operation_id AS e FROM item_operations WHERE id = ?').get(applied.body.data.operation.id).e).toBeNull();
  expect((await post(`/api/operations/${split.operation.id}/undo`)).status).toBe(200);
  expect((await request(app).get(`/api/items/${split.detachedItem.id}`)).status).toBe(404);
  expect((await json(`/api/items/${splitWeapon.id}`)).cost.effectiveUsdCents).toBe(1001);
});

test('backup v21 importado migra para a v22 (coluna nula, dados intactos) e a RETURN funciona sobre a aplicação importada', async () => {
  const v21 = path.join(dir, 'v21.sqlite');
  const old = database.openDatabase(v21, { migrations: MIGRATIONS.filter((m) => m.version <= 21) });
  const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const insert = old.prepare(
    `INSERT INTO items (name, category, variant, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, acquired_at, status, created_at, updated_at)
     VALUES (?, ?, ?, 'COMPRA', ?, ?, 'USD', '2026-11-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`
  );
  const ak = Number(insert.run('AK-47 | Redline', 'SKIN', 'NORMAL', csf, 1000).lastInsertRowid);
  const charm = Number(insert.run("Charm | Lil' Ava", 'PINGENTE', null, csf, 300).lastInsertRowid);
  const operation = Number(old.prepare(
    "INSERT INTO item_operations (kind, outcome, occurred_at, created_at) VALUES ('APPLY_COMPONENT', 'TRANSFERRED', '2026-11-05T00:00:00.000Z', 'c')"
  ).run().lastInsertRowid);
  old.prepare("INSERT INTO item_operation_links (operation_id, item_id, role) VALUES (?, ?, 'CONSUMED')").run(operation, charm);
  old.prepare("INSERT INTO item_operation_links (operation_id, item_id, role) VALUES (?, ?, 'TARGET')").run(operation, ak);
  old.prepare("UPDATE items SET status = 'CONSUMIDO', consumed_at = '2026-11-05T00:00:00.000Z' WHERE id = ?").run(charm);
  old.prepare(
    `INSERT INTO item_components (item_id, kind, catalog_id, name, slot, source, origin, source_item_id, operation_id, created_at, updated_at)
     VALUES (?, 'CHARM', NULL, ?, 0, 'MANUAL', 'APPLIED_FROM_STOCK', ?, ?, 'c', 'u')`
  ).run(ak, "Charm | Lil' Ava", charm, operation);
  const rows = {
    items: old.prepare('SELECT * FROM items ORDER BY id').all(),
    links: old.prepare('SELECT * FROM item_operation_links ORDER BY id').all(),
  };
  old.close();

  const res = await octet(fs.readFileSync(v21));
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ fileVersion: 21, schemaVersion: 24, migrationsApplied: [22, 23, 24] });
  const db = database.getDb();
  expect(db.pragma('foreign_key_check')).toEqual([]);
  expect(db.prepare('SELECT ended_by_operation_id AS e FROM item_operations').all()).toEqual([{ e: null }]);
  const strip = ({ updated_at: u, catalog_id: c, ...rest }) => rest; // eslint-disable-line no-unused-vars
  expect(db.prepare('SELECT * FROM items ORDER BY id').all().map(strip)).toEqual(rows.items.map(strip));
  expect(db.prepare('SELECT * FROM item_operation_links ORDER BY id').all()).toEqual(rows.links);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_item_operations_ended_by'").all()).toHaveLength(1);

  // a separação (RETURN) funciona sobre a aplicação importada e a unidade volta com o custo dela
  const view = await json(`/api/items/${ak}`);
  expect(view.cost.effectiveUsdCents).toBe(1300);
  const component = view.components.find((c) => c.kind === 'CHARM');
  expect(component).toMatchObject({ origin: 'APPLIED_FROM_STOCK', detachable: true });
  const back = await post(`/api/items/${ak}/components/${component.id}/detach`, { detachedAt: '2026-11-10T12:00:00.000Z' });
  expect(back.status).toBe(201);
  expect(back.body.data.item.cost.effectiveUsdCents).toBe(1000);
  expect(back.body.data.detachedItem).toMatchObject({ id: charm, status: 'EM_ESTOQUE' });
  expect(db.prepare('SELECT ended_by_operation_id AS e FROM item_operations WHERE id = ?').get(operation).e).toBe(back.body.data.operation.id);
});
