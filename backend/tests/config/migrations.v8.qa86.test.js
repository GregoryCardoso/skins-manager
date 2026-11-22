'use strict';

// QA da migração v8 (D240, D250): dados antigos variados, rollback em pontos diferentes e idempotência.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDatabase, runMigrations } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v8qa-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

const upTo7 = MIGRATIONS.filter((m) => m.version <= 7);
const upTo8 = MIGRATIONS.filter((m) => m.version <= 8); // estes testes verificam a v8; a v9 tem os seus (v9.test.js)
const real8 = MIGRATIONS.find((m) => m.version === 8);
const dbIn = (name) => path.join(tmpRoot, name, 'inventory.sqlite');
const NOW = new Date('2026-11-22T12:00:00.000Z');
const backups = (dbPath) => {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : [];
};

// v7 com movimentações variadas (itens em estoque, vendidos e GANHEI; aportes e saques) e saldos das lojas.
function seedVaried(dbPath) {
  const old = openDatabase(dbPath, { migrations: upTo7 });
  const id = (name) => old.prepare('SELECT id FROM stores WHERE name = ?').get(name).id;
  const [csf, steam, money] = [id('CSFloat'), id('Steam'), id('CSMoney')];
  old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, acquired_at, status, created_at, updated_at)
     VALUES ('Compra', 'CAIXA', 'COMPRA', ?, 1500, 'USD', '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`
  ).run(csf);
  old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, acquired_at, status, sale_store_id, sale_price_cents,
       sale_currency, net_received_cents, sold_at, sale_fee_type_applied, sale_fee_rate_applied, sale_fee_rounding_applied,
       sale_fixed_fee_cents_applied, sale_hold_days_applied, created_at, updated_at)
     VALUES ('Ganhei', 'CAIXA', 'GANHEI', ?, '2026-10-01T00:00:00.000Z', 'VENDIDO', ?, 1000, 'USD', 980,
       '2026-11-15T12:00:00.000Z', 'DEDUCTED', 0.02, 'CEIL', 0, 7, 'c', 'u')`
  ).run(csf, csf);
  old.prepare("INSERT INTO deposits (amount_brl_cents, amount_store_cents, deposited_at, store_id, created_at, updated_at) VALUES (30000, 5000, '2026-10-05T12:00:00.000Z', ?, 'c', 'u')").run(csf);
  old.prepare("INSERT INTO withdrawals (store_id, amount_store_cents, fee_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, 1000, 25, 5000, '2026-11-10T12:00:00.000Z', 'c', 'u')").run(csf);
  const ins = old.prepare('INSERT INTO store_balances (store_id, balance_cents, fx_rate, recorded_at, created_at) VALUES (?, ?, ?, ?, ?)');
  // CSFloat: o id mais alto NÃO é o mais recente (importado fora de ordem); vale a data, não o id
  ins.run(csf, 111, null, '2026-11-20T12:00:00.000Z', 'a'); // id 1: o mais recente
  ins.run(csf, 222, null, '2026-11-01T12:00:00.000Z', 'b'); // id 2
  ins.run(csf, 333, null, '2026-11-01T12:00:00.000Z', 'c'); // id 3 (empate com o 2)
  ins.run(steam, 0, 5.5, '2026-11-02T12:00:00.000Z', 'd'); // saldo 0 também vira INITIAL
  const tables = ['items', 'deposits', 'withdrawals', 'stores', 'settings', 'store_balances'];
  const snapshot = Object.fromEntries(tables.map((t) => [t, old.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()]));
  old.close();
  return { snapshot, csf, steam, money };
}

describe('migração v8 com dados antigos variados', () => {
  test('o mais recente por DATA vira INITIAL (não o de maior id); saldo 0 também; demais tabelas intactas', () => {
    const dbPath = dbIn('variado');
    const { snapshot, csf, steam } = seedVaried(dbPath);
    const db = openDatabase(dbPath, { migrations: upTo8, now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(8);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      for (const t of ['items', 'deposits', 'withdrawals', 'stores', 'settings']) {
        expect(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()).toEqual(snapshot[t]);
      }
      const rows = db.prepare('SELECT id, store_id, kind, balance_cents, fx_rate, computed_cents, adjustment_cents, note FROM store_balances ORDER BY id').all();
      expect(rows.map((r) => [r.id, r.store_id, r.kind, r.balance_cents, r.fx_rate])).toEqual([
        [1, csf, 'INITIAL', 111, null],
        [2, csf, 'CHECK', 222, null],
        [3, csf, 'CHECK', 333, null],
        [4, steam, 'INITIAL', 0, 5.5],
      ]);
      expect(rows.every((r) => r.computed_cents === null && r.adjustment_cents === null && r.note === null)).toBe(true);
      // os campos preservados são exatamente os antigos
      for (const old of snapshot.store_balances) {
        const now = db.prepare('SELECT recorded_at, created_at FROM store_balances WHERE id = ?').get(old.id);
        expect(now).toEqual({ recorded_at: old.recorded_at, created_at: old.created_at });
      }
      // índices recriados
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'store_balances'").all().map((r) => r.name);
      expect(indexes).toEqual(expect.arrayContaining(['idx_store_balances_store_date', 'ux_store_balances_initial']));
      // o próximo id continua depois do maior (AUTOINCREMENT preservado)
      const next = db.prepare("INSERT INTO store_balances (store_id, kind, balance_cents, recorded_at, created_at) VALUES (?, 'CHECK', 1, 'r', 'c')").run(csf);
      expect(Number(next.lastInsertRowid)).toBe(5);
    } finally {
      db.close();
    }
  });

  test('a tabela nova é STRICT e a coluna `note` e `kind` existem; colunas antigas na mesma ordem relativa', () => {
    const dbPath = dbIn('colunas');
    seedVaried(dbPath);
    const db = openDatabase(dbPath, { migrations: upTo8, now: NOW });
    try {
      const cols = db.prepare("SELECT name FROM pragma_table_info('store_balances')").all().map((c) => c.name);
      expect(cols).toEqual(expect.arrayContaining(['id', 'store_id', 'kind', 'balance_cents', 'computed_cents', 'adjustment_cents', 'fx_rate', 'note', 'recorded_at', 'created_at']));
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'store_balances'").get().sql;
      expect(sql).toMatch(/STRICT/);
      expect(() => db.prepare("INSERT INTO store_balances (store_id, kind, balance_cents, recorded_at, created_at) VALUES (1, 'CHECK', 'abc', 'r', 'c')").run()).toThrow();
    } finally {
      db.close();
    }
  });

  test('o backup automático (v7) guarda o banco anterior e abre como v7 com as mesmas linhas', () => {
    const dbPath = dbIn('backup-v7');
    const { snapshot } = seedVaried(dbPath);
    openDatabase(dbPath, { migrations: upTo8, now: NOW }).close();
    const files = backups(dbPath);
    expect(files).toHaveLength(1);
    const copy = new Database(files[0], { readonly: true });
    try {
      expect(copy.pragma('user_version', { simple: true })).toBe(7);
      expect(copy.prepare('SELECT * FROM store_balances ORDER BY id').all()).toEqual(snapshot.store_balances);
    } finally {
      copy.close();
    }
  });

  test('loja sem nenhum saldo (CSMoney) e a conferência posterior ao saldo migrado funcionam: um INITIAL por loja com registro', () => {
    const dbPath = dbIn('um-por-loja');
    const { money } = seedVaried(dbPath);
    const db = openDatabase(dbPath, { migrations: upTo8, now: NOW });
    try {
      const perStore = db.prepare("SELECT store_id, COUNT(*) AS n FROM store_balances WHERE kind = 'INITIAL' GROUP BY store_id").all();
      expect(perStore.every((r) => r.n === 1)).toBe(true);
      expect(perStore.find((r) => r.store_id === money)).toBeUndefined();
      expect(() => db.prepare("INSERT INTO store_balances (store_id, kind, balance_cents, recorded_at, created_at) VALUES (?, 'INITIAL', 1, 'r', 'c')").run(money)).not.toThrow();
    } finally {
      db.close();
    }
  });
});

describe('migração v8: rollback em pontos diferentes', () => {
  // Executa `real8.up` com um banco "espião": `trap(sql)` pode lançar quando um prepare/exec com esse SQL acontece.
  function failingAt(trap) {
    return {
      ...real8,
      up(db) {
        const spy = new Proxy(db, {
          get(target, prop) {
            if (prop === 'prepare') return (sql) => { trap(sql); return target.prepare(sql); };
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        real8.up(spy);
      },
    };
  }

  function expectRolledBack(dbPath, snapshot) {
    const db = new Database(dbPath);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(7);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.prepare('SELECT * FROM store_balances ORDER BY id').all()).toEqual(snapshot.store_balances);
      const cols = db.prepare("SELECT name FROM pragma_table_info('store_balances')").all().map((c) => c.name);
      expect(cols).not.toContain('kind');
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'store_balances_new%' OR name = 'ux_store_balances_initial'").all()).toEqual([]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_store_balances_store_date'").all()).toHaveLength(1);
      for (const t of ['items', 'deposits', 'withdrawals', 'stores', 'settings']) {
        expect(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()).toEqual(snapshot[t]);
      }
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  }

  test('falha no restauro do contador AUTOINCREMENT (depois do DROP, do RENAME e dos índices): volta tudo para a v7', () => {
    const dbPath = dbIn('rb-seq');
    const { snapshot } = seedVaried(dbPath);
    const failing = failingAt((sql) => { if (/UPDATE sqlite_sequence|INSERT INTO sqlite_sequence/.test(sql)) throw new Error('falha no contador'); });
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    try {
      expect(() => runMigrations(db, [...upTo7, failing], { dbPath, now: NOW })).toThrow('falha no contador');
    } finally {
      db.close();
    }
    expectRolledBack(dbPath, snapshot);
  });

  test('falha logo no início (antes de qualquer mudança): v7 intacta e o backup da v7 foi feito', () => {
    const dbPath = dbIn('rb-start');
    const { snapshot } = seedVaried(dbPath);
    const failing = { ...real8, up() { throw new Error('falha no início'); } };
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    try {
      expect(() => runMigrations(db, [...upTo7, failing], { dbPath, now: NOW })).toThrow('falha no início');
    } finally {
      db.close();
    }
    expectRolledBack(dbPath, snapshot);
    expect(backups(dbPath)).toHaveLength(1);
  });

  test('depois de uma falha, tentar de novo com a migração real conclui a v8 sem perder nada', () => {
    const dbPath = dbIn('rb-retry');
    const { snapshot } = seedVaried(dbPath);
    const failing = failingAt((sql) => { if (/sqlite_sequence/.test(sql)) throw new Error('falha única'); });
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    try {
      expect(() => runMigrations(db, [...upTo7, failing], { dbPath, now: NOW })).toThrow('falha única');
    } finally {
      db.close();
    }
    const again = openDatabase(dbPath, { migrations: upTo8, now: new Date('2026-11-22T12:00:01.000Z') });
    try {
      expect(again.pragma('user_version', { simple: true })).toBe(8);
      expect(again.prepare('SELECT COUNT(*) AS n FROM store_balances').get().n).toBe(snapshot.store_balances.length);
      expect(again.prepare("SELECT COUNT(*) AS n FROM store_balances WHERE kind = 'INITIAL'").get().n).toBe(2);
    } finally {
      again.close();
    }
  });
});
