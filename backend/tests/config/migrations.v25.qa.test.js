'use strict';

// QA 11.4: a v25 sobre um banco v24 CHEIO não perde nada (linhas, FKs, índices, AUTOINCREMENT) e a falha no meio desfaz tudo.
// Só bancos temporários; nunca o banco real.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

const UP_TO_24 = MIGRATIONS.filter((m) => m.version <= 24);
const NOW = new Date('2026-11-25T12:00:00.000Z');
let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v25qa-')); });
afterAll(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ } });

const dumpTables = (db) => Object.fromEntries(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map((r) => [r.name, db.prepare(`SELECT * FROM ${r.name} ORDER BY 1`).all().map(({ inventory_density: _dn, ...r }) => r)])
);
const masterOf = (db) => Object.fromEntries(
  db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => [`${r.type}:${r.name}`, r])
);
const fkOf = (db) => Object.fromEntries(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map((r) => [r.name, db.prepare(`PRAGMA foreign_key_list(${r.name})`).all().map(({ id, seq, ...rest }) => rest)]) // eslint-disable-line no-unused-vars
);
const seqOf = (db) => db.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all();

// Banco v24 cheio: lojas USD e BRL, itens de todos os tipos, componentes, operações, aportes, saques, conferências, holding, fora de venda.
function makeFullV24(name) {
  const dbPath = path.join(tmpRoot, name, 'inventory.sqlite');
  const db = openDatabase(dbPath, { migrations: UP_TO_24 });
  const csfloat = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const steam = db.prepare("SELECT id FROM stores WHERE name = 'Steam'").get().id;
  db.prepare("UPDATE stores SET currency = 'BRL', sale_hold_days = 7, sale_min_fee_cents = 3, sale_fixed_fee_cents = 2, allows_withdrawal = 1, withdrawal_fee_rate = 0.0125 WHERE id = ?").run(steam);
  db.prepare("UPDATE settings SET display_currency = 'BRL', usd_brl_rate = 5.25, steam_store_id = ?").run(steam);
  db.prepare("INSERT INTO stores (name, currency, is_active, created_at, updated_at) VALUES ('Antiga', 'USD', 0, 'c', 'u')").run();

  const base = "created_at, updated_at, acquired_at";
  const ins = (cols, vals) => Number(db.prepare(`INSERT INTO items (${cols}, ${base}) VALUES (${vals.map(() => '?').join(',')}, 'c', 'u', '2026-11-01T00:00:00.000Z')`).run(...vals).lastInsertRowid);
  const usd = ins('name, category, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, off_sale_at, for_sale_since, trade_unlock_at', ['Caixa USD', 'CAIXA', 'COMPRA', csfloat, 1234, 'USD', '2026-11-05T00:00:00.000Z', '2026-11-02T00:00:00.000Z', '2026-12-01T00:00:00.000Z']);
  const brl = ins('name, category, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, fx_rate_at_purchase', ['Caixa BRL', 'CAIXA', 'COMPRA', steam, 5599, 'BRL', 5.3333]);
  const ganhei = ins('name, category, acquisition_type, purchase_price_cents', ['Brinde', 'OUTRO', 'GANHEI', 0]);
  const weapon = ins('name, category, variant, float_value, exterior, paint_seed, phase, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, catalog_id', ['AK-47 | Redline', 'SKIN', 'NORMAL', 0.1234567, 'FT', 661, null, 'COMPRA', csfloat, 9000, 'USD', 'cat-1']);
  const charm = ins('name, category, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency', ["Charm | Lil' Ava", 'PINGENTE', 'COMPRA', csfloat, 300, 'USD']);
  const generated = ins('name, category, acquisition_type, purchase_price_cents', ['Gerado', 'STICKER', 'GERADO', 0]);
  const sold = ins('name, category, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, fx_rate_at_purchase', ['Vendida BRL', 'OUTRO', 'COMPRA', steam, 1000, 'BRL', 5.2]);
  db.prepare(
    `UPDATE items SET status = 'VENDIDO', sale_store_id = ?, sale_price_cents = 9000, sale_currency = 'BRL', fx_rate_at_sale = 5.41, sale_fee_type_applied = 'ADDED',
       sale_fee_rate_applied = 0.15, sale_fee_rounding_applied = 'CEIL', sale_min_fee_cents_applied = 3, sale_fixed_fee_cents_applied = 2, net_received_cents = 7826,
       sold_at = '2026-11-10T12:00:00.000Z', sale_hold_days_applied = 7, sale_release_at = '2026-11-17T12:00:00.000Z' WHERE id = ?`
  ).run(steam, sold);
  const soldManual = ins('name, category, acquisition_type, purchase_store_id, purchase_price_cents', ['Vendida manual', 'OUTRO', 'COMPRA', csfloat, 400]);
  db.prepare(
    `UPDATE items SET status = 'VENDIDO', sale_store_id = ?, sale_price_cents = 800, sale_currency = 'USD', net_received_cents = 700, net_received_manual = 1,
       sold_at = '2026-11-12T12:00:00.000Z', sale_hold_days_applied = 0 WHERE id = ?`
  ).run(csfloat, soldManual);
  db.prepare("UPDATE items SET status = 'CONSUMIDO', consumed_at = '2026-11-06T00:00:00.000Z' WHERE id = ?").run(charm);
  // item apagado depois: o contador AUTOINCREMENT fica à frente do maior id
  const doomed = ins('name, category, acquisition_type, purchase_price_cents', ['Apagado', 'OUTRO', 'GANHEI', 0]);
  db.prepare('DELETE FROM items WHERE id = ?').run(doomed);

  const op = Number(db.prepare("INSERT INTO item_operations (kind, outcome, occurred_at, created_at, detail_json) VALUES ('APPLY_COMPONENT', 'TRANSFERRED', '2026-11-06T00:00:00.000Z', 'c', '{\"x\":1}')").run().lastInsertRowid);
  db.prepare("INSERT INTO item_operation_links (operation_id, item_id, role, cost_share_bp) VALUES (?, ?, 'CONSUMED', 10000)").run(op, charm);
  db.prepare("INSERT INTO item_operation_links (operation_id, item_id, role) VALUES (?, ?, 'TARGET')").run(op, weapon);
  db.prepare(
    `INSERT INTO item_components (item_id, kind, name, slot, source, origin, source_item_id, operation_id, created_at, updated_at)
     VALUES (?, 'CHARM', 'Charm', 0, 'MANUAL', 'APPLIED_FROM_STOCK', ?, ?, 'c', 'u')`
  ).run(weapon, charm, op);
  db.prepare("INSERT INTO item_components (item_id, kind, name, slot, wear, pattern, source, created_at, updated_at) VALUES (?, 'STICKER', 'Sticker', 1, 0.25, 77, 'CSFLOAT', 'c', 'u')").run(weapon);
  db.prepare("INSERT INTO market_prices (source, price_key, market_hash_name, status, base_price_cents, priced_at, fetched_at, created_at, updated_at) VALUES ('CSFLOAT', 'k1', 'AK-47 | Redline (Field-Tested)', 'OK', 5555, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', 'c', 'u')").run();
  db.prepare("INSERT INTO fx_rates (currency, rate, source, updated_at) VALUES ('EUR', 0.9, 'MANUAL', 'u')").run();

  db.prepare("INSERT INTO deposits (store_id, amount_store_cents, fee_cents, amount_brl_cents, deposited_at, note, created_at, updated_at) VALUES (?, 20000, 100, 100000, '2026-10-01T00:00:00.000Z', 'n', 'c', 'u')").run(csfloat);
  db.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, created_at, updated_at) VALUES (30000, '2026-09-01T00:00:00.000Z', 'c', 'u')").run();
  db.prepare("INSERT INTO withdrawals (store_id, amount_store_cents, fee_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, 5000, 100, 25000, '2026-10-20T00:00:00.000Z', 'c', 'u')").run(csfloat);
  db.prepare("INSERT INTO withdrawals (amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (30000, '2026-01-05T00:00:00.000Z', 'c', 'u')").run();
  db.prepare("INSERT INTO store_balances (store_id, balance_cents, computed_cents, adjustment_cents, fx_rate, note, recorded_at, created_at) VALUES (?, 12345, 12000, 345, 5.3, 'ajuste', '2026-11-02T00:00:00.000Z', 'c')").run(steam);

  const snapshot = { tables: dumpTables(db), master: masterOf(db), fk: fkOf(db), seq: seqOf(db), steam, doomed, maxItem: db.prepare('SELECT MAX(id) AS m FROM items').get().m };
  db.close();
  return { dbPath, ...snapshot };
}

const stripNewColumn = (rows) => rows.map(({ amount_brl_currency: currency, ...rest }) => { expect(currency).toBe('BRL'); return rest; });

describe('v25 sobre um banco v24 cheio', () => {
  let ctx;
  let db;
  beforeAll(() => {
    ctx = makeFullV24('full');
    db = openDatabase(ctx.dbPath, { now: NOW });
  });
  afterAll(() => db.close());

  test('todas as tabelas ficam com linhas idênticas (só as colunas novas de aportes e saques, em BRL)', () => {
    const after = dumpTables(db);
    delete after.catalog_item_names; // tabela da v026
    expect(db.pragma('user_version', { simple: true })).toBe(27);
    for (const name of Object.keys(ctx.tables)) {
      if (name === 'deposits' || name === 'withdrawals') expect(stripNewColumn(after[name])).toEqual(ctx.tables[name]);
      else expect({ [name]: after[name] }).toEqual({ [name]: ctx.tables[name] });
    }
    expect(Object.keys(after).sort()).toEqual(Object.keys(ctx.tables).sort());
    expect(after.items.length).toBeGreaterThanOrEqual(8);
    expect(after.settings[0].steam_store_id).toBe(ctx.steam);
  });

  test('foreign_key_check vazio e a lista de FKs de TODAS as tabelas é a mesma de antes', () => {
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const fkNow = fkOf(db);
    delete fkNow.catalog_item_names; // tabela da v026
    expect(fkNow).toEqual(ctx.fk);
  });

  test('sqlite_master: só stores, items, deposits e withdrawals mudam o SQL; índices e demais objetos idênticos', () => {
    const after = masterOf(db);
    delete after['table:catalog_item_names']; // tabela da v026
    expect(Object.keys(after).sort()).toEqual(Object.keys(ctx.master).sort());
    const changed = Object.keys(after).filter((key) => JSON.stringify(after[key]) !== JSON.stringify(ctx.master[key])).sort();
    expect(changed).toEqual(['table:deposits', 'table:items', 'table:settings', 'table:stores', 'table:withdrawals']) // settings: coluna da v027;
    expect(after['table:stores'].sql).not.toMatch(/IN \('USD','BRL'\)/);
    expect(after['table:items'].sql).not.toMatch(/IN \('USD','BRL'\)/);
    expect(after['table:stores'].sql).toMatch(/AUTOINCREMENT/);
    expect(after['table:items'].sql).toMatch(/AUTOINCREMENT/);
    // os 8 índices de items e o índice único parcial de stores existem com o mesmo SQL
    for (const key of Object.keys(ctx.master).filter((k) => k.startsWith('index:'))) expect(after[key]).toEqual(ctx.master[key]);
  });

  test('AUTOINCREMENT preservado: o contador continua à frente do maior id e o próximo id não reutiliza o apagado', () => {
    expect(seqOf(db)).toEqual(ctx.seq);
    expect(ctx.doomed).toBeGreaterThan(ctx.maxItem);
    const id = Number(db.prepare("INSERT INTO items (name, category, acquisition_type, acquired_at, created_at, updated_at) VALUES ('Novo', 'OUTRO', 'GANHEI', 'a', 'c', 'u')").run().lastInsertRowid);
    expect(id).toBe(ctx.doomed + 1);
    const storeId = Number(db.prepare("INSERT INTO stores (name, currency, created_at, updated_at) VALUES ('Nova', 'EUR', 'c', 'u')").run().lastInsertRowid);
    expect(storeId).toBe(ctx.seq.find((s) => s.name === 'stores').seq + 1);
  });

  test('as FKs continuam valendo: apagar loja/item usado é recusado (RESTRICT) e excluir a loja Steam zera steam_store_id (SET NULL)', () => {
    const csfloat = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    expect(() => db.prepare('DELETE FROM stores WHERE id = ?').run(csfloat)).toThrow(/FOREIGN KEY/);
    const weapon = db.prepare("SELECT id FROM items WHERE name = 'AK-47 | Redline'").get().id;
    expect(() => db.prepare('DELETE FROM items WHERE id = ?').run(db.prepare('SELECT id FROM items WHERE name LIKE ?').get('Charm%').id)).toThrow(/FOREIGN KEY/);
    // CASCADE de componentes ao apagar a arma (as operações referenciam o item por RESTRICT: apagamos o vínculo antes)
    db.prepare('DELETE FROM item_components').run();
    db.prepare('DELETE FROM item_operation_links WHERE item_id = ?').run(weapon);
    db.prepare('DELETE FROM items WHERE id = ?').run(weapon);
    expect(db.prepare('SELECT COUNT(*) AS n FROM item_components').get().n).toBe(0);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  test('as regras (CHECK) continuam: GERADO só USD sem loja; CONSUMIDO exige consumed_at; moeda x cotação', () => {
    const run = (sql, ...args) => db.prepare(sql).run(...args);
    expect(() => run("INSERT INTO items (name, category, acquisition_type, purchase_price_cents, purchase_currency, fx_rate_at_purchase, acquired_at, created_at, updated_at) VALUES ('g', 'OUTRO', 'GERADO', 0, 'EUR', 0.9, 'a', 'c', 'u')")).toThrow(/CHECK/);
    expect(() => run("INSERT INTO items (name, category, acquisition_type, purchase_price_cents, status, acquired_at, created_at, updated_at) VALUES ('g', 'OUTRO', 'GANHEI', 0, 'CONSUMIDO', 'a', 'c', 'u')")).toThrow(/CHECK/);
    expect(() => run("INSERT INTO items (name, category, acquisition_type, purchase_price_cents, purchase_currency, acquired_at, created_at, updated_at) VALUES ('g', 'OUTRO', 'GANHEI', 0, 'eur', 'a', 'c', 'u')")).toThrow(/CHECK/);
    expect(() => run("INSERT INTO items (name, category, acquisition_type, purchase_price_cents, purchase_currency, fx_rate_at_purchase, acquired_at, created_at, updated_at) VALUES ('g', 'OUTRO', 'GANHEI', 0, 'EU', 1, 'a', 'c', 'u')")).toThrow(/CHECK/);
    expect(() => run("UPDATE stores SET is_primary = 1, is_active = 0 WHERE name = 'Antiga'")).toThrow(/CHECK/);
    expect(() => run("INSERT INTO deposits (amount_brl_cents, amount_brl_currency, deposited_at, created_at, updated_at) VALUES (1, 'BR', 'a', 'c', 'u')")).toThrow(/CHECK/);
    expect(() => run("INSERT INTO withdrawals (amount_brl_cents, amount_brl_currency, withdrawn_at, created_at, updated_at) VALUES (1, 'EUR', 'a', 'c', 'u')")).not.toThrow();
  });
});

describe('v25: falha no meio', () => {
  test('falha depois da reconstrução: rollback total e o banco continua na v24, idêntico (tabelas, esquema, contadores)', () => {
    const real = MIGRATIONS.find((m) => m.version === 25);
    const ctx = makeFullV24('rb1');
    const failing = { ...real, up(db, c) { real.up(db, c); throw new Error('falha simulada'); } };
    expect(() => openDatabase(ctx.dbPath, { migrations: [...UP_TO_24, failing], now: NOW })).toThrow(/falha simulada/);
    const check = openDatabase(ctx.dbPath, { migrations: UP_TO_24, skipBackup: true });
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(24);
      expect(dumpTables(check)).toEqual(ctx.tables);
      expect(masterOf(check)).toEqual(ctx.master);
      expect(seqOf(check)).toEqual(ctx.seq);
      expect(check.pragma('foreign_key_check')).toEqual([]);
      expect(check.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally { check.close(); }
  });

  test('o runner religa as FKs depois da v25 (PRAGMA foreign_keys = 1 numa conexão aberta)', () => {
    const ctx = makeFullV24('fkon');
    const db = openDatabase(ctx.dbPath, { now: NOW });
    try { expect(db.pragma('foreign_keys', { simple: true })).toBe(1); } finally { db.close(); }
  });
});
