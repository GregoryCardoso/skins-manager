const fs = require('fs');
const os = require('os');
const path = require('path');

// 10.3 (D362), QA: backup v18 cheio de dados importado migra para a v19 com os números do app idênticos; backup ida e volta com
// operações (ativas e desfeitas), componentes aplicados e unidades consumidas.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-ops-'));
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
const json = async (url) => (await request(app).get(url)).body.data;
const storeIdOf = async (name) => (await json('/api/stores')).find((s) => s.name === name).id;

test('backup v18 (com vendidos USD/BRL, holding, componentes) importado migra para a v19 e os números do app batem com o esperado', async () => {
  const v18 = path.join(dir, 'v18.sqlite');
  const old = database.openDatabase(v18, { migrations: MIGRATIONS.filter((m) => m.version <= 18) });
  const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const steam = old.prepare("SELECT id FROM stores WHERE name = 'Steam'").get().id;
  const insert = old.prepare(
    `INSERT INTO items (name, category, variant, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, fx_rate_at_purchase,
       acquired_at, status, off_sale_at, created_at, updated_at, catalog_id)
     VALUES (@name, 'SKIN', 'NORMAL', @type, @store, @price, @currency, @fx, '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', @off, 'c', 'u', NULL)`
  );
  const base = { type: 'COMPRA', store: csf, price: 1000, currency: 'USD', fx: null, off: null };
  insert.run({ ...base, name: 'AK-47 | Redline' });
  insert.run({ ...base, name: 'M4A4 | Howl', off: '2026-10-10T00:00:00.000Z', price: 2000 });
  insert.run({ ...base, name: 'Glock-18 | Fade', store: steam, price: 5430, currency: 'BRL', fx: 5.43 });
  const sold = Number(insert.run({ ...base, name: 'AWP | Asiimov', price: 3000 }).lastInsertRowid);
  old.prepare(
    `UPDATE items SET status = 'VENDIDO', sale_store_id = ?, sale_price_cents = 4000, sale_currency = 'USD', sale_fee_type_applied = 'DEDUCTED',
       sale_fee_rate_applied = 0.02, sale_fee_rounding_applied = 'CEIL', sale_fixed_fee_cents_applied = 0, net_received_cents = 3920,
       net_received_manual = 0, sold_at = '2026-11-10T12:00:00.000Z', sale_hold_days_applied = 0, sale_release_at = '2026-11-10T12:00:00.000Z' WHERE id = ?`
  ).run(csf, sold);
  old.prepare(
    `INSERT INTO item_components (item_id, kind, catalog_id, name, slot, wear, pattern, source, created_at, updated_at)
     VALUES (1, 'STICKER', NULL, 'Sticker | Fly High', 0, 0.1, NULL, 'MANUAL', 'c', 'u')`
  ).run();
  old.prepare(
    `INSERT INTO deposits (store_id, amount_store_cents, amount_brl_cents, deposited_at, note, created_at, updated_at)
     VALUES (?, 100000, 500000, '2026-10-01T00:00:00.000Z', 'x', 'c', 'u')`
  ).run(csf);
  const rows = old.prepare('SELECT * FROM items ORDER BY id').all();
  old.close();

  const res = await octet(fs.readFileSync(v18));
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ fileVersion: 18, schemaVersion: 23, migrationsApplied: [19, 20, 21, 22, 23] });
  const db = database.getDb();
  expect(db.pragma('foreign_key_check')).toEqual([]);
  // `catalog_id`/`updated_at` mudam só pelo vínculo de legados ao catálogo, depois da migração (não pela v19)
  const strip = ({ catalog_id: c, updated_at: u, consumed_at: consumed, ...rest }) => {
    expect(consumed === undefined || consumed === null).toBe(true);
    return rest;
  };
  expect(db.prepare('SELECT * FROM items ORDER BY id').all().map(strip)).toEqual(rows.map(strip));
  // números pela API: estoque = 1000 + 2000 + 5430/5,43 (1000) = 4000; lucro da venda = 3920 - 3000
  const summary = await json('/api/profit/summary');
  expect(summary.stockUsdCents).toBe(4000);
  expect(summary.stockBreakdown.offSale.usdCents).toBe(2000);
  expect(summary.stockBreakdown.forSale.usdCents).toBe(2000);
  const sales = await json('/api/items/sales');
  expect(sales.summary.totalProfitUsdCents).toBe(920);
  expect((await json('/api/items')).items).toHaveLength(4);
  expect((await json('/api/items?status=CONSUMIDO')).items).toEqual([]);
  // depois da migração a aplicação funciona sobre o banco migrado
  const item = (await json('/api/items?status=EM_ESTOQUE')).items.find((i) => i.name === 'AK-47 | Redline');
  expect(item.components).toHaveLength(1);
  expect(item.cost).toEqual({ ownUsdCents: 1000, inheritedUsdCents: 0, effectiveUsdCents: 1000, estimated: false , hasOperationCost: false });
});

test('exportar e importar leva operações ativas e desfeitas, componentes aplicados e a unidade consumida', async () => {
  require('../helpers/catalog').importCatalogFixture(); // o import do v18 trocou o banco (e o catálogo)
  const csfloat = await storeIdOf('CSFloat');
  const make = async (body) => {
    const created = await request(app).post('/api/items').send({
      acquisitionType: 'COMPRA', purchaseStoreId: csfloat, acquiredAt: '2026-11-10T12:00:00.000Z', ...body,
    });
    if (created.status !== 201) throw new Error(JSON.stringify(created.body));
    return created.body.data;
  };
  const ak = await make({ catalogId: CAT.AK_REDLINE, purchasePriceCents: 100 });
  const stickerA = await make({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 50 });
  const stickerB = await make({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 70 });
  const apply = (target, source) => request(app).post(`/api/items/${target}/apply-component`).send({ sourceItemId: source, appliedAt: '2026-11-15T12:00:00.000Z' });
  const firstApply = await apply(ak.id, stickerA.id);
  if (firstApply.status !== 201) throw new Error(JSON.stringify(firstApply.body));
  const opA = firstApply.body.data.operation.id;
  const opB = (await apply(ak.id, stickerB.id)).body.data.operation.id;
  expect((await request(app).post(`/api/operations/${opB}/undo`).send({})).status).toBe(200); // B desfeita; A ativa
  const profitBefore = await json('/api/profit/summary');
  const itemBefore = await json(`/api/items/${ak.id}`);
  const opsBefore = await json(`/api/items/${ak.id}/operations`);
  const file = await exportBuffer();

  // estraga o estado: desfaz A e apaga tudo que dá
  expect((await request(app).post(`/api/operations/${opA}/undo`).send({})).status).toBe(200);
  expect((await json(`/api/items/${stickerA.id}`)).status).toBe('EM_ESTOQUE');

  const res = await octet(file);
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ schemaVersion: 23 });
  const restored = await json(`/api/items/${ak.id}`);
  expect(restored.components).toEqual(itemBefore.components);
  expect(restored.cost).toEqual(itemBefore.cost);
  expect(await json(`/api/items/${ak.id}/operations`)).toEqual(opsBefore);
  expect(await json(`/api/items/${stickerA.id}`)).toMatchObject({ status: 'CONSUMIDO', consumedAt: '2026-11-15T12:00:00.000Z' });
  expect(await json(`/api/items/${stickerB.id}`)).toMatchObject({ status: 'EM_ESTOQUE', consumedAt: null });
  const profitAfter = await json('/api/profit/summary');
  expect(profitAfter.stockUsdCents).toBe(profitBefore.stockUsdCents);
  expect(profitAfter.realProfitUsdCents).toBe(profitBefore.realProfitUsdCents);
  // a operação restaurada continua sendo a mais recente ativa e pode ser desfeita; a desfeita continua desfeita
  expect((await request(app).post(`/api/operations/${opB}/undo`).send({})).status).toBe(409);
  expect((await request(app).post(`/api/operations/${opA}/undo`).send({})).status).toBe(200);

  // o arquivo exportado tem as colunas novas
  const copy = path.join(dir, 'export-ops.sqlite');
  fs.writeFileSync(copy, file);
  const exported = new Database(copy, { readonly: true });
  expect(exported.pragma('user_version', { simple: true })).toBe(23);
  expect(exported.prepare("SELECT COUNT(*) n FROM items WHERE status = 'CONSUMIDO' AND consumed_at IS NOT NULL").get().n).toBe(1);
  expect(exported.prepare('SELECT COUNT(*) n FROM item_operations').get().n).toBe(2);
  expect(exported.prepare('SELECT COUNT(*) n FROM item_operations WHERE undone_at IS NOT NULL').get().n).toBe(1);
  exported.close();
});
