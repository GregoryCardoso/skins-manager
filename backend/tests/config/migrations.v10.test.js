'use strict';

// Migração v10 (D264, D270): itens "fora de venda". Só acrescenta duas colunas nulas em `items` e um índice.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { openDatabase, runMigrations } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v10-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

const upTo = (version) => MIGRATIONS.filter((m) => m.version <= version);
const dbIn = (name) => path.join(tmpRoot, name, 'inventory.sqlite');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const NOW = new Date('2026-11-22T12:00:00.000Z');
const backups = (dbPath) => {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

// Banco v9 com itens em estoque (com e sem trade lock), vendido, GANHEI e legado (sem catálogo).
function seedV9(dbPath, version = 9) {
  const old = openDatabase(dbPath, { migrations: upTo(version) });
  const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const ins = old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, trade_unlock_at, status, created_at, updated_at)
     VALUES (?, 'CAIXA', ?, ?, ?, ?, ?, 'EM_ESTOQUE', 'c', 'u')`
  );
  ins.run('Estoque livre', 'COMPRA', csf, 1500, '2026-10-01T00:00:00.000Z', null);
  ins.run('Estoque em trade lock', 'COMPRA', csf, 700, '2026-11-20T00:00:00.000Z', '2026-11-27T00:00:00.000Z');
  ins.run('Ganhei', 'GANHEI', csf, 0, '2026-10-02T00:00:00.000Z', null);
  old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, status, sale_store_id, sale_price_cents,
       sale_currency, net_received_cents, sold_at, sale_fee_type_applied, sale_fee_rate_applied, sale_fee_rounding_applied, sale_fixed_fee_cents_applied,
       created_at, updated_at)
     VALUES ('Vendido', 'CAIXA', 'COMPRA', ?, 500, '2026-10-01T00:00:00.000Z', 'VENDIDO', ?, 1000, 'USD', 980, '2026-10-20T00:00:00.000Z',
       'DEDUCTED', 0.02, 'CEIL', 0, 'c', 'u')`
  ).run(csf, csf);
  old.prepare("INSERT INTO items (name, category, variant, acquisition_type, acquired_at, status, created_at, updated_at) VALUES ('Legado', 'SKIN', 'NORMAL', 'GANHEI', '2026-01-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')").run();
  const snapshot = {
    items: old.prepare('SELECT * FROM items ORDER BY id').all(),
    stores: old.prepare('SELECT * FROM stores ORDER BY id').all(),
    sequence: old.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'items'").get(),
  };
  old.close();
  return snapshot;
}

describe('migração v10', () => {
  test('é a migração 10 (off_sale), sem desligar as FKs, e as migrações v1 a v9 continuam idênticas (hash)', () => {
    expect(MIGRATIONS.find((m) => m.version === 10)).toMatchObject({ version: 10, name: 'off_sale' });
    const last = MIGRATIONS.find((m) => m.version === 10);
    expect(last.disableForeignKeys).toBeUndefined();
    const dir = path.join(__dirname, '..', '..', 'src', 'config', 'migrations');
    expect(sha(path.join(dir, 'v001_initial.js'))).toBe('18514164a9ad3d10128e6b1c271ce7623d11835a9240fe9bf2f337bfced3eb1f');
    expect(sha(path.join(dir, 'v007_store_currency_flows.js'))).toBe('33458e5a958452fff91811822cbef913fdcfad716e4185f4c9f7f17a38f76d76');
    expect(sha(path.join(dir, 'v008_computed_store_balance.js'))).toBe('6f95ee3c336310fc239742b88a7f6f8507dca7e810d49bcf28c66e17b30ad8c6');
    expect(fs.readFileSync(path.join(dir, 'v009_remove_initial_balance.js'), 'utf8')).toContain("CHECK (kind = 'CHECK')");
  });

  test('banco v9 com itens: linhas e colunas iguais, as duas colunas novas nulas, índice criado e backup feito', () => {
    const dbPath = dbIn('dados');
    const snapshot = seedV9(dbPath);
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(15);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      const rows = db.prepare('SELECT * FROM items ORDER BY id').all();
      expect(rows).toHaveLength(snapshot.items.length);
      rows.forEach((row, i) => {
        const { off_sale_at: offSale, for_sale_since: forSale, sale_release_at: saleReleaseAt, ...rest } = row;
        expect([offSale, forSale]).toEqual([null, null]);
        expect(rest).toEqual(snapshot.items[i]);
      });
      expect(db.prepare('SELECT * FROM stores ORDER BY id').all()).toEqual(snapshot.stores);
      expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'items'").get()).toEqual(snapshot.sequence);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_items_off_sale_at'").all()).toHaveLength(1);
      const cols = db.prepare("SELECT name FROM pragma_table_info('items')").all().map((c) => c.name);
      expect(cols).toEqual(expect.arrayContaining(['off_sale_at', 'for_sale_since']));
      expect(backups(dbPath)).toHaveLength(1);
      expect(backups(dbPath)[0]).toMatch(/^inventory-v9-/);
    } finally {
      db.close();
    }
  });

  test.each([5, 8])('banco v%i chega à v10 com todos os itens à venda', (version) => {
    const dbPath = dbIn(`v${version}`);
    const csfSeed = seedV9(dbPath, version);
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(15);
      expect(db.prepare('SELECT COUNT(*) AS n FROM items').get().n).toBe(csfSeed.items.length);
      expect(db.prepare('SELECT COUNT(*) AS n FROM items WHERE off_sale_at IS NOT NULL OR for_sale_since IS NOT NULL').get().n).toBe(0);
    } finally {
      db.close();
    }
  });

  test('reabrir um banco v10 não migra de novo nem cria outro backup', () => {
    const dbPath = dbIn('reabrir');
    seedV9(dbPath);
    openDatabase(dbPath, { now: NOW }).close();
    const first = backups(dbPath).length;
    openDatabase(dbPath, { now: NOW }).close();
    expect(backups(dbPath).length).toBe(first);
  });

  test('rollback: falha depois do primeiro ADD COLUMN -> versão 9, items sem as colunas novas e linhas intactas', () => {
    const dbPath = dbIn('rollback');
    const snapshot = seedV9(dbPath);
    const real = MIGRATIONS.find((m) => m.version === 10);
    const failing = {
      ...real,
      up(db) {
        db.exec('ALTER TABLE items ADD COLUMN off_sale_at TEXT NULL');
        throw new Error('falha injetada depois do primeiro ADD COLUMN');
      },
    };
    const db = new Database(dbPath);
    try {
      db.pragma('foreign_keys = ON');
      expect(() => runMigrations(db, [...upTo(9), failing], { dbPath, now: NOW })).toThrow('falha injetada');
      expect(db.pragma('user_version', { simple: true })).toBe(9);
      const cols = db.prepare("SELECT name FROM pragma_table_info('items')").all().map((c) => c.name);
      expect(cols).not.toContain('off_sale_at');
      expect(cols).not.toContain('for_sale_since');
      expect(db.prepare('SELECT * FROM items ORDER BY id').all()).toEqual(snapshot.items);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_items_off_sale_at'").all()).toEqual([]);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      db.close();
    }
  });
});
