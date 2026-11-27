'use strict';

// 11.4 (D369, Adendo 1): migração v25 (lojas e itens aceitam qualquer moeda; `amount_brl_currency` em aportes e saques).
// Bancos temporários; nada no %APPDATA%.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stripSellsHere } = require('../helpers/stripV6');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

const UP_TO_24 = MIGRATIONS.filter((m) => m.version <= 24);
const NOW = new Date('2026-11-25T12:00:00.000Z');
let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v25-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

const dbPathOf = (name) => path.join(tmpRoot, name, 'inventory.sqlite');
const backupsOf = (dbPath, prefix) => {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(prefix)) : [];
};
const dumpTables = (db, skip = []) => Object.fromEntries(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map((r) => r.name)
    .filter((name) => !skip.includes(name))
    .map((name) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all().map(({ inventory_density: _dn, ...r }) => r)])
);
const withoutNewColumn = (rows) => rows.map(({ amount_brl_currency: currency, ...rest }) => { expect(currency).toBe('BRL'); return rest; });

// Banco v24 "de verdade", com lojas, itens em USD e BRL (um vendido), aporte, saque e conferência.
function makeV24(name) {
  const dbPath = dbPathOf(name);
  const old = openDatabase(dbPath, { migrations: UP_TO_24 });
  old.prepare("UPDATE settings SET display_currency = 'BRL'").run();
  const csfloat = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const steam = old.prepare("SELECT id FROM stores WHERE name = 'Steam'").get().id;
  const insert = old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, fx_rate_at_purchase, acquired_at, created_at, updated_at)
     VALUES (?, 'OUTRO', 'COMPRA', ?, ?, ?, ?, '2026-11-01T00:00:00.000Z', 'c', 'u')`
  );
  insert.run('Caixa USD', csfloat, 1000, 'USD', null);
  const brl = Number(insert.run('Caixa BRL', steam, 5500, 'BRL', 5.5).lastInsertRowid);
  old.prepare(
    `UPDATE items SET status = 'VENDIDO', sale_store_id = ?, sale_price_cents = 9000, sale_currency = 'BRL', fx_rate_at_sale = 5.4, sale_fee_type_applied = 'ADDED',
       sale_fee_rate_applied = 0.15, sale_fee_rounding_applied = 'CEIL', sale_fixed_fee_cents_applied = 0, net_received_cents = 7826, sold_at = '2026-11-10T12:00:00.000Z' WHERE id = ?`
  ).run(steam, brl);
  old.prepare("INSERT INTO deposits (store_id, amount_store_cents, amount_brl_cents, deposited_at, created_at, updated_at) VALUES (?, 20000, 100000, '2026-10-01T00:00:00.000Z', 'c', 'u')").run(csfloat);
  old.prepare("INSERT INTO withdrawals (store_id, amount_store_cents, fee_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, 5000, 100, 25000, '2026-10-20T00:00:00.000Z', 'c', 'u')").run(csfloat);
  old.prepare("INSERT INTO withdrawals (amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (30000, '2026-01-05T00:00:00.000Z', 'c', 'u')").run();
  old.prepare("INSERT INTO store_balances (store_id, balance_cents, fx_rate, recorded_at, created_at) VALUES (?, 12345, NULL, '2026-11-02T00:00:00.000Z', 'c')").run(csfloat);
  const before = dumpTables(old);
  const sequences = old.prepare("SELECT name, seq FROM sqlite_sequence WHERE name IN ('items', 'stores') ORDER BY name").all();
  old.close();
  return { dbPath, before, sequences };
}

describe('v25 sobre um banco v24 (banco existente)', () => {
  test('nenhum dado muda: lojas, itens, aportes, saques e conferências idênticos; as colunas novas nascem em BRL; há backup da v24', () => {
    const { dbPath, before, sequences } = makeV24('existing');
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(28);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      const after = dumpTables(db);
      expect(stripSellsHere(after.stores)).toEqual(before.stores);
      expect(after.items).toEqual(before.items);
      expect(after.store_balances).toEqual(before.store_balances);
      expect(withoutNewColumn(after.deposits)).toEqual(before.deposits);
      expect(withoutNewColumn(after.withdrawals)).toEqual(before.withdrawals);
      expect(after.settings).toEqual(before.settings);
      expect(db.prepare("SELECT name, seq FROM sqlite_sequence WHERE name IN ('items', 'stores') ORDER BY name").all()).toEqual(sequences);
      expect(backupsOf(dbPath, 'inventory-v24-')).toHaveLength(1);
      // os índices e a regra "uma só loja principal" sobreviveram
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_items_%' OR name = 'ux_stores_primary'").all().map((r) => r.name);
      expect(indexes).toEqual(expect.arrayContaining(['ux_stores_primary', 'idx_items_status', 'idx_items_sold_at', 'idx_items_catalog_id']));
      expect(() => db.prepare("UPDATE stores SET is_primary = 1 WHERE name = 'CSMoney'").run()).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  test('depois da v25 o banco aceita lojas e itens em qualquer moeda no formato; formato inválido continua recusado', () => {
    const { dbPath } = makeV24('accepts');
    const db = openDatabase(dbPath, { now: NOW });
    try {
      const insertStore = (name, currency) => db.prepare(
        "INSERT INTO stores (name, currency, created_at, updated_at) VALUES (?, ?, 'c', 'u')"
      ).run(name, currency);
      expect(() => insertStore('Loja JPY', 'JPY')).not.toThrow();
      expect(() => insertStore('Loja eur', 'eur')).toThrow(/CHECK/);
      expect(() => insertStore('Loja X', 'EURO')).toThrow(/CHECK/);
      const jpy = db.prepare("SELECT id FROM stores WHERE name = 'Loja JPY'").get().id;
      const insertItem = (currency, fx) => db.prepare(
        `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, fx_rate_at_purchase, acquired_at, created_at, updated_at)
         VALUES ('Caixa', 'OUTRO', 'COMPRA', ?, 100000, ?, ?, '2026-11-01T00:00:00.000Z', 'c', 'u')`
      ).run(jpy, currency, fx);
      expect(() => insertItem('JPY', 150)).not.toThrow();
      expect(() => insertItem('JPY', null)).toThrow(/CHECK/); // moeda não-USD exige cotação
      expect(() => insertItem('USD', 150)).toThrow(/CHECK/); // USD não aceita cotação
      expect(db.prepare('SELECT amount_brl_currency AS c FROM deposits').get().c).toBe('BRL');
    } finally {
      db.close();
    }
  });

  test('é idempotente: abrir de novo não refaz nada nem cria outro backup', () => {
    const { dbPath } = makeV24('idem');
    openDatabase(dbPath, { now: NOW }).close();
    const first = backupsOf(dbPath, 'inventory-v24-');
    const db = openDatabase(dbPath, { now: new Date('2026-11-25T13:00:00.000Z') });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(28);
      expect(backupsOf(dbPath, 'inventory-v24-')).toEqual(first);
    } finally {
      db.close();
    }
  });

  test('falha no meio da v25: rollback total (continua na v24 e idêntico) e o backup da v24 existe', () => {
    const real = MIGRATIONS.find((m) => m.version === 25);
    const { dbPath, before } = makeV24('rollback');
    const failing = { ...real, up(db, ctx) { real.up(db, ctx); throw new Error('falha simulada'); } };
    expect(() => openDatabase(dbPath, { migrations: [...UP_TO_24, failing], now: NOW })).toThrow(/falha simulada/);

    const check = openDatabase(dbPath, { migrations: UP_TO_24, skipBackup: true });
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(24);
      expect(dumpTables(check)).toEqual(before);
      expect(check.prepare("SELECT 1 FROM pragma_table_info('deposits') WHERE name = 'amount_brl_currency'").get()).toBeUndefined();
    } finally {
      check.close();
    }
    expect(backupsOf(dbPath, 'inventory-v24-').length).toBeGreaterThanOrEqual(1);
    const ok = openDatabase(dbPath, { skipBackup: true });
    try {
      expect(ok.pragma('user_version', { simple: true })).toBe(28);
    } finally {
      ok.close();
    }
  });
});

describe('v25 em banco novo', () => {
  test('instalação nova: termina na v25, Steam em USD, moeda de conversão USD, sem backup de migração', () => {
    const dbPath = dbPathOf('fresh');
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(28);
      expect(db.prepare("SELECT currency FROM stores WHERE name = 'Steam'").get().currency).toBe('USD');
      expect(db.prepare('SELECT display_currency AS d FROM settings').get().d).toBe('USD');
      expect(db.prepare('SELECT steam_store_id AS s FROM settings').get().s).toBe(db.prepare("SELECT id FROM stores WHERE name = 'Steam'").get().id);
      expect(backupsOf(dbPath, 'inventory-v')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  test('banco existente (v23 -> v25 de uma vez) continua com a Steam em BRL', () => {
    const dbPath = dbPathOf('old-steam');
    const old = openDatabase(dbPath, { migrations: MIGRATIONS.filter((m) => m.version <= 23) });
    old.close();
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(28);
      expect(db.prepare("SELECT currency FROM stores WHERE name = 'Steam'").get().currency).toBe('BRL');
      expect(db.prepare('SELECT display_currency AS d FROM settings').get().d).toBe('BRL');
    } finally {
      db.close();
    }
  });
});
