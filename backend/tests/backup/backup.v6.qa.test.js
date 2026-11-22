const fs = require('fs');
const os = require('os');
const path = require('path');

// QA do backup com a v6 (D209): snapshot 0 x nulo preservado na ida e volta; aportes preservados; venda antiga importada de v5 aceita unsell e nova venda.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-v6qa-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(60000);
let request;
let database;
let app;

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
  database = require('../../src/config/database');
  require('../../src/services/catalogService').setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024 });
  database.getDb();
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
const insertSold = (db, name, storeId, hold) => db.prepare(
  `INSERT INTO items (name, category, acquisition_type, purchase_store_id, acquired_at, status, sale_store_id, sale_price_cents,
     sale_currency, net_received_cents, sold_at, sale_fee_type_applied, sale_fee_rate_applied, sale_fee_rounding_applied,
     sale_fixed_fee_cents_applied, sale_hold_days_applied, created_at, updated_at)
   VALUES (?, 'CAIXA', 'GANHEI', ?, '2026-01-01T00:00:00.000Z', 'VENDIDO', ?, 1000, 'USD', 980,
     '2026-11-15T12:00:00.000Z', 'DEDUCTED', 0.02, 'CEIL', 0, ?, 'c', 'u')`
).run(name, storeId, storeId, hold).lastInsertRowid;

test('ida e volta: snapshot 0 continua 0 (não vira nulo), nulo continua nulo, 30 e aportes preservados', async () => {
  const db = database.getDb();
  const csf = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  insertSold(db, 'Zero', csf, 0);
  insertSold(db, 'Nulo', csf, null);
  insertSold(db, 'Trinta', csf, 30);
  db.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, note, created_at, updated_at) VALUES (4200, '2026-11-10T12:00:00.000Z', ?, 'pix', 'c', 'u')").run(csf);
  db.prepare('UPDATE stores SET sale_hold_days = 0 WHERE id = ?').run(csf);
  const exported = await exportBuffer();

  db.prepare('DELETE FROM items').run();
  db.prepare('DELETE FROM deposits').run();
  db.prepare('UPDATE stores SET sale_hold_days = 9 WHERE id = ?').run(csf);

  const res = await octet(exported);
  expect(res.status).toBe(200);
  const after = database.getDb();
  expect(after.prepare('SELECT name, sale_hold_days_applied AS h FROM items ORDER BY name').all())
    .toEqual([{ name: 'Nulo', h: null }, { name: 'Trinta', h: 30 }, { name: 'Zero', h: 0 }]);
  expect(after.prepare("SELECT sale_hold_days AS d FROM stores WHERE name = 'CSFloat'").get().d).toBe(0);
  const deposits = (await request(app).get('/api/deposits')).body.data;
  expect(deposits.totals).toEqual({ count: 1, legacyCount: 1, amountUsdCents: null, approxBrlCents: null, estimated: true }); // v7: aporte antigo vira legado; sem cotação, sem US$
  expect(deposits.deposits[0]).toMatchObject({ note: 'pix', storeName: 'CSFloat', legacy: true, amountBrlCents: 4200, amountStoreCents: null });
});

test('venda com snapshot nulo (herdada) aceita desfazer e refazer: o novo snapshot vem da loja atual', async () => {
  const db = database.getDb();
  const nulo = db.prepare("SELECT id FROM items WHERE name = 'Nulo'").get().id;
  db.prepare("UPDATE stores SET sale_hold_days = 5 WHERE name = 'CSFloat'").run();
  await request(app).post(`/api/items/${nulo}/unsell`).set('Content-Type', 'application/json').send({}).expect(200);
  const csf = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const sold = await request(app).post(`/api/items/${nulo}/sell`).send({ saleStoreId: csf, salePriceCents: 500, soldAt: '2026-11-18T12:00:00.000Z' });
  expect(sold.status).toBe(200);
  expect(sold.body.data.item.saleHoldDaysApplied).toBe(5);
});
