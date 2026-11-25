'use strict';

// Migração v5 (D162): fontes da cotação. Reconstrói `settings`; v1-v4 não podem mudar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');
const { stripV6Rows } = require('../helpers/stripV6');

let tmpRoot;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v5-'));
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
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

describe('migração v5', () => {
  test('migrações v1-v4 publicadas continuam idênticas (hash)', () => {
    const dir = path.join(__dirname, '..', '..', 'src', 'config', 'migrations');
    expect(sha(path.join(dir, 'v001_initial.js'))).toBe('18514164a9ad3d10128e6b1c271ce7623d11835a9240fe9bf2f337bfced3eb1f');
    expect(sha(path.join(dir, 'v002_catalog.js'))).toBe('9e0718ac8ad78ee5e48a4bd41f591e3835ed3b1c653e95e6362f6041b56ba22f');
    expect(sha(path.join(dir, 'v003_manual_net.js'))).toBe('a6a480628b4cfbd4acaaab82cd091ca2d865d3c09821104cee243ab011631620');
    expect(sha(path.join(dir, 'v004_stores_settings.js'))).toBe('d8dc15e343e815b01956323e05448684bc948d2c82e17d482187f1bf0febef47');
  });

  test('banco v4 com cotação PTAX: dados copiados, ptax_quoted_at vira rate_quoted_at, fonte do botão = AWESOMEAPI, backup criado', () => {
    const dbPath = dbIn('a');
    const old = openDatabase(dbPath, { migrations: upTo4 });
    old.prepare(
      `UPDATE settings SET usd_brl_rate = 5.3012, usd_brl_rate_updated_at = '2026-11-19T15:00:00.000Z',
         usd_brl_rate_source = 'PTAX', ptax_quoted_at = '2026-11-19T16:04:28.123Z', theme = 'DARK', language = 'en',
         catalog_updated_at = '2026-11-01T00:00:00.000Z', slow_item_days = 30, fast_turnover_days = 5`
    ).run();
    const before = old.prepare('SELECT * FROM settings').get();
    const storesBefore = old.prepare('SELECT * FROM stores ORDER BY id').all();
    old.close();

    const db = openDatabase(dbPath, { now: new Date('2026-11-20T12:00:00.000Z') });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(25);
      expect(db.pragma('application_id', { simple: true })).toBe(1397444935);
      const { steam_store_id: _steam, price_refresh_started_at: _p1, price_refresh_last_at: _p2, price_refresh_last_status: _p3, price_refresh_last_error_code: _p4, display_currency: _dc, ...after } = db.prepare('SELECT * FROM settings').get();
      const { ptax_quoted_at: oldQuotedAt, ...beforeRest } = before;
      expect(after).toEqual({ ...beforeRest, rate_quoted_at: oldQuotedAt, fx_refresh_source: 'AWESOMEAPI', inventory_view: 'GROUPED' });
      expect(after.rate_quoted_at).toBe('2026-11-19T16:04:28.123Z');
      expect(db.prepare("SELECT 1 FROM pragma_table_info('settings') WHERE name = 'ptax_quoted_at'").get()).toBeUndefined();
      expect(stripV6Rows(db.prepare('SELECT * FROM stores ORDER BY id').all())).toEqual(storesBefore);
      expect(fs.readdirSync(path.join(path.dirname(dbPath), 'backups')).some((f) => f.startsWith('inventory-v4-'))).toBe(true);
    } finally {
      db.close();
    }
  });

  test('banco novo: padrões e CHECKs (AWESOMEAPI aceito, valor inválido recusado; tema, idioma e limites preservados)', () => {
    const db = openDatabase(dbIn('b'));
    try {
      expect(db.prepare('SELECT fx_refresh_source AS f, usd_brl_rate_source AS s, rate_quoted_at AS q FROM settings').get()).toEqual({
        f: 'AWESOMEAPI', s: null, q: null,
      });
      db.prepare("UPDATE settings SET usd_brl_rate_source = 'AWESOMEAPI'").run();
      for (const source of ['MANUAL', 'PTAX']) db.prepare('UPDATE settings SET usd_brl_rate_source = ?').run(source);
      expect(() => db.prepare("UPDATE settings SET usd_brl_rate_source = 'X'").run()).toThrow(/CHECK/);
      db.prepare("UPDATE settings SET fx_refresh_source = 'PTAX'").run();
      expect(() => db.prepare("UPDATE settings SET fx_refresh_source = 'MANUAL'").run()).toThrow(/CHECK/);
      expect(() => db.prepare("UPDATE settings SET theme = 'X'").run()).toThrow(/CHECK/);
      expect(() => db.prepare("UPDATE settings SET language = 'x'").run()).toThrow(/CHECK/);
      expect(() => db.prepare('UPDATE settings SET slow_item_days = 1').run()).toThrow(/CHECK/);
      expect(() => db.prepare('UPDATE settings SET fast_turnover_days = 365').run()).toThrow(/CHECK/);
      expect(() => db.prepare('UPDATE settings SET usd_brl_rate = 0').run()).toThrow(/CHECK/);
      expect(() => db.prepare('INSERT INTO settings (id, updated_at) VALUES (2, ?)').run('x')).toThrow(/CHECK/);
    } finally {
      db.close();
    }
  });

  test('foreign keys continuam ligadas e a integridade fecha depois da reconstrução', () => {
    const dbPath = dbIn('c');
    openDatabase(dbPath, { migrations: upTo4 }).close();
    const db = openDatabase(dbPath);
    try {
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      db.close();
    }
  });
});
