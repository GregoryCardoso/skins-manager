const fs = require('fs');
const os = require('os');
const path = require('path');

// D370 (v028): backup v27 importado vira sellsHere = true; exportar e importar um v28 preserva sellsHere = false.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-v28-'));
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
const stores = async () => (await request(app).get('/api/stores')).body.data;
const steam = async () => (await stores()).find((s) => s.name === 'Steam');
const setSells = (id, value) => request(app).patch(`/api/stores/${id}`).set('Content-Type', 'application/json').send({ sellsHere: value });

test('importar um backup v27 deixa todas as lojas com sellsHere true', async () => {
  await setSells((await steam()).id, false);
  const file = path.join(dir, 'v27.sqlite');
  database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 27) }).close();
  const res = await octet(fs.readFileSync(file));
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ fileVersion: 27, schemaVersion: 28 });
  expect((await stores()).every((s) => s.sellsHere === true)).toBe(true);
});

test('exportar com sellsHere false, religar e importar de volta restaura false', async () => {
  const id = (await steam()).id;
  await setSells(id, false);
  const chunks = [];
  const exported = (await request(app).get('/api/backup/export').buffer(true).parse((r, cb) => {
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  })).body;
  await setSells(id, true);
  const res = await octet(exported);
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ fileVersion: 28, schemaVersion: 28 });
  expect((await steam()).sellsHere).toBe(false);
});
