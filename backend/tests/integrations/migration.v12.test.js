'use strict';

// QA 9.1 (D316 seção 2 e 6): migração v12 sobre banco v11 com dados, seed da linha CSFLOAT, restrições da tabela e backups
// automáticos sem a chave. Usa bancos de arquivo temporários (nunca o inventory.sqlite real).
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDatabase, stripSecretsInFile } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');
const { KEY } = require('../helpers/csfloatFixtures');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v12qa-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

const upTo = (version) => MIGRATIONS.filter((m) => m.version <= version);
const dbIn = (name) => path.join(tmpRoot, name, 'inventory.sqlite');
const backupsOf = (dbPath) => {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => path.join(dir, n)) : [];
};
const dump = (db) => ({
  stores: db.prepare('SELECT * FROM stores ORDER BY id').all(),
  // a v14 acrescenta `sale_release_at` (nula) em items: fica fora da comparação
  items: db.prepare('SELECT * FROM items ORDER BY id').all().map(({ sale_release_at: saleReleaseAt, components_imported_at: componentsImportedAt, consumed_at: consumedAt, ...rest }) => rest),
  // a v16 acrescenta `fee_cents` (nula) em deposits: fica fora da comparação
  deposits: db.prepare('SELECT * FROM deposits ORDER BY id').all().map(({ fee_cents: feeCents, ...rest }) => rest),
  withdrawals: db.prepare('SELECT * FROM withdrawals ORDER BY id').all(),
  balances: db.prepare('SELECT * FROM store_balances ORDER BY id').all(),
  settings: db.prepare('SELECT * FROM settings').all().map(({ steam_store_id: _steam, price_refresh_started_at: _p1, price_refresh_last_at: _p2, price_refresh_last_status: _p3, price_refresh_last_error_code: _p4, ...r }) => r),
});
const hasTable = (db, name) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

describe('v12 sobre um banco v11 com dados', () => {
  test('nada se perde; a tabela integrations nasce com a linha CSFLOAT ligada à loja CSFloat', () => {
    const dbPath = dbIn('populado');
    const old = openDatabase(dbPath, { migrations: upTo(11) });
    expect(hasTable(old, 'integrations')).toBe(false);
    const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    old.prepare(
      `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, status, created_at, updated_at)
       VALUES ('Caixa A', 'CAIXA', 'COMPRA', ?, 500, '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`,
    ).run(csf);
    old.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, note, created_at, updated_at) VALUES (4200, '2026-11-10T12:00:00.000Z', ?, 'pix', 'c', 'u')").run(csf);
    old.prepare("UPDATE settings SET theme = 'LIGHT', language = 'en', inventory_view = 'INDIVIDUAL'").run();
    const before = dump(old);
    old.close();

    const now = new Date('2026-11-22T12:00:00.000Z');
    const db = openDatabase(dbPath, { now });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(23);
      expect(dump(db)).toEqual(before);
      const rows = db.prepare('SELECT * FROM integrations').all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        source: 'CSFLOAT',
        store_id: csf,
        api_key: null,
        api_key_saved_at: null,
        account_fingerprint: null,
        account_salt: null,
        auto_import_on_open: 0,
        auto_import_paused: 0,
        trades_cutoff_at: null,
        transactions_cutoff_at: null,
        last_transaction_id: null,
        last_import_at: null,
        last_import_status: null,
        last_import_error_code: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      });
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });

  test('o backup automático antes de migrar (v11) existe, está íntegro e sem a tabela nova', () => {
    const dbPath = dbIn('populado');
    const backups = backupsOf(dbPath).filter((f) => /inventory-v11-/.test(path.basename(f)));
    expect(backups).toHaveLength(1);
    const copy = new Database(backups[0], { readonly: true });
    try {
      expect(copy.pragma('user_version', { simple: true })).toBe(11);
      expect(hasTable(copy, 'integrations')).toBe(false);
      expect(copy.prepare("SELECT COUNT(*) AS n FROM items").get().n).toBe(1);
    } finally {
      copy.close();
    }
  });

  test('reabrir não recria nem sobrescreve a linha (seed com INSERT OR IGNORE)', () => {
    const dbPath = dbIn('populado');
    const db = openDatabase(dbPath);
    db.prepare("UPDATE integrations SET api_key = ?, auto_import_on_open = 1").run(KEY);
    db.close();
    const again = openDatabase(dbPath);
    try {
      const rows = again.prepare('SELECT api_key, auto_import_on_open FROM integrations').all();
      expect(rows).toEqual([{ api_key: KEY, auto_import_on_open: 1 }]);
    } finally {
      again.close();
    }
  });

  test('loja CSFloat renomeada antes da migração -> store_id nulo (sem adivinhar)', () => {
    const dbPath = dbIn('renomeada');
    const old = openDatabase(dbPath, { migrations: upTo(11) });
    old.prepare("UPDATE stores SET name = 'Minha Loja' WHERE name = 'CSFloat'").run();
    old.close();
    const db = openDatabase(dbPath);
    try {
      expect(db.prepare('SELECT store_id FROM integrations').get().store_id).toBeNull();
    } finally {
      db.close();
    }
  });

  test('loja CSFloat em BRL (não US$) antes da migração -> store_id nulo', () => {
    const dbPath = dbIn('brl');
    const old = openDatabase(dbPath, { migrations: upTo(11) });
    old.prepare("UPDATE stores SET currency = 'BRL' WHERE name = 'CSFloat'").run();
    old.close();
    const db = openDatabase(dbPath);
    try {
      expect(db.prepare('SELECT store_id FROM integrations').get().store_id).toBeNull();
    } finally {
      db.close();
    }
  });

  test('nome da loja é comparado sem diferenciar maiúsculas ("csfloat")', () => {
    const dbPath = dbIn('caixa');
    const old = openDatabase(dbPath, { migrations: upTo(11) });
    const id = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    old.prepare("UPDATE stores SET name = 'csfloat' WHERE id = ?").run(id);
    old.close();
    const db = openDatabase(dbPath);
    try {
      expect(db.prepare('SELECT store_id FROM integrations').get().store_id).toBe(id);
    } finally {
      db.close();
    }
  });
});

describe('restrições da tabela integrations', () => {
  let db;
  beforeAll(() => { db = openDatabase(dbIn('restricoes')); });
  afterAll(() => db.close());

  test('excluir a loja ligada deixa store_id nulo (ON DELETE SET NULL), sem erro de chave estrangeira', () => {
    const id = db.prepare("INSERT INTO stores (name, currency, created_at, updated_at) VALUES ('Temp QA', 'USD', 'c', 'u')").run().lastInsertRowid;
    db.prepare('UPDATE integrations SET store_id = ?').run(id);
    db.prepare('DELETE FROM stores WHERE id = ?').run(id);
    expect(db.prepare('SELECT store_id FROM integrations').get().store_id).toBeNull();
  });
  test.each([
    ['chave curta (7)', "UPDATE integrations SET api_key = 'abcdefg'"],
    ['chave longa (513)', `UPDATE integrations SET api_key = '${'a'.repeat(513)}'`],
    ['impressão digital sem o sal', `UPDATE integrations SET account_fingerprint = '${'a'.repeat(64)}'`],
    ['sal sem a impressão digital', `UPDATE integrations SET account_salt = '${'a'.repeat(64)}'`],
    ['impressão digital com tamanho errado', `UPDATE integrations SET account_fingerprint = 'abc', account_salt = '${'a'.repeat(64)}'`],
    ['auto_import_on_open = 2', 'UPDATE integrations SET auto_import_on_open = 2'],
    ['auto_import_paused = 2', 'UPDATE integrations SET auto_import_paused = 2'],
    ["last_import_status inválido", "UPDATE integrations SET last_import_status = 'TALVEZ'"],
  ])('CHECK recusa %s', (_n, sql) => {
    expect(() => db.prepare(sql).run()).toThrow(/constraint/i);
  });
  test('source só aceita CSFLOAT e é chave primária', () => {
    expect(() => db.prepare("INSERT INTO integrations (source, created_at, updated_at) VALUES ('OUTRA', 'c', 'u')").run()).toThrow(/constraint/i);
    expect(() => db.prepare("INSERT INTO integrations (source, created_at, updated_at) VALUES ('CSFLOAT', 'c', 'u')").run()).toThrow(/constraint|UNIQUE/i);
  });
  test('chave de 8 e de 512 caracteres entram', () => {
    db.prepare('UPDATE integrations SET api_key = ?').run('a'.repeat(8));
    db.prepare('UPDATE integrations SET api_key = ?').run('b'.repeat(512));
    db.prepare('UPDATE integrations SET api_key = NULL').run();
  });
  test('a tabela é STRICT (texto em coluna INTEGER é recusado)', () => {
    expect(() => db.prepare("UPDATE integrations SET auto_import_on_open = 'sim'").run()).toThrow();
  });
});

describe('backup automático antes de migrar não leva a chave (D290)', () => {
  test('migração v23 -> v24 (simulada): o backup sai com api_key nula e o banco vivo mantém a chave', () => {
    const dbPath = dbIn('autobackup');
    const db = openDatabase(dbPath);
    db.prepare('UPDATE integrations SET api_key = ?, api_key_saved_at = ?').run(KEY, '2026-11-22T10:00:00.000Z');
    db.close();

    const fake23 = { version: 24, name: 'qa_fake', up(d) { d.exec('CREATE TABLE qa_fake (id INTEGER)'); } };
    const live = openDatabase(dbPath, { migrations: [...MIGRATIONS, fake23], now: new Date('2026-11-22T13:00:00.000Z') });
    try {
      expect(live.prepare('SELECT api_key FROM integrations').get().api_key).toBe(KEY);
    } finally {
      live.close();
    }
    const backups = backupsOf(dbPath).filter((f) => /inventory-v23-/.test(path.basename(f)));
    expect(backups).toHaveLength(1);
    const copy = new Database(backups[0], { readonly: true });
    try {
      expect(copy.prepare('SELECT api_key FROM integrations').get().api_key).toBeNull();
    } finally {
      copy.close();
    }
    // nem em busca binária: a limpeza compactou o arquivo (VACUUM), sem sobras em páginas livres
    expect(fs.readFileSync(backups[0]).includes(Buffer.from(KEY))).toBe(false);
    for (const suffix of ['-wal', '-shm']) expect(fs.existsSync(`${backups[0]}${suffix}`)).toBe(false);
  });

  test('stripSecretsInFile: zera a chave e compacta; esquema antigo (sem a tabela) é ignorado; arquivo inexistente lança', () => {
    const withKey = dbIn('strip');
    const db = openDatabase(withKey);
    db.prepare('UPDATE integrations SET api_key = ?').run(KEY);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    const copy = path.join(tmpRoot, 'strip-copy.sqlite');
    fs.copyFileSync(withKey, copy);
    expect(fs.readFileSync(copy).includes(Buffer.from(KEY))).toBe(true); // a sentinela estava no arquivo
    stripSecretsInFile(copy);
    expect(fs.readFileSync(copy).includes(Buffer.from(KEY))).toBe(false);
    const check = new Database(copy, { readonly: true });
    try {
      expect(check.prepare('SELECT api_key FROM integrations').get().api_key).toBeNull();
    } finally {
      check.close();
    }

    const v11 = dbIn('strip-v11');
    openDatabase(v11, { migrations: upTo(11) }).close();
    expect(() => stripSecretsInFile(v11)).not.toThrow();
    expect(() => stripSecretsInFile(path.join(tmpRoot, 'nao-existe.sqlite'))).toThrow();
  });
});
