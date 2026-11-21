'use strict';

// QA da migração v6 (D199): transação/rollback, backup, nomes de loja variados, dados reais misturados e
// impossibilidade de dado antigo violar o CHECK novo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v6qa-'));
});
afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o arquivo por instantes; a pasta é temporária.
  }
});

const upTo5 = MIGRATIONS.filter((m) => m.version <= 5);
const dbIn = (name) => path.join(tmpRoot, name, 'inventory.sqlite');
const columns = (db, table) => db.prepare('SELECT name FROM pragma_table_info(?)').all(table).map((r) => r.name);
const rootPage = (db, table) => db.prepare('SELECT rootpage FROM sqlite_master WHERE name = ?').get(table).rootpage;
const NOW = '2026-11-01T00:00:00.000Z';

const insertStore = (db, name) => db.prepare(
  `INSERT INTO stores (name, currency, is_active, is_primary, sale_fee_rounding, sale_fixed_fee_cents, allows_withdrawal,
     withdrawal_fixed_fee_cents, created_at, updated_at) VALUES (?, 'USD', 1, 0, 'CEIL', 0, 0, 0, ?, ?)`
).run(name, NOW, NOW).lastInsertRowid;

const insertSold = (db, name, storeId) => db.prepare(
  `INSERT INTO items (name, category, acquisition_type, purchase_store_id, acquired_at, status, sale_store_id, sale_price_cents,
     sale_currency, net_received_cents, sold_at, sale_fee_type_applied, sale_fee_rate_applied, sale_fee_rounding_applied,
     sale_fixed_fee_cents_applied, created_at, updated_at)
   VALUES (?, 'CAIXA', 'GANHEI', ?, '2026-01-01T00:00:00.000Z', 'VENDIDO', ?, 1000, 'USD', 980,
     '2026-11-15T12:00:00.000Z', 'DEDUCTED', 0.02, 'CEIL', 0, 'c', 'u')`
).run(name, storeId, storeId).lastInsertRowid;

const insertStock = (db, name, storeId) => db.prepare(
  `INSERT INTO items (name, category, acquisition_type, purchase_store_id, acquired_at, created_at, updated_at)
   VALUES (?, 'CAIXA', 'GANHEI', ?, '2026-01-01T00:00:00.000Z', 'c', 'u')`
).run(name, storeId).lastInsertRowid;

const csfloatId = (db) => Number(db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id);

describe('migração v6: lojas com nomes variados (D213)', () => {
  test('csfloat, "CSFloat " (espaço), "CS Float", CSMONEY e Steam: só o nome exato (sem diferenciar caixa) recebe 7', () => {
    const dbPath = dbIn('nomes');
    const old = openDatabase(dbPath, { migrations: upTo5 });
    old.prepare("UPDATE stores SET name = 'csfloat' WHERE name = 'CSFloat'").run();
    old.prepare("UPDATE stores SET name = 'CSMONEY' WHERE name = 'CSMoney'").run();
    insertStore(old, 'CSFloat '); // espaço no fim: nome diferente para o UNIQUE
    insertStore(old, 'CS Float');
    insertStore(old, 'cs money');
    old.close();

    const db = openDatabase(dbPath);
    try {
      const holds = Object.fromEntries(db.prepare('SELECT name, sale_hold_days AS d FROM stores').all().map((r) => [r.name, r.d]));
      expect(holds).toEqual({
        csfloat: 7, CSMONEY: 7, Steam: 0, 'CSFloat ': 0, 'CS Float': 0, 'cs money': 0,
      });
    } finally {
      db.close();
    }
  });

  test('banco v5 sem nenhuma loja (todas excluídas): a v6 não quebra e o seed não recria as lojas', () => {
    const dbPath = dbIn('semlojas');
    const old = openDatabase(dbPath, { migrations: upTo5 });
    old.prepare('DELETE FROM stores').run();
    old.close();
    const db = openDatabase(dbPath);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(6);
      expect(db.prepare('SELECT COUNT(*) AS n FROM stores').get().n).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('migração v6: dados reais variados', () => {
  test('vendas em lojas diferentes, estoque, saques com e sem loja, aporte e saldo: tudo idêntico, snapshots nulos, FKs íntegras', () => {
    const dbPath = dbIn('real');
    const old = openDatabase(dbPath, { migrations: upTo5 });
    const csfloat = csfloatId(old);
    const steam = Number(old.prepare("SELECT id FROM stores WHERE name = 'Steam'").get().id);
    for (let i = 0; i < 40; i += 1) insertSold(old, `V${i}`, i % 2 ? csfloat : steam);
    for (let i = 0; i < 25; i += 1) insertStock(old, `E${i}`, csfloat);
    old.prepare("INSERT INTO withdrawals (store_id, amount_store_cents, amount_brl_cents, withdrawn_at, note, created_at, updated_at) VALUES (?, 500, 2500, 'w', 'n', 'c', 'u')").run(csfloat);
    old.prepare("INSERT INTO withdrawals (amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (1000, 'w2', 'c', 'u')").run();
    old.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, note, created_at, updated_at) VALUES (5000, 'd', ?, 'x', 'c', 'u')").run(steam);
    old.prepare("INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, 1234, 'r', 'c')").run(csfloat);
    const snapshot = (db) => ({
      deposits: db.prepare('SELECT * FROM deposits ORDER BY id').all(),
      balances: db.prepare('SELECT * FROM store_balances ORDER BY id').all(),
      items: db.prepare('SELECT * FROM items ORDER BY id').all().map(({ sale_hold_days_applied: _h, ...row }) => row),
      withdrawals: db.prepare('SELECT * FROM withdrawals ORDER BY id').all().map(({ fee_cents: _f, ...row }) => row),
      stores: db.prepare('SELECT * FROM stores ORDER BY id').all().map(({ sale_hold_days: _s, ...row }) => row),
    });
    const before = snapshot(old);
    old.close();

    const db = openDatabase(dbPath);
    try {
      expect(snapshot(db)).toEqual(before);
      expect(db.prepare('SELECT COUNT(*) AS n FROM items WHERE sale_hold_days_applied IS NOT NULL').get().n).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS n FROM withdrawals WHERE fee_cents IS NOT NULL').get().n).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS n FROM items').get().n).toBe(65);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      db.close();
    }
  });

  test('a v6 só faz ADD COLUMN: sem disableForeignKeys e sem reconstruir tabelas (rootpage igual)', () => {
    expect(MIGRATIONS.find((m) => m.version === 6).disableForeignKeys).toBeUndefined();
    const dbPath = dbIn('semrebuild');
    const old = openDatabase(dbPath, { migrations: upTo5 });
    const before = ['stores', 'items', 'withdrawals'].map((t) => rootPage(old, t));
    old.close();
    const db = openDatabase(dbPath);
    try {
      expect(['stores', 'items', 'withdrawals'].map((t) => rootPage(db, t))).toEqual(before);
      expect(columns(db, 'withdrawals')).toContain('fee_cents');
      expect(columns(db, 'stores')).toContain('sale_hold_days');
      expect(columns(db, 'items')).toContain('sale_hold_days_applied');
    } finally {
      db.close();
    }
  });
});

describe('migração v6: dado antigo x CHECK de sale_hold_days_applied', () => {
  test('já na v5 o CHECK do esquema impede item EM_ESTOQUE com campos de venda sobrando (nenhum dado antigo viola o CHECK novo)', () => {
    const old = openDatabase(dbIn('sujo'), { migrations: upTo5 });
    try {
      const stock = insertStock(old, 'E', csfloatId(old));
      expect(() => old.prepare("UPDATE items SET sold_at = '2026-11-15T12:00:00.000Z' WHERE id = ?").run(stock)).toThrow(/CHECK/);
      expect(() => old.prepare('UPDATE items SET net_received_cents = 5 WHERE id = ?').run(stock)).toThrow(/CHECK/);
    } finally {
      old.close();
    }
  });

  test('linha "suja" forçada (ignore_check_constraints): o SQLite revalida os CHECKs da tabela no ADD COLUMN, a v6 falha e é desfeita por inteiro', () => {
    // Só ocorreria com banco adulterado (o esquema v1 já impede a linha). O comportamento é seguro: rollback + backup.
    const dbPath = dbIn('sujo2');
    const old = openDatabase(dbPath, { migrations: upTo5 });
    const stock = insertStock(old, 'E', csfloatId(old));
    old.pragma('ignore_check_constraints = ON');
    old.prepare("UPDATE items SET sold_at = '2026-11-15T12:00:00.000Z' WHERE id = ?").run(stock);
    old.close();
    expect(() => openDatabase(dbPath)).toThrow(/CHECK/);
    const raw = new Database(dbPath);
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(5);
      expect(columns(raw, 'withdrawals')).not.toContain('fee_cents');
      expect(columns(raw, 'stores')).not.toContain('sale_hold_days');
    } finally {
      raw.close();
    }
  });
});

describe('migração v6: falha no meio e backup', () => {
  test.each([
    ['stores', 'ALTER TABLE stores ADD COLUMN sale_hold_days INTEGER'],
    ['items', 'ALTER TABLE items ADD COLUMN sale_hold_days_applied INTEGER'],
  ])('falha no ALTER de %s: transação desfeita, user_version 5, sem colunas novas e dados intactos', (table, sabotage) => {
    const dbPath = dbIn(`falha-${table}`);
    const old = openDatabase(dbPath, { migrations: upTo5 });
    insertSold(old, 'V', csfloatId(old));
    old.prepare("INSERT INTO withdrawals (amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (1000, 'w2', 'c', 'u')").run();
    old.exec(sabotage); // a v6 vai bater em "duplicate column name" no meio da execução
    const before = {
      items: old.prepare('SELECT * FROM items').all(),
      withdrawals: old.prepare('SELECT * FROM withdrawals').all(),
      stores: old.prepare('SELECT * FROM stores').all(),
    };
    old.close();

    expect(() => openDatabase(dbPath)).toThrow(/duplicate column/i);

    const raw = new Database(dbPath);
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(5);
      expect(columns(raw, 'withdrawals')).not.toContain('fee_cents'); // o 1º ALTER foi desfeito junto
      if (table === 'items') expect(columns(raw, 'stores')).not.toContain('sale_hold_days');
      expect(raw.prepare('SELECT * FROM items').all()).toEqual(before.items);
      expect(raw.prepare('SELECT * FROM withdrawals').all()).toEqual(before.withdrawals);
      expect(raw.prepare('SELECT * FROM stores').all()).toEqual(before.stores);
      expect(raw.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      raw.close();
    }
    // o backup pré-migração foi feito antes da tentativa
    expect(fs.readdirSync(path.join(path.dirname(dbPath), 'backups')).some((f) => f.startsWith('inventory-v5-'))).toBe(true);
  });

  test('falha da v6 não deixa o handle aberto (o arquivo pode ser removido, inclusive no Windows)', () => {
    const dbPath = dbIn('handle');
    const old = openDatabase(dbPath, { migrations: upTo5 });
    old.exec('ALTER TABLE withdrawals ADD COLUMN fee_cents INTEGER');
    old.close();
    expect(() => openDatabase(dbPath)).toThrow();
    fs.rmSync(dbPath, { force: true });
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test('o backup pré-migração é cópia fiel do banco v5 (user_version 5, sem colunas da v6, mesmos dados)', () => {
    const dbPath = dbIn('backupfiel');
    const old = openDatabase(dbPath, { migrations: upTo5 });
    const csfloat = csfloatId(old);
    insertSold(old, 'V', csfloat);
    insertStock(old, 'E', csfloat);
    const items = old.prepare('SELECT * FROM items ORDER BY id').all();
    old.close();
    openDatabase(dbPath).close();

    const dir = path.join(path.dirname(dbPath), 'backups');
    const file = fs.readdirSync(dir).find((f) => f.startsWith('inventory-v5-'));
    const backup = new Database(path.join(dir, file), { readonly: true });
    try {
      expect(backup.pragma('user_version', { simple: true })).toBe(5);
      expect(columns(backup, 'items')).not.toContain('sale_hold_days_applied');
      expect(columns(backup, 'stores')).not.toContain('sale_hold_days');
      expect(columns(backup, 'withdrawals')).not.toContain('fee_cents');
      expect(backup.prepare('SELECT * FROM items ORDER BY id').all()).toEqual(items);
    } finally {
      backup.close();
    }
  });

  test('skipMigrationBackup não cria o backup, e a v6 aplica igual', () => {
    const dbPath = dbIn('semBackup');
    openDatabase(dbPath, { migrations: upTo5 }).close();
    const db = openDatabase(dbPath, { skipMigrationBackup: true });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(6);
      expect(fs.existsSync(path.join(path.dirname(dbPath), 'backups'))).toBe(false);
    } finally {
      db.close();
    }
  });
});

describe('seed com checagem de coluna', () => {
  test('lista truncada (v5) semeia as 3 lojas sem a coluna; a v6 depois leva CSFloat/CSMoney a 7 (igual ao seed completo)', () => {
    const dbPath = dbIn('seedtrunc');
    const old = openDatabase(dbPath, { migrations: upTo5 });
    expect(columns(old, 'stores')).not.toContain('sale_hold_days');
    expect(old.prepare('SELECT name FROM stores ORDER BY id').all().map((r) => r.name)).toEqual(['CSFloat', 'Steam', 'CSMoney']);
    old.close();
    const db = openDatabase(dbPath);
    try {
      expect(db.prepare('SELECT name, sale_hold_days AS d FROM stores ORDER BY id').all())
        .toEqual([{ name: 'CSFloat', d: 7 }, { name: 'Steam', d: 0 }, { name: 'CSMoney', d: 7 }]);
    } finally {
      db.close();
    }
  });

  test('banco novo com a lista completa: o seed roda depois das migrações e grava 7/0/7 (nunca o ramo sem coluna)', () => {
    const db = openDatabase(':memory:');
    try {
      expect(columns(db, 'stores')).toContain('sale_hold_days');
      expect(db.prepare('SELECT name, sale_hold_days AS d FROM stores ORDER BY id').all())
        .toEqual([{ name: 'CSFloat', d: 7 }, { name: 'Steam', d: 0 }, { name: 'CSMoney', d: 7 }]);
    } finally {
      db.close();
    }
  });
});
