'use strict';

// 9.6 (D311): migração v16 (taxa do aporte e corte anterior dos aportes e saques no lote) sobre um banco v15 com aportes e lotes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v16-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

test('v16 sobre um banco v15: as colunas nascem nulas, aportes e lotes ficam intactos, com o backup da v15', () => {
  const dbPath = path.join(tmpRoot, 'v15', 'inventory.sqlite');
  const old = openDatabase(dbPath, { migrations: MIGRATIONS.filter((m) => m.version <= 15) });
  const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  old.prepare(
    `INSERT INTO deposits (store_id, amount_store_cents, amount_brl_cents, deposited_at, note, created_at, updated_at)
     VALUES (?, 5000, NULL, '2026-11-01T00:00:00.000Z', 'base', 'c', 'u')`
  ).run(csf);
  old.prepare(
    `INSERT INTO import_batches (source, trigger, status, started_at, finished_at, cutoff_at, created_at)
     VALUES ('CSFLOAT', 'MANUAL', 'DONE', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:05.000Z', '2026-11-01T00:00:00.000Z', '2026-11-20T00:00:00.000Z')`
  ).run();
  const before = { deposits: old.prepare('SELECT * FROM deposits').all(), batches: old.prepare('SELECT * FROM import_batches').all() };
  old.close();

  const db = openDatabase(dbPath, { now: new Date('2026-11-23T12:00:00.000Z') });
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(21);
    expect(db.prepare('SELECT * FROM deposits').all().map(({ fee_cents: fee, ...rest }) => { expect(fee).toBeNull(); return rest; })).toEqual(before.deposits);
    expect(db.prepare('SELECT * FROM import_batches').all()
      .map(({ previous_transactions_cutoff_at: previous, components_filled_count: _f, components_skipped_count: _s, ...rest }) => { expect(previous).toBeNull(); return rest; })).toEqual(before.batches);
    // a taxa negativa é recusada pelo próprio banco
    expect(() => db.prepare('UPDATE deposits SET fee_cents = -1').run()).toThrow();
  } finally {
    db.close();
  }
  expect(fs.readdirSync(path.join(tmpRoot, 'v15', 'backups')).filter((f) => /inventory-v15-/.test(f))).toHaveLength(1);
});
