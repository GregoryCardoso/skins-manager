'use strict';

// QA da migração v3 (D122): todas as colunas preenchidas, idempotência, backup, AUTOINCREMENT e CHECK.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const v001 = require('../../src/config/migrations/v001_initial');
const v002 = require('../../src/config/migrations/v002_catalog');

let tmpRoot;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v3qa-'));
});
afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // pasta temporária
  }
});

const NOW = new Date('2026-11-20T12:00:00.000Z');

function seedFull(dbPath) {
  const db = openDatabase(dbPath, { migrations: [v001, v002] });
  const ins = db.prepare(
    `INSERT INTO items (name, category, variant, float_value, exterior, paint_seed, phase, inspect_link, asset_id,
       acquisition_type, origin_detail, purchase_store_id, purchase_price_cents, purchase_currency, fx_rate_at_purchase,
       acquired_at, trade_unlock_at, status, sale_store_id, sale_price_cents, sale_currency, fx_rate_at_sale,
       sale_fee_type_applied, sale_fee_rate_applied, sale_fee_rounding_applied, sale_min_fee_cents_applied,
       sale_fixed_fee_cents_applied, net_received_cents, sold_at, created_at, updated_at, catalog_id)
     VALUES (@name, 'SKIN', 'STATTRAK', 0.123456789, 'FT', 777, 'Phase 2', 'steam://x', 'A1', 'COMPRA', 'drop',
       @pstore, 12345, @pcur, @pfx, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z', @status, @sstore, @sprice,
       @scur, @sfx, @stype, @srate, @sround, @smin, @sfix, @net, @sold, '2026-01-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z',
       'skin-abc')`
  );
  const steam = db.prepare("SELECT id FROM stores WHERE currency = 'BRL' LIMIT 1").get().id;
  const usd = db.prepare("SELECT id FROM stores WHERE currency = 'USD' LIMIT 1").get().id;
  ins.run({ name: 'Estoque ünï\'"', pstore: steam, pcur: 'BRL', pfx: 5.43, status: 'EM_ESTOQUE', sstore: null, sprice: null, scur: null, sfx: null, stype: null, srate: null, sround: null, smin: null, sfix: null, net: null, sold: null });
  ins.run({ name: 'Vendido USD', pstore: usd, pcur: 'USD', pfx: null, status: 'VENDIDO', sstore: usd, sprice: 5000, scur: 'USD', sfx: null, stype: 'DEDUCTED', srate: 0.0525, sround: 'ROUND', smin: 5, sfix: 7, net: 4700, sold: '2026-03-01T00:00:00.000Z' });
  ins.run({ name: 'Vendido BRL', pstore: usd, pcur: 'USD', pfx: null, status: 'VENDIDO', sstore: steam, sprice: 9000, scur: 'BRL', sfx: 5.5, stype: 'ADDED', srate: 0.15, sround: 'CEIL', smin: null, sfix: 0, net: 7000, sold: '2026-03-02T00:00:00.000Z' });
  const dump = db.prepare('SELECT * FROM items ORDER BY id').all();
  const catalogCount = db.prepare('SELECT count(*) c FROM catalog_items').get().c;
  db.close();
  return { dump, catalogCount };
}

test('todas as colunas (inclusive REAL, BRL, fases, textos com aspas) idênticas após a migração; só net_received_manual é novo', () => {
  const dbPath = path.join(tmpRoot, 'full', 'inventory.sqlite');
  const { dump } = seedFull(dbPath);
  expect(dump[1].sale_min_fee_cents_applied).toBe(5);
  const db = openDatabase(dbPath, { now: NOW });
  try {
    const after = db.prepare('SELECT * FROM items ORDER BY id').all();
    expect(after).toHaveLength(3);
    after.forEach((row, i) => {
      const { net_received_manual: manual, sale_hold_days_applied: hold, off_sale_at: offSale, for_sale_since: forSale, sale_release_at: saleReleaseAt, components_imported_at: componentsImportedAt, consumed_at: consumedAt, ...rest } = row; // v6 acrescenta o snapshot
      expect(manual).toBe(0);
      expect(rest).toEqual(dump[i]);
    });
    expect(db.prepare("SELECT count(*) c FROM pragma_table_info('items')").get().c).toBe(Object.keys(dump[0]).length + 7);
  } finally {
    db.close();
  }
});

test('idempotência: reabrir não migra de novo, não cria outro backup e não altera dados', () => {
  const dbPath = path.join(tmpRoot, 'idem', 'inventory.sqlite');
  seedFull(dbPath);
  let db = openDatabase(dbPath, { now: NOW });
  const first = db.prepare('SELECT * FROM items ORDER BY id').all();
  db.close();
  db = openDatabase(dbPath, { now: new Date('2026-11-21T12:00:00.000Z') });
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(23);
    expect(db.prepare('SELECT * FROM items ORDER BY id').all()).toEqual(first);
  } finally {
    db.close();
  }
  expect(fs.readdirSync(path.join(path.dirname(dbPath), 'backups'))).toHaveLength(1);
});

test('backup feito antes de migrar é um banco v2 legível com os mesmos itens', () => {
  const dbPath = path.join(tmpRoot, 'bk', 'inventory.sqlite');
  const { dump } = seedFull(dbPath);
  openDatabase(dbPath, { now: NOW }).close();
  const Database = require('better-sqlite3');
  const bk = new Database(path.join(path.dirname(dbPath), 'backups', 'inventory-v2-2026-11-20T12-00-00.000Z.sqlite'), { readonly: true });
  try {
    expect(bk.pragma('user_version', { simple: true })).toBe(2);
    expect(bk.prepare('SELECT * FROM items ORDER BY id').all()).toEqual(dump);
  } finally {
    bk.close();
  }
});

test('catálogo, lojas e configurações não são afetados', () => {
  const dbPath = path.join(tmpRoot, 'other', 'inventory.sqlite');
  const { catalogCount } = seedFull(dbPath);
  const db = openDatabase(dbPath, { now: NOW });
  try {
    expect(db.prepare('SELECT count(*) c FROM catalog_items').get().c).toBe(catalogCount);
    expect(db.prepare('SELECT count(*) c FROM stores').get().c).toBeGreaterThan(0);
  } finally {
    db.close();
  }
});

// A v3 reconstrói `items`; o contador AUTOINCREMENT (sqlite_sequence) deve ser preservado.
test('AUTOINCREMENT: ids de itens apagados antes da migração não são reutilizados depois', () => {
  const dbPath = path.join(tmpRoot, 'seq', 'inventory.sqlite');
  seedFull(dbPath); // ids 1..3
  const Database = require('better-sqlite3');
  const raw = new Database(dbPath);
  raw.prepare('DELETE FROM items WHERE id = 3').run(); // sqlite_sequence continua em 3
  raw.close();
  const db = openDatabase(dbPath, { now: NOW });
  try {
    const info = db.prepare(
      "INSERT INTO items (name, category, acquisition_type, acquired_at, created_at, updated_at) VALUES ('Novo','OUTRO','GANHEI','a','c','u')"
    ).run();
    expect(Number(info.lastInsertRowid)).toBe(4);
  } finally {
    db.close();
  }
});

test('CHECK novo: snapshot completo com manual=1 é aceito (correção do líquido); sem taxa mínima também', () => {
  const db = openDatabase(':memory:');
  try {
    const base = {
      name: 'X', category: 'OUTRO', acquisition_type: 'GANHEI', acquired_at: 'a', status: 'VENDIDO', sale_store_id: 1,
      sale_price_cents: 10, sale_currency: 'USD', net_received_cents: 9, sold_at: 's', created_at: 'c', updated_at: 'u',
      sale_fee_type_applied: 'DEDUCTED', sale_fee_rate_applied: 0.02, sale_fee_rounding_applied: 'CEIL', sale_fixed_fee_cents_applied: 0,
    };
    const insert = (extra) => {
      const cols = { ...base, ...extra };
      const keys = Object.keys(cols);
      return db.prepare(`INSERT INTO items (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(cols));
    };
    expect(() => insert({ net_received_manual: 1 })).not.toThrow();
    expect(() => insert({ net_received_manual: 0 })).not.toThrow();
    expect(() => insert({ net_received_manual: 2 })).toThrow(/CHECK/);
    // snapshot parcial sem a coluna fixa
    expect(() => insert({ sale_fixed_fee_cents_applied: null, net_received_manual: 1 })).toThrow(/CHECK/);
    // snapshot parcial: só o tipo preenchido, com manual
    expect(() =>
      insert({ sale_fee_rate_applied: null, sale_fee_rounding_applied: null, sale_fixed_fee_cents_applied: null, net_received_manual: 1 })
    ).toThrow(/CHECK/);
    // snapshot nulo, mas com min_fee preenchido (parcial)
    expect(() =>
      insert({
        sale_fee_type_applied: null, sale_fee_rate_applied: null, sale_fee_rounding_applied: null,
        sale_fixed_fee_cents_applied: null, sale_min_fee_cents_applied: 3, net_received_manual: 1,
      })
    ).toThrow(/CHECK/);
  } finally {
    db.close();
  }
});

test('se a migração falhar, o banco continua v2 e intacto (transação)', () => {
  const dbPath = path.join(tmpRoot, 'fail', 'inventory.sqlite');
  const { dump } = seedFull(dbPath);
  const v3 = require('../../src/config/migrations/v003_manual_net');
  const broken = { ...v3, up(db) { v3.up(db); throw new Error('boom'); } };
  expect(() => openDatabase(dbPath, { migrations: [v001, v002, broken], now: NOW })).toThrow('boom');
  const db = openDatabase(dbPath, { migrations: [v001, v002], now: NOW });
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(db.prepare('SELECT * FROM items ORDER BY id').all()).toEqual(dump);
  } finally {
    db.close();
  }
});
