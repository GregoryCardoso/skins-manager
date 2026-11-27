'use strict';

// QA da migração v27 (D370, 12.5a): banco v26 com dados de várias tabelas, sem perda, e rejeição de valores inválidos pelo CHECK.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v27qa-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

const upTo = (version) => MIGRATIONS.filter((m) => m.version <= version);
const TABLES = ['items', 'deposits', 'withdrawals', 'stores'];

describe('migração v27 com dados reais', () => {
  test('itens, aportes e saques de um banco v26 continuam idênticos e a linha de settings ganha só a coluna nova', () => {
    const dbPath = path.join(tmpRoot, 'cheio', 'inventory.sqlite');
    const old = openDatabase(dbPath, { migrations: upTo(26) });
    const store = old.prepare('SELECT id FROM stores ORDER BY id LIMIT 1').get().id;
    const now = '2026-11-01T00:00:00.000Z';
    for (let i = 0; i < 3; i += 1) {
      old.prepare("INSERT INTO items (name, category, acquisition_type, acquired_at, created_at, updated_at) VALUES (?, 'CAIXA', 'GANHEI', ?, ?, ?)")
        .run(`Item ${i}`, now, now, now);
    }
    old.prepare('INSERT INTO deposits (store_id, amount_store_cents, deposited_at, created_at, updated_at) VALUES (?, 5000, ?, ?, ?)').run(store, now, now, now);
    old.prepare('INSERT INTO withdrawals (store_id, amount_store_cents, withdrawn_at, created_at, updated_at) VALUES (?, 1000, ?, ?, ?)').run(store, now, now, now);
    old.prepare("UPDATE settings SET theme = 'DARK', language = 'ru', display_currency = 'EUR'").run();
    const snapshot = Object.fromEntries(TABLES.map((table) => [table, old.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
    const settingsBefore = old.prepare('SELECT * FROM settings').get();
    expect(store).toBeDefined();
    old.close();

    const db = openDatabase(dbPath, { now: new Date('2026-11-27T12:00:00.000Z') });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(28);
      for (const table of TABLES) expect(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map(({ sells_here: _sh, ...r }) => r)).toEqual(snapshot[table]);
      const after = db.prepare('SELECT * FROM settings').get();
      expect(Object.keys(after).sort()).toEqual([...Object.keys(settingsBefore), 'inventory_density'].sort());
      expect(after).toMatchObject({ ...settingsBefore, inventory_density: 'COMPACT' });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok');
    } finally {
      db.close();
    }
    // o backup da v26 é o banco como estava (sem a coluna nova)
    const backups = fs.readdirSync(path.join(path.dirname(dbPath), 'backups')).filter((f) => f.startsWith('inventory-v26-'));
    expect(backups).toHaveLength(1);
    const copyPath = path.join(tmpRoot, 'copia-v26.sqlite');
    fs.copyFileSync(path.join(path.dirname(dbPath), 'backups', backups[0]), copyPath);
    const copy = new Database(copyPath, { readonly: true });
    try {
      expect(copy.prepare('PRAGMA table_info(settings)').all().map((c) => c.name)).not.toContain('inventory_density');
      expect(copy.prepare('SELECT COUNT(*) AS n FROM items').get().n).toBe(3);
    } finally {
      copy.close();
    }
  });

  test('banco novo: a coluna existe, é NOT NULL com padrão COMPACT e o CHECK aceita só COMPACT e COMFORTABLE', () => {
    const db = openDatabase(path.join(tmpRoot, 'novo', 'inventory.sqlite'));
    try {
      const column = db.prepare('PRAGMA table_info(settings)').all().find((c) => c.name === 'inventory_density');
      expect(column).toMatchObject({ type: 'TEXT', notnull: 1 });
      expect(column.dflt_value).toBe("'COMPACT'");
      for (const bad of ['compact', 'Comfortable', '', ' COMPACT', 'WIDE']) {
        expect(() => db.prepare('UPDATE settings SET inventory_density = ?').run(bad)).toThrow(/CHECK/);
      }
      db.prepare("UPDATE settings SET inventory_density = 'COMFORTABLE'").run();
      expect(db.prepare('SELECT inventory_density AS d FROM settings').get().d).toBe('COMFORTABLE');
    } finally {
      db.close();
    }
  });
});
