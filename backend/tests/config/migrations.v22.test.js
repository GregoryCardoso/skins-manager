'use strict';

// 10.7 (D366): migração v22 (`item_operations.ended_by_operation_id`, só ADD COLUMN e CREATE INDEX) sobre um banco v21 com itens, operações,
// vínculos e componentes: linhas idênticas, coluna nula, FKs íntegras e backup da v21 antes de migrar. Bancos temporários; nada no %APPDATA%.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

const UP_TO_21 = MIGRATIONS.filter((m) => m.version <= 21);
const NOW = new Date('2026-11-24T12:00:00.000Z');
let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v22-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

const dump = (db) => ({
  items: db.prepare('SELECT * FROM items ORDER BY id').all(),
  operations: db.prepare('SELECT * FROM item_operations ORDER BY id').all().map(({ ended_by_operation_id: ended, ...rest }) => rest),
  links: db.prepare('SELECT * FROM item_operation_links ORDER BY id').all(),
  components: db.prepare('SELECT * FROM item_components ORDER BY id').all(),
});

test('v22 sobre v21 cheio de operações: dados idênticos, coluna nula, índice criado e backup da v21', () => {
  const dbPath = path.join(tmpRoot, 'a', 'inventory.sqlite');
  const seed = openDatabase(dbPath, { migrations: UP_TO_21 });
  const csf = seed.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const insert = seed.prepare(
    `INSERT INTO items (name, category, variant, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, created_at, updated_at)
     VALUES (?, ?, ?, 'COMPRA', ?, ?, '2026-10-01T00:00:00.000Z', 'c', 'u')`
  );
  const ak = Number(insert.run('AK-47 | Redline', 'SKIN', 'NORMAL', csf, 1000).lastInsertRowid);
  const charm = Number(insert.run("Charm | Lil' Ava", 'PINGENTE', null, csf, 300).lastInsertRowid);
  const op = Number(seed.prepare("INSERT INTO item_operations (kind, outcome, occurred_at, created_at) VALUES ('APPLY_COMPONENT', 'TRANSFERRED', '2026-10-05T00:00:00.000Z', 'c')").run().lastInsertRowid);
  seed.prepare("INSERT INTO item_operation_links (operation_id, item_id, role) VALUES (?, ?, 'CONSUMED')").run(op, charm);
  seed.prepare("INSERT INTO item_operation_links (operation_id, item_id, role) VALUES (?, ?, 'TARGET')").run(op, ak);
  seed.prepare("UPDATE items SET status = 'CONSUMIDO', consumed_at = '2026-10-05T00:00:00.000Z' WHERE id = ?").run(charm);
  seed.prepare(
    `INSERT INTO item_components (item_id, kind, catalog_id, name, slot, source, origin, source_item_id, operation_id, created_at, updated_at)
     VALUES (?, 'CHARM', NULL, 'Charm | Lil Ava', 0, 'MANUAL', 'APPLIED_FROM_STOCK', ?, ?, 'c', 'u')`
  ).run(ak, charm, op);
  const before = dump(seed);
  seed.close();

  const db = openDatabase(dbPath, { now: NOW });
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(23);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(dump(db)).toEqual(before);
    expect(db.prepare('SELECT ended_by_operation_id AS ended FROM item_operations').all()).toEqual([{ ended: null }]);
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
    expect(names).toContain('idx_item_operations_ended_by');
  } finally {
    db.close();
  }
  const backups = fs.readdirSync(path.join(path.dirname(dbPath), 'backups')).filter((f) => f.startsWith('inventory-v21-'));
  expect(backups).toHaveLength(1);
});

test('migração v22 aplicada duas vezes não repete (idempotente pelo user_version)', () => {
  const dbPath = path.join(tmpRoot, 'b', 'inventory.sqlite');
  openDatabase(dbPath, { now: NOW }).close();
  const again = openDatabase(dbPath, { now: NOW });
  try {
    expect(again.pragma('user_version', { simple: true })).toBe(23);
  } finally {
    again.close();
  }
});
