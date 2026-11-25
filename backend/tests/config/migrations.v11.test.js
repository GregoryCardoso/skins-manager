'use strict';

// Migração v11 (D276): preferência da visão do inventário. Só ADD COLUMN em `settings`, padrão 'GROUPED'.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v11-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

const upTo = (version) => MIGRATIONS.filter((m) => m.version <= version);
const dbIn = (name) => path.join(tmpRoot, name, 'inventory.sqlite');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

describe('migração v11', () => {
  test('é a migração 11 (inventory_view) e a v10 não foi editada', () => {
    const last = MIGRATIONS.find((m) => m.version === 11);
    expect(last).toMatchObject({ version: 11, name: 'inventory_view' });
    expect(last.disableForeignKeys).toBeUndefined();
    const dir = path.join(__dirname, '..', '..', 'src', 'config', 'migrations');
    expect(fs.readFileSync(path.join(dir, 'v011_inventory_view.js'), 'utf8')).toMatch(/ADD COLUMN inventory_view/);
    expect(sha(path.join(dir, 'v001_initial.js'))).toBe('18514164a9ad3d10128e6b1c271ce7623d11835a9240fe9bf2f337bfced3eb1f');
  });

  test('banco v10 vira v11: linha de settings mantém os dados e ganha GROUPED; backup criado', () => {
    const dbPath = dbIn('dados');
    const old = openDatabase(dbPath, { migrations: upTo(10) });
    old.prepare("UPDATE settings SET theme = 'DARK', language = 'en', usd_brl_rate = 5.4").run();
    const before = old.prepare('SELECT * FROM settings').get();
    old.close();
    const db = openDatabase(dbPath, { now: new Date('2026-11-22T12:00:00.000Z') });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(24);
      const { inventory_view: view, steam_store_id: _steam, price_refresh_started_at: _p1, price_refresh_last_at: _p2, price_refresh_last_status: _p3, price_refresh_last_error_code: _p4, display_currency: _dc, ...rest } = db.prepare('SELECT * FROM settings').get();
      expect(view).toBe('GROUPED');
      expect(rest).toEqual(before);
      expect(() => db.prepare("UPDATE settings SET inventory_view = 'LIST'").run()).toThrow(/CHECK/);
      expect(() => db.prepare('UPDATE settings SET inventory_view = NULL').run()).toThrow(/NOT NULL/);
      db.prepare("UPDATE settings SET inventory_view = 'INDIVIDUAL'").run();
      expect(fs.readdirSync(path.join(path.dirname(dbPath), 'backups')).some((f) => f.startsWith('inventory-v10-'))).toBe(true);
    } finally {
      db.close();
    }
  });

  test('falha forçada na v11 volta ao v10 sem a coluna', () => {
    const dbPath = dbIn('falha');
    openDatabase(dbPath, { migrations: upTo(10) }).close();
    const broken = [...upTo(10), { version: 11, name: 'inventory_view', up(db) { MIGRATIONS[10].up(db); throw new Error('falha forçada'); } }];
    expect(() => openDatabase(dbPath, { migrations: broken })).toThrow();
    const db = openDatabase(dbPath, { migrations: upTo(10) });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(10);
      expect(db.prepare("SELECT 1 FROM pragma_table_info('settings') WHERE name = 'inventory_view'").get()).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
