'use strict';

// Migração v6 (D199): taxa paga do saque, retenção do saldo na loja e snapshot da retenção na venda.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v6-'));
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
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const holdOf = (db) => Object.fromEntries(db.prepare('SELECT name, sale_hold_days AS d FROM stores').all().map((r) => [r.name, r.d]));

const insertItem = (db, { name, status = 'EM_ESTOQUE', storeId }) => db.prepare(
  `INSERT INTO items (name, category, acquisition_type, purchase_store_id, acquired_at, status, sale_store_id,
     sale_price_cents, sale_currency, net_received_cents, sold_at, sale_fee_type_applied, sale_fee_rate_applied,
     sale_fee_rounding_applied, sale_fixed_fee_cents_applied, created_at, updated_at)
   VALUES (?, 'CAIXA', 'GANHEI', ?, '2026-01-01T00:00:00.000Z', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'c', 'u')`
).run(
  name, storeId, status,
  status === 'VENDIDO' ? storeId : null, status === 'VENDIDO' ? 1000 : null, status === 'VENDIDO' ? 'USD' : null,
  status === 'VENDIDO' ? 980 : null, status === 'VENDIDO' ? '2026-11-15T12:00:00.000Z' : null,
  status === 'VENDIDO' ? 'DEDUCTED' : null, status === 'VENDIDO' ? 0.02 : null,
  status === 'VENDIDO' ? 'CEIL' : null, status === 'VENDIDO' ? 0 : null
).lastInsertRowid;

describe('migração v6', () => {
  test('o último user_version é 6 e as migrações v1 a v5 publicadas continuam idênticas (hash)', () => {
    expect(MIGRATIONS[MIGRATIONS.length - 1].version).toBe(6);
    expect(MIGRATIONS[MIGRATIONS.length - 1].name).toBe('withdrawal_fee_sale_hold');
    const dir = path.join(__dirname, '..', '..', 'src', 'config', 'migrations');
    expect(sha(path.join(dir, 'v001_initial.js'))).toBe('18514164a9ad3d10128e6b1c271ce7623d11835a9240fe9bf2f337bfced3eb1f');
    expect(sha(path.join(dir, 'v002_catalog.js'))).toBe('9e0718ac8ad78ee5e48a4bd41f591e3835ed3b1c653e95e6362f6041b56ba22f');
    expect(sha(path.join(dir, 'v003_manual_net.js'))).toBe('a6a480628b4cfbd4acaaab82cd091ca2d865d3c09821104cee243ab011631620');
    expect(sha(path.join(dir, 'v004_stores_settings.js'))).toBe('d8dc15e343e815b01956323e05448684bc948d2c82e17d482187f1bf0febef47');
    expect(sha(path.join(dir, 'v005_fx_sources.js'))).toBe('6892beb82a64b3975a3b169316f30bb2e989a2a7dcb8867108d2ed2f0d572c27');
  });

  test('banco v5: lojas pelo nome (sem diferenciar maiúsculas), loja renomeada com 0, vendas antigas nulas, saques intactos, backup criado', () => {
    const dbPath = dbIn('a');
    const old = openDatabase(dbPath, { migrations: upTo5 });
    old.prepare("UPDATE stores SET name = 'csmoney' WHERE name = 'CSMoney'").run();
    old.prepare("UPDATE stores SET name = 'CSFLOAT' WHERE name = 'CSFloat'").run();
    const now = '2026-11-01T00:00:00.000Z';
    old.prepare(
      `INSERT INTO stores (name, currency, is_active, is_primary, sale_fee_rounding, sale_fixed_fee_cents, allows_withdrawal,
         withdrawal_fixed_fee_cents, created_at, updated_at) VALUES ('Float', 'USD', 1, 0, 'CEIL', 0, 0, 0, ?, ?)`
    ).run(now, now);
    const csfloat = old.prepare("SELECT id FROM stores WHERE name = 'CSFLOAT'").get().id;
    const sold = insertItem(old, { name: 'Vendida', status: 'VENDIDO', storeId: csfloat });
    const stock = insertItem(old, { name: 'Estoque', storeId: csfloat });
    old.prepare("INSERT INTO withdrawals (store_id, amount_store_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, 500, 2500, 'w', 'c', 'u')").run(csfloat);
    old.prepare("INSERT INTO withdrawals (amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (1000, 'w2', 'c', 'u')").run();
    const tables = ['items', 'withdrawals', 'deposits', 'store_balances'];
    const before = Object.fromEntries(tables.map((t) => [t, old.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]));
    expect(old.pragma('user_version', { simple: true })).toBe(5);
    old.close();

    const db = openDatabase(dbPath, { now: new Date('2026-11-21T12:00:00.000Z') });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(6);
      expect(holdOf(db)).toEqual({ CSFLOAT: 7, csmoney: 7, Steam: 0, Float: 0 });
      // vendas antigas e itens em estoque: snapshot nulo
      expect(db.prepare('SELECT id, sale_hold_days_applied AS h FROM items ORDER BY id').all()).toEqual([
        { id: Number(sold), h: null }, { id: Number(stock), h: null },
      ]);
      // saques (com e sem loja): fee_cents nulo e o resto idêntico
      const withdrawals = db.prepare('SELECT * FROM withdrawals ORDER BY id').all();
      expect(withdrawals.map((w) => w.fee_cents)).toEqual([null, null]);
      expect(withdrawals[1].store_id).toBeNull();
      const strip = (rows, cols) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !cols.includes(k))));
      expect(strip(withdrawals, ['fee_cents'])).toEqual(before.withdrawals);
      expect(strip(db.prepare('SELECT * FROM items ORDER BY id').all(), ['sale_hold_days_applied'])).toEqual(before.items);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(fs.readdirSync(path.join(path.dirname(dbPath), 'backups')).some((f) => f.startsWith('inventory-v5-'))).toBe(true);
    } finally {
      db.close();
    }
  });

  test('o nome "CSMONEY" em outra caixa também recebe 7', () => {
    const dbPath = dbIn('caixa');
    const old = openDatabase(dbPath, { migrations: upTo5 });
    old.prepare("UPDATE stores SET name = 'CSMONEY' WHERE name = 'CSMoney'").run();
    old.close();
    const db = openDatabase(dbPath);
    try {
      expect(holdOf(db)).toEqual({ CSFloat: 7, Steam: 0, CSMONEY: 7 });
    } finally {
      db.close();
    }
  });

  test('banco novo: o seed grava 7/0/7 e a v6 não deixa a retenção nula', () => {
    const db = openDatabase(dbIn('novo'));
    try {
      expect(holdOf(db)).toEqual({ CSFloat: 7, Steam: 0, CSMoney: 7 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM stores WHERE sale_hold_days IS NULL').get().n).toBe(0);
    } finally {
      db.close();
    }
  });

  test('CHECKs: fee_cents >= 0, sale_hold_days de 0 a 30, snapshot só em item VENDIDO', () => {
    const db = openDatabase(dbIn('checks'));
    try {
      const csfloat = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
      for (const ok of [0, 30]) db.prepare('UPDATE stores SET sale_hold_days = ? WHERE id = ?').run(ok, csfloat);
      for (const bad of [31, -1]) {
        expect(() => db.prepare('UPDATE stores SET sale_hold_days = ? WHERE id = ?').run(bad, csfloat)).toThrow(/CHECK/);
      }
      expect(() => db.prepare('UPDATE stores SET sale_hold_days = NULL WHERE id = ?').run(csfloat)).toThrow(/NOT NULL/);

      const withdrawal = db.prepare("INSERT INTO withdrawals (store_id, amount_store_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, 500, 2500, 'w', 'c', 'u')").run(csfloat).lastInsertRowid;
      for (const ok of [0, 250, null]) db.prepare('UPDATE withdrawals SET fee_cents = ? WHERE id = ?').run(ok, withdrawal);
      expect(() => db.prepare('UPDATE withdrawals SET fee_cents = -1 WHERE id = ?').run(withdrawal)).toThrow(/CHECK/);

      const stock = insertItem(db, { name: 'E', storeId: csfloat });
      const sold = insertItem(db, { name: 'V', status: 'VENDIDO', storeId: csfloat });
      expect(() => db.prepare('UPDATE items SET sale_hold_days_applied = 7 WHERE id = ?').run(stock)).toThrow(/CHECK/);
      for (const ok of [0, 7, 30]) db.prepare('UPDATE items SET sale_hold_days_applied = ? WHERE id = ?').run(ok, sold);
      for (const bad of [31, -1]) {
        expect(() => db.prepare('UPDATE items SET sale_hold_days_applied = ? WHERE id = ?').run(bad, sold)).toThrow(/CHECK/);
      }
    } finally {
      db.close();
    }
  });

  test('reabrir um banco v6 não migra de novo nem cria outro backup', () => {
    const dbPath = dbIn('reabrir');
    openDatabase(dbPath, { migrations: upTo5 }).close();
    openDatabase(dbPath).close();
    const backups = () => fs.readdirSync(path.join(path.dirname(dbPath), 'backups')).length;
    const first = backups();
    const db = openDatabase(dbPath);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(6);
      expect(backups()).toBe(first);
    } finally {
      db.close();
    }
  });
});
