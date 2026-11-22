'use strict';

// Migração v8 (D240): saldo das lojas calculado. Reconstrói `store_balances` (kind, computed_cents, adjustment_cents, note)
// sem perder dado: o registro mais recente de cada loja vira o saldo inicial e os demais viram conferências antigas.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { openDatabase, runMigrations } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v8-'));
});
afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o arquivo por instantes; a pasta é temporária.
  }
});

const upTo7 = MIGRATIONS.filter((m) => m.version <= 7);
const upTo8 = MIGRATIONS.filter((m) => m.version <= 8); // estes testes verificam a v8; a v9 tem os seus (v9.test.js)
const dbIn = (name) => path.join(tmpRoot, name, 'inventory.sqlite');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const backups = (dbPath) => {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};
const NOW = new Date('2026-11-22T12:00:00.000Z');

// Banco v7 com três lojas: CSFloat com 3 registros (dois empatados em recorded_at), Steam com 1 e CSMoney sem nenhum.
function seedV7(dbPath) {
  const old = openDatabase(dbPath, { migrations: upTo7 });
  const id = (name) => old.prepare('SELECT id FROM stores WHERE name = ?').get(name).id;
  const csf = id('CSFloat');
  const steam = id('Steam');
  const ins = old.prepare('INSERT INTO store_balances (store_id, balance_cents, fx_rate, recorded_at, created_at) VALUES (?, ?, ?, ?, ?)');
  ins.run(csf, 1000, null, '2026-11-01T12:00:00.000Z', 'c1');
  ins.run(csf, 2000, null, '2026-11-10T12:00:00.000Z', 'c2');
  ins.run(csf, 3000, null, '2026-11-10T12:00:00.000Z', 'c3'); // empate de recorded_at: vale o maior id
  ins.run(steam, 4590, 5.4321, '2026-11-05T12:00:00.000Z', 'c4');
  const extra = ins.run(steam, 1, null, '2026-10-01T00:00:00.000Z', 'c5').lastInsertRowid;
  old.prepare('DELETE FROM store_balances WHERE id = ?').run(extra); // contador AUTOINCREMENT à frente do MAX(id)
  const snapshot = {
    balances: old.prepare('SELECT * FROM store_balances ORDER BY id').all(),
    sequence: old.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'store_balances'").get(),
    tables: Object.fromEntries(['items', 'deposits', 'withdrawals', 'stores', 'settings'].map((t) => [t, old.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()])),
  };
  const csmoney = id('CSMoney');
  old.close();
  return { snapshot, csf, steam, csmoney };
}

describe('migração v8', () => {
  test('a v8 é computed_store_balance e as migrações v1 a v7 continuam idênticas (hash)', () => {
    const last = MIGRATIONS.find((m) => m.version === 8);
    expect(last.version).toBe(8);
    expect(last.name).toBe('computed_store_balance');
    expect(last.disableForeignKeys).toBe(true);
    const dir = path.join(__dirname, '..', '..', 'src', 'config', 'migrations');
    const expected = {
      'v001_initial.js': '18514164a9ad3d10128e6b1c271ce7623d11835a9240fe9bf2f337bfced3eb1f',
      'v002_catalog.js': '9e0718ac8ad78ee5e48a4bd41f591e3835ed3b1c653e95e6362f6041b56ba22f',
      'v003_manual_net.js': 'a6a480628b4cfbd4acaaab82cd091ca2d865d3c09821104cee243ab011631620',
      'v004_stores_settings.js': 'd8dc15e343e815b01956323e05448684bc948d2c82e17d482187f1bf0febef47',
      'v005_fx_sources.js': '6892beb82a64b3975a3b169316f30bb2e989a2a7dcb8867108d2ed2f0d572c27',
      'v006_withdrawal_fee_sale_hold.js': '5ed05352931346dc6dad349701fd42dd1dd0dcd30a325798098428cc12216e24',
      'v007_store_currency_flows.js': '33458e5a958452fff91811822cbef913fdcfad716e4185f4c9f7f17a38f76d76',
    };
    for (const [file, hash] of Object.entries(expected)) expect(sha(path.join(dir, file))).toBe(hash);
  });

  test('banco v7 com dados: linhas preservadas (ids, valores, fx_rate, datas), mais recente de cada loja vira INITIAL, backup criado', () => {
    const dbPath = dbIn('dados');
    const { snapshot, csf, steam, csmoney } = seedV7(dbPath);
    const db = openDatabase(dbPath, { migrations: upTo8, now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(8);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      const rows = db.prepare('SELECT * FROM store_balances ORDER BY id').all();
      expect(rows).toHaveLength(snapshot.balances.length);
      rows.forEach((row, i) => {
        const old = snapshot.balances[i];
        const { kind, computed_cents: computed, adjustment_cents: adjustment, note, ...rest } = row;
        expect(rest).toEqual(old); // ids, store_id, balance_cents, fx_rate, recorded_at e created_at iguais
        expect([computed, adjustment, note]).toEqual([null, null, null]);
        expect(['INITIAL', 'CHECK']).toContain(kind);
      });
      const kindOf = (id) => rows.find((r) => r.id === id).kind;
      const [c1, c2, c3, c4] = snapshot.balances.map((b) => b.id);
      expect([kindOf(c1), kindOf(c2), kindOf(c3)]).toEqual(['CHECK', 'CHECK', 'INITIAL']); // empate: o maior id
      expect(kindOf(c4)).toBe('INITIAL');
      expect(rows.filter((r) => r.store_id === csmoney)).toEqual([]); // CSMoney sem registro, sem INITIAL
      expect(rows.filter((r) => r.kind === 'INITIAL').map((r) => r.store_id).sort()).toEqual([csf, steam].sort());
      // contador AUTOINCREMENT preservado e as outras tabelas intactas
      expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'store_balances'").get()).toEqual(snapshot.sequence);
      for (const t of ['items', 'deposits', 'withdrawals', 'stores', 'settings']) {
        expect(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()).toEqual(snapshot.tables[t]);
      }
      expect(backups(dbPath)).toHaveLength(1);
      expect(backups(dbPath)[0]).toMatch(/^inventory-v7-/);
    } finally {
      db.close();
    }
  });

  test('reabrir um banco v8 não migra de novo nem cria outro backup', () => {
    const dbPath = dbIn('reabrir');
    seedV7(dbPath);
    openDatabase(dbPath, { migrations: upTo8, now: NOW }).close();
    const first = backups(dbPath).length;
    const db = openDatabase(dbPath, { migrations: upTo8, now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(8);
      expect(backups(dbPath).length).toBe(first);
      expect(db.prepare("SELECT COUNT(*) AS n FROM store_balances WHERE kind = 'INITIAL'").get().n).toBe(2);
    } finally {
      db.close();
    }
  });

  test('banco novo (sem registros) chega à v8 com a tabela vazia', () => {
    const db = openDatabase(dbIn('novo'), { migrations: upTo8, now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(8);
      expect(db.prepare('SELECT COUNT(*) AS n FROM store_balances').get().n).toBe(0);
    } finally {
      db.close();
    }
  });

  describe('CHECKs e índice único do esquema novo', () => {
    let db;
    let csf;
    beforeAll(() => {
      db = openDatabase(dbIn('checks'), { migrations: upTo8, now: NOW });
      csf = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    });
    afterAll(() => db.close());
    const insert = (kind, { computed = null, adjustment = null, storeId = csf } = {}) =>
      db.prepare(
        `INSERT INTO store_balances (store_id, kind, balance_cents, computed_cents, adjustment_cents, recorded_at, created_at)
         VALUES (?, ?, 100, ?, ?, 'r', 'c')`
      ).run(storeId, kind, computed, adjustment);

    test('um INITIAL por loja: o segundo é recusado, mesmo com data diferente', () => {
      insert('INITIAL');
      expect(() => insert('INITIAL')).toThrow(/UNIQUE/);
      const steam = db.prepare("SELECT id FROM stores WHERE name = 'Steam'").get().id;
      expect(() => insert('INITIAL', { storeId: steam })).not.toThrow();
    });

    test('INITIAL com computed_cents ou adjustment_cents é recusado', () => {
      const money = db.prepare("SELECT id FROM stores WHERE name = 'CSMoney'").get().id;
      expect(() => insert('INITIAL', { computed: 5, storeId: money })).toThrow(/CHECK/);
      expect(() => insert('INITIAL', { computed: 5, adjustment: -1, storeId: money })).toThrow(/CHECK/);
    });

    test('adjustment_cents = 0 e ajuste sem computed_cents são recusados; ajuste negativo com calculado vale', () => {
      expect(() => insert('CHECK', { computed: 100, adjustment: 0 })).toThrow(/CHECK/);
      expect(() => insert('CHECK', { adjustment: -5 })).toThrow(/CHECK/);
      expect(() => insert('CHECK', { computed: -50, adjustment: 150 })).not.toThrow();
      expect(() => insert('CHECK', { computed: 100 })).not.toThrow();
    });

    test('kind inválido e saldo negativo recusados', () => {
      expect(() => insert('OUTRO')).toThrow(/CHECK/);
      expect(() => db.prepare("INSERT INTO store_balances (store_id, kind, balance_cents, recorded_at, created_at) VALUES (?, 'CHECK', -1, 'r', 'c')").run(csf))
        .toThrow(/CHECK/);
    });

    test('a loja com saldo não pode ser removida (FK RESTRICT)', () => {
      expect(() => db.prepare('DELETE FROM stores WHERE id = ?').run(csf)).toThrow(/FOREIGN KEY/);
    });
  });
});

describe('migração v8: rollback', () => {
  test('falha depois do DROP: store_balances da v7 intacta, user_version 7, sem tabela _new e foreign_keys volta a 1', () => {
    const dbPath = dbIn('rollback');
    const { snapshot } = seedV7(dbPath);
    const real = MIGRATIONS.find((m) => m.version === 8);
    // Executa a v8 de verdade (inclui o DROP e o RENAME) e só então lança.
    const failing = { ...real, up(db) { real.up(db); throw new Error('falha injetada depois do DROP'); } };
    const db = new Database(dbPath);
    try {
      db.pragma('foreign_keys = ON');
      expect(() => runMigrations(db, [...upTo7, failing], { dbPath, now: NOW })).toThrow('falha injetada depois do DROP');
      expect(db.pragma('user_version', { simple: true })).toBe(7);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.prepare('SELECT * FROM store_balances ORDER BY id').all()).toEqual(snapshot.balances);
      const columns = db.prepare("SELECT name FROM pragma_table_info('store_balances')").all().map((c) => c.name);
      expect(columns).not.toContain('kind');
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'store_balances_new'").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('importar backups antigos', () => {
  test('um banco v5 e um v7 chegam à v8 com o mesmo resultado (registro mais recente de cada loja vira INITIAL)', () => {
    const upTo5 = MIGRATIONS.filter((m) => m.version <= 5);
    for (const [name, migrations] of [['imp5', upTo5], ['imp7', upTo7]]) {
      const dbPath = dbIn(name);
      const old = openDatabase(dbPath, { migrations });
      const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
      const ins = old.prepare('INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, ?, ?, ?)');
      ins.run(csf, 1, '2026-11-01T00:00:00.000Z', 'a');
      ins.run(csf, 2, '2026-11-02T00:00:00.000Z', 'b');
      old.close();
      const db = openDatabase(dbPath, { migrations: upTo8, now: NOW });
      try {
        expect(db.pragma('user_version', { simple: true })).toBe(8);
        expect(db.prepare('SELECT balance_cents AS b, kind FROM store_balances ORDER BY id').all()).toEqual([
          { b: 1, kind: 'CHECK' }, { b: 2, kind: 'INITIAL' },
        ]);
      } finally {
        db.close();
      }
    }
  });
});
