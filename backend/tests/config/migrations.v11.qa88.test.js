'use strict';

// QA 8.8: migração v11 em banco v10 com dados reais (itens, aportes, saques, lojas) e idempotência.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v11qa-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

const upTo = (version) => MIGRATIONS.filter((m) => m.version <= version);
const dbIn = (name) => path.join(tmpRoot, name, 'inventory.sqlite');
const dump = (db) => ({
  stores: db.prepare('SELECT * FROM stores ORDER BY id').all(),
  // a v14 acrescenta `sale_release_at` (nula) em items: fica fora da comparação
  items: db.prepare('SELECT * FROM items ORDER BY id').all().map(({ sale_release_at: saleReleaseAt, components_imported_at: componentsImportedAt, consumed_at: consumedAt, ...rest }) => rest),
  deposits: db.prepare('SELECT * FROM deposits ORDER BY id').all(),
  withdrawals: db.prepare('SELECT * FROM withdrawals ORDER BY id').all(),
  balances: db.prepare('SELECT * FROM store_balances ORDER BY id').all(),
});

describe('v11 com dados', () => {
  test('v10 populado: nenhuma linha de nenhuma tabela muda; settings ganha só a coluna', () => {
    const dbPath = dbIn('populado');
    const old = openDatabase(dbPath, { migrations: upTo(10) });
    const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    const insertItem = old.prepare(
      `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, status, created_at, updated_at, off_sale_at)
       VALUES (?, 'CAIXA', 'COMPRA', ?, ?, '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u', ?)`
    );
    insertItem.run('Caixa A', csf, 500, null);
    insertItem.run('Caixa B', csf, 700, '2026-11-01T00:00:00.000Z');
    old.prepare("UPDATE settings SET theme = 'LIGHT', language = 'en', fast_turnover_days = 3, slow_item_days = 30").run();
    const before = dump(old);
    const settingsBefore = old.prepare('SELECT * FROM settings').get();
    const rowsBefore = old.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
    old.close();

    const db = openDatabase(dbPath, { now: new Date('2026-11-22T12:00:00.000Z') });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(20);
      expect(dump(db)).toEqual(before);
      const { inventory_view: view, steam_store_id: _steam, ...rest } = db.prepare('SELECT * FROM settings').get();
      expect(view).toBe('GROUPED');
      expect(rest).toEqual(settingsBefore);
      expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get().n).toBe(rowsBefore);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });

  test('reabrir um banco v11 não reaplica nem altera a preferência', () => {
    const dbPath = dbIn('reabrir');
    const first = openDatabase(dbPath);
    first.prepare("UPDATE settings SET inventory_view = 'INDIVIDUAL'").run();
    first.close();
    const second = openDatabase(dbPath);
    try {
      expect(second.pragma('user_version', { simple: true })).toBe(20);
      expect(second.prepare('SELECT inventory_view AS v FROM settings').get().v).toBe('INDIVIDUAL');
    } finally {
      second.close();
    }
  });

  test('banco novo (sem migração anterior) já nasce em v11 com GROUPED', () => {
    const db = openDatabase(dbIn('novo'));
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(20);
      expect(db.prepare('SELECT inventory_view AS v FROM settings').get().v).toBe('GROUPED');
    } finally {
      db.close();
    }
  });

  test('coluna NOT NULL com default GROUPED e CHECK nos dois valores', () => {
    const db = openDatabase(dbIn('esquema'));
    try {
      const col = db.prepare("SELECT * FROM pragma_table_info('settings') WHERE name = 'inventory_view'").get();
      expect(col).toMatchObject({ notnull: 1, dflt_value: "'GROUPED'" });
      for (const ok of ['GROUPED', 'INDIVIDUAL']) db.prepare('UPDATE settings SET inventory_view = ?').run(ok);
      for (const bad of ['', 'grouped', 'LIST']) expect(() => db.prepare('UPDATE settings SET inventory_view = ?').run(bad)).toThrow(/CHECK/);
    } finally {
      db.close();
    }
  });

  test('falha forçada preserva os dados do v10 (rollback completo, linha de settings intacta)', () => {
    const dbPath = dbIn('rollback');
    const old = openDatabase(dbPath, { migrations: upTo(10) });
    old.prepare("UPDATE settings SET theme = 'DARK'").run();
    const before = old.prepare('SELECT * FROM settings').get();
    old.close();
    const broken = [...upTo(10), { version: 11, name: 'inventory_view', up(db) { MIGRATIONS[10].up(db); throw new Error('boom'); } }];
    expect(() => openDatabase(dbPath, { migrations: broken })).toThrow();
    const again = openDatabase(dbPath, { migrations: upTo(10) });
    try {
      expect(again.pragma('user_version', { simple: true })).toBe(10);
      expect(again.prepare('SELECT * FROM settings').get()).toEqual(before);
    } finally {
      again.close();
    }
  });
});
