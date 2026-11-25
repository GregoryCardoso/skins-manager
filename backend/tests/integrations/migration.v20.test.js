'use strict';

// 10.4 (D363, E-P2-Q45): migração v20 (`settings.steam_store_id`). Só ADD COLUMN; preenche com a loja "steam" em BRL se houver exatamente
// uma; sem perda de dados; backup da v19 antes de migrar; loja excluída limpa a referência.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

const UP_TO_19 = MIGRATIONS.filter((m) => m.version <= 19);
const NOW = new Date('2026-11-24T12:00:00.000Z');
let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v20-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

let seq = 0;
const newPath = () => path.join(tmpRoot, `d${++seq}`, 'inventory.sqlite');
const backupsOf = (dbPath) => {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('inventory-v19-')) : [];
};

// Banco v19 com as lojas semeadas (CSFloat, Steam em BRL e CSMoney); `prepare` ajusta antes de fechar.
function seedV19(dbPath, prepare = () => {}) {
  const db = openDatabase(dbPath, { migrations: UP_TO_19 });
  prepare(db);
  db.close();
}
const steamIdOf = (db) => db.prepare('SELECT steam_store_id AS id FROM settings').get().id;
const addStore = (db, name, currency) => db.prepare(
  `INSERT INTO stores (name, currency, is_active, is_primary, sale_fee_rounding, sale_fixed_fee_cents, allows_withdrawal, withdrawal_fixed_fee_cents,
     sale_hold_days, created_at, updated_at)
   VALUES (?, ?, 1, 0, 'CEIL', 0, 0, 0, 0, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`
).run(name, currency).lastInsertRowid;

describe('migração v20', () => {
  test('banco v19 com a loja Steam em BRL: a coluna nasce preenchida; nada mais muda; backup da v19', () => {
    const dbPath = newPath();
    let before;
    seedV19(dbPath, (db) => {
      before = { items: db.prepare('SELECT * FROM items').all(), stores: db.prepare('SELECT * FROM stores').all(), settings: db.prepare('SELECT * FROM settings').get() };
    });
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(23);
      const { steam_store_id: steamId, price_refresh_started_at: _p1, price_refresh_last_at: _p2, price_refresh_last_status: _p3, price_refresh_last_error_code: _p4, ...rest } = db.prepare('SELECT * FROM settings').get();
      expect(rest).toEqual(before.settings);
      expect(steamId).toBe(db.prepare("SELECT id FROM stores WHERE name = 'Steam'").get().id);
      expect(db.prepare('SELECT * FROM stores').all()).toEqual(before.stores);
      expect(db.prepare('SELECT * FROM items').all()).toEqual(before.items);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
    expect(backupsOf(dbPath)).toHaveLength(1);
  });

  test.each([
    ['Steam em USD (só a BRL conta)', (db) => db.prepare("UPDATE stores SET name = 'steam ', currency = 'USD' WHERE name = 'Steam'").run()],
    ['duas lojas Steam em BRL (ambíguo)', (db) => addStore(db, 'STEAM 2', 'BRL') && db.prepare("UPDATE stores SET name = ' steam' WHERE name = 'STEAM 2'").run()],
    ['nenhuma loja Steam', (db) => db.prepare("UPDATE stores SET name = 'Outra' WHERE name = 'Steam'").run()],
  ])('%s -> fica nula', (_label, prepare) => {
    const dbPath = newPath();
    seedV19(dbPath, prepare);
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(steamIdOf(db)).toBeNull();
    } finally {
      db.close();
    }
  });

  test('a loja "Steam" com espaços e maiúsculas em BRL, sozinha, é preenchida', () => {
    const dbPath = newPath();
    seedV19(dbPath, (db) => db.prepare("UPDATE stores SET name = '  STEAM  ' WHERE name = 'Steam'").run());
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(steamIdOf(db)).not.toBeNull();
    } finally {
      db.close();
    }
  });

  test('excluir a loja Steam sem uso limpa a referência (SET NULL)', () => {
    const dbPath = newPath();
    seedV19(dbPath);
    const db = openDatabase(dbPath, { now: NOW });
    try {
      const id = steamIdOf(db);
      expect(id).not.toBeNull();
      db.prepare('DELETE FROM stores WHERE id = ?').run(id);
      expect(steamIdOf(db)).toBeNull();
    } finally {
      db.close();
    }
  });

  test('a migração 20 só acrescenta a coluna em settings', () => {
    const v020 = MIGRATIONS.find((m) => m.version === 20);
    expect(v020.name).toBe('steam_store');
    const dbPath = newPath();
    seedV19(dbPath);
    const db = openDatabase(dbPath, { now: NOW });
    try {
      const cols = db.prepare("SELECT name FROM pragma_table_info('settings')").all().map((c) => c.name);
      expect(cols).toContain('steam_store_id');
    } finally {
      db.close();
    }
  });
});
