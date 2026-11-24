'use strict';

// QA da migração v9 (D253, D256): dados variados vindos da v8, contador, rollback em pontos extras e efeito no cálculo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDatabase, runMigrations } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v9qa-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

const upTo8 = MIGRATIONS.filter((m) => m.version <= 8);
const real9 = MIGRATIONS.find((m) => m.version === 9);
const dbIn = (name) => path.join(tmpRoot, name, 'inventory.sqlite');
const NOW = new Date('2026-11-22T12:00:00.000Z');
const backups = (dbPath) => {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : [];
};

// v8 com um INITIAL por loja (um com nota e valor 0), conferências com cálculo (ajuste +, − e nenhum) e movimentações.
function seedV8(dbPath) {
  const old = openDatabase(dbPath, { migrations: upTo8 });
  const id = (name) => old.prepare('SELECT id FROM stores WHERE name = ?').get(name).id;
  const [csf, steam, money] = [id('CSFloat'), id('Steam'), id('CSMoney')];
  old.prepare("INSERT INTO deposits (amount_brl_cents, amount_store_cents, deposited_at, store_id, created_at, updated_at) VALUES (30000, 5000, '2026-11-12T12:00:00.000Z', ?, 'c', 'u')").run(csf);
  old.prepare("INSERT INTO withdrawals (store_id, amount_store_cents, fee_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, 1000, 25, 5000, '2026-11-14T12:00:00.000Z', 'c', 'u')").run(csf);
  const ins = old.prepare(
    'INSERT INTO store_balances (store_id, kind, balance_cents, computed_cents, adjustment_cents, fx_rate, note, recorded_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  ins.run(csf, 'CHECK', 100, null, null, null, null, '2026-10-01T00:00:00.000Z', 'a'); // registro antigo (migrado da v7)
  ins.run(csf, 'INITIAL', 10000, null, null, null, 'início', '2026-11-10T12:00:00.000Z', 'b');
  ins.run(csf, 'CHECK', 7900, 8000, -100, null, 'taxa', '2026-11-16T12:00:00.000Z', 'c'); // ajuste negativo
  ins.run(csf, 'CHECK', 8300, 8000, 300, null, 'bônus', '2026-11-17T12:00:00.000Z', 'd'); // ajuste positivo
  ins.run(csf, 'CHECK', 8300, 8300, null, null, null, '2026-11-18T12:00:00.000Z', 'e'); // com cálculo, sem ajuste
  ins.run(steam, 'INITIAL', 0, null, null, 5.4321, 'zero', '2026-11-05T00:00:00.000Z', 'f'); // valor 0 com nota
  ins.run(money, 'CHECK', 50, -20, 70, null, 'x', '2026-11-06T00:00:00.000Z', 'g'); // calculado negativo
  const extra = ins.run(money, 'CHECK', 1, null, null, null, null, '2026-09-01T00:00:00.000Z', 'h').lastInsertRowid;
  old.prepare('DELETE FROM store_balances WHERE id = ?').run(extra); // maior id excluído: o contador fica à frente
  const snapshot = {
    balances: old.prepare('SELECT * FROM store_balances ORDER BY id').all(),
    sequence: old.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'store_balances'").get(),
    others: Object.fromEntries(['items', 'deposits', 'withdrawals', 'stores', 'settings'].map((t) => [t, old.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()])),
  };
  old.close();
  return { snapshot, csf, steam, money };
}

describe('migração v9 com dados variados da v8', () => {
  test('cada linha mantém id e dados; só o kind INITIAL muda; cálculo e ajuste das conferências ficam; outras tabelas iguais', () => {
    const dbPath = dbIn('variado');
    const { snapshot } = seedV8(dbPath);
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(19);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      const rows = db.prepare('SELECT * FROM store_balances ORDER BY id').all();
      expect(rows).toHaveLength(snapshot.balances.length);
      rows.forEach((row, i) => {
        const old = snapshot.balances[i];
        expect(row.kind).toBe('CHECK');
        expect({ ...row, kind: old.kind }).toEqual(old === undefined ? row : {
          ...old, computed_cents: row.computed_cents, adjustment_cents: row.adjustment_cents,
        });
        if (old.kind === 'INITIAL') {
          expect([row.computed_cents, row.adjustment_cents]).toEqual([null, null]);
          expect(row.note).toBe(old.note); // a nota do saldo inicial fica
        } else {
          expect([row.computed_cents, row.adjustment_cents]).toEqual([old.computed_cents, old.adjustment_cents]);
        }
      });
      for (const t of ['items', 'deposits', 'withdrawals', 'stores', 'settings']) {
        expect(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all().map((r) => (t === 'deposits' ? (({ fee_cents: feeCents, ...rest }) => rest)(r) : r))).toEqual(t === 'settings' ? snapshot.others[t].map((r) => ({ ...r, inventory_view: 'GROUPED' })) : snapshot.others[t]); // v11: coluna nova com o padrão
      }
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ux_store_balances_initial'").all()).toEqual([]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_store_balances_store_date'").all()).toHaveLength(1);
      expect(backups(dbPath)).toHaveLength(1);
      expect(path.basename(backups(dbPath)[0])).toMatch(/^inventory-v8-/);
    } finally {
      db.close();
    }
  });

  test('o contador AUTOINCREMENT é mantido: o novo id não reutiliza o de uma linha excluída', () => {
    const dbPath = dbIn('contador');
    const { snapshot, csf } = seedV8(dbPath);
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'store_balances'").get()).toEqual(snapshot.sequence);
      const maxId = Math.max(...snapshot.balances.map((b) => b.id));
      expect(snapshot.sequence.seq).toBeGreaterThan(maxId);
      const next = db.prepare("INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, 1, 'r', 'c')").run(csf);
      expect(Number(next.lastInsertRowid)).toBe(snapshot.sequence.seq + 1);
    } finally {
      db.close();
    }
  });

  test('o kind assume o padrão CHECK quando omitido; INITIAL e outros valores são recusados; a tabela segue STRICT', () => {
    const dbPath = dbIn('padrao');
    const { csf } = seedV8(dbPath);
    const db = openDatabase(dbPath, { now: NOW });
    try {
      db.prepare("INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, 1, 'r', 'c')").run(csf);
      expect(db.prepare("SELECT kind FROM store_balances ORDER BY id DESC LIMIT 1").get().kind).toBe('CHECK');
      for (const kind of ['INITIAL', 'initial', 'OTHER', '']) {
        expect(() => db.prepare("INSERT INTO store_balances (store_id, kind, balance_cents, recorded_at, created_at) VALUES (?, ?, 1, 'r', 'c')").run(csf, kind)).toThrow(/CHECK/);
      }
      expect(() => db.prepare("INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, 'abc', 'r', 'c')").run(csf)).toThrow();
      expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'store_balances'").get().sql).toMatch(/STRICT/);
      // vários registros por loja são permitidos (não há mais índice único)
      expect(() => db.prepare("INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, 2, 'r2', 'c')").run(csf)).not.toThrow();
      expect(() => db.prepare('DELETE FROM stores WHERE id = ?').run(csf)).toThrow(/FOREIGN KEY/);
    } finally {
      db.close();
    }
  });

  test('banco novo chega à v9 com a tabela vazia e sem índice de saldo inicial', () => {
    const db = openDatabase(dbIn('novo'), { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(19);
      expect(db.prepare('SELECT COUNT(*) AS n FROM store_balances').get().n).toBe(0);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ux_store_balances_initial'").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('migração v9: rollback em pontos extras', () => {
  function failingAt(trap) {
    return {
      ...real9,
      up(db) {
        const spy = new Proxy(db, {
          get(target, prop) {
            if (prop === 'prepare') return (sql) => { trap(sql); return target.prepare(sql); };
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        real9.up(spy);
      },
    };
  }

  function expectStillV8(dbPath, snapshot) {
    const db = new Database(dbPath);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(8);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.prepare('SELECT * FROM store_balances ORDER BY id').all()).toEqual(snapshot.balances);
      expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'store_balances'").get()).toEqual(snapshot.sequence);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'store_balances_new%'").all()).toEqual([]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ux_store_balances_initial'").all()).toHaveLength(1);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_store_balances_store_date'").all()).toHaveLength(1);
      expect(() => db.prepare("INSERT INTO store_balances (store_id, kind, balance_cents, recorded_at, created_at) VALUES (1, 'INITIAL', 1, 'r', 'c')").run()).toThrow(/UNIQUE/);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  }

  test('falha ao restaurar o contador (depois de DROP, RENAME e índice): volta para a v8 com os INITIAL e o índice', () => {
    const dbPath = dbIn('rb-seq');
    const { snapshot } = seedV8(dbPath);
    const failing = failingAt((sql) => { if (/sqlite_sequence/.test(sql) && /UPDATE|INSERT/.test(sql)) throw new Error('falha no contador'); });
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    try {
      expect(() => runMigrations(db, [...upTo8, failing], { dbPath, now: NOW })).toThrow('falha no contador');
    } finally {
      db.close();
    }
    expectStillV8(dbPath, snapshot);
  });

  test('falha logo no início: v8 intacta e backup da v8 feito; depois, a migração real conclui sem perdas', () => {
    const dbPath = dbIn('rb-start');
    const { snapshot } = seedV8(dbPath);
    const failing = { ...real9, up() { throw new Error('falha no início'); } };
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    try {
      expect(() => runMigrations(db, [...upTo8, failing], { dbPath, now: NOW })).toThrow('falha no início');
    } finally {
      db.close();
    }
    expectStillV8(dbPath, snapshot);
    expect(backups(dbPath)).toHaveLength(1);
    const again = openDatabase(dbPath, { now: new Date('2026-11-22T12:00:01.000Z') });
    try {
      expect(again.pragma('user_version', { simple: true })).toBe(19);
      expect(again.prepare('SELECT COUNT(*) AS n FROM store_balances').get().n).toBe(snapshot.balances.length);
      expect(again.prepare("SELECT COUNT(*) AS n FROM store_balances WHERE kind <> 'CHECK'").get().n).toBe(0);
    } finally {
      again.close();
    }
  });
});
