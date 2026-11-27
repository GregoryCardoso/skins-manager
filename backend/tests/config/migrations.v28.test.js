'use strict';

// v028 (D370): `stores.sells_here`, só ADD COLUMN. Sobre um banco v27 com dados: lojas viram 1, nada muda, CHECK vale e há backup da v27.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

const UP_TO_27 = MIGRATIONS.filter((m) => m.version <= 27);
const NOW = new Date('2026-11-27T12:00:00.000Z');
let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v28-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

test('v28 sobre v27 com dados: lojas e itens idênticos, sells_here = 1 em todas, CHECK e backup da v27', () => {
  const dbPath = path.join(tmpRoot, 'a', 'inventory.sqlite');
  const seed = openDatabase(dbPath, { migrations: UP_TO_27 });
  const csf = seed.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  seed.prepare("UPDATE stores SET is_active = 0 WHERE name = 'CSMoney'").run();
  seed.prepare(
    `INSERT INTO items (name, category, variant, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, created_at, updated_at)
     VALUES ('AK-47 | Redline', 'SKIN', 'NORMAL', 'COMPRA', ?, 1000, '2026-10-01T00:00:00.000Z', 'c', 'u')`
  ).run(csf);
  const stores = seed.prepare('SELECT * FROM stores ORDER BY id').all();
  const items = seed.prepare('SELECT * FROM items ORDER BY id').all();
  seed.close();

  const db = openDatabase(dbPath, { now: NOW });
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(28);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const after = db.prepare('SELECT * FROM stores ORDER BY id').all();
    expect(after.every((s) => s.sells_here === 1)).toBe(true);
    expect(after.map(({ sells_here: _ignored, ...rest }) => rest)).toEqual(stores);
    expect(db.prepare('SELECT * FROM items ORDER BY id').all()).toEqual(items);
    db.prepare('UPDATE stores SET sells_here = 0 WHERE id = ?').run(csf);
    expect(() => db.prepare('UPDATE stores SET sells_here = 2 WHERE id = ?').run(csf)).toThrow(/CHECK/);
    expect(() => db.prepare('UPDATE stores SET sells_here = NULL WHERE id = ?').run(csf)).toThrow();
  } finally {
    db.close();
  }
  const backups = fs.readdirSync(path.join(path.dirname(dbPath), 'backups')).filter((f) => f.startsWith('inventory-v27-'));
  expect(backups).toHaveLength(1);
});
