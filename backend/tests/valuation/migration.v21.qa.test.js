'use strict';

// 10.5 (D364, Adendo 1): complementos de QA da v21 e do backup: todas as tabelas intactas na migração, estado da rodada no backup
// (ida e volta), backup restaurado durante a busca e colunas fora da API de configurações. Só bancos temporários; nenhuma rede.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v21qa-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(60000);
let request;
let database;
let app;
let MIGRATIONS;
let valuationLock;
const NOW = new Date('2026-11-24T12:00:00.000Z');
const JSON_TYPE = 'application/json';

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
  database = require('../../src/config/database');
  ({ MIGRATIONS } = require('../../src/config/migrations'));
  valuationLock = require('../../src/services/valuation/valuationLock');
  require('../../src/services/catalogService').setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  database.getDb();
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => NOW });
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const exportBuffer = async () => (await request(app).get('/api/backup/export').buffer(true).parse(binary)).body;
const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
const dumpAll = (db, skip = []) => Object.fromEntries(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .filter((t) => !skip.includes(t.name))
    .map((t) => [t.name, db.prepare(`SELECT * FROM "${t.name}" ORDER BY 1`).all().map(({ amount_brl_currency: _abc, ...r }) => r)])
);

describe('v21 sobre um banco v20 mais completo', () => {
  test('todas as tabelas (menos settings e a nova) idênticas depois de migrar; a linha de settings só ganha as 4 colunas nulas', () => {
    const file = path.join(dir, 'm2', 'inventory.sqlite');
    const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 20) });
    const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    const insertItem = old.prepare(
      `INSERT INTO items (name, category, variant, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, acquired_at, status, created_at, updated_at)
       VALUES (?, 'OUTRO', NULL, 'COMPRA', ?, ?, 'USD', '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`
    );
    insertItem.run('Caixa A', csf, 300);
    insertItem.run('Caixa B', csf, 450);
    old.prepare("INSERT INTO deposits (store_id, amount_store_cents, deposited_at, created_at, updated_at) VALUES (?, 5000, '2026-10-01T00:00:00.000Z', 'c', 'u')").run(csf);
    const before = dumpAll(old);
    old.close();

    const db = database.openDatabase(file, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(27);
      const after = dumpAll(db, ['market_prices', 'fx_rates', 'catalog_item_names']);
      const { settings: settingsBefore, ...restBefore } = before;
      const { settings: settingsAfter, ...restAfter } = after;
      expect(restAfter).toEqual(restBefore);
      expect(settingsAfter).toHaveLength(1);
      const { price_refresh_started_at: a, price_refresh_last_at: b, price_refresh_last_status: c, price_refresh_last_error_code: d, display_currency: _dc, inventory_density: _dn, ...kept } = settingsAfter[0];
      expect([a, b, c, d]).toEqual([null, null, null, null]);
      expect(kept).toEqual(settingsBefore[0]);
      expect(db.prepare('SELECT COUNT(*) AS n FROM market_prices').get().n).toBe(0);
    } finally {
      db.close();
    }
  });

  test('migrar de novo não reaplica nada nem duplica o backup automático', () => {
    const file = path.join(dir, 'm3', 'inventory.sqlite');
    const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 20) });
    old.close();
    database.openDatabase(file, { now: NOW }).close();
    database.openDatabase(file, { now: NOW }).close();
    const backups = fs.readdirSync(path.join(path.dirname(file), 'backups')).filter((f) => f.startsWith('inventory-v20-'));
    expect(backups).toHaveLength(1);
  });
});

describe('backup com o estado da rodada', () => {
  test('exportado e restaurado: cache e instantes da rodada voltam iguais; as colunas continuam fora da API de configurações', async () => {
    const db = database.getDb();
    db.prepare(
      `INSERT INTO market_prices (source, price_key, market_hash_name, paint_index, status, base_price_cents, reference_quantity, source_updated_at, priced_at, fetched_at, created_at, updated_at)
       VALUES ('CSFLOAT_LISTINGS', '★ Karambit | Doppler (Factory New)|418', '★ Karambit | Doppler (Factory New)', 418, 'NOT_FOUND', 89000, 3, '2026-11-24T10:00:00.000Z', '2026-11-23T10:00:00.000Z', '2026-11-24T10:00:00.000Z', 'c', 'u')`
    ).run();
    db.prepare(
      "UPDATE settings SET price_refresh_started_at = '2026-11-24T11:50:00.000Z', price_refresh_last_at = '2026-11-24T11:51:00.000Z', price_refresh_last_status = 'PARTIAL', price_refresh_last_error_code = 'IMPORT_RATE_LIMITED'"
    ).run();
    const expected = { market: db.prepare('SELECT * FROM market_prices').all(), settings: db.prepare('SELECT * FROM settings').get() };
    const file = await exportBuffer();
    db.prepare('DELETE FROM market_prices').run();
    db.prepare('UPDATE settings SET price_refresh_started_at = NULL, price_refresh_last_at = NULL, price_refresh_last_status = NULL, price_refresh_last_error_code = NULL').run();
    expect((await octet(file)).status).toBe(200);
    const after = database.getDb();
    expect(after.prepare('SELECT * FROM market_prices').all()).toEqual(expected.market);
    expect(after.prepare('SELECT * FROM settings').get()).toMatchObject({
      price_refresh_started_at: '2026-11-24T11:50:00.000Z', price_refresh_last_at: '2026-11-24T11:51:00.000Z', price_refresh_last_status: 'PARTIAL', price_refresh_last_error_code: 'IMPORT_RATE_LIMITED',
    });
    const settings = JSON.stringify((await request(app).get('/api/settings')).body);
    expect(settings).not.toMatch(/price_?refresh|priceRefresh/i);
    const summary = (await request(app).get('/api/market-values/summary')).body.data;
    expect(summary.lastRun).toEqual({ at: '2026-11-24T11:51:00.000Z', status: 'PARTIAL', errorCode: 'IMPORT_RATE_LIMITED' });
    expect(summary.nextAllowedAt).toBe('2026-11-24T12:05:00.000Z'); // 15 min depois de 11:50; relógio em 12:00
  });

  test('restaurar durante a busca de preços -> 409 BACKUP_BUSY, sem trocar o banco', async () => {
    const before = database.getDb().prepare('SELECT COUNT(*) AS n FROM market_prices').get().n;
    const file = await exportBuffer();
    const release = valuationLock.acquire();
    try {
      const res = await octet(file);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BACKUP_BUSY');
      expect(database.getDb().prepare('SELECT COUNT(*) AS n FROM market_prices').get().n).toBe(before);
    } finally {
      release();
    }
    expect((await octet(file)).status).toBe(200);
  });

  test('a chave da API nunca vai no arquivo exportado (nem como texto)', async () => {
    database.getDb().prepare("UPDATE integrations SET api_key = 'SENTINEL-CHAVE-v21qa-a1b2', api_key_saved_at = ?").run(NOW.toISOString());
    const file = await exportBuffer();
    expect(file.includes(Buffer.from('SENTINEL-CHAVE-v21qa-a1b2'))).toBe(false);
  });
});
