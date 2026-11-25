'use strict';

// Migração v4 (D143): colunas novas em settings, flag do seed (T5) e application_id.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { openDatabase } = require('../../src/config/database');
const { stripV6Rows } = require('../helpers/stripV6');
const { MIGRATIONS } = require('../../src/config/migrations');

let tmpRoot;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v4-'));
});
afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o arquivo por instantes; a pasta é temporária.
  }
});

const upTo3 = MIGRATIONS.filter((m) => m.version <= 3);

describe('migração v4', () => {
  test('banco v3 com dados: linhas iguais, colunas novas, origem MANUAL só com cotação, backup, application_id', () => {
    const dbPath = path.join(tmpRoot, 'a', 'inventory.sqlite');
    const old = openDatabase(dbPath, { migrations: upTo3 });
    old.prepare("UPDATE settings SET usd_brl_rate = 5.1, usd_brl_rate_updated_at = 'x'").run();
    const storesBefore = old.prepare('SELECT * FROM stores ORDER BY id').all();
    old.close();

    const db = openDatabase(dbPath, { now: new Date('2026-11-20T12:00:00.000Z') });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(26);
      expect(db.pragma('application_id', { simple: true })).toBe(1397444935);
      expect(stripV6Rows(db.prepare('SELECT * FROM stores ORDER BY id').all())).toEqual(storesBefore);
      expect(db.prepare('SELECT * FROM settings').get()).toMatchObject({
        usd_brl_rate: 5.1, usd_brl_rate_source: 'MANUAL', rate_quoted_at: null, slow_item_days: null,
        fast_turnover_days: null, stores_seeded: 1,
      });
      expect(fs.readdirSync(path.join(tmpRoot, 'a', 'backups')).some((f) => f.startsWith('inventory-v3-'))).toBe(true);
    } finally {
      db.close();
    }
  });

  test('sem cotação a origem fica nula; banco novo tem 3 lojas e stores_seeded = 1', () => {
    const db = openDatabase(path.join(tmpRoot, 'b', 'inventory.sqlite'));
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM stores').get().n).toBe(3);
      expect(db.prepare('SELECT usd_brl_rate_source AS s, stores_seeded AS f FROM settings').get()).toEqual({ s: null, f: 1 });
    } finally {
      db.close();
    }
  });

  test('T5: apagar todas as lojas e reabrir não recria o seed', () => {
    const dbPath = path.join(tmpRoot, 'c', 'inventory.sqlite');
    const first = openDatabase(dbPath);
    first.exec('DELETE FROM stores');
    first.close();
    const db = openDatabase(dbPath);
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM stores').get().n).toBe(0);
    } finally {
      db.close();
    }
  });

  test('CHECKs: slow 2..365, fast 1..364', () => {
    const db = openDatabase(':memory:');
    try {
      const set = (col, v) => db.prepare(`UPDATE settings SET ${col} = ?`).run(v);
      expect(() => set('fast_turnover_days', 0)).toThrow(/CHECK/);
      expect(() => set('fast_turnover_days', 365)).toThrow(/CHECK/);
      expect(() => set('fast_turnover_days', 1)).not.toThrow();
      expect(() => set('fast_turnover_days', 364)).not.toThrow();
      expect(() => set('slow_item_days', 1)).toThrow(/CHECK/);
      expect(() => set('slow_item_days', 366)).toThrow(/CHECK/);
      expect(() => set('slow_item_days', 2)).not.toThrow();
      expect(() => set('slow_item_days', 365)).not.toThrow();
    } finally {
      db.close();
    }
  });

  test('banco v3 com itens, aporte, saque e saldo: nenhuma linha perdida ou alterada', () => {
    const dbPath = path.join(tmpRoot, 'd', 'inventory.sqlite');
    const old = openDatabase(dbPath, { migrations: upTo3 });
    const steam = old.prepare("SELECT id FROM stores WHERE name = 'Steam'").get().id;
    const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    const ins = old.prepare(
      `INSERT INTO items (name, category, acquisition_type, purchase_store_id, acquired_at, created_at, updated_at)
       VALUES (?, 'CAIXA', 'GANHEI', ?, '2026-01-01T00:00:00.000Z', 'c', 'u')`
    );
    ins.run('Caixa A', steam);
    ins.run('Caixa B', csf);
    old.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, created_at, updated_at) VALUES (1000, 'd', ?, 'c', 'u')").run(steam);
    old.prepare("INSERT INTO withdrawals (store_id, amount_store_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, 500, 2500, 'w', 'c', 'u')").run(csf);
    old.prepare("INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, 700, 'r', 'c')").run(csf);
    const tables = ['stores', 'items', 'deposits', 'withdrawals', 'store_balances'];
    const before = Object.fromEntries(tables.map((t) => [t, old.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]));
    old.close();

    const db = openDatabase(dbPath, { now: new Date('2026-11-20T12:00:00.000Z') });
    try {
      for (const t of tables) expect(stripV6Rows(db.prepare(`SELECT * FROM ${t} ORDER BY id`).all())).toEqual(before[t]);
      expect(before.items).toHaveLength(2);
      expect(db.prepare('SELECT stores_seeded AS f FROM settings').get().f).toBe(1);
    } finally {
      db.close();
    }
  });

  test('o backup de migração é um banco v3 legível com os dados anteriores', () => {
    const dbPath = path.join(tmpRoot, 'e', 'inventory.sqlite');
    openDatabase(dbPath, { migrations: upTo3 }).close();
    openDatabase(dbPath, { now: new Date('2026-11-20T12:00:00.000Z') }).close();
    const dir = path.join(tmpRoot, 'e', 'backups');
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('inventory-v3-'));
    expect(files).toHaveLength(1);
    const Database = require('better-sqlite3');
    const bk = new Database(path.join(dir, files[0]), { readonly: true });
    try {
      expect(bk.pragma('user_version', { simple: true })).toBe(3);
      expect(bk.prepare('SELECT COUNT(*) AS n FROM stores').get().n).toBe(3);
    } finally {
      bk.close();
    }
  });

  test('reabrir um banco v4 não cria novo backup nem altera o seed', () => {
    const dbPath = path.join(tmpRoot, 'f', 'inventory.sqlite');
    openDatabase(dbPath).close();
    openDatabase(dbPath).close();
    expect(fs.existsSync(path.join(tmpRoot, 'f', 'backups'))).toBe(false);
  });

  test('hash do conteúdo das migrações v1 a v3 inalterado (migração publicada não se edita)', () => {
    const expected = {
      v001_initial: '18514164a9ad3d10128e6b1c271ce7623d11835a9240fe9bf2f337bfced3eb1f',
      v002_catalog: '9e0718ac8ad78ee5e48a4bd41f591e3835ed3b1c653e95e6362f6041b56ba22f',
      v003_manual_net: 'a6a480628b4cfbd4acaaab82cd091ca2d865d3c09821104cee243ab011631620',
    };
    for (const [file, hash] of Object.entries(expected)) {
      // Normaliza fim de linha (autocrlf do Windows) antes do hash.
      const text = fs.readFileSync(path.join(__dirname, '../../src/config/migrations', `${file}.js`), 'utf8').replace(/\r\n/g, '\n');
      expect(crypto.createHash('sha256').update(text).digest('hex')).toBe(hash);
    }
  });
});
