'use strict';

// QA da migração v10 (D264, D270): dados variados da v9, rollback em pontos extras, índice e colunas.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDatabase, runMigrations } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v10qa-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

const upTo9 = MIGRATIONS.filter((m) => m.version <= 9);
const real10 = MIGRATIONS.find((m) => m.version === 10);
const dbIn = (name) => path.join(tmpRoot, name, 'inventory.sqlite');
const NOW = new Date('2026-11-22T12:00:00.000Z');
const backups = (dbPath) => {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : [];
};

// v9 com itens variados: em estoque (com e sem trade lock), GANHEI, vendido com e sem retenção, e saldos/aportes/saques.
function seedV9(dbPath) {
  const old = openDatabase(dbPath, { migrations: upTo9 });
  const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const ins = old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, trade_unlock_at, status, created_at, updated_at)
     VALUES (?, 'CAIXA', ?, ?, ?, '2026-10-01T00:00:00.000Z', ?, 'EM_ESTOQUE', 'c', 'u')`
  );
  ins.run('Livre', 'COMPRA', csf, 500, null);
  ins.run('Bloqueado', 'COMPRA', csf, 700, '2026-12-01T00:00:00.000Z');
  ins.run('Ganhei', 'GANHEI', null, 0, null);
  const sold = old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, status, sale_store_id, sale_price_cents,
       sale_currency, net_received_cents, sold_at, sale_fee_type_applied, sale_fee_rate_applied, sale_fee_rounding_applied, sale_fixed_fee_cents_applied,
       sale_hold_days_applied, created_at, updated_at)
     VALUES (?, 'CAIXA', 'COMPRA', ?, 100, '2026-10-01T00:00:00.000Z', 'VENDIDO', ?, 1000, 'USD', 980, '2026-11-15T12:00:00.000Z', 'DEDUCTED', 0.02, 'CEIL', 0, ?, 'c', 'u')`
  );
  sold.run('Vendido7', csf, csf, 7);
  sold.run('VendidoAntigo', csf, csf, null); // venda anterior à v6 (retenção nula)
  old.prepare("INSERT INTO deposits (amount_brl_cents, amount_store_cents, deposited_at, store_id, created_at, updated_at) VALUES (1000, 200, '2026-11-12T12:00:00.000Z', ?, 'c', 'u')").run(csf);
  old.prepare("INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, 100, '2026-11-01T00:00:00.000Z', 'c')").run(csf);
  const tables = ['items', 'deposits', 'withdrawals', 'stores', 'settings', 'store_balances'];
  const snapshot = {
    ...Object.fromEntries(tables.map((t) => [t, old.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()])),
    seq: old.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name").all(),
    columns: old.prepare("SELECT name FROM pragma_table_info('items')").all().map((c) => c.name),
  };
  old.close();
  return snapshot;
}

describe('migração v10 com dados variados da v9', () => {
  test('cada linha de items mantém todas as colunas antigas; as duas novas ficam nulas; as outras tabelas e o contador iguais', () => {
    const dbPath = dbIn('variado');
    const snap = seedV9(dbPath);
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(10);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      const rows = db.prepare('SELECT * FROM items ORDER BY id').all();
      expect(rows).toHaveLength(snap.items.length);
      rows.forEach((row, i) => {
        const { off_sale_at: off, for_sale_since: back, ...rest } = row;
        expect(rest).toEqual(snap.items[i]);
        expect([off, back]).toEqual([null, null]);
      });
      const cols = db.prepare("SELECT name FROM pragma_table_info('items')").all().map((c) => c.name);
      expect(cols).toEqual([...snap.columns, 'off_sale_at', 'for_sale_since']);
      for (const t of ['deposits', 'withdrawals', 'stores', 'settings', 'store_balances']) {
        expect(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()).toEqual(snap[t]);
      }
      expect(db.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all()).toEqual(snap.seq);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_items_off_sale_at'").all()).toHaveLength(1);
      expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_items_off_sale_at'").get().sql).toMatch(/items\s*\(\s*off_sale_at\s*\)/);
      expect(backups(dbPath)).toHaveLength(1);
      expect(path.basename(backups(dbPath)[0])).toMatch(/^inventory-v9-/);
    } finally {
      db.close();
    }
  });

  test('as colunas novas aceitam texto e nulo; o esquema antigo (CHECKs, FKs) segue valendo', () => {
    const dbPath = dbIn('colunas');
    seedV9(dbPath);
    const db = openDatabase(dbPath, { now: NOW });
    try {
      const id = db.prepare("SELECT id FROM items WHERE name = 'Livre'").get().id;
      db.prepare('UPDATE items SET off_sale_at = ?, for_sale_since = ? WHERE id = ?').run('2026-11-20T00:00:00.000Z', '2026-11-21T00:00:00.000Z', id);
      expect(db.prepare('SELECT off_sale_at, for_sale_since FROM items WHERE id = ?').get(id)).toEqual({
        off_sale_at: '2026-11-20T00:00:00.000Z', for_sale_since: '2026-11-21T00:00:00.000Z',
      });
      db.prepare('UPDATE items SET off_sale_at = NULL WHERE id = ?').run(id);
      expect(db.prepare('SELECT off_sale_at FROM items WHERE id = ?').get(id).off_sale_at).toBeNull();
      expect(() => db.prepare("UPDATE items SET status = 'XPTO' WHERE id = ?").run(id)).toThrow(/CHECK/);
      expect(() => db.prepare('DELETE FROM stores WHERE id = (SELECT purchase_store_id FROM items WHERE id = ?)').run(id)).toThrow(/FOREIGN KEY/);
    } finally {
      db.close();
    }
  });

  test('banco v7 chega à v10 direto com o mesmo resultado (colunas nulas)', () => {
    const dbPath = dbIn('v7');
    const old = openDatabase(dbPath, { migrations: MIGRATIONS.filter((m) => m.version <= 7) });
    const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    old.prepare(
      `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, status, created_at, updated_at)
       VALUES ('A', 'CAIXA', 'COMPRA', ?, 1, '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`
    ).run(csf);
    old.close();
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(10);
      expect(db.prepare('SELECT off_sale_at, for_sale_since FROM items').all()).toEqual([{ off_sale_at: null, for_sale_since: null }]);
    } finally {
      db.close();
    }
  });
});

describe('migração v10: rollback em pontos extras', () => {
  function failingAt(trap) {
    return {
      ...real10,
      up(db) {
        const spy = new Proxy(db, {
          get(target, prop) {
            if (prop === 'exec') return (sql) => { trap(sql); return target.exec(sql); };
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        real10.up(spy);
      },
    };
  }

  function expectStillV9(dbPath, snap) {
    const db = new Database(dbPath);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(9);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      const cols = db.prepare("SELECT name FROM pragma_table_info('items')").all().map((c) => c.name);
      expect(cols).toEqual(snap.columns);
      expect(db.prepare('SELECT * FROM items ORDER BY id').all()).toEqual(snap.items);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_items_off_sale_at'").all()).toEqual([]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  }

  test('falha depois de todo o script (colunas e índice criados): tudo é desfeito, inclusive o índice', () => {
    const dbPath = dbIn('rb-after');
    const snap = seedV9(dbPath);
    const failing = { ...real10, up(db) { real10.up(db); throw new Error('falha depois do índice'); } };
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    try {
      expect(() => runMigrations(db, [...upTo9, failing], { dbPath, now: NOW })).toThrow('falha depois do índice');
    } finally {
      db.close();
    }
    expectStillV9(dbPath, snap);
  });

  test('falha logo no início: v9 intacta, backup feito; depois a migração real conclui sem perda', () => {
    const dbPath = dbIn('rb-start');
    const snap = seedV9(dbPath);
    const failing = failingAt(() => { throw new Error('falha no início'); });
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    try {
      expect(() => runMigrations(db, [...upTo9, failing], { dbPath, now: NOW })).toThrow('falha no início');
    } finally {
      db.close();
    }
    expectStillV9(dbPath, snap);
    expect(backups(dbPath)).toHaveLength(1);
    const again = openDatabase(dbPath, { now: new Date('2026-11-22T12:00:01.000Z') });
    try {
      expect(again.pragma('user_version', { simple: true })).toBe(10);
      expect(again.prepare('SELECT COUNT(*) AS n FROM items WHERE off_sale_at IS NULL AND for_sale_since IS NULL').get().n).toBe(snap.items.length);
    } finally {
      again.close();
    }
  });
});
