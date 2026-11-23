'use strict';

// Migração v9 (D253, D256): fim do saldo inicial. Reconstrói `store_balances` sem perder dado: os INITIAL viram registros antigos.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { openDatabase, runMigrations } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v9-')); });
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

// Banco v8: INITIAL por loja (um com valor 0 e nota), registros antigos e conferências com cálculo (ajuste +, − e nenhum).
function seedV8(dbPath) {
  const old = openDatabase(dbPath, { migrations: upTo(8) });
  const id = (name) => old.prepare('SELECT id FROM stores WHERE name = ?').get(name).id;
  const [csf, steam, money] = [id('CSFloat'), id('Steam'), id('CSMoney')];
  const ins = old.prepare(
    `INSERT INTO store_balances (store_id, kind, balance_cents, computed_cents, adjustment_cents, fx_rate, note, recorded_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  ins.run(csf, 'CHECK', 100, null, null, null, null, '2026-10-01T00:00:00.000Z', 'c1'); // registro antigo
  ins.run(csf, 'INITIAL', 0, null, null, null, 'início', '2026-10-05T00:00:00.000Z', 'c2'); // INITIAL com valor 0 e nota
  ins.run(csf, 'CHECK', 900, 1000, -100, null, 'taxa', '2026-11-01T00:00:00.000Z', 'c3'); // ajuste negativo
  ins.run(csf, 'CHECK', 1200, 1000, 200, null, 'bônus', '2026-11-02T00:00:00.000Z', 'c4'); // ajuste positivo
  ins.run(csf, 'CHECK', 1200, 1200, null, null, null, '2026-11-03T00:00:00.000Z', 'c5'); // com cálculo, sem ajuste
  ins.run(steam, 'INITIAL', 4590, null, null, 5.4321, null, '2026-11-05T00:00:00.000Z', 'c6');
  const extra = ins.run(money, 'CHECK', 1, null, null, null, null, '2026-09-01T00:00:00.000Z', 'c7').lastInsertRowid;
  old.prepare('DELETE FROM store_balances WHERE id = ?').run(extra); // contador à frente do MAX(id)
  const snapshot = {
    balances: old.prepare('SELECT * FROM store_balances ORDER BY id').all(),
    sequence: old.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'store_balances'").get(),
    others: Object.fromEntries(['items', 'deposits', 'withdrawals', 'stores', 'settings'].map((t) => [t, old.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()])),
  };
  old.close();
  return { snapshot, csf, steam, money };
}

describe('migração v9', () => {
  test('a v9 é remove_initial_balance e as migrações v1 a v8 continuam idênticas (hash)', () => {
    const last = MIGRATIONS.find((m) => m.version === 9);
    expect(last).toMatchObject({ version: 9, name: 'remove_initial_balance', disableForeignKeys: true });
    const dir = path.join(__dirname, '..', '..', 'src', 'config', 'migrations');
    const expected = {
      'v001_initial.js': '18514164a9ad3d10128e6b1c271ce7623d11835a9240fe9bf2f337bfced3eb1f',
      'v007_store_currency_flows.js': '33458e5a958452fff91811822cbef913fdcfad716e4185f4c9f7f17a38f76d76',
    };
    for (const [file, hash] of Object.entries(expected)) expect(sha(path.join(dir, file))).toBe(hash);
    // a v8 já está publicada no banco do usuário: o hash dela é fixado aqui
    expect(sha(path.join(dir, 'v008_computed_store_balance.js'))).toBe('6f95ee3c336310fc239742b88a7f6f8507dca7e810d49bcf28c66e17b30ad8c6');
    expect(fs.readFileSync(path.join(dir, 'v008_computed_store_balance.js'), 'utf8')).toContain("CHECK (kind IN ('INITIAL','CHECK'))");
  });

  test('banco v8 com dados: ids e dados iguais, INITIAL vira CHECK sem cálculo nem ajuste (nota fica), cálculo e ajuste intactos, backup criado', () => {
    const dbPath = dbIn('dados');
    const { snapshot } = seedV8(dbPath);
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(13);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      const rows = db.prepare('SELECT * FROM store_balances ORDER BY id').all();
      expect(rows).toHaveLength(snapshot.balances.length);
      rows.forEach((row, i) => {
        const old = snapshot.balances[i];
        expect(row.kind).toBe('CHECK');
        expect({ ...row, kind: old.kind }).toEqual(old.kind === 'INITIAL'
          ? { ...old, computed_cents: null, adjustment_cents: null }
          : old);
      });
      // nada é gravado como INITIAL e o índice parcial do saldo inicial deixou de existir
      expect(db.prepare("SELECT COUNT(*) AS n FROM store_balances WHERE kind = 'INITIAL'").get().n).toBe(0);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ux_store_balances_initial'").all()).toEqual([]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_store_balances_store_date'").all()).toHaveLength(1);
      expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'store_balances'").get().sql).toMatch(/STRICT/);
      for (const t of ['items', 'deposits', 'withdrawals', 'stores', 'settings']) {
        expect(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()).toEqual(t === 'settings' ? snapshot.others[t].map((r) => ({ ...r, inventory_view: 'GROUPED' })) : snapshot.others[t]); // v11: coluna nova com o padrão
      }
      expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'store_balances'").get()).toEqual(snapshot.sequence);
      const next = db.prepare("INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (1, 1, 'r', 'c')").run();
      expect(Number(next.lastInsertRowid)).toBe(snapshot.sequence.seq + 1); // não reutiliza o id excluído
      expect(backups(dbPath)).toHaveLength(1);
      expect(backups(dbPath)[0]).toMatch(/^inventory-v8-/);
    } finally {
      db.close();
    }
  });

  test('o banco passa a recusar kind = INITIAL, ajuste 0 e ajuste sem cálculo', () => {
    const db = openDatabase(dbIn('checks'), { now: NOW });
    try {
      const insert = (kind, computed = null, adjustment = null) => db.prepare(
        'INSERT INTO store_balances (store_id, kind, balance_cents, computed_cents, adjustment_cents, recorded_at, created_at) VALUES (1, ?, 1, ?, ?, ?, ?)'
      ).run(kind, computed, adjustment, 'r', 'c');
      expect(() => insert('INITIAL')).toThrow(/CHECK/);
      expect(() => insert('CHECK', 10, 0)).toThrow(/CHECK/);
      expect(() => insert('CHECK', null, -5)).toThrow(/CHECK/);
      expect(() => insert('CHECK', 10, -5)).not.toThrow();
      expect(db.prepare("INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (1, 1, 'r', 'c')").run().changes).toBe(1);
      expect(db.prepare('SELECT kind FROM store_balances ORDER BY id DESC LIMIT 1').get().kind).toBe('CHECK'); // padrão
    } finally {
      db.close();
    }
  });

  test('banco v7 -> v9 direto: mesmo resultado do v8 -> v9, sem nenhum INITIAL', () => {
    const dbPath = dbIn('v7');
    const old = openDatabase(dbPath, { migrations: upTo(7) });
    const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    const ins = old.prepare('INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, ?, ?, ?)');
    ins.run(csf, 1, '2026-11-01T00:00:00.000Z', 'a');
    ins.run(csf, 2, '2026-11-02T00:00:00.000Z', 'b');
    old.close();
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(13);
      expect(db.prepare('SELECT balance_cents AS b, kind, computed_cents AS c, adjustment_cents AS a FROM store_balances ORDER BY id').all())
        .toEqual([{ b: 1, kind: 'CHECK', c: null, a: null }, { b: 2, kind: 'CHECK', c: null, a: null }]);
    } finally {
      db.close();
    }
  });

  test('reabrir um banco v9 não migra de novo nem cria outro backup', () => {
    const dbPath = dbIn('reabrir');
    seedV8(dbPath);
    openDatabase(dbPath, { now: NOW }).close();
    const first = backups(dbPath).length;
    openDatabase(dbPath, { now: NOW }).close();
    expect(backups(dbPath).length).toBe(first);
  });
});

describe('migração v9: rollback', () => {
  test('falha depois de criar store_balances_new: v8 intacta (INITIAL e índice), user_version 8, sem _new, foreign_keys religado', () => {
    const dbPath = dbIn('rollback');
    const { snapshot } = seedV8(dbPath);
    const real = MIGRATIONS.find((m) => m.version === 9);
    const failing = { ...real, up(db) { real.up(db); throw new Error('falha injetada depois do DROP'); } };
    const db = new Database(dbPath);
    try {
      db.pragma('foreign_keys = ON');
      expect(() => runMigrations(db, [...upTo(8), failing], { dbPath, now: NOW })).toThrow('falha injetada depois do DROP');
      expect(db.pragma('user_version', { simple: true })).toBe(8);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.prepare('SELECT * FROM store_balances ORDER BY id').all()).toEqual(snapshot.balances);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ux_store_balances_initial'").all()).toHaveLength(1);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'store_balances_new'").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
