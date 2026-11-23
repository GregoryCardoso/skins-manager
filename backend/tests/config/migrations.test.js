'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase, runMigrations } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');
const v001 = require('../../src/config/migrations/v001_initial');
const { SCHEMA_SQL } = require('../../src/config/schema');

let tmpRoot;
let counter = 0;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-test-'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function newDbPath() {
  counter += 1;
  return path.join(tmpRoot, `case${counter}`, 'inventory.sqlite');
}

function backupsOf(dbPath) {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

describe('migrações (D69)', () => {
  test('versões únicas, consecutivas e começando em 1', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
    expect(new Set(MIGRATIONS.map((m) => m.name)).size).toBe(MIGRATIONS.length);
    for (const m of MIGRATIONS) expect(typeof m.up).toBe('function');
  });

  test('a migração 1 usa o SQL do esquema original, congelado por hash', () => {
    expect(crypto.createHash('sha256').update(SCHEMA_SQL).digest('hex')).toBe(
      '79b204fa96faa84a9e2e5fa433baf0ea4812338ffc4386ada42fda0867f7358f'
    );
    expect(v001.version).toBe(1);
  });

  test('banco novo em memória recebe todas as migrações', () => {
    const db = openDatabase(':memory:');
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
    } finally {
      db.close();
    }
  });

  test('banco novo em arquivo não gera backup; reabrir não migra nem gera backup', () => {
    const dbPath = newDbPath();
    openDatabase(dbPath).close();
    expect(backupsOf(dbPath)).toEqual([]);
    openDatabase(dbPath).close();
    expect(backupsOf(dbPath)).toEqual([]);
  });

  test('migra do v1 aplicando só as pendentes, com backup do estado anterior', () => {
    const dbPath = newDbPath();
    const old = openDatabase(dbPath, { migrations: [v001] });
    old.prepare("INSERT INTO stores (name, currency, created_at, updated_at) VALUES ('Minha', 'USD', 'x', 'x')").run();
    old.close();

    const calls = [];
    const v2 = {
      version: 2,
      name: 'fake',
      up: (db) => {
        calls.push(2);
        db.exec('CREATE TABLE extra (id INTEGER) STRICT');
      },
    };
    const now = new Date('2026-11-20T10:30:00.000Z');
    const db = openDatabase(dbPath, { migrations: [v001, v2], now });
    try {
      expect(calls).toEqual([2]);
      expect(db.pragma('user_version', { simple: true })).toBe(2);
      expect(db.prepare("SELECT COUNT(*) AS n FROM stores WHERE name = 'Minha'").get().n).toBe(1);
    } finally {
      db.close();
    }
    const backups = backupsOf(dbPath);
    expect(backups).toEqual(['inventory-v1-2026-11-20T10-30-00.000Z.sqlite']);
    const backupDb = openDatabase(path.join(path.dirname(dbPath), 'backups', backups[0]), { migrations: [v001] });
    try {
      expect(backupDb.pragma('user_version', { simple: true })).toBe(1);
      expect(backupDb.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'extra'").get().n).toBe(0);
    } finally {
      backupDb.close();
    }
  });

  test('user_version maior que a última conhecida: erro em português e arquivo intacto', () => {
    const dbPath = newDbPath();
    const future = { version: 2, name: 'fake', up: (db) => db.exec('CREATE TABLE extra (id INTEGER) STRICT') };
    openDatabase(dbPath, { migrations: [v001, future] }).close();
    const before = hashFile(dbPath);
    expect(() => openDatabase(dbPath, { migrations: [v001] })).toThrow(/versão mais nova do Skins Manager/);
    expect(hashFile(dbPath)).toBe(before);
    expect(backupsOf(dbPath)).toEqual([]);
    // O handle foi liberado: a pasta pode ser removida (Windows).
    expect(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })).not.toThrow();
  });

  test('migração que lança: rollback, versão anterior mantida, handle fechado e erro original', () => {
    const dbPath = newDbPath();
    openDatabase(dbPath, { migrations: [v001] }).close();
    const broken = {
      version: 2,
      name: 'broken',
      up: (db) => {
        db.exec('CREATE TABLE parcial (id INTEGER) STRICT');
        throw new Error('migração quebrou');
      },
    };
    expect(() => openDatabase(dbPath, { migrations: [v001, broken] })).toThrow('migração quebrou');

    const db = openDatabase(dbPath, { migrations: [v001] });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'parcial'").get().n).toBe(0);
    } finally {
      db.close();
    }
    expect(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })).not.toThrow();
  });

  test('cada migração roda na sua transação: a 3ª falha mas a 2ª fica gravada', () => {
    const dbPath = newDbPath();
    openDatabase(dbPath, { migrations: [v001] }).close();
    const ok = { version: 2, name: 'ok', up: (db) => db.exec('CREATE TABLE a (id INTEGER) STRICT') };
    const bad = {
      version: 3,
      name: 'bad',
      up: () => {
        throw new Error('falhou a 3');
      },
    };
    expect(() => openDatabase(dbPath, { migrations: [v001, ok, bad] })).toThrow('falhou a 3');
    const db = openDatabase(dbPath, { migrations: [v001, ok] });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(2);
    } finally {
      db.close();
    }
  });

  test('runMigrations em banco já atualizado não faz nada', () => {
    const db = openDatabase(':memory:');
    try {
      const result = runMigrations(db, MIGRATIONS);
      expect(result.applied).toEqual([]);
      expect(result.backupPath).toBeNull();
    } finally {
      db.close();
    }
  });

  test('migração com disableForeignKeys reabilita as chaves e valida foreign_key_check', () => {
    const db = openDatabase(':memory:', { migrations: [v001] });
    try {
      const rebuild = { version: 2, name: 'rebuild', disableForeignKeys: true, up: () => {} };
      runMigrations(db, [v001, rebuild]);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      const violating = {
        version: 3,
        name: 'violating',
        disableForeignKeys: true,
        up: (d) =>
          d.exec(
            "INSERT INTO items (name, category, acquisition_type, acquired_at, created_at, updated_at, purchase_store_id) VALUES ('x','OUTRO','COMPRA','2026-01-01T00:00:00.000Z','x','x', 999)"
          ),
      };
      expect(() => runMigrations(db, [v001, rebuild, violating])).toThrow();
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('user_version', { simple: true })).toBe(2);
    } finally {
      db.close();
    }
  });
});

describe('migração v2 (catálogo, preferências e T32)', () => {
  function seedV1(dbPath) {
    const db = openDatabase(dbPath, { migrations: [v001] });
    const insert = db.prepare(
      `INSERT INTO items (name, category, variant, acquisition_type, purchase_store_id, purchase_price_cents,
         purchase_currency, fx_rate_at_purchase, acquired_at, created_at, updated_at)
       VALUES (?, 'SKIN', 'NORMAL', ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', 'x', 'x')`
    );
    insert.run('Ganhei BRL', 'GANHEI', null, 500, 'BRL', 5.2);
    insert.run('Ganhei USD zero', 'GANHEI', null, 0, 'USD', null);
    insert.run('Compra BRL', 'COMPRA', 2, 1500, 'BRL', 5.1);
    db.prepare('UPDATE settings SET usd_brl_rate = 5.5 WHERE id = 1').run();
    db.close();
  }

  test('banco novo tem catalog_items e as colunas novas', () => {
    const db = openDatabase(':memory:');
    try {
      const cols = (table) => db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((r) => r.name);
      expect(cols('catalog_items')).toEqual([
        'id', 'source', 'category', 'name', 'name_pt_br', 'name_key', 'search_text', 'image_url', 'min_float',
        'max_float', 'has_stattrak', 'has_souvenir', 'phase', 'rarity', 'updated_at',
      ]);
      expect(cols('items')).toContain('catalog_id');
      expect(cols('settings')).toEqual(expect.arrayContaining(['catalog_updated_at', 'theme', 'language']));
      expect(db.prepare('SELECT theme, language, catalog_updated_at FROM settings').get()).toEqual({
        theme: 'SYSTEM', language: 'pt-BR', catalog_updated_at: null,
      });
    } finally {
      db.close();
    }
  });

  test('v1 com dados vira v2: dados intactos, catalog_id nulo, preferências padrão e backup', () => {
    const dbPath = newDbPath();
    seedV1(dbPath);
    const now = new Date('2026-11-20T12:00:00.000Z');
    const db = openDatabase(dbPath, { now });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(12);
      expect(db.prepare('SELECT name FROM stores ORDER BY id').all().map((r) => r.name)).toEqual(['CSFloat', 'Steam', 'CSMoney']);
      const items = db.prepare('SELECT name, catalog_id FROM items ORDER BY id').all();
      expect(items).toEqual([
        { name: 'Ganhei BRL', catalog_id: null },
        { name: 'Ganhei USD zero', catalog_id: null },
        { name: 'Compra BRL', catalog_id: null },
      ]);
      expect(db.prepare('SELECT usd_brl_rate, theme, language FROM settings').get()).toEqual({
        usd_brl_rate: 5.5, theme: 'SYSTEM', language: 'pt-BR',
      });
    } finally {
      db.close();
    }
    expect(backupsOf(dbPath)).toEqual(['inventory-v1-2026-11-20T12-00-00.000Z.sqlite']);
  });

  test('T32: GANHEI antigo vira custo 0 em USD sem cotação; COMPRA fica intacto', () => {
    const dbPath = newDbPath();
    seedV1(dbPath);
    const db = openDatabase(dbPath);
    try {
      const rows = db
        .prepare('SELECT name, purchase_price_cents AS cents, purchase_currency AS cur, fx_rate_at_purchase AS fx FROM items ORDER BY id')
        .all();
      expect(rows).toEqual([
        { name: 'Ganhei BRL', cents: 0, cur: 'USD', fx: null },
        { name: 'Ganhei USD zero', cents: 0, cur: 'USD', fx: null },
        { name: 'Compra BRL', cents: 1500, cur: 'BRL', fx: 5.1 },
      ]);
    } finally {
      db.close();
    }
  });

  test('CHECKs de theme e language', () => {
    const db = openDatabase(':memory:');
    try {
      expect(() => db.prepare("UPDATE settings SET theme = 'BLUE'").run()).toThrow(/CHECK/);
      expect(() => db.prepare("UPDATE settings SET language = 'es'").run()).toThrow(/CHECK/);
    } finally {
      db.close();
    }
  });

  test('o último user_version é 11', () => {
    expect(MIGRATIONS[MIGRATIONS.length - 1].version).toBe(12);
  });

  test('banco com user_version = 13 é recusado e o arquivo fica inalterado', () => {
    const dbPath = newDbPath();
    openDatabase(dbPath).close();
    const raw = new (require('better-sqlite3'))(dbPath);
    raw.pragma('user_version = 13');
    raw.pragma('wal_checkpoint(TRUNCATE)');
    raw.close();
    const before = hashFile(dbPath);
    expect(() => openDatabase(dbPath)).toThrow(/versão mais nova do Skins Manager/);
    expect(hashFile(dbPath)).toBe(before);
    expect(backupsOf(dbPath)).toEqual([]);
  });
});
