'use strict';

// Lacunas da migração v5 (D162, D155): todas as tabelas intactas, origem PTAX preservada, banco v5 estável.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v5g-'));
});
afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o arquivo por instantes; a pasta é temporária.
  }
});

const upTo4 = MIGRATIONS.filter((m) => m.version <= 4);
const dbIn = (name) => path.join(tmpRoot, name, 'inventory.sqlite');
const NOW5 = new Date('2026-11-21T12:00:00.000Z');

function tables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}
const snapshot = (db, skip = ['settings']) =>
  Object.fromEntries(tables(db).filter((t) => !skip.includes(t)).map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const schemaOf = (db) => db.prepare("SELECT type, name, sql FROM sqlite_master WHERE tbl_name <> 'settings' ORDER BY name").all();

function populateV4(db) {
  const csfloat = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const t = '2026-11-01T00:00:00.000Z';
  db.prepare(
    `INSERT INTO items (name, category, variant, acquisition_type, purchase_price_cents, purchase_currency, acquired_at, status, created_at, updated_at)
     VALUES ('AK-47 | Redline', 'SKIN', 'NORMAL', 'GANHEI', 0, 'USD', ?, 'EM_ESTOQUE', ?, ?)`
  ).run(t, t, t);
  db.prepare('INSERT INTO deposits (amount_brl_cents, deposited_at, created_at, updated_at) VALUES (5000, ?, ?, ?)').run(t, t, t);
  db.prepare(
    'INSERT INTO withdrawals (store_id, amount_store_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, 1000, 5000, ?, ?, ?)'
  ).run(csfloat, t, t, t);
  db.prepare('INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, 1234, ?, ?)').run(csfloat, t, t);
  db.prepare(
    "INSERT INTO catalog_items (id, source, category, name, name_key, search_text, updated_at) VALUES ('c1', 'SKINS', 'SKIN', 'AK-47 | Redline', 'ak-47 | redline', 'ak redline', ?)"
  ).run(t);
}

describe('migração v5: lacunas', () => {
  test('banco v4 com linhas em todas as tabelas: nada se perde, esquema das outras tabelas igual', () => {
    const dbPath = dbIn('full');
    const old = openDatabase(dbPath, { migrations: upTo4 });
    populateV4(old);
    const rows = snapshot(old);
    const schema = schemaOf(old);
    for (const name of ['items', 'deposits', 'withdrawals', 'store_balances', 'catalog_items', 'stores']) {
      expect(rows[name].length).toBeGreaterThan(0);
    }
    old.close();

    const db = openDatabase(dbPath, { now: NOW5 });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(5);
      expect(snapshot(db)).toEqual(rows);
      expect(schemaOf(db)).toEqual(schema);
      expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get().n).toBe(1);
    } finally {
      db.close();
    }
  });

  test.each([
    ['PTAX', '2026-11-19T16:04:28.123Z'],
    ['MANUAL', null],
  ])('banco v4 com origem %s mantém origem, cotação e data; fx_refresh_source vira AWESOMEAPI', (source, quotedAt) => {
    const dbPath = dbIn(`src-${source}`);
    const old = openDatabase(dbPath, { migrations: upTo4 });
    old
      .prepare('UPDATE settings SET usd_brl_rate = 5.3012, usd_brl_rate_updated_at = ?, usd_brl_rate_source = ?, ptax_quoted_at = ?')
      .run('2026-11-19T15:00:00.000Z', source, quotedAt);
    old.close();
    const db = openDatabase(dbPath, { now: NOW5 });
    try {
      expect(
        db
          .prepare(
            'SELECT usd_brl_rate AS r, usd_brl_rate_source AS s, rate_quoted_at AS q, usd_brl_rate_updated_at AS u, fx_refresh_source AS f FROM settings'
          )
          .get()
      ).toEqual({ r: 5.3012, s: source, q: quotedAt, u: '2026-11-19T15:00:00.000Z', f: 'AWESOMEAPI' });
    } finally {
      db.close();
    }
  });

  test('banco v4 sem cotação: origem e data continuam nulas', () => {
    const dbPath = dbIn('nullrate');
    openDatabase(dbPath, { migrations: upTo4 }).close();
    const db = openDatabase(dbPath, { now: NOW5 });
    try {
      expect(db.prepare('SELECT usd_brl_rate AS r, usd_brl_rate_source AS s, rate_quoted_at AS q FROM settings').get()).toEqual({
        r: null,
        s: null,
        q: null,
      });
    } finally {
      db.close();
    }
  });

  test('o CHECK recusa fx_refresh_source nulo e inválido, e aceita AWESOMEAPI e PTAX', () => {
    const db = openDatabase(':memory:');
    try {
      expect(() => db.prepare('UPDATE settings SET fx_refresh_source = NULL').run()).toThrow(/NOT NULL|CHECK/);
      expect(() => db.prepare("UPDATE settings SET fx_refresh_source = 'awesomeapi'").run()).toThrow(/CHECK/);
      expect(() => db.prepare("UPDATE settings SET fx_refresh_source = ''").run()).toThrow(/CHECK/);
      expect(() => db.prepare("UPDATE settings SET fx_refresh_source = 'AWESOMEAPI'").run()).not.toThrow();
      expect(() => db.prepare("UPDATE settings SET usd_brl_rate_source = 'AWESOMEAPI'").run()).not.toThrow();
      expect(() => db.prepare("UPDATE settings SET usd_brl_rate_source = 'BCB'").run()).toThrow(/CHECK/);
    } finally {
      db.close();
    }
  });

  test('reabrir um banco v5 não migra nem cria backup novo', () => {
    const dbPath = dbIn('again');
    openDatabase(dbPath, { migrations: upTo4 }).close();
    openDatabase(dbPath, { now: NOW5 }).close();
    const dir = path.join(path.dirname(dbPath), 'backups');
    const before = fs.readdirSync(dir);
    openDatabase(dbPath, { now: new Date('2026-11-22T12:00:00.000Z') }).close();
    expect(fs.readdirSync(dir)).toEqual(before);
  });
});
