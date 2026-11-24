'use strict';

// 10.1 (D343, D353, D355a): migração v17 (item_operations, item_operation_links, item_components, items.components_imported_at)
// sobre um banco v16 com dados variados: nada muda nos dados existentes; falha faz rollback; banco mais novo é recusado.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');
const v017 = require('../../src/config/migrations/v017_item_components');

const UP_TO_16 = MIGRATIONS.filter((m) => m.version <= 16);
let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v17-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

let seq = 0;
const newPath = () => path.join(tmpRoot, `d${++seq}`, 'inventory.sqlite');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const snapshot = (d) => ({
  items: d.prepare('SELECT * FROM items ORDER BY id').all(),
  deposits: d.prepare('SELECT * FROM deposits ORDER BY id').all(),
  stores: d.prepare('SELECT * FROM stores ORDER BY id').all(),
  settings: d.prepare('SELECT * FROM settings').all(),
});

// Banco v16 com itens variados: em estoque, vendido, fora de venda, GANHEI, FACA, CAIXA, com float/pattern, mais um aporte.
function seedV16(dbPath) {
  const db = openDatabase(dbPath, { migrations: UP_TO_16 });
  const csf = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const insertItem = db.prepare(
    `INSERT INTO items (name, category, variant, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, acquired_at, status,
       sale_store_id, sale_price_cents, sale_currency, net_received_cents, net_received_manual, sold_at, off_sale_at, float_value, paint_seed, created_at, updated_at)
     VALUES (@name, @category, CASE WHEN @category IN ('SKIN','FACA','LUVA') THEN 'NORMAL' END, @type, @store, @price, 'USD', '2026-10-01T00:00:00.000Z', @status, @saleStore, @salePrice, @saleCur, @net, @manual, @soldAt,
       @offSaleAt, @float, @pattern, 'c', 'u')`
  );
  const base = {
    store: null, price: 0, status: 'EM_ESTOQUE', saleStore: null, salePrice: null, saleCur: null, net: null, manual: 0, soldAt: null,
    offSaleAt: null, float: null, pattern: null,
  };
  insertItem.run({ ...base, name: 'AK-47 | Redline', category: 'SKIN', type: 'COMPRA', store: csf, price: 1234, float: 0.1234, pattern: 661 });
  insertItem.run({ ...base, name: 'AK-47 | Redline', category: 'SKIN', type: 'COMPRA', store: csf, price: 1300, offSaleAt: '2026-10-05T00:00:00.000Z' });
  insertItem.run({
    ...base, name: 'M4A4 | Howl', category: 'SKIN', type: 'COMPRA', store: csf, price: 5000, status: 'VENDIDO', saleStore: csf, salePrice: 9000,
    saleCur: 'USD', net: 8800, manual: 1, soldAt: '2026-10-20T00:00:00.000Z',
  });
  insertItem.run({ ...base, name: 'Karambit | Fade', category: 'FACA', type: 'GANHEI' });
  insertItem.run({ ...base, name: 'Revolver Case', category: 'CAIXA', type: 'COMPRA', store: csf, price: 50 });
  db.prepare(
    `INSERT INTO deposits (store_id, amount_store_cents, amount_brl_cents, deposited_at, note, created_at, updated_at)
     VALUES (?, 20000, 100000, '2026-10-01T00:00:00.000Z', 'x', 'c', 'u')`
  ).run(csf);
  const before = snapshot(db);
  db.close();
  return before;
}

const withoutNewColumn = (rows) => rows.map(({ components_imported_at: imported, ...rest }) => {
  expect(imported).toBeNull();
  return rest;
});

test('v17 sobre v16 com dados variados: itens, aportes, lojas e configurações idênticos; tabelas novas vazias; backup da v16', () => {
  const dbPath = newPath();
  const before = seedV16(dbPath);
  const db = openDatabase(dbPath, { now: new Date('2026-11-23T12:00:00.000Z') });
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(18);
    const after = snapshot(db);
    expect(withoutNewColumn(after.items)).toEqual(before.items);
    expect(after.deposits).toEqual(before.deposits);
    expect(after.stores).toEqual(before.stores);
    expect(after.settings).toEqual(before.settings);
    for (const table of ['item_components', 'item_operations', 'item_operation_links']) {
      expect(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n).toBe(0);
    }
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
  }
  expect(fs.readdirSync(path.join(path.dirname(dbPath), 'backups')).filter((f) => /inventory-v16-/.test(f))).toHaveLength(1);
});

test('reabrir um banco já na v17 não reaplica a migração nem cria outro backup de migração', () => {
  const dbPath = newPath();
  seedV16(dbPath);
  openDatabase(dbPath).close();
  const backupsDir = path.join(path.dirname(dbPath), 'backups');
  const count = () => fs.readdirSync(backupsDir).filter((f) => /^inventory-v/.test(f)).length;
  const first = count();
  const reopened = openDatabase(dbPath);
  try {
    expect(reopened.pragma('user_version', { simple: true })).toBe(18);
  } finally {
    reopened.close();
  }
  expect(count()).toBe(first);
});

test('v17 falha no meio: rollback total (sem tabelas nem coluna), versão 16 e dados intactos; depois migra normalmente', () => {
  const dbPath = newPath();
  const before = seedV16(dbPath);
  const broken = {
    version: 17,
    name: 'item_components',
    up(db) {
      v017.up(db); // aplica tudo e só então falha
      throw new Error('quebrou depois de criar tudo');
    },
  };
  expect(() => openDatabase(dbPath, { migrations: [...UP_TO_16, broken] })).toThrow('quebrou depois de criar tudo');

  const raw = openDatabase(dbPath, { migrations: UP_TO_16 });
  try {
    expect(raw.pragma('user_version', { simple: true })).toBe(16);
    expect(raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('item_components','item_operations','item_operation_links')").get().n).toBe(0);
    expect(raw.prepare("SELECT COUNT(*) n FROM pragma_table_info('items') WHERE name = 'components_imported_at'").get().n).toBe(0);
    expect(snapshot(raw)).toEqual(before);
  } finally {
    raw.close();
  }
  const ok = openDatabase(dbPath);
  try {
    expect(ok.pragma('user_version', { simple: true })).toBe(18);
    expect(ok.prepare('SELECT COUNT(*) n FROM items').get().n).toBe(before.items.length);
  } finally {
    ok.close();
  }
});

test('banco com user_version 19 é recusado e o arquivo fica inalterado', () => {
  const dbPath = newPath();
  const raw = openDatabase(dbPath);
  raw.pragma('user_version = 19');
  raw.close();
  const before = hash(dbPath);
  expect(() => openDatabase(dbPath)).toThrow(/versão mais nova do Skins Manager/);
  expect(hash(dbPath)).toBe(before);
});

describe('restrições do esquema v17 (CHECKs e índices)', () => {
  let db;
  let itemId;
  let other;
  beforeEach(() => {
    db = openDatabase(':memory:');
    const ins = db.prepare(
      `INSERT INTO items (name, category, variant, acquisition_type, purchase_price_cents, purchase_currency, acquired_at, status, created_at, updated_at)
       VALUES ('x', 'SKIN', 'NORMAL', 'GANHEI', 0, 'USD', '2026-11-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`
    );
    itemId = ins.run().lastInsertRowid;
    other = ins.run().lastInsertRowid;
  });
  afterEach(() => db.close());

  const insert = (over = {}) => {
    const row = { item_id: itemId, kind: 'STICKER', catalog_id: null, name: 'n', slot: null, wear: null, pattern: null, source: 'MANUAL', origin: 'CAME_WITH', ...over };
    return db.prepare(
      `INSERT INTO item_components (item_id, kind, catalog_id, name, slot, wear, pattern, source, origin, created_at, updated_at)
       VALUES (@item_id, @kind, @catalog_id, @name, @slot, @wear, @pattern, @source, @origin, 'c', 'u')`
    ).run(row);
  };

  test('kind, source e origin inválidos; nome vazio ou com mais de 200 caracteres', () => {
    expect(() => insert({ kind: 'AGENTE' })).toThrow();
    expect(() => insert({ source: 'OUTRA' })).toThrow();
    expect(() => insert({ origin: 'ALGUM' })).toThrow();
    expect(() => insert({ name: '' })).toThrow();
    expect(() => insert({ name: 'a'.repeat(201) })).toThrow();
    expect(() => insert({ name: 'a'.repeat(200) })).not.toThrow();
  });

  test('wear fora de 0 a menos de 1, slot fora de 0 a 5 e pattern fora de 0 a 999999', () => {
    expect(() => insert({ wear: -0.01 })).toThrow();
    expect(() => insert({ wear: 1 })).toThrow();
    expect(() => insert({ wear: 0 })).not.toThrow();
    expect(() => insert({ wear: 0.9999, slot: 0 })).not.toThrow();
    expect(() => insert({ slot: -1 })).toThrow();
    expect(() => insert({ slot: 6 })).toThrow();
    expect(() => insert({ pattern: -1 })).toThrow();
    expect(() => insert({ pattern: 1000000 })).toThrow();
    expect(() => insert({ kind: 'CHARM', pattern: 999999 })).not.toThrow();
  });

  test('origem CAME_WITH com unidade de origem, ou APPLIED_FROM_STOCK sem ela, é recusada', () => {
    expect(() => db.prepare(
      `INSERT INTO item_components (item_id, kind, name, source, origin, source_item_id, created_at, updated_at)
       VALUES (?, 'CHARM', 'n', 'MANUAL', 'CAME_WITH', ?, 'c', 'u')`
    ).run(itemId, other)).toThrow();
    expect(() => insert({ origin: 'APPLIED_FROM_STOCK' })).toThrow();
  });

  test('slot repetido vale desde a v18 (o índice único saiu, D361): o CS2 permite dois stickers no mesmo slot', () => {
    insert({ kind: 'STICKER', slot: 0 });
    expect(() => insert({ kind: 'STICKER', slot: 0 })).not.toThrow();
    expect(() => insert({ kind: 'CHARM', slot: 0 })).not.toThrow();
    expect(() => insert({ item_id: other, kind: 'STICKER', slot: 0 })).not.toThrow();
    expect(() => insert({ kind: 'STICKER' })).not.toThrow();
    expect(() => insert({ kind: 'STICKER' })).not.toThrow();
  });

  test('item inexistente é recusado (FK) e apagar o item remove os componentes', () => {
    expect(() => insert({ item_id: 9999 })).toThrow();
    insert({ slot: 1 });
    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    expect(db.prepare('SELECT COUNT(*) n FROM item_components').get().n).toBe(0);
  });

  test('operações: kind, outcome, role e cost_share_bp inválidos; vínculo único; item com vínculo não é apagado', () => {
    const op = (kind = 'APPLY_COMPONENT', outcome = 'TRANSFERRED') => db.prepare(
      "INSERT INTO item_operations (kind, outcome, occurred_at, created_at) VALUES (?, ?, 'o', 'c')"
    ).run(kind, outcome).lastInsertRowid;
    expect(() => op('X')).toThrow();
    expect(() => op('APPLY_COMPONENT', 'Y')).toThrow();
    const id = op();
    const link = (role, share, item = itemId) => db.prepare(
      'INSERT INTO item_operation_links (operation_id, item_id, role, cost_share_bp) VALUES (?, ?, ?, ?)'
    ).run(id, item, role, share);
    expect(() => link('OUTRO', null)).toThrow();
    expect(() => link('TARGET', -1)).toThrow();
    expect(() => link('TARGET', 10001)).toThrow();
    expect(() => link('TARGET', 10000)).not.toThrow();
    expect(() => link('CONSUMED', 0)).toThrow(); // mesmo item na mesma operação
    expect(() => link('CONSUMED', 0, other)).not.toThrow();
    expect(() => db.prepare('DELETE FROM items WHERE id = ?').run(itemId)).toThrow(); // RESTRICT
  });
});
