'use strict';

// Migração v7 (D223): aportes e saques na moeda da loja. Reconstrói `deposits` e `withdrawals` sem perder dado.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v7-'));
});
afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o arquivo por instantes; a pasta é temporária.
  }
});

const upTo6 = MIGRATIONS.filter((m) => m.version <= 6);
const dbIn = (name) => path.join(tmpRoot, name, 'inventory.sqlite');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const backups = (dbPath) => {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

// Banco v6 com aportes (com e sem loja informativa) e saques (com loja, taxa nula e preenchida, e sem loja).
function seedV6(dbPath) {
  const old = openDatabase(dbPath, { migrations: upTo6 });
  const id = (name) => old.prepare('SELECT id FROM stores WHERE name = ?').get(name).id;
  const csf = id('CSFloat');
  const steam = id('Steam');
  const insDeposit = old.prepare(
    'INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insDeposit.run(50000, '2026-10-01T12:00:00.000Z', null, 'sem loja', 'c1', 'u1');
  insDeposit.run(30000, '2026-10-05T12:00:00.000Z', csf, 'csfloat', 'c2', 'u2');
  insDeposit.run(12345, '2026-10-06T12:00:00.000Z', steam, null, 'c3', 'u3');
  const insWithdrawal = old.prepare(
    `INSERT INTO withdrawals (store_id, amount_store_cents, fee_cents, amount_brl_cents, withdrawn_at, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insWithdrawal.run(csf, 10000, 250, 52037, '2026-11-10T12:00:00.000Z', 'com taxa', 'c4', 'u4');
  insWithdrawal.run(csf, 5000, null, 26000, '2026-11-11T12:00:00.000Z', 'sem taxa', 'c5', 'u5');
  insWithdrawal.run(null, null, null, 10000, '2026-11-02T12:00:00.000Z', 'antigo sem loja', 'c6', 'u6');
  // Contadores AUTOINCREMENT à frente do MAX(id): um registro apagado não pode ter o id reaproveitado.
  const extraDeposit = insDeposit.run(1, '2026-10-07T12:00:00.000Z', null, null, 'c', 'u').lastInsertRowid;
  old.prepare('DELETE FROM deposits WHERE id = ?').run(extraDeposit);
  const extraWithdrawal = insWithdrawal.run(null, null, null, 1, '2026-10-08T12:00:00.000Z', null, 'c', 'u').lastInsertRowid;
  old.prepare('DELETE FROM withdrawals WHERE id = ?').run(extraWithdrawal);
  const snapshot = {
    deposits: old.prepare('SELECT * FROM deposits ORDER BY id').all(),
    withdrawals: old.prepare('SELECT * FROM withdrawals ORDER BY id').all(),
    sequences: old.prepare("SELECT name, seq FROM sqlite_sequence WHERE name IN ('deposits', 'withdrawals') ORDER BY name").all(),
  };
  old.close();
  return { snapshot, csf, steam };
}

describe('migração v7', () => {
  test('a v7 existe com o nome certo e as migrações v1 a v7 publicadas continuam idênticas (hash)', () => {
    const v7 = MIGRATIONS.find((m) => m.version === 7);
    expect(v7.name).toBe('store_currency_flows');
    expect(v7.disableForeignKeys).toBe(true);
    const dir = path.join(__dirname, '..', '..', 'src', 'config', 'migrations');
    expect(sha(path.join(dir, 'v001_initial.js'))).toBe('18514164a9ad3d10128e6b1c271ce7623d11835a9240fe9bf2f337bfced3eb1f');
    expect(sha(path.join(dir, 'v002_catalog.js'))).toBe('9e0718ac8ad78ee5e48a4bd41f591e3835ed3b1c653e95e6362f6041b56ba22f');
    expect(sha(path.join(dir, 'v003_manual_net.js'))).toBe('a6a480628b4cfbd4acaaab82cd091ca2d865d3c09821104cee243ab011631620');
    expect(sha(path.join(dir, 'v004_stores_settings.js'))).toBe('d8dc15e343e815b01956323e05448684bc948d2c82e17d482187f1bf0febef47');
    expect(sha(path.join(dir, 'v005_fx_sources.js'))).toBe('6892beb82a64b3975a3b169316f30bb2e989a2a7dcb8867108d2ed2f0d572c27');
    expect(sha(path.join(dir, 'v006_withdrawal_fee_sale_hold.js'))).toBe('5ed05352931346dc6dad349701fd42dd1dd0dcd30a325798098428cc12216e24');
    expect(sha(path.join(dir, 'v007_store_currency_flows.js'))).toBe('33458e5a958452fff91811822cbef913fdcfad716e4185f4c9f7f17a38f76d76');
  });

  test('banco v6 com aportes e saques antigos: nenhuma linha se perde, ids iguais, aportes viram legados', () => {
    const dbPath = dbIn('dados');
    const { snapshot } = seedV6(dbPath);
    const db = openDatabase(dbPath, { now: new Date('2026-11-21T12:00:00.000Z') });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(17);
      const deposits = db.prepare('SELECT * FROM deposits ORDER BY id').all();
      expect(deposits).toHaveLength(3);
      expect(deposits.map((d) => d.id)).toEqual(snapshot.deposits.map((d) => d.id));
      deposits.forEach((row, i) => {
        const { amount_store_cents: stored, fee_cents: feeCents, ...rest } = row; // fee_cents: v16 (nula)
        expect(stored).toBeNull(); // todo aporte antigo vira legado
        expect(rest).toEqual(snapshot.deposits[i]); // valor em R$, loja informativa, nota e carimbos intactos
      });
      // saques: iguais, com e sem loja, com taxa nula e preenchida
      expect(db.prepare('SELECT * FROM withdrawals ORDER BY id').all()).toEqual(snapshot.withdrawals);
      const withdrawals = db.prepare('SELECT * FROM withdrawals ORDER BY id').all();
      expect(withdrawals.map((w) => [w.store_id === null, w.fee_cents])).toEqual([[false, 250], [false, null], [true, null]]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      db.close();
    }
  });

  test('backup automático criado antes de migrar (v6)', () => {
    const dbPath = dbIn('backup');
    seedV6(dbPath);
    openDatabase(dbPath).close();
    expect(backups(dbPath).some((f) => f.startsWith('inventory-v6-'))).toBe(true);
  });

  test('sqlite_sequence preservado: um id novo não reutiliza o de um registro excluído', () => {
    const dbPath = dbIn('sequencia');
    const { snapshot, csf } = seedV6(dbPath);
    const before = Object.fromEntries(snapshot.sequences.map((s) => [s.name, s.seq]));
    expect(before.deposits).toBeGreaterThan(3);
    expect(before.withdrawals).toBeGreaterThan(3);
    const db = openDatabase(dbPath);
    try {
      const after = Object.fromEntries(db.prepare("SELECT name, seq FROM sqlite_sequence WHERE name IN ('deposits', 'withdrawals')").all().map((s) => [s.name, s.seq]));
      expect(after).toEqual(before);
      const now = '2026-11-21T12:00:00.000Z';
      const depositId = db.prepare(
        'INSERT INTO deposits (store_id, amount_store_cents, deposited_at, created_at, updated_at) VALUES (?, 100, ?, ?, ?)'
      ).run(csf, now, now, now).lastInsertRowid;
      const withdrawalId = db.prepare(
        'INSERT INTO withdrawals (store_id, amount_store_cents, withdrawn_at, created_at, updated_at) VALUES (?, 100, ?, ?, ?)'
      ).run(csf, now, now, now).lastInsertRowid;
      expect(Number(depositId)).toBe(before.deposits + 1);
      expect(Number(withdrawalId)).toBe(before.withdrawals + 1);
    } finally {
      db.close();
    }
  });

  test('índices recriados com os mesmos nomes', () => {
    const dbPath = dbIn('indices');
    seedV6(dbPath);
    const db = openDatabase(dbPath);
    try {
      const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('deposits', 'withdrawals') AND name LIKE 'idx_%' ORDER BY name").all().map((r) => r.name);
      expect(names).toEqual(['idx_deposits_deposited_at', 'idx_withdrawals_store_date', 'idx_withdrawals_withdrawn_at']);
    } finally {
      db.close();
    }
  });

  test('reabrir um banco v7 não migra de novo nem cria outro backup', () => {
    const dbPath = dbIn('reabrir');
    seedV6(dbPath);
    openDatabase(dbPath).close();
    const first = backups(dbPath).length;
    const db = openDatabase(dbPath);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(17);
      expect(backups(dbPath).length).toBe(first);
      expect(db.prepare('SELECT COUNT(*) AS n FROM deposits').get().n).toBe(3);
    } finally {
      db.close();
    }
  });

  describe('CHECKs do esquema novo', () => {
    let db;
    let csf;
    beforeAll(() => {
      db = openDatabase(dbIn('checks'));
      csf = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    });
    afterAll(() => db.close());
    const insertDeposit = (store, storeCents, brlCents) => db.prepare(
      "INSERT INTO deposits (store_id, amount_store_cents, amount_brl_cents, deposited_at, created_at, updated_at) VALUES (?, ?, ?, 'd', 'c', 'u')"
    ).run(store, storeCents, brlCents);
    const insertWithdrawal = (store, storeCents, brlCents) => db.prepare(
      "INSERT INTO withdrawals (store_id, amount_store_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, ?, ?, 'w', 'c', 'u')"
    ).run(store, storeCents, brlCents);

    test('aporte sem amount_store_cents e sem amount_brl_cents é recusado', () => {
      expect(() => insertDeposit(csf, null, null)).toThrow(/CHECK/);
      expect(() => insertDeposit(null, null, null)).toThrow(/CHECK/);
    });

    test('amount_store_cents sem store_id é recusado', () => {
      expect(() => insertDeposit(null, 100, null)).toThrow(/CHECK/);
    });

    test('aporte aceito: só valor na loja; só R$ (legado, com ou sem loja); ambos', () => {
      expect(() => insertDeposit(csf, 100, null)).not.toThrow();
      expect(() => insertDeposit(null, null, 100)).not.toThrow();
      expect(() => insertDeposit(csf, null, 100)).not.toThrow();
      expect(() => insertDeposit(csf, 100, 500)).not.toThrow();
    });

    test('valores zero ou negativos são recusados', () => {
      expect(() => insertDeposit(csf, 0, null)).toThrow(/CHECK/);
      expect(() => insertDeposit(csf, 100, 0)).toThrow(/CHECK/);
      expect(() => insertWithdrawal(csf, 100, 0)).toThrow(/CHECK/);
    });

    test('saque sem loja e sem amount_brl_cents é recusado; com loja e amount_brl_cents nulo é aceito', () => {
      expect(() => insertWithdrawal(null, null, null)).toThrow(/CHECK/);
      expect(() => insertWithdrawal(csf, 100, null)).not.toThrow();
      expect(() => insertWithdrawal(null, null, 100)).not.toThrow();
    });

    test('saque com loja mas sem amount_store_cents (ou o contrário) segue recusado', () => {
      expect(() => insertWithdrawal(csf, null, 100)).toThrow(/CHECK/);
      expect(() => insertWithdrawal(null, 100, 100)).toThrow(/CHECK/);
    });
  });
});

describe('migração v7: rollback', () => {
  test('falha depois do DROP: deposits e withdrawals da v6 intactas, user_version 6 e foreign_keys volta a 1', () => {
    const Database = require('better-sqlite3');
    const { runMigrations } = require('../../src/config/database');
    const dbPath = dbIn('rollback');
    const { snapshot } = seedV6(dbPath);
    const real = MIGRATIONS.find((m) => m.version === 7);
    // Executa a v7 de verdade (inclui os DROP/RENAME) e só então lança.
    const failing = { ...real, up(db) { real.up(db); throw new Error('falha injetada depois do DROP'); } };
    const db = new Database(dbPath);
    try {
      db.pragma('foreign_keys = ON');
      expect(() => runMigrations(db, [...upTo6, failing], { dbPath, now: new Date('2026-11-21T12:00:00.000Z') }))
        .toThrow('falha injetada depois do DROP');
      expect(db.pragma('user_version', { simple: true })).toBe(6);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.prepare('SELECT * FROM deposits ORDER BY id').all()).toEqual(snapshot.deposits);
      expect(db.prepare('SELECT * FROM withdrawals ORDER BY id').all()).toEqual(snapshot.withdrawals);
      const columns = db.prepare("SELECT name FROM pragma_table_info('deposits')").all().map((c) => c.name);
      expect(columns).not.toContain('amount_store_cents');
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE name IN ('deposits_new', 'withdrawals_new')").all();
      expect(tables).toEqual([]);
    } finally {
      db.close();
    }
  });
});
