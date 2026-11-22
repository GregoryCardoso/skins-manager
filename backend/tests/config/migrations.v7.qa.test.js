'use strict';

// QA 8.5: migração até a v7 partindo de bancos reais de cada versão anterior (v1 a v6) com aportes e saques gravados:
// dados preservados, ids iguais, aportes viram legados, foreign_key_check vazio e CHECKs novos recusando dados inválidos.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v7qa-'));
});
afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // pasta temporária
  }
});

const dbIn = (name) => path.join(tmpRoot, name, 'inventory.sqlite');

function seedOld(version, name) {
  const dbPath = dbIn(name);
  const old = openDatabase(dbPath, { migrations: MIGRATIONS.filter((m) => m.version <= version) });
  const id = (store) => old.prepare('SELECT id FROM stores WHERE name = ?').get(store).id;
  const csf = id('CSFloat');
  const dep = old.prepare('INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  dep.run(50000, '2026-10-01T12:00:00.000Z', null, 'a', 'c1', 'u1');
  dep.run(30000, '2026-10-05T12:00:00.000Z', csf, 'b', 'c2', 'u2');
  const wd = old.prepare('INSERT INTO withdrawals (store_id, amount_store_cents, amount_brl_cents, withdrawn_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  wd.run(csf, 10000, 52000, '2026-11-10T12:00:00.000Z', 'c', 'c3', 'u3');
  wd.run(null, null, 10000, '2026-11-02T12:00:00.000Z', 'd', 'c4', 'u4');
  const before = {
    deposits: old.prepare('SELECT id, store_id, amount_brl_cents, deposited_at, note, created_at, updated_at FROM deposits ORDER BY id').all(),
    withdrawals: old.prepare('SELECT id, store_id, amount_store_cents, amount_brl_cents, withdrawn_at, note, created_at, updated_at FROM withdrawals ORDER BY id').all(),
  };
  old.close();
  return { dbPath, before };
}

describe.each([1, 2, 3, 4, 5, 6])('banco v%i com aportes e saques -> v7', (version) => {
  test('linhas, ids e valores preservados; aportes legados; saques intactos; foreign_key_check vazio', () => {
    const { dbPath, before } = seedOld(version, `v${version}`);
    const db = openDatabase(dbPath);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const deposits = db.prepare('SELECT id, store_id, amount_store_cents, amount_brl_cents, deposited_at, note, created_at, updated_at FROM deposits ORDER BY id').all();
    expect(deposits.every((row) => row.amount_store_cents === null)).toBe(true);
    expect(deposits.map(({ amount_store_cents: _legacy, ...rest }) => rest)).toEqual(before.deposits);
    const withdrawals = db.prepare('SELECT id, store_id, amount_store_cents, amount_brl_cents, withdrawn_at, note, created_at, updated_at FROM withdrawals ORDER BY id').all();
    expect(withdrawals).toEqual(before.withdrawals);
    db.close();
  });

  test('os CHECKs novos recusam dados inválidos e aceitam os novos formatos', () => {
    const { dbPath } = seedOld(version, `v${version}-checks`);
    const db = openDatabase(dbPath);
    const csf = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    const dep = db.prepare('INSERT INTO deposits (store_id, amount_store_cents, amount_brl_cents, deposited_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const wd = db.prepare('INSERT INTO withdrawals (store_id, amount_store_cents, fee_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const d = '2026-11-01T00:00:00.000Z';
    expect(() => dep.run(csf, null, null, d, 'c', 'u')).toThrow(); // sem nenhum valor
    expect(() => dep.run(null, 100, null, d, 'c', 'u')).toThrow(); // valor na loja sem loja
    expect(() => dep.run(csf, 0, null, d, 'c', 'u')).toThrow();
    expect(() => dep.run(csf, null, 0, d, 'c', 'u')).toThrow();
    expect(() => dep.run(csf, -5, 100, d, 'c', 'u')).toThrow();
    expect(() => dep.run(csf, 100, null, d, 'c', 'u')).not.toThrow(); // novo: só valor na loja
    expect(() => dep.run(null, null, 100, d, 'c', 'u')).not.toThrow(); // legado sem loja
    expect(() => wd.run(null, null, null, null, d, 'c', 'u')).toThrow(); // sem loja e sem R$
    expect(() => wd.run(csf, 100, -1, null, d, 'c', 'u')).toThrow(); // taxa negativa
    expect(() => wd.run(csf, 100, null, 0, d, 'c', 'u')).toThrow(); // R$ 0
    expect(() => wd.run(csf, 100, null, null, d, 'c', 'u')).not.toThrow(); // novo: loja sem R$
    db.close();
  });
});

describe('ids e contador AUTOINCREMENT', () => {
  test('um aporte novo depois da migração recebe id acima do maior antigo', () => {
    const { dbPath } = seedOld(6, 'ids');
    const db = openDatabase(dbPath);
    const csf = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    const res = db.prepare('INSERT INTO deposits (store_id, amount_store_cents, deposited_at, created_at, updated_at) VALUES (?, 100, ?, ?, ?)')
      .run(csf, '2026-11-01T00:00:00.000Z', 'c', 'u');
    expect(Number(res.lastInsertRowid)).toBe(3);
    db.close();
  });

  test('o aporte pode apontar só para loja existente (FK mantida) e a loja com aporte não pode ser excluída', () => {
    const { dbPath } = seedOld(6, 'fk');
    const db = openDatabase(dbPath);
    const csf = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    expect(() => db.prepare('DELETE FROM stores WHERE id = ?').run(csf)).toThrow();
    expect(() => db.prepare('INSERT INTO deposits (store_id, amount_store_cents, deposited_at, created_at, updated_at) VALUES (9999, 100, ?, ?, ?)')
      .run('2026-11-01T00:00:00.000Z', 'c', 'u')).toThrow();
    db.close();
  });
});
