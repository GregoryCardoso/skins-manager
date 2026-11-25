'use strict';

// QA 11.2: importação de backups antigos (v20, v22, v23) pela API: terminam na v24, em BRL, com a cotação do BRL em fx_rates e sem
// perder dados. Também cobre backup antigo sem cotação e importação sobre um banco em outra moeda de conversão.
// Bancos temporários; nada no %APPDATA%.
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.setTimeout(120000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-v24bkold-'));
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

function makeBackup(name, version, { rate, source = 'MANUAL', refresh = 'AWESOMEAPI' } = {}) {
  const file = path.join(dir, name);
  const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= version) });
  if (rate !== undefined) {
    old.prepare(
      "UPDATE settings SET usd_brl_rate = ?, usd_brl_rate_source = ?, usd_brl_rate_updated_at = '2026-11-01T10:00:00.000Z', fx_refresh_source = ?, language = 'pt-BR'"
    ).run(rate, source, refresh);
  }
  const csfloat = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  old.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, created_at, updated_at) VALUES (4200, '2026-10-10T12:00:00.000Z', ?, 'c', 'u')").run(csfloat);
  old.close();
  return fs.readFileSync(file);
}

describe.each([20, 22, 23])('backup v%i', (version) => {
  test('importa, migra até a v24 e fica em BRL com a cotação do BRL preservada', async () => {
    await request(app).patch('/api/settings').send({ displayCurrency: 'JPY' }).expect(200); // o banco atual está em outra moeda
    const res = await octet(makeBackup(`v${version}.sqlite`, version, { rate: 5.2, source: 'PTAX', refresh: 'PTAX' }));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: version, schemaVersion: 26 });
    expect(res.body.data.migrationsApplied).toContain(24);
    const s = await settings();
    expect(s.displayCurrency).toBe('BRL');
    expect(s.language).toBe('pt-BR');
    expect(s.usdBrlRate).toBe(5.2);
    expect(s.fxRates).toEqual([
      { currency: 'BRL', rate: 5.2, source: 'PTAX', refreshSource: 'PTAX', quotedAt: null, updatedAt: '2026-11-01T10:00:00.000Z' },
    ]);
    const deposits = (await request(app).get('/api/deposits')).body.data;
    expect(deposits.deposits).toHaveLength(1);
    expect(deposits.deposits[0]).toMatchObject({ amountBrlCents: 4200, approxCurrency: 'BRL' });
  });

  test('backup sem cotação: BRL sem rate, "≈" nulo e nada quebra', async () => {
    const res = await octet(makeBackup(`v${version}-norate.sqlite`, version));
    expect(res.status).toBe(200);
    const s = await settings();
    expect(s.displayCurrency).toBe('BRL');
    expect(s.fxRates).toHaveLength(1);
    expect(s.fxRates[0]).toMatchObject({ currency: 'BRL', rate: null, source: null });
    expect((await request(app).get('/api/profit/summary')).status).toBe(200);
  });
});
