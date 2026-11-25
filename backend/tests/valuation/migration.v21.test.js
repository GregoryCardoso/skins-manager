'use strict';

// 10.5 (D364): migração v21 (`market_prices` e as colunas da rodada em `settings`) e o backup. Só bancos temporários (nunca o %APPDATA%
// real) e nenhuma rede. Sem perda de dados, com backup automático da v20 antes de migrar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v21-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(60000);
let request;
let database;
let app;
let MIGRATIONS;
const NOW = new Date('2026-11-24T12:00:00.000Z');

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
  database = require('../../src/config/database');
  ({ MIGRATIONS } = require('../../src/config/migrations'));
  require('../../src/services/catalogService').setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  database.getDb();
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => NOW });
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

const UP_TO_20 = () => MIGRATIONS.filter((m) => m.version <= 20);
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const exportBuffer = async () => (await request(app).get('/api/backup/export').buffer(true).parse(binary)).body;
const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);

function makeV20(file) {
  const old = database.openDatabase(file, { migrations: UP_TO_20() });
  const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  old.prepare(
    `INSERT INTO items (name, category, variant, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, acquired_at, status, created_at, updated_at)
     VALUES ('AK-47 | Redline', 'SKIN', 'NORMAL', 'COMPRA', ?, 1000, 'USD', '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`
  ).run(csf);
  const snapshot = {
    items: old.prepare('SELECT * FROM items ORDER BY id').all(),
    stores: old.prepare('SELECT * FROM stores ORDER BY id').all(),
    settings: old.prepare('SELECT * FROM settings').get(),
  };
  old.close();
  return snapshot;
}

describe('migração v21', () => {
  test('banco v20 com dados: nada muda, a tabela nasce vazia, as colunas da rodada nascem nulas e há backup da v20', () => {
    const file = path.join(dir, 'm1', 'inventory.sqlite');
    const before = makeV20(file);
    const db = database.openDatabase(file, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(24);
      expect(db.prepare('SELECT * FROM items ORDER BY id').all()).toEqual(before.items);
      expect(db.prepare('SELECT * FROM stores ORDER BY id').all()).toEqual(before.stores);
      const { price_refresh_started_at: a, price_refresh_last_at: b, price_refresh_last_status: c, price_refresh_last_error_code: d, display_currency: _dc, ...rest } = db.prepare('SELECT * FROM settings').get();
      expect([a, b, c, d]).toEqual([null, null, null, null]);
      expect(rest).toEqual(before.settings);
      expect(db.prepare('SELECT COUNT(*) AS n FROM market_prices').get().n).toBe(0);
      expect(db.prepare("SELECT strict FROM pragma_table_list WHERE name = 'market_prices'").get().strict).toBe(1);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
    const backups = fs.readdirSync(path.join(path.dirname(file), 'backups')).filter((f) => f.startsWith('inventory-v20-'));
    expect(backups).toHaveLength(1);
  });

  test('as restrições da tabela: moeda só USD, status só OK/NOT_FOUND, preço e data andam juntos, chave única por fonte', () => {
    const db = database.openDatabase(':memory:', { now: NOW });
    try {
      const insert = (over = {}) => {
        const row = {
          source: 'CSFLOAT_LISTINGS', price_key: 'k|', market_hash_name: 'k', paint_index: null, currency: 'USD', status: 'OK', base_price_cents: 10,
          priced_at: 'x', fetched_at: 'x', ...over,
        };
        db.prepare(
          `INSERT INTO market_prices (source, price_key, market_hash_name, paint_index, currency, status, base_price_cents, priced_at, fetched_at, created_at, updated_at)
           VALUES (@source, @price_key, @market_hash_name, @paint_index, @currency, @status, @base_price_cents, @priced_at, @fetched_at, 'c', 'u')`
        ).run(row);
      };
      insert();
      expect(() => insert()).toThrow(/UNIQUE/);
      expect(() => insert({ source: 'OUTRA_FONTE' })).not.toThrow(); // a fonte é trocável: sem lista fixa no CHECK
      expect(() => insert({ price_key: 'a|', currency: 'BRL' })).toThrow(/CHECK/);
      expect(() => insert({ price_key: 'b|', status: 'FAILED' })).toThrow(/CHECK/);
      expect(() => insert({ price_key: 'c|', base_price_cents: null })).toThrow(/CHECK/);
      expect(() => insert({ price_key: 'd|', base_price_cents: -1 })).toThrow(/CHECK/);
      expect(() => insert({ price_key: 'e|', base_price_cents: null, priced_at: null, status: 'NOT_FOUND' })).not.toThrow();
      expect(() => db.prepare("UPDATE settings SET price_refresh_last_status = 'QUALQUER'").run()).toThrow(/CHECK/);
    } finally {
      db.close();
    }
  });
});

describe('backup', () => {
  test('backup v20 importado chega à v21 com a tabela vazia e os dados intactos', async () => {
    const v20 = path.join(dir, 'v20.sqlite');
    const before = makeV20(v20);
    const res = await octet(fs.readFileSync(v20));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: 20, schemaVersion: 24, migrationsApplied: [21, 22, 23, 24] });
    const db = database.getDb();
    expect(db.prepare('SELECT COUNT(*) AS n FROM market_prices').get().n).toBe(0);
    expect(db.prepare('SELECT * FROM items ORDER BY id').all().map(({ updated_at: _u, catalog_id: _c, ...r }) => r)).toEqual(before.items.map(({ updated_at: _u, catalog_id: _c, ...r }) => r));
    expect((await request(app).get('/api/market-values/summary')).body.data).toMatchObject({ totals: { pricedUnits: 0 }, lastRun: null, nextAllowedAt: null });
  });

  test('o backup exportado leva o cache de preços; restaurar traz os preços de volta, sem segredo', async () => {
    const db = database.getDb();
    db.prepare(
      `INSERT INTO market_prices (source, price_key, market_hash_name, paint_index, status, base_price_cents, reference_quantity, priced_at, fetched_at, created_at, updated_at)
       VALUES ('CSFLOAT_LISTINGS', 'AK-47 | Redline (Field-Tested)|', 'AK-47 | Redline (Field-Tested)', NULL, 'OK', 1000, 50, '2026-11-24T10:00:00.000Z', '2026-11-24T10:00:00.000Z', 'c', 'u')`
    ).run();
    db.prepare("UPDATE integrations SET api_key = 'SENTINEL-CHAVE-v21-a1b2', api_key_saved_at = ?").run(NOW.toISOString());
    const file = await exportBuffer();
    const copyPath = path.join(dir, 'exported.sqlite');
    fs.writeFileSync(copyPath, file);
    const copy = new Database(copyPath, { readonly: true });
    try {
      expect(copy.prepare('SELECT base_price_cents AS p FROM market_prices').get().p).toBe(1000);
      expect(copy.prepare('SELECT api_key FROM integrations').get().api_key).toBeNull();
    } finally {
      copy.close();
    }
    db.prepare('DELETE FROM market_prices').run();
    expect((await octet(file)).status).toBe(200);
    const after = database.getDb();
    expect(after.prepare('SELECT base_price_cents AS p FROM market_prices').get().p).toBe(1000);
    expect(after.prepare('SELECT api_key FROM integrations').get().api_key).toBe('SENTINEL-CHAVE-v21-a1b2'); // a chave atual é mantida
  });
});
