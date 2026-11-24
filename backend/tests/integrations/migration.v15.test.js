'use strict';

// 9.5.1c (D326): migração v15 (corte anterior no lote) sobre um banco v14 com lotes. Bancos de arquivo temporários.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v15-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

test('v15 sobre um banco v14 com lotes: a coluna nasce nula e nada mais muda; o backup da v14 é feito', () => {
  const dbPath = path.join(tmpRoot, 'v14', 'inventory.sqlite');
  const old = openDatabase(dbPath, { migrations: MIGRATIONS.filter((m) => m.version <= 14) });
  old.prepare(
    `INSERT INTO import_batches (source, trigger, status, started_at, finished_at, cutoff_at, purchases_created, created_at)
     VALUES ('CSFLOAT', 'MANUAL', 'DONE', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:05.000Z', '2026-11-01T00:00:00.000Z', 2, '2026-11-20T00:00:00.000Z')`
  ).run();
  const before = old.prepare('SELECT * FROM import_batches').all();
  expect(old.prepare("SELECT 1 FROM pragma_table_info('import_batches') WHERE name = 'previous_trades_cutoff_at'").get()).toBeUndefined();
  old.close();

  const db = openDatabase(dbPath, { now: new Date('2026-11-23T12:00:00.000Z') });
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(17);
    const after = db.prepare('SELECT * FROM import_batches').all();
    expect(after.map(({ previous_trades_cutoff_at: previous, previous_transactions_cutoff_at: previousTx, ...rest }) => { expect(previous).toBeNull(); return rest; })).toEqual(before);
  } finally {
    db.close();
  }
  const backups = fs.readdirSync(path.join(tmpRoot, 'v14', 'backups')).filter((f) => /inventory-v14-/.test(f));
  expect(backups).toHaveLength(1);
});
