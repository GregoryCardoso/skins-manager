'use strict';

// 11.1 (D369): migração v23 (`settings.language` com CHECK de formato e padrão 'en'). Bancos temporários; nada no %APPDATA%.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

const UP_TO_22 = MIGRATIONS.filter((m) => m.version <= 22);
const NOW = new Date('2026-11-25T12:00:00.000Z');
let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v23-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

function migrateFrom22(name, language) {
  const dbPath = path.join(tmpRoot, name, 'inventory.sqlite');
  const seed = openDatabase(dbPath, { migrations: UP_TO_22 });
  seed.prepare(
    "UPDATE settings SET language = ?, theme = 'DARK', usd_brl_rate = 5.4, slow_item_days = 30, fast_turnover_days = 5, inventory_view = 'INDIVIDUAL'"
  ).run(language);
  const before = seed.prepare('SELECT * FROM settings').get();
  seed.close();
  const db = openDatabase(dbPath, { now: NOW });
  return { db, before, dbPath };
}

describe.each(['pt-BR', 'en'])('v23 sobre um banco v22 com idioma %s', (language) => {
  test('a linha de settings fica idêntica (inclusive o idioma), há backup da v22 e as chaves estrangeiras estão íntegras', () => {
    const { db, before, dbPath } = migrateFrom22(`keep-${language}`, language);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(23);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.prepare('SELECT * FROM settings').get()).toEqual(before);
      expect(db.prepare('SELECT language FROM settings').get().language).toBe(language);
    } finally {
      db.close();
    }
    const backups = fs.readdirSync(path.join(path.dirname(dbPath), 'backups')).filter((f) => f.startsWith('inventory-v22-'));
    expect(backups).toHaveLength(1);
  });
});

test('o CHECK passa a ser de formato: códigos de 2 a 10 caracteres entram, e fora disso não', () => {
  const db = openDatabase(':memory:');
  try {
    for (const code of ['en', 'pt-BR', 'zh-CN', 'es', 'abcdefghij']) db.prepare('UPDATE settings SET language = ?').run(code);
    for (const code of ['', 'x', 'abcdefghijk']) {
      expect(() => db.prepare('UPDATE settings SET language = ?').run(code)).toThrow(/CHECK/);
    }
  } finally {
    db.close();
  }
});

test('banco novo: idioma padrão en; as colunas e as chaves estrangeiras de settings continuam as mesmas', () => {
  const db = openDatabase(':memory:');
  try {
    expect(db.prepare('SELECT language FROM settings').get().language).toBe('en');
    const columns = db.prepare("SELECT name FROM pragma_table_info('settings')").all().map((r) => r.name);
    expect(columns).toEqual(expect.arrayContaining([
      'id', 'usd_brl_rate', 'theme', 'language', 'inventory_view', 'steam_store_id', 'price_refresh_started_at', 'price_refresh_last_error_code',
    ]));
    expect(db.prepare("SELECT \"table\" AS t FROM pragma_foreign_key_list('settings')").all()).toEqual([{ t: 'stores' }]);
  } finally {
    db.close();
  }
});
