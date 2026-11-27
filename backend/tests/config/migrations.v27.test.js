'use strict';

// Migração v27 (D370, 12.5a): densidade da tabela do inventário. Só ADD COLUMN em `settings`, padrão 'COMPACT'.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v27-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

const upTo = (version) => MIGRATIONS.filter((m) => m.version <= version);
const dbIn = (name) => path.join(tmpRoot, name, 'inventory.sqlite');

describe('migração v27', () => {
  test('é a migração 27 (inventory_density), sem reconstruir a tabela', () => {
    const last = MIGRATIONS[MIGRATIONS.length - 1];
    expect(last).toMatchObject({ version: 27, name: 'inventory_density' });
    expect(last.disableForeignKeys).toBeUndefined();
  });

  test('banco v26 com dados vira v27: nada se perde, a linha recebe COMPACT e há backup da v26', () => {
    const dbPath = dbIn('dados');
    const old = openDatabase(dbPath, { migrations: upTo(26) });
    old.prepare("UPDATE settings SET theme = 'DARK', language = 'pt-BR', inventory_view = 'INDIVIDUAL', display_currency = 'EUR'").run();
    const before = old.prepare('SELECT * FROM settings').get();
    const storesBefore = old.prepare('SELECT * FROM stores ORDER BY id').all();
    old.close();
    const db = openDatabase(dbPath, { now: new Date('2026-11-27T12:00:00.000Z') });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(27);
      const { inventory_density: density, ...rest } = db.prepare('SELECT * FROM settings').get();
      expect(density).toBe('COMPACT');
      expect(rest).toEqual(before);
      expect(db.prepare('SELECT * FROM stores ORDER BY id').all()).toEqual(storesBefore);
      expect(() => db.prepare("UPDATE settings SET inventory_density = 'WIDE'").run()).toThrow(/CHECK/);
      expect(() => db.prepare('UPDATE settings SET inventory_density = NULL').run()).toThrow(/NOT NULL/);
      db.prepare("UPDATE settings SET inventory_density = 'COMFORTABLE'").run();
      expect(fs.readdirSync(path.join(path.dirname(dbPath), 'backups')).some((f) => f.startsWith('inventory-v26-'))).toBe(true);
    } finally {
      db.close();
    }
  });

  test('abrir de novo não migra nem mexe na preferência', () => {
    const dbPath = dbIn('idempotente');
    openDatabase(dbPath).close();
    const again = openDatabase(dbPath);
    try {
      again.prepare("UPDATE settings SET inventory_density = 'COMFORTABLE'").run();
    } finally {
      again.close();
    }
    const third = openDatabase(dbPath);
    try {
      expect(third.pragma('user_version', { simple: true })).toBe(27);
      expect(third.prepare('SELECT inventory_density AS d FROM settings').get().d).toBe('COMFORTABLE');
    } finally {
      third.close();
    }
  });
});
