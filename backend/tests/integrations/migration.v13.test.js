'use strict';

// 9.2 (D318 seção 2): migração v13 (tabelas da importação) sobre um banco v12 com dados. Bancos de arquivo temporários.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v13-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

const NEW_TABLES = ['import_batches', 'external_records', 'external_links', 'import_batch_entries'];
const hasTable = (db, name) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

test('v13 sobre um banco v12 com dados: nada se perde, as quatro tabelas nascem vazias e STRICT, com o backup da v12', () => {
  const dbPath = path.join(tmpRoot, 'v12', 'inventory.sqlite');
  const old = openDatabase(dbPath, { migrations: MIGRATIONS.filter((m) => m.version <= 12) });
  const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, status, created_at, updated_at)
     VALUES ('Caixa A', 'CAIXA', 'COMPRA', ?, 500, '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`
  ).run(csf);
  old.prepare("UPDATE integrations SET api_key = 'CHAVE-FICTICIA-1234', last_import_status = 'OK', last_import_at = '2026-11-01T00:00:00.000Z'").run();
  const before = {
    items: old.prepare('SELECT * FROM items').all(),
    integrations: old.prepare('SELECT * FROM integrations').all(),
    stores: old.prepare('SELECT * FROM stores').all(),
  };
  for (const name of NEW_TABLES) expect(hasTable(old, name)).toBe(false);
  old.close();

  const db = openDatabase(dbPath, { now: new Date('2026-11-22T12:00:00.000Z') });
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(26);
    // a v14 acrescenta só `sale_release_at` (nula) em items
    expect(db.prepare('SELECT * FROM items').all().map(({ sale_release_at: saleReleaseAt, components_imported_at: componentsImportedAt, consumed_at: consumedAt, ...rest }) => { expect(saleReleaseAt).toBeNull(); return rest; })).toEqual(before.items);
    expect(db.prepare('SELECT * FROM stores').all()).toEqual(before.stores);
    expect(db.prepare('SELECT * FROM integrations').all()).toEqual(before.integrations);
    for (const name of NEW_TABLES) {
      expect(hasTable(db, name)).toBe(true);
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n).toBe(0);
      expect(db.prepare('SELECT strict FROM pragma_table_list WHERE name = ?').get(name).strict).toBe(1);
    }
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    db.close();
  }
  const backups = fs.readdirSync(path.join(path.dirname(dbPath), 'backups'));
  expect(backups.some((f) => /inventory-v12-/.test(f))).toBe(true);
});

test('restrições: lote FAILED exige error_code; UNDONE exige undone_at; vínculo único por lançamento; registro de trade exige direção (salvo RETRY)', () => {
  const dbPath = path.join(tmpRoot, 'checks', 'inventory.sqlite');
  const db = openDatabase(dbPath);
  try {
    const batch = (status, extra = '') =>
      db.prepare(`INSERT INTO import_batches (source, trigger, status, started_at, finished_at, created_at${extra ? ', error_code' : ''}) VALUES ('CSFLOAT','MANUAL',?,'a','b','c'${extra ? ', ?' : ''})`);
    expect(() => batch('FAILED').run('FAILED')).toThrow();
    expect(() => batch('FAILED', 'x').run('FAILED', 'IMPORT_SOURCE_UNREACHABLE')).not.toThrow();
    expect(() => batch('UNDONE').run('UNDONE')).toThrow();
    const record = (tracking, direction) =>
      db.prepare(
        `INSERT INTO external_records (source, kind, external_id, direction, tracking, external_created_at, last_seen_at, created_at, updated_at)
         VALUES ('CSFLOAT','TRADE',?,?,?,'a','b','c','d')`
      ).run(`id-${Math.random()}`, direction, tracking);
    expect(() => record('OPEN', null)).toThrow();
    expect(() => record('RETRY', null)).not.toThrow();
    expect(() => record('OPEN', 'BUY')).not.toThrow();
    expect(() => record('INVENTADO', 'BUY')).toThrow();
    const rec = db.prepare("SELECT id FROM external_records WHERE tracking = 'OPEN'").get().id;
    const batchId = db.prepare('SELECT id FROM import_batches LIMIT 1').get().id;
    const link = (entityId) =>
      db.prepare("INSERT INTO external_links (record_id, entity_type, entity_id, link_kind, batch_id, entity_updated_at, created_at) VALUES (?,'ITEM_PURCHASE',?,'CREATED',?,'u','c')").run(rec, entityId, batchId);
    expect(() => link(7)).not.toThrow();
    expect(() => link(8)).toThrow(); // um vínculo por registro
  } finally {
    db.close();
  }
});
