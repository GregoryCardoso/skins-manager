'use strict';

// QA 11.5: migração v026 sobre um banco v25 cheio (catálogo, itens ligados ao catálogo, componentes e operações). Nada muda além da tabela nova;
// nomes vazios/só com espaços não entram; rollback em caso de falha; idempotência; importação de backups v23, v24 e v25. Só bancos temporários.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

const V26 = MIGRATIONS.find((m) => m.version === 26);
const upTo = (v) => MIGRATIONS.filter((m) => m.version <= v);
const NOW = new Date('2026-11-25T12:00:00.000Z');
let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v26qa-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

function dumpAll(db, skip = []) {
  const out = {};
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  for (const { name } of tables) if (!skip.includes(name)) out[name] = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(({ inventory_density: _dn, sells_here: _sh, ...r }) => r);
  return out;
}

function seedFullV25(dir, version = 25) {
  const dbPath = path.join(tmpRoot, dir, 'inventory.sqlite');
  const db = openDatabase(dbPath, { migrations: upTo(version) });
  const csf = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const cat = db.prepare(
    `INSERT INTO catalog_items (id, source, category, name, name_pt_br, name_key, search_text, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'u')`
  );
  cat.run('skin-ak', 'SKINS', 'SKIN', 'AK-47 | Redline', 'AK-47 | Linha Vermelha', 'ak-47 | redline', 'ak-47 | redline ak-47 | linha vermelha');
  cat.run('skin-vazio', 'SKINS', 'SKIN', 'Glock-18 | Fade', '', 'glock-18 | fade', 'glock-18 | fade');
  cat.run('skin-espacos', 'SKINS', 'SKIN', 'M4A4 | Howl', '   \t ', 'm4a4 | howl', 'm4a4 | howl');
  cat.run('skin-nulo', 'SKINS', 'SKIN', 'AWP | Asiimov', null, 'awp | asiimov', 'awp | asiimov');
  cat.run('sticker-1', 'STICKERS', 'STICKER', 'Sticker | Titan | 2014', '  Adesivo | Titan | 2014  ', 'sticker | titan | 2014', 'x');
  cat.run('keychain-1', 'KEYCHAINS', 'PINGENTE', 'Charm | Lil Ava', 'Pingente | Lil Ava', 'charm | lil ava', 'x');
  const insItem = db.prepare(
    `INSERT INTO items (name, category, variant, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, acquired_at, status, created_at, updated_at, catalog_id)
     VALUES (?, ?, ?, 'COMPRA', ?, ?, 'USD', '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u', ?)`
  );
  const weapon = Number(insItem.run('AK-47 | Redline', 'SKIN', 'NORMAL', csf, 1000, 'skin-ak').lastInsertRowid);
  const sticker = Number(insItem.run('Sticker | Titan | 2014', 'STICKER', null, csf, 200, 'sticker-1').lastInsertRowid);
  insItem.run('Item de catalogo sumido', 'SKIN', 'NORMAL', csf, 50, 'id-que-nao-existe');
  const op = Number(db.prepare(
    "INSERT INTO item_operations (kind, outcome, occurred_at, created_at) VALUES ('APPLY_COMPONENT', 'TRANSFERRED', '2026-10-05T00:00:00.000Z', 'c')"
  ).run().lastInsertRowid);
  db.prepare("INSERT INTO item_operation_links (operation_id, item_id, role, cost_share_bp) VALUES (?, ?, 'TARGET', NULL)").run(op, weapon);
  db.prepare("INSERT INTO item_operation_links (operation_id, item_id, role, cost_share_bp) VALUES (?, ?, 'CONSUMED', 10000)").run(op, sticker);
  db.prepare("UPDATE items SET status = 'CONSUMIDO', consumed_at = '2026-10-05T00:00:00.000Z' WHERE id = ?").run(sticker);
  db.prepare(
    `INSERT INTO item_components (item_id, kind, catalog_id, name, slot, source, origin, source_item_id, operation_id, created_at, updated_at)
     VALUES (?, 'STICKER', 'sticker-1', 'Sticker | Titan | 2014', 0, 'MANUAL', 'APPLIED_FROM_STOCK', ?, ?, 'c', 'u')`
  ).run(weapon, sticker, op);
  db.prepare(
    `INSERT INTO item_components (item_id, kind, catalog_id, name, source, origin, created_at, updated_at)
     VALUES (?, 'CHARM', 'keychain-1', 'Charm | Lil Ava', 'MANUAL', 'CAME_WITH', 'c', 'u')`
  ).run(weapon);
  const before = dumpAll(db);
  db.close();
  return { dbPath, before };
}

describe('v026 sobre um banco v25 cheio', () => {
  test('tudo fica idêntico; só nomes pt-BR não vazios entram (com trim); FKs ok', () => {
    const { dbPath, before } = seedFullV25('full');
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(28);
      expect(dumpAll(db, ['catalog_item_names'])).toEqual(before);
      expect(db.prepare('SELECT catalog_id, language, name FROM catalog_item_names ORDER BY catalog_id').all()).toEqual([
        { catalog_id: 'keychain-1', language: 'pt-BR', name: 'Pingente | Lil Ava' },
        { catalog_id: 'skin-ak', language: 'pt-BR', name: 'AK-47 | Linha Vermelha' },
        { catalog_id: 'sticker-1', language: 'pt-BR', name: 'Adesivo | Titan | 2014' },
      ]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      db.close();
    }
  });

  test('item do inventário ligado a um catálogo apagado continua legível e apagar o catálogo não toca os itens', () => {
    const { dbPath } = seedFullV25('cascade');
    const db = openDatabase(dbPath, { now: NOW });
    try {
      const itemsBefore = db.prepare('SELECT * FROM items ORDER BY id').all();
      const componentsBefore = db.prepare('SELECT * FROM item_components ORDER BY id').all();
      db.prepare("DELETE FROM catalog_items WHERE id IN ('skin-ak', 'sticker-1')").run();
      expect(db.prepare("SELECT COUNT(*) AS n FROM catalog_item_names WHERE catalog_id IN ('skin-ak', 'sticker-1')").get().n).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS n FROM catalog_item_names WHERE catalog_id = 'keychain-1'").get().n).toBe(1);
      expect(db.prepare('SELECT * FROM items ORDER BY id').all()).toEqual(itemsBefore);
      expect(db.prepare('SELECT * FROM item_components ORDER BY id').all()).toEqual(componentsBefore);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });

  test('idempotente: reabrir não reaplica nem duplica; a migração rodada de novo à mão falha por já existir (não por corromper)', () => {
    const { dbPath } = seedFullV25('idem');
    openDatabase(dbPath, { now: NOW }).close();
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(28);
      expect(db.prepare('SELECT COUNT(*) AS n FROM catalog_item_names').get().n).toBe(3);
      expect(() => V26.up(db)).toThrow(/already exists/);
      expect(db.prepare('SELECT COUNT(*) AS n FROM catalog_item_names').get().n).toBe(3);
    } finally {
      db.close();
    }
  });

  test('rollback: se a migração falha no meio, o banco continua na v25 sem a tabela e sem dados alterados', () => {
    const { dbPath, before } = seedFullV25('rollback');
    const failing = MIGRATIONS.map((m) => (m.version === 26
      ? { ...m, up(db) { m.up(db); db.exec('INSERT INTO catalog_item_names (catalog_id, language, name) VALUES (\'nao-existe\', \'es\', \'x\')'); } }
      : m));
    expect(() => openDatabase(dbPath, { migrations: failing, now: NOW })).toThrow();
    const raw = openDatabase(dbPath, { migrations: upTo(25) });
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(25);
      expect(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'catalog_item_names'").get()).toBeUndefined();
      expect(dumpAll(raw)).toEqual(before);
    } finally {
      raw.close();
    }
  });

  test('a tabela recusa nome só com tab/quebra de linha (trim do SQLite só tiraria espaços)', () => {
    const { dbPath } = seedFullV25('tab');
    const db = openDatabase(dbPath, { now: NOW });
    try {
      const ins = db.prepare('INSERT INTO catalog_item_names (catalog_id, language, name) VALUES (?, ?, ?)');
      for (const bad of ['\t', '\n', ' \r\n\t ']) expect(() => ins.run('skin-nulo', 'es', bad)).toThrow(/CHECK/);
      expect(() => ins.run('skin-nulo', 'es', 'ok')).not.toThrow();
    } finally {
      db.close();
    }
  });

  test('a coluna antiga name_pt_br continua intacta (sem reconstrução da tabela)', () => {
    const { dbPath } = seedFullV25('col');
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.prepare("SELECT 1 FROM pragma_table_info('catalog_items') WHERE name = 'name_pt_br'").get()).toBeTruthy();
      expect(db.prepare("SELECT name_pt_br FROM catalog_items WHERE id = 'sticker-1'").get().name_pt_br).toBe('  Adesivo | Titan | 2014  ');
    } finally {
      db.close();
    }
  });
});

describe('importar backups v23, v24 e v25 na v26', () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-v26qa-'));
  const dbFile = path.join(backupDir, 'inventory.sqlite');
  let request;
  let database;
  let app;

  beforeAll(() => {
    jest.resetModules();
    process.env.DB_PATH = dbFile;
    request = require('supertest');
    database = require('../../src/config/database');
    require('../../src/services/catalogService').setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
    app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => NOW });
    database.getDb();
  });
  afterAll(() => {
    database.closeDb();
    process.env.DB_PATH = ':memory:';
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  test.each([23, 24, 25])('backup v%i chega à v26 com os nomes pt-BR copiados, sem perder itens, componentes e operações', async (version) => {
    const { dbPath, before } = seedFullV25(`bk${version}`, version);
    const res = await request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(fs.readFileSync(dbPath));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: version, schemaVersion: 28 });
    const db = database.getDb();
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare('SELECT catalog_id, name FROM catalog_item_names WHERE language = ? ORDER BY catalog_id').all('pt-BR').map((r) => r.catalog_id))
      .toEqual(['keychain-1', 'skin-ak', 'sticker-1']);
    for (const table of ['items', 'item_components', 'item_operations', 'item_operation_links']) {
      const after = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
      const strip = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'updated_at')));
      const keys = Object.keys(before[table][0]);
      expect(strip(after).map((r) => Object.fromEntries(keys.filter((k) => k !== 'updated_at').map((k) => [k, r[k]])))).toEqual(strip(before[table]));
    }
  });
});
