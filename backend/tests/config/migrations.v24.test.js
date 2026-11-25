'use strict';

// 11.2 (D369, Adendo 1): migração v24 (`fx_rates` e `settings.display_currency`). Bancos temporários; nada no %APPDATA%.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

const UP_TO_23 = MIGRATIONS.filter((m) => m.version <= 23);
// A v25 (11.4) é posterior: estes testes cobrem a v24 e param nela.
const UP_TO_24 = MIGRATIONS.filter((m) => m.version <= 24);
const NOW = new Date('2026-11-25T12:00:00.000Z');
let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v24-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

const dbPathOf = (name) => path.join(tmpRoot, name, 'inventory.sqlite');
const backupsOf = (dbPath, prefix) => {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(prefix)) : [];
};
const dumpTables = (db, skip = []) => Object.fromEntries(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map((r) => r.name)
    .filter((name) => !skip.includes(name))
    .map((name) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()])
);

// Banco v23 "de verdade": criado só com as migrações até a 23, com cotação do BRL, fonte PTAX e dados nas outras tabelas.
function makeV23(name, { rate = 5.3012 } = {}) {
  const dbPath = dbPathOf(name);
  const old = openDatabase(dbPath, { migrations: UP_TO_23 });
  old.prepare(
    `UPDATE settings SET usd_brl_rate = ?, usd_brl_rate_updated_at = '2026-11-20T10:00:00.000Z', usd_brl_rate_source = 'PTAX',
       rate_quoted_at = '2026-11-19T16:04:28.123Z', fx_refresh_source = 'PTAX', theme = 'DARK', language = 'pt-BR'`
  ).run(rate);
  const csfloat = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, created_at, updated_at)
     VALUES ('Dreams & Nightmares Case', 'CAIXA', 'COMPRA', ?, 1000, '2026-11-01T00:00:00.000Z', 'c', 'u')`
  ).run(csfloat);
  old.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, created_at, updated_at) VALUES (4200, '2026-11-10T12:00:00.000Z', ?, 'c', 'u')").run(csfloat);
  const before = { settings: old.prepare('SELECT * FROM settings').get(), tables: dumpTables(old, ['settings']) };
  old.close();
  return { dbPath, before };
}

describe('v24 sobre um banco v23 (banco existente)', () => {
  test('display_currency vira BRL, a cotação do BRL é copiada para fx_rates e nada mais muda; há backup da v23', () => {
    const { dbPath, before } = makeV23('existing');
    const db = openDatabase(dbPath, { migrations: UP_TO_24, now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(24);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      const { display_currency: displayCurrency, ...settings } = db.prepare('SELECT * FROM settings').get();
      expect(displayCurrency).toBe('BRL');
      expect(settings).toEqual(before.settings); // colunas antigas da cotação continuam, sem uso
      expect(db.prepare('SELECT * FROM fx_rates').all()).toEqual([
        {
          currency: 'BRL', rate: 5.3012, source: 'PTAX', refresh_source: 'PTAX', quoted_at: '2026-11-19T16:04:28.123Z', updated_at: '2026-11-20T10:00:00.000Z',
        },
      ]);
      expect(dumpTables(db, ['settings', 'fx_rates'])).toEqual(before.tables);
      expect(backupsOf(dbPath, 'inventory-v23-')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test('banco v23 sem cotação: a linha do BRL nasce com rate nulo e guarda a fonte do botão', () => {
    const dbPath = dbPathOf('no-rate');
    const old = openDatabase(dbPath, { migrations: UP_TO_23 });
    old.prepare("UPDATE settings SET fx_refresh_source = 'PTAX', updated_at = '2026-11-01T00:00:00.000Z'").run();
    old.close();
    const db = openDatabase(dbPath, { migrations: UP_TO_24, now: NOW });
    try {
      expect(db.prepare('SELECT * FROM fx_rates').all()).toEqual([
        { currency: 'BRL', rate: null, source: null, refresh_source: 'PTAX', quoted_at: null, updated_at: '2026-11-01T00:00:00.000Z' },
      ]);
      expect(db.prepare('SELECT display_currency FROM settings').get().display_currency).toBe('BRL');
    } finally {
      db.close();
    }
  });

  test('é idempotente: abrir de novo não refaz nada nem cria outro backup', () => {
    const { dbPath } = makeV23('idem');
    openDatabase(dbPath, { migrations: UP_TO_24, now: NOW }).close();
    const first = backupsOf(dbPath, 'inventory-v23-');
    const db = openDatabase(dbPath, { migrations: UP_TO_24, now: new Date('2026-11-25T13:00:00.000Z') });
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM fx_rates').get().n).toBe(1);
      expect(db.prepare('SELECT display_currency FROM settings').get().display_currency).toBe('BRL');
      expect(backupsOf(dbPath, 'inventory-v23-')).toEqual(first);
    } finally {
      db.close();
    }
  });

  test('a moeda de conversão escolhida depois da migração é preservada ao reabrir', () => {
    const { dbPath } = makeV23('keep-choice');
    const db = openDatabase(dbPath, { migrations: UP_TO_24, now: NOW });
    db.prepare("UPDATE settings SET display_currency = 'EUR'").run();
    db.close();
    const again = openDatabase(dbPath, { migrations: UP_TO_24, now: NOW });
    try {
      expect(again.prepare('SELECT display_currency FROM settings').get().display_currency).toBe('EUR');
    } finally {
      again.close();
    }
  });

  test('falha no meio da v24: rollback total (continua na v23, sem fx_rates nem display_currency) e o backup da v23 existe', () => {
    const real = MIGRATIONS.find((m) => m.version === 24);
    const { dbPath, before } = makeV23('rollback');
    const failing = {
      ...real,
      up(db, ctx) {
        real.up(db, ctx);
        throw new Error('falha simulada');
      },
    };
    expect(() => openDatabase(dbPath, { migrations: [...UP_TO_23, failing], now: NOW })).toThrow(/falha simulada/);

    const check = openDatabase(dbPath, { migrations: UP_TO_23, skipBackup: true });
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(23);
      expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'fx_rates'").all()).toEqual([]);
      expect(check.prepare("SELECT 1 FROM pragma_table_info('settings') WHERE name = 'display_currency'").get()).toBeUndefined();
      expect(check.prepare('SELECT * FROM settings').get()).toEqual(before.settings);
      expect(dumpTables(check, ['settings'])).toEqual(before.tables);
    } finally {
      check.close();
    }
    expect(backupsOf(dbPath, 'inventory-v23-').length).toBeGreaterThanOrEqual(1);

    // depois da falha, a migração real roda normalmente
    const ok = openDatabase(dbPath, { migrations: UP_TO_24, skipBackup: true });
    try {
      expect(ok.pragma('user_version', { simple: true })).toBe(24);
      expect(ok.prepare('SELECT display_currency FROM settings').get().display_currency).toBe('BRL');
    } finally {
      ok.close();
    }
  });
});

describe('v24 em banco novo', () => {
  test('instalação nova termina na v24 com USD, sem linhas em fx_rates e sem backup de migração', () => {
    const dbPath = dbPathOf('fresh');
    const db = openDatabase(dbPath, { migrations: UP_TO_24, now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(24);
      expect(db.prepare('SELECT display_currency FROM settings').get().display_currency).toBe('USD');
      expect(db.prepare('SELECT COUNT(*) AS n FROM fx_rates').get().n).toBe(0);
    } finally {
      db.close();
    }
    expect(backupsOf(dbPath, 'inventory-v')).toEqual([]);
  });

  test('banco em memória (testes) também nasce em USD', () => {
    const db = openDatabase(':memory:', { migrations: UP_TO_24, now: NOW });
    try {
      expect(db.prepare('SELECT display_currency FROM settings').get().display_currency).toBe('USD');
    } finally {
      db.close();
    }
  });
});

describe('restrições do esquema', () => {
  let db;
  beforeAll(() => { db = openDatabase(dbPathOf('checks'), { migrations: UP_TO_24, now: NOW }); });
  afterAll(() => db.close());
  const insert = (currency, rate = 5, source = 'MANUAL', refresh = 'AWESOMEAPI') => db
    .prepare('INSERT INTO fx_rates (currency, rate, source, refresh_source, quoted_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?)')
    .run(currency, rate, source, refresh, 'x');

  test('a tabela é STRICT e só aceita moeda de 3 letras maiúsculas diferente de USD', () => {
    expect(db.prepare("SELECT strict FROM pragma_table_list WHERE name = 'fx_rates'").get().strict).toBe(1);
    for (const bad of ['USD', 'eur', 'EU', 'EURO', '']) expect(() => insert(bad)).toThrow(/CHECK/);
    expect(() => insert('EUR')).not.toThrow();
  });

  test('cotação precisa ser maior que zero (nula é aceita), origem e fonte do botão têm lista fechada', () => {
    expect(() => insert('GBP', 0)).toThrow(/CHECK/);
    expect(() => insert('GBP', -1)).toThrow(/CHECK/);
    expect(() => insert('GBP', null, null)).not.toThrow();
    expect(() => insert('CAD', 1.4, 'BCB')).toThrow(/CHECK/);
    expect(() => insert('AUD', 1.5, 'MANUAL', 'MANUAL')).toThrow(/CHECK/);
    expect(() => insert('MXN', 19, 'AWESOMEAPI')).not.toThrow();
  });

  test('display_currency exige 3 caracteres', () => {
    expect(() => db.prepare("UPDATE settings SET display_currency = 'EU'").run()).toThrow(/CHECK/);
    expect(() => db.prepare("UPDATE settings SET display_currency = NULL").run()).toThrow(/NOT NULL/);
    expect(() => db.prepare("UPDATE settings SET display_currency = 'JPY'").run()).not.toThrow();
  });
});
