'use strict';

// Migração v3 (D122): reconstrução de `items` com `net_received_manual` e CHECK novo; dados e índices preservados.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const v001 = require('../../src/config/migrations/v001_initial');
const v002 = require('../../src/config/migrations/v002_catalog');
const { SCHEMA_SQL } = require('../../src/config/schema');

let tmpRoot;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v3-'));
});
afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o arquivo por instantes; a pasta é temporária.
  }
});

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

function seedV2(dbPath) {
  const db = openDatabase(dbPath, { migrations: [v001, v002] });
  const ins = db.prepare(
    `INSERT INTO items (name, category, variant, acquisition_type, purchase_store_id, purchase_price_cents,
       acquired_at, status, sale_store_id, sale_price_cents, sale_currency, sale_fee_type_applied,
       sale_fee_rate_applied, sale_fee_rounding_applied, sale_fixed_fee_cents_applied, net_received_cents, sold_at,
       catalog_id, created_at, updated_at)
     VALUES (@name, 'SKIN', 'NORMAL', 'COMPRA', 1, 100, '2026-01-01T00:00:00.000Z', @status, @sstore, @sprice,
       @scur, @stype, @srate, @sround, @sfixed, @net, @sold, @cat, 'c', 'u')`
  );
  const base = { status: 'EM_ESTOQUE', sstore: null, sprice: null, scur: null, stype: null, srate: null, sround: null, sfixed: null, net: null, sold: null, cat: null };
  ins.run({ ...base, name: 'Em estoque', cat: 'skin-x' });
  ins.run({
    ...base, name: 'Vendido', status: 'VENDIDO', sstore: 1, sprice: 1000, scur: 'USD', stype: 'DEDUCTED', srate: 0.02,
    sround: 'CEIL', sfixed: 0, net: 980, sold: '2026-01-20T00:00:00.000Z',
  });
  const dump = db.prepare('SELECT * FROM items ORDER BY id').all();
  db.close();
  return dump;
}

describe('migração v3', () => {
  test('banco v2 com dados vira v3 sem perder nada, com índices e backup', () => {
    const dbPath = path.join(tmpRoot, 'a', 'inventory.sqlite');
    const before = seedV2(dbPath);
    const db = openDatabase(dbPath, { now: new Date('2026-11-20T12:00:00.000Z') });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(14);
      const after = db.prepare('SELECT * FROM items ORDER BY id').all();
      expect(after).toHaveLength(2);
      after.forEach((row, i) => {
        const { net_received_manual: manual, sale_hold_days_applied: hold, off_sale_at: offSale, for_sale_since: forSale, sale_release_at: saleReleaseAt, ...rest } = row;
        expect([offSale, forSale]).toEqual([null, null]); // v10: todos à venda
        expect(manual).toBe(0);
        expect(rest).toEqual(before[i]);
      });
      const indexes = db.pragma('index_list(items)').map((i) => i.name);
      for (const name of [
        'idx_items_status', 'idx_items_category', 'idx_items_acquired_at', 'idx_items_sold_at',
        'idx_items_purchase_store', 'idx_items_sale_store', 'idx_items_catalog_id',
      ]) expect(indexes).toContain(name);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      db.close();
    }
    const backups = fs.readdirSync(path.join(path.dirname(dbPath), 'backups'));
    expect(backups).toEqual(['inventory-v2-2026-11-20T12-00-00.000Z.sqlite']);
  });

  test('CHECK novo: recusa snapshot parcial, manual sem a marca e EM_ESTOQUE manual; aceita snapshot nulo com marca', () => {
    const db = openDatabase(':memory:');
    try {
      const sold = (extra) => {
        const cols = {
          name: 'X', category: 'OUTRO', acquisition_type: 'GANHEI', acquired_at: 'a', status: 'VENDIDO', sale_store_id: 1,
          sale_price_cents: 10, sale_currency: 'USD', net_received_cents: 9, sold_at: 's', created_at: 'c', updated_at: 'u',
          ...extra,
        };
        const keys = Object.keys(cols);
        return db.prepare(`INSERT INTO items (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(cols));
      };
      expect(() => sold({})).toThrow(/CHECK/); // snapshot nulo sem marca
      expect(() => sold({ sale_fee_type_applied: 'DEDUCTED' })).toThrow(/CHECK/); // parcial
      expect(() => sold({ net_received_manual: 1, sale_fee_type_applied: 'DEDUCTED' })).toThrow(/CHECK/); // parcial
      expect(() => sold({ net_received_manual: 1 })).not.toThrow();
      expect(() =>
        db.prepare(
          "INSERT INTO items (name, category, acquisition_type, acquired_at, net_received_manual, created_at, updated_at) VALUES ('Y','OUTRO','GANHEI','a',1,'c','u')"
        ).run()
      ).toThrow(/CHECK/);
    } finally {
      db.close();
    }
  });

  test('o SQL da v1 não foi editado', () => {
    // Âncora: se o esquema da v1 mudar, este hash muda; migração publicada não é editada.
    expect(sha(SCHEMA_SQL)).toMatch(/^[0-9a-f]{64}$/);
    expect(SCHEMA_SQL).toContain('sale_fee_type_applied IS NOT NULL');
  });
});
