const fs = require('fs');
const os = require('os');
const path = require('path');
const env = require('../../src/config/env');
const { getDb, closeDb, openDatabase } = require('../../src/config/database');

let tmpRoot;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-db-test-'));
});

afterEach(() => closeDb());

afterAll(() => {
  closeDb();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('config/database', () => {
  test('os testes usam banco em memória (nunca o inventory.sqlite real)', () => {
    expect(env.dbPath).toBe(':memory:');
    expect(getDb().name).toBe(':memory:');
  });

  test('getDb() devolve sempre a mesma instância', () => {
    expect(getDb()).toBe(getDb());
  });

  test('closeDb() descarta a instância e getDb() abre outra', () => {
    const first = getDb();
    closeDb();
    const second = getDb();
    expect(second).not.toBe(first);
    expect(first.open).toBe(false);
    expect(second.open).toBe(true);
  });

  test('closeDb() sem banco aberto não falha', () => {
    closeDb();
    expect(() => closeDb()).not.toThrow();
  });

  test('user_version = 4 e foreign_keys = 1', () => {
    const db = getDb();
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  test('cria as 7 tabelas, todas STRICT', () => {
    const rows = getDb()
      .prepare(
        "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all();
    expect(rows.map((r) => r.name)).toEqual(['catalog_items', 'deposits', 'items', 'settings', 'store_balances', 'stores', 'withdrawals']);
    expect(rows.every((r) => r.strict === 1)).toBe(true);
  });

  test('cria a pasta se não existir, usa WAL e reabrir não recria nem duplica o seed', () => {
    const dbPath = path.join(tmpRoot, 'nivel1', 'nivel2', 'test.sqlite');
    expect(fs.existsSync(path.dirname(dbPath))).toBe(false);

    const db1 = openDatabase(dbPath);
    try {
      expect(fs.existsSync(dbPath)).toBe(true);
      expect(db1.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(db1.pragma('foreign_keys', { simple: true })).toBe(1);
      db1.prepare(
        "INSERT INTO stores (name, currency, created_at, updated_at) VALUES ('Persistida', 'USD', 'x', 'x')"
      ).run();
      db1.prepare('UPDATE settings SET usd_brl_rate = 5.5 WHERE id = 1').run();
    } finally {
      db1.close();
    }

    const db2 = openDatabase(dbPath);
    try {
      expect(db2.pragma('user_version', { simple: true })).toBe(4);
      expect(db2.pragma('foreign_keys', { simple: true })).toBe(1);
      const names = db2.prepare('SELECT name FROM stores ORDER BY id').all().map((r) => r.name);
      expect(names).toEqual(['CSFloat', 'Steam', 'CSMoney', 'Persistida']);
      expect(db2.prepare('SELECT COUNT(*) AS n FROM settings').get().n).toBe(1);
      expect(db2.prepare('SELECT usd_brl_rate FROM settings').get().usd_brl_rate).toBe(5.5);
    } finally {
      db2.close();
    }
  });

  test('T3: se o seed lançar, o handle é fechado (arquivo liberado) e o erro original é relançado', () => {
    const dbPath = path.join(tmpRoot, 'falha', 'seed-falha.sqlite');
    let thrown;
    jest.isolateModules(() => {
      jest.doMock('../../src/config/seed', () => ({
        runSeed: () => {
          throw new Error('seed quebrou');
        },
      }));
      const isolated = require('../../src/config/database');
      try {
        isolated.openDatabase(dbPath);
      } catch (err) {
        thrown = err;
      }
    });
    jest.dontMock('../../src/config/seed');
    expect(thrown).toEqual(new Error('seed quebrou'));
    // No Windows, um handle aberto faria o rmSync lançar EBUSY.
    expect(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })).not.toThrow();
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test(':memory: não usa WAL', () => {
    const db = openDatabase(':memory:');
    try {
      expect(db.pragma('journal_mode', { simple: true })).toBe('memory');
    } finally {
      db.close();
    }
  });
});
