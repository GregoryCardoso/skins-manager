'use strict';

// QA 11.2: bordas da migração v24 (cotação do BRL nula/MANUAL/PTAX, esquema de settings intacto, CHECKs, migração direta de versões
// antigas). Bancos temporários; nada no %APPDATA%.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

const upTo = (n) => MIGRATIONS.filter((m) => m.version <= n);
const NOW = new Date('2026-11-25T12:00:00.000Z');
let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v24qa-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});
const dbPathOf = (name) => path.join(tmpRoot, name, 'inventory.sqlite');

function makeV23(name, sql) {
  const dbPath = dbPathOf(name);
  const old = openDatabase(dbPath, { migrations: upTo(23) });
  if (sql) old.prepare(sql).run();
  old.close();
  return { dbPath };
}
const fxRows = (db) => db.prepare('SELECT * FROM fx_rates').all();

describe('cotação do BRL em cada estado de origem', () => {
  test('cotação nula (nunca configurada): linha do BRL com rate nulo, sem origem e fonte padrão', () => {
    const { dbPath } = makeV23('null');
    const db = openDatabase(dbPath, { now: NOW });
    try {
      const rows = fxRows(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ currency: 'BRL', rate: null, source: null, refresh_source: 'AWESOMEAPI', quoted_at: null });
      expect(typeof rows[0].updated_at).toBe('string');
      expect(db.prepare('SELECT display_currency AS d FROM settings').get().d).toBe('BRL');
    } finally { db.close(); }
  });

  test('MANUAL: rate, origem e data da gravação copiados, sem data de cotação', () => {
    const { dbPath } = makeV23('manual',
      "UPDATE settings SET usd_brl_rate = 5.5, usd_brl_rate_source = 'MANUAL', usd_brl_rate_updated_at = '2026-10-01T00:00:00.000Z'");
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(fxRows(db)).toEqual([
        { currency: 'BRL', rate: 5.5, source: 'MANUAL', refresh_source: 'AWESOMEAPI', quoted_at: null, updated_at: '2026-10-01T00:00:00.000Z' },
      ]);
    } finally { db.close(); }
  });

  test('PTAX: origem e fonte do botão PTAX preservadas, com a data da cotação', () => {
    const { dbPath } = makeV23('ptax',
      `UPDATE settings SET usd_brl_rate = 5.3, usd_brl_rate_source = 'PTAX', usd_brl_rate_updated_at = '2026-10-02T00:00:00.000Z',
         rate_quoted_at = '2026-10-01T13:00:00.000Z', fx_refresh_source = 'PTAX'`);
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(fxRows(db)).toEqual([
        { currency: 'BRL', rate: 5.3, source: 'PTAX', refresh_source: 'PTAX', quoted_at: '2026-10-01T13:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z' },
      ]);
    } finally { db.close(); }
  });

  test('fonte PTAX sem cotação gravada: a fonte do botão é preservada com rate nulo', () => {
    const { dbPath } = makeV23('ptaxnull', "UPDATE settings SET fx_refresh_source = 'PTAX'");
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(fxRows(db)[0]).toMatchObject({ rate: null, refresh_source: 'PTAX' });
    } finally { db.close(); }
  });
});

describe('esquema de settings sem mudança além de display_currency', () => {
  test('colunas antigas iguais e na mesma ordem; uma coluna nova no fim; um CHECK a mais', () => {
    const dbPath = dbPathOf('schema');
    const old = openDatabase(dbPath, { migrations: upTo(23) });
    const colsBefore = old.prepare('PRAGMA table_info(settings)').all();
    const sqlBefore = old.prepare("SELECT sql FROM sqlite_master WHERE name = 'settings'").get().sql;
    old.close();
    const db = openDatabase(dbPath, { now: NOW });
    try {
      const colsAfter = db.prepare('PRAGMA table_info(settings)').all();
      expect(colsAfter.slice(0, colsBefore.length)).toEqual(colsBefore);
      expect(colsAfter).toHaveLength(colsBefore.length + 1);
      expect(colsAfter[colsAfter.length - 1]).toMatchObject({ name: 'display_currency', type: 'TEXT', notnull: 1, dflt_value: "'USD'" });
      const sqlAfter = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'settings'").get().sql;
      const checks = (s) => (s.match(/CHECK\s*\(/g) || []).length;
      expect(checks(sqlAfter)).toBe(checks(sqlBefore) + 1);
      expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get().n).toBe(1);
    } finally { db.close(); }
  });
});

describe('CHECKs de fx_rates', () => {
  let db;
  beforeAll(() => { db = openDatabase(dbPathOf('checks2'), { now: NOW }); });
  afterAll(() => db.close());
  const ins = (currency, rate) => db
    .prepare("INSERT INTO fx_rates (currency, rate, source, refresh_source, quoted_at, updated_at) VALUES (?, ?, 'MANUAL', 'AWESOMEAPI', NULL, 'x')")
    .run(currency, rate);

  test('USD, minúscula, mista e tamanho errado recusados', () => {
    for (const bad of ['USD', 'eur', 'Eur', 'EUr', 'EU', 'EURO', 'EUR ']) expect(() => ins(bad, 1)).toThrow(/CHECK/);
  });
  test('rate <= 0 recusado; texto não passa (STRICT); positivo ok; moeda duplicada recusada', () => {
    for (const bad of [0, -0.0001, -5]) expect(() => ins('EUR', bad)).toThrow(/CHECK/);
    expect(() => ins('EUR', 'abc')).toThrow();
    expect(() => ins('EUR', 0.9)).not.toThrow();
    expect(() => ins('EUR', 0.8)).toThrow(/UNIQUE|PRIMARY/);
  });
});

describe('banco criado em versão antiga e migrado direto até a 24 fica em BRL', () => {
  test.each([1, 2, 5, 10, 15, 20, 22, 23])('v%i -> v24', (version) => {
    const dbPath = dbPathOf(`direct${version}`);
    const old = openDatabase(dbPath, { migrations: upTo(version) });
    old.close();
    const db = openDatabase(dbPath, { now: NOW });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(24);
      expect(db.prepare('SELECT display_currency AS d FROM settings').get().d).toBe('BRL');
      expect(fxRows(db).map((r) => r.currency)).toEqual(['BRL']);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally { db.close(); }
  });

  test('banco novo (v0) direto até a 24 fica em USD, sem linhas em fx_rates', () => {
    const db = openDatabase(dbPathOf('fresh'), { now: NOW });
    try {
      expect(db.prepare('SELECT display_currency AS d FROM settings').get().d).toBe('USD');
      expect(fxRows(db)).toEqual([]);
    } finally { db.close(); }
  });
});
