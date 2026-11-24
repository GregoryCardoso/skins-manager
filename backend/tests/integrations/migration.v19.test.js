'use strict';

// 10.3 (D362): migração v19 (reconstrução de `items` e `catalog_items`: status CONSUMIDO, aquisição GERADO, categoria PATCH, fonte
// PATCHES, `consumed_at`) sobre um banco v18 cheio de dados: ids, valores, `sqlite_sequence`, índices, chaves estrangeiras e números
// do app idênticos; falha no meio faz rollback; backup da v18 antes de migrar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');
const v019 = require('../../src/config/migrations/v019_consumed_generated_patch');

const UP_TO_18 = MIGRATIONS.filter((m) => m.version <= 18);
const NOW = new Date('2026-11-24T12:00:00.000Z');
let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v19-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

let seq = 0;
const newPath = () => path.join(tmpRoot, `d${++seq}`, 'inventory.sqlite');
const backupsOf = (dbPath) => {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('inventory-v18-')) : [];
};
const snapshot = (d) => ({
  items: d.prepare('SELECT * FROM items ORDER BY id').all().map(({ consumed_at: consumed, ...rest }) => {
    expect(consumed === undefined || consumed === null).toBe(true);
    return rest;
  }),
  catalog: d.prepare('SELECT * FROM catalog_items ORDER BY id').all(),
  components: d.prepare('SELECT * FROM item_components ORDER BY id').all(),
  operations: d.prepare('SELECT * FROM item_operations ORDER BY id').all().map(({ detail_json: detail, ...rest }) => rest), // a v19 acrescenta detail_json
  links: d.prepare('SELECT * FROM item_operation_links ORDER BY id').all(),
  stores: d.prepare('SELECT * FROM stores ORDER BY id').all(),
  deposits: d.prepare('SELECT * FROM deposits ORDER BY id').all(),
  settings: d.prepare('SELECT * FROM settings').all(),
  sequence: d.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'items'").get(),
});

// Banco v18 com itens à venda, no holding, em trade lock, vendidos (USD e BRL, com taxa e líquido manual), compra GANHEI, componentes,
// um item apagado (o contador não pode voltar) e um catálogo.
function seedV18(dbPath) {
  const db = openDatabase(dbPath, { migrations: UP_TO_18 });
  const csf = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const steam = db.prepare("SELECT id FROM stores WHERE name = 'Steam'").get().id;
  const insert = db.prepare(
    `INSERT INTO items (name, category, variant, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, fx_rate_at_purchase,
       acquired_at, trade_unlock_at, status, off_sale_at, for_sale_since, created_at, updated_at)
     VALUES (@name, @category, @variant, @type, @store, @price, @currency, @fx, @acquired, @unlock, 'EM_ESTOQUE', @off, @forSale, '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z')`
  );
  const base = { category: 'SKIN', variant: 'NORMAL', type: 'COMPRA', store: csf, price: 1000, currency: 'USD', fx: null, acquired: '2026-10-01T00:00:00.000Z', unlock: null, off: null, forSale: null };
  const ak = Number(insert.run({ ...base, name: 'AK-47 | Redline' }).lastInsertRowid);
  const holding = Number(insert.run({ ...base, name: 'AWP | Dragon Lore', price: 5000, off: '2026-10-10T00:00:00.000Z' }).lastInsertRowid);
  insert.run({ ...base, name: 'M4A4 | Howl', unlock: '2026-12-01T00:00:00.000Z' });
  const brl = Number(insert.run({ ...base, name: 'Glock-18 | Fade', store: steam, price: 5400, currency: 'BRL', fx: 5.4, forSale: '2026-10-20T00:00:00.000Z' }).lastInsertRowid);
  const won = Number(insert.run({ ...base, name: 'Desert Eagle | Blaze', type: 'GANHEI', store: null, price: 0 }).lastInsertRowid);
  const gone = Number(insert.run({ ...base, name: 'Apagado' }).lastInsertRowid);
  const sell = db.prepare(
    `UPDATE items SET status = 'VENDIDO', sale_store_id = ?, sale_price_cents = ?, sale_currency = ?, fx_rate_at_sale = ?, sale_fee_type_applied = ?,
       sale_fee_rate_applied = ?, sale_fee_rounding_applied = ?, sale_fixed_fee_cents_applied = ?, net_received_cents = ?, net_received_manual = ?,
       sold_at = '2026-11-10T12:00:00.000Z', sale_hold_days_applied = 7, sale_release_at = '2026-11-17T12:00:00.000Z' WHERE id = ?`
  );
  sell.run(csf, 2000, 'USD', null, 'DEDUCTED', 0.02, 'CEIL', 0, 1960, 0, holding);
  sell.run(steam, 9000, 'BRL', 5.5, null, null, null, null, 7800, 1, won);
  db.prepare("DELETE FROM items WHERE id = ?").run(gone);
  const comp = db.prepare(
    `INSERT INTO item_components (item_id, kind, catalog_id, name, slot, wear, pattern, source, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'c', 'u')`
  );
  comp.run(ak, 'STICKER', 'Sticker | Fly High', 0, 0.1, null, 'MANUAL');
  comp.run(ak, 'CHARM', "Charm | Lil' Teacup", 0, null, 84492, 'CSFLOAT');
  // operação (a v17 deixa as tabelas prontas): uma linha com vínculo, para conferir que a FK sobrevive à reconstrução
  const op = Number(db.prepare("INSERT INTO item_operations (kind, outcome, occurred_at, created_at) VALUES ('APPLY_COMPONENT', 'TRANSFERRED', '2026-10-05T00:00:00.000Z', 'c')").run().lastInsertRowid);
  db.prepare("INSERT INTO item_operation_links (operation_id, item_id, role) VALUES (?, ?, 'TARGET')").run(op, ak);
  db.prepare(
    `INSERT INTO deposits (store_id, amount_store_cents, amount_brl_cents, deposited_at, note, created_at, updated_at)
     VALUES (?, 20000, 100000, '2026-10-01T00:00:00.000Z', 'x', 'c', 'u')`
  ).run(csf);
  db.prepare(
    `INSERT INTO catalog_items (id, source, category, name, name_key, search_text, updated_at)
     VALUES ('skin-ak', 'SKINS', 'SKIN', 'AK-47 | Redline', 'ak-47 | redline', 'ak-47 | redline', 'u')`
  ).run();
  const before = snapshot(db);
  db.close();
  return { before, ids: { ak, brl, brlStore: steam } };
}

test('v19 sobre v18 cheio de dados: linhas idênticas, contador preservado, índices e FKs íntegros, backup da v18', () => {
  const dbPath = newPath();
  const { before } = seedV18(dbPath);
  expect(before.items).toHaveLength(5);
  const db = openDatabase(dbPath, { now: NOW });
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(19);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const after = snapshot(db);
    for (const key of Object.keys(before)) expect(after[key]).toEqual(before[key]);
    // o id apagado não volta: o próximo item recebe id > 6
    const insert = db.prepare(
      `INSERT INTO items (name, category, acquisition_type, purchase_price_cents, acquired_at, created_at, updated_at)
       VALUES ('Novo', 'OUTRO', 'GANHEI', 0, '2026-11-01T00:00:00.000Z', 'c', 'u')`
    );
    expect(Number(insert.run().lastInsertRowid)).toBeGreaterThan(6);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'items'").all().map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining([
      'idx_items_status', 'idx_items_category', 'idx_items_acquired_at', 'idx_items_sold_at', 'idx_items_purchase_store', 'idx_items_sale_store',
      'idx_items_catalog_id', 'idx_items_off_sale_at',
    ]));
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['idx_catalog_items_category_key', 'idx_item_components_operation']));
    expect(db.prepare("SELECT name FROM pragma_table_info('item_operations')").all().map((r) => r.name)).toContain('detail_json');
  } finally {
    db.close();
  }
  expect(backupsOf(dbPath)).toHaveLength(1);
});

test('depois da v19: CONSUMIDO, GERADO, PATCH e a fonte PATCHES gravam; combinações inválidas continuam recusadas', () => {
  const dbPath = newPath();
  seedV18(dbPath);
  const db = openDatabase(dbPath, { now: NOW });
  try {
    const insert = (sql) => db.prepare(sql).run();
    const cols = '(name, category, acquisition_type, purchase_price_cents, acquired_at, status, consumed_at, created_at, updated_at)';
    expect(() => insert(`INSERT INTO items ${cols} VALUES ('Sticker', 'STICKER', 'GANHEI', 0, 'a', 'CONSUMIDO', '2026-11-01T00:00:00.000Z', 'c', 'u')`)).not.toThrow();
    expect(() => insert(`INSERT INTO items ${cols} VALUES ('Patch | X', 'PATCH', 'GERADO', 0, 'a', 'EM_ESTOQUE', NULL, 'c', 'u')`)).not.toThrow();
    // CONSUMIDO sem consumed_at, e consumed_at sem CONSUMIDO
    expect(() => insert(`INSERT INTO items ${cols} VALUES ('x', 'STICKER', 'GANHEI', 0, 'a', 'CONSUMIDO', NULL, 'c', 'u')`)).toThrow();
    expect(() => insert(`INSERT INTO items ${cols} VALUES ('x', 'STICKER', 'GANHEI', 0, 'a', 'EM_ESTOQUE', 'z', 'c', 'u')`)).toThrow();
    // GERADO com preço
    expect(() => insert(`INSERT INTO items ${cols} VALUES ('x', 'STICKER', 'GERADO', 5, 'a', 'EM_ESTOQUE', NULL, 'c', 'u')`)).toThrow();
    // CONSUMIDO com dados de venda
    expect(() => insert("UPDATE items SET status = 'CONSUMIDO', consumed_at = 'z', sold_at = 'z' WHERE id = 1")).toThrow();
    expect(() => insert("INSERT INTO catalog_items (id, source, category, name, name_key, search_text, updated_at) VALUES ('patch-1', 'PATCHES', 'PATCH', 'Patch | A', 'patch | a', 'patch | a', 'u')")).not.toThrow();
  } finally {
    db.close();
  }
});

test('v19 falha no meio: rollback total, versão 18 e dados intactos; depois migra normalmente', () => {
  const dbPath = newPath();
  const { before } = seedV18(dbPath);
  const broken = { ...v019, up(d) { v019.up(d); throw new Error('falha simulada'); } };
  const migrations = [...UP_TO_18, broken];
  expect(() => openDatabase(dbPath, { migrations, now: NOW })).toThrow(/falha simulada/);
  const raw = openDatabase(dbPath, { migrations: UP_TO_18, now: NOW });
  try {
    expect(raw.pragma('user_version', { simple: true })).toBe(18);
    const after = snapshot(raw);
    for (const key of Object.keys(before)) expect(after[key]).toEqual(before[key]);
    expect(raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'items'").get().sql).not.toContain('CONSUMIDO');
  } finally {
    raw.close();
  }
  const ok = openDatabase(dbPath, { now: NOW });
  try {
    expect(ok.pragma('user_version', { simple: true })).toBe(19);
    expect(ok.prepare('SELECT COUNT(*) AS n FROM items').get().n).toBe(5);
  } finally {
    ok.close();
  }
});

test('a migração tem número e nome estáveis e é a última', () => {
  expect(v019).toMatchObject({ version: 19, name: 'consumed_generated_patch', disableForeignKeys: true });
  expect(MIGRATIONS[MIGRATIONS.length - 1].version).toBe(19);
});
