'use strict';

// 11.2 (D369): backup v23 importado pela API (migra para a v24 e o banco existente fica em BRL), backup mais novo recusado e exportação
// com `fx_rates` e `display_currency`. Bancos temporários; nada no %APPDATA%.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

jest.setTimeout(120000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-v24bk-'));
const dbFile = path.join(dir, 'inventory.sqlite');
let request;
let database;
let app;
let MIGRATIONS;

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
  database = require('../../src/config/database');
  ({ MIGRATIONS } = require('../../src/config/migrations'));
  require('../../src/services/catalogService').setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => new Date('2026-11-25T12:00:00.000Z') });
  database.getDb();
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporário */ }
});

const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
const settings = async () => (await request(app).get('/api/settings')).body.data;
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

function makeV23Backup(name) {
  const file = path.join(dir, name);
  const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 23) });
  old.prepare("UPDATE settings SET usd_brl_rate = 5.31, usd_brl_rate_source = 'MANUAL', usd_brl_rate_updated_at = '2026-11-20T10:00:00.000Z', language = 'en'").run();
  old.close();
  return fs.readFileSync(file);
}

describe('backup e a v24', () => {
  test('backup v23 importado: migra para a v24, vira BRL e leva a cotação do BRL para fx_rates', async () => {
    // o banco atual (novo) está em USD e sem cotação
    expect((await settings()).displayCurrency).toBe('USD');
    const res = await octet(makeV23Backup('v23.sqlite'));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: 23, schemaVersion: 25, migrationsApplied: [24, 25] });
    const s = await settings();
    expect(s).toMatchObject({ displayCurrency: 'BRL', usdBrlRate: 5.31, usdBrlRateSource: 'MANUAL', language: 'en' });
    expect(s.fxRates).toEqual([
      { currency: 'BRL', rate: 5.31, source: 'MANUAL', refreshSource: 'AWESOMEAPI', quotedAt: null, updatedAt: '2026-11-20T10:00:00.000Z' },
    ]);
  });

  test('backup mais novo que o app (v26) é recusado e nada muda', async () => {
    const before = await settings();
    const file = path.join(dir, 'newer.sqlite');
    const newer = database.openDatabase(file, { migrations: MIGRATIONS });
    newer.pragma('user_version = 26');
    newer.close();
    const res = await octet(fs.readFileSync(file));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BACKUP_NEWER_VERSION');
    expect(await settings()).toEqual(before);
  });

  test('exportar e importar de volta preserva moeda de conversão e cotações por moeda', async () => {
    await request(app).put('/api/settings/fx-rate').send({ currency: 'EUR', rate: 0.92 }).expect(200);
    await request(app).patch('/api/settings').send({ displayCurrency: 'EUR' }).expect(200);
    const exported = (await request(app).get('/api/backup/export').buffer(true).parse(binary)).body;

    const copyPath = path.join(dir, 'exported.sqlite');
    fs.writeFileSync(copyPath, exported);
    const copy = new Database(copyPath, { readonly: true });
    try {
      expect(copy.prepare('SELECT display_currency FROM settings').get().display_currency).toBe('EUR');
      expect(copy.prepare('SELECT currency, rate FROM fx_rates ORDER BY currency').all()).toEqual([
        { currency: 'BRL', rate: 5.31 }, { currency: 'EUR', rate: 0.92 },
      ]);
    } finally {
      copy.close();
    }

    await request(app).patch('/api/settings').send({ displayCurrency: 'JPY' }).expect(200);
    await request(app).put('/api/settings/fx-rate').send({ currency: 'EUR', rate: 0.5 }).expect(200);
    const res = await octet(exported);
    expect(res.status).toBe(200);
    const s = await settings();
    expect(s.displayCurrency).toBe('EUR');
    expect(s.fxRates.find((r) => r.currency === 'EUR').rate).toBe(0.92);
  });
});
