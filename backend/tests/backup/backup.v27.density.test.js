const fs = require('fs');
const os = require('os');
const path = require('path');

// 12.5a (D370): backup v26 importado recebe COMPACT; exportar e importar um v27 preserva a densidade.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-v27-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(120000);
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
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => new Date('2026-11-27T12:00:00.000Z') });
  database.getDb();
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
const settings = async () => (await request(app).get('/api/settings')).body.data;

test('importar um backup v26 deixa a densidade em COMPACT', async () => {
  await request(app).patch('/api/settings').send({ inventoryDensity: 'COMFORTABLE' });
  const file = path.join(dir, 'v26.sqlite');
  database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 26) }).close();
  const res = await octet(fs.readFileSync(file));
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ fileVersion: 26, schemaVersion: 27 });
  expect((await settings()).inventoryDensity).toBe('COMPACT');
});

test('exportar com COMFORTABLE, mudar e importar de volta restaura COMFORTABLE', async () => {
  await request(app).patch('/api/settings').send({ inventoryDensity: 'COMFORTABLE' });
  const chunks = [];
  const exported = (await request(app).get('/api/backup/export').buffer(true).parse((r, cb) => {
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  })).body;
  await request(app).patch('/api/settings').send({ inventoryDensity: 'COMPACT' });
  const res = await octet(exported);
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ fileVersion: 27, schemaVersion: 27 });
  expect((await settings()).inventoryDensity).toBe('COMFORTABLE');
});
