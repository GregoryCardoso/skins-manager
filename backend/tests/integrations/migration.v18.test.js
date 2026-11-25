'use strict';

// 10.2 (D361): migração v18 (índice único de slot removido; contagens de componentes no lote) sobre um banco v17 com dados:
// nada muda nos dados existentes; dois stickers no mesmo slot passam a gravar; falha faz rollback; backup antes de migrar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');
const v018 = require('../../src/config/migrations/v018_component_slots_and_batch_counts');

const UP_TO_17 = MIGRATIONS.filter((m) => m.version <= 17);
let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v18-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

let seq = 0;
const newPath = () => path.join(tmpRoot, `d${++seq}`, 'inventory.sqlite');
const snapshot = (d) => ({
  items: d.prepare('SELECT * FROM items ORDER BY id').all().map(({ consumed_at: consumed, ...rest }) => rest), // a v19 acrescenta consumed_at
  components: d.prepare('SELECT * FROM item_components ORDER BY id').all(),
  deposits: d.prepare('SELECT * FROM deposits ORDER BY id').all().map(({ amount_brl_currency: _abc, ...r }) => r),
  stores: d.prepare('SELECT * FROM stores ORDER BY id').all(),
  settings: d.prepare('SELECT * FROM settings').all().map(({ steam_store_id: _steam, price_refresh_started_at: _p1, price_refresh_last_at: _p2, price_refresh_last_status: _p3, price_refresh_last_error_code: _p4, display_currency: _dc, ...r }) => r),
  batches: d.prepare('SELECT * FROM import_batches ORDER BY id').all(),
});
const withoutBatchColumns = (rows) => rows.map(({ components_filled_count: filled, components_skipped_count: skipped, ...rest }) => {
  expect(filled).toBe(0);
  expect(skipped).toBe(0);
  return rest;
});

// Banco v17 com itens, componentes (um por tipo, sem slot repetido, como a v17 exigia), aporte e um lote de importação.
function seedV17(dbPath) {
  const db = openDatabase(dbPath, { migrations: UP_TO_17 });
  const csf = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const item = db.prepare(
    `INSERT INTO items (name, category, variant, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, acquired_at, status,
       components_imported_at, created_at, updated_at)
     VALUES (?, 'SKIN', 'NORMAL', 'COMPRA', ?, ?, 'USD', '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', ?, 'c', 'u')`
  );
  const a = item.run('AK-47 | Redline', csf, 1234, '2026-11-01T00:00:00.000Z').lastInsertRowid;
  item.run('M4A4 | Howl', csf, 5000, null);
  const comp = db.prepare(
    `INSERT INTO item_components (item_id, kind, catalog_id, name, slot, wear, pattern, source, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'c', 'u')`
  );
  comp.run(a, 'STICKER', 'Sticker | Fly High', 0, 0.1, null, 'MANUAL');
  comp.run(a, 'STICKER', 'Sticker | Clavis', 1, 0, null, 'CSFLOAT');
  comp.run(a, 'CHARM', "Charm | Lil' Teacup", 0, null, 84492, 'CSFLOAT');
  db.prepare(
    `INSERT INTO deposits (store_id, amount_store_cents, amount_brl_cents, deposited_at, note, created_at, updated_at)
     VALUES (?, 20000, 100000, '2026-10-01T00:00:00.000Z', 'x', 'c', 'u')`
  ).run(csf);
  db.prepare(
    `INSERT INTO import_batches (source, trigger, status, started_at, finished_at, full_scan, cutoff_at, purchases_created, created_at)
     VALUES ('CSFLOAT', 'MANUAL', 'DONE', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:01.000Z', 1, '2026-11-01T00:00:00.000Z', 2, '2026-11-20T00:00:00.000Z')`
  ).run();
  const before = snapshot(db);
  db.close();
  return { before, itemId: Number(a) };
}

test('v18 sobre v17 com dados: tudo idêntico; o índice de slot sai; as colunas do lote nascem em 0; backup da v17', () => {
  const dbPath = newPath();
  const { before } = seedV17(dbPath);
  const db = openDatabase(dbPath, { now: new Date('2026-11-24T12:00:00.000Z') });
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(26);
    const after = snapshot(db);
    expect(after.items).toEqual(before.items);
    expect(after.components).toEqual(before.components);
    expect(after.deposits).toEqual(before.deposits);
    expect(after.stores).toEqual(before.stores);
    expect(after.settings).toEqual(before.settings);
    expect(withoutBatchColumns(after.batches)).toEqual(before.batches);
    expect(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'idx_item_components_slot'").get().n).toBe(0);
    // os demais índices de componentes continuam
    expect(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('idx_item_components_item','idx_item_components_source_item')").get().n).toBe(2);
    const columns = db.prepare("SELECT name, \"notnull\" AS nn, dflt_value AS dv FROM pragma_table_info('import_batches') WHERE name LIKE 'components_%'").all();
    expect(columns).toEqual([
      { name: 'components_filled_count', nn: 1, dv: '0' },
      { name: 'components_skipped_count', nn: 1, dv: '0' },
    ]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
  }
  expect(fs.readdirSync(path.join(path.dirname(dbPath), 'backups')).filter((f) => /inventory-v17-/.test(f))).toHaveLength(1);
});

test('depois da v18, dois stickers no mesmo slot do mesmo item gravam (posicionamento livre do CS2)', () => {
  const dbPath = newPath();
  const { itemId } = seedV17(dbPath);
  const db = openDatabase(dbPath);
  try {
    const insert = db.prepare(
      `INSERT INTO item_components (item_id, kind, name, slot, wear, source, created_at, updated_at) VALUES (?, 'STICKER', ?, 4, ?, 'CSFLOAT', 'c', 'u')`
    );
    insert.run(itemId, 'Sticker | Scavenger', 0);
    expect(() => insert.run(itemId, 'Sticker | Flickshot', 0.5)).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) n FROM item_components WHERE item_id = ? AND slot = 4').get(itemId).n).toBe(2);
    // as demais restrições continuam: desgaste 1 e slot 6 são recusados
    expect(() => insert.run(itemId, 'x', 1)).toThrow();
    expect(() => db.prepare("INSERT INTO item_components (item_id, kind, name, slot, source, created_at, updated_at) VALUES (?, 'STICKER', 'x', 6, 'MANUAL', 'c', 'u')").run(itemId)).toThrow();
  } finally {
    db.close();
  }
});

test('reabrir um banco já na v18 não reaplica a migração nem cria outro backup', () => {
  const dbPath = newPath();
  seedV17(dbPath);
  openDatabase(dbPath).close();
  const dir = path.join(path.dirname(dbPath), 'backups');
  const count = () => fs.readdirSync(dir).filter((f) => /^inventory-v/.test(f)).length;
  const first = count();
  openDatabase(dbPath).close();
  expect(count()).toBe(first);
});

test('v18 falha no meio: rollback total (índice de volta, sem colunas), versão 17 e dados intactos; depois migra', () => {
  const dbPath = newPath();
  const { before } = seedV17(dbPath);
  const broken = {
    version: 18,
    name: 'component_slots_and_batch_counts',
    up(db) {
      v018.up(db);
      throw new Error('quebrou depois de aplicar tudo');
    },
  };
  expect(() => openDatabase(dbPath, { migrations: [...UP_TO_17, broken] })).toThrow('quebrou depois de aplicar tudo');
  const raw = openDatabase(dbPath, { migrations: UP_TO_17 });
  try {
    expect(raw.pragma('user_version', { simple: true })).toBe(17);
    expect(raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'idx_item_components_slot'").get().n).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) n FROM pragma_table_info('import_batches') WHERE name LIKE 'components_%'").get().n).toBe(0);
    expect(snapshot(raw)).toEqual(before);
  } finally {
    raw.close();
  }
  const ok = openDatabase(dbPath);
  try {
    expect(ok.pragma('user_version', { simple: true })).toBe(26);
  } finally {
    ok.close();
  }
});

test('a migração v18 continua com número e nome estáveis (a última é a v19, D362) tem número e nome estáveis', () => {
  expect(v018).toMatchObject({ version: 18, name: 'component_slots_and_batch_counts' });
  expect(MIGRATIONS.some((m) => m.version === 18)).toBe(true);
});
