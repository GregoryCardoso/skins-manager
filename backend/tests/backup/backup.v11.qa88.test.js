const fs = require('fs');
const os = require('os');
const path = require('path');

// QA 8.8 (D276): backups antigos (v1..v10) importados chegam à v11 com GROUPED; um backup v11 com INDIVIDUAL preserva o valor.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-v11qa-'));
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
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => new Date('2026-11-22T12:00:00.000Z') });
  database.getDb();
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
const settings = async () => (await request(app).get('/api/settings')).body.data;

function makeBackup(version) {
  const file = path.join(dir, `v${version}.sqlite`);
  const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= version) });
  const cols = old.prepare("SELECT name FROM pragma_table_info('settings')").all().map((c) => c.name);
  if (cols.includes('theme') && cols.includes('language')) old.prepare("UPDATE settings SET theme = 'DARK', language = 'en'").run();
  old.close();
  return fs.readFileSync(file);
}

describe('backups antigos viram v11 com GROUPED', () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('backup v%i -> schemaVersion 11, visão GROUPED, demais preferências preservadas', async (version) => {
    // garante que o app esteja com INDIVIDUAL antes: o import precisa trocar para o valor do backup (GROUPED)
    await request(app).patch('/api/settings').send({ inventoryView: 'INDIVIDUAL' });
    const res = await octet(makeBackup(version));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: version, schemaVersion: 22 });
    const s = await settings();
    expect(s.inventoryView).toBe('GROUPED');
    if (version >= 3) expect(s).toMatchObject({ theme: 'DARK', language: 'en' });
  });
});

describe('backup v11', () => {
  async function exportBuffer() {
    const chunks = [];
    const res = await request(app).get('/api/backup/export').buffer(true).parse((r, cb) => {
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    return res.body;
  }

  test('exportar com INDIVIDUAL, mudar para GROUPED e importar restaura INDIVIDUAL', async () => {
    await request(app).patch('/api/settings').send({ inventoryView: 'INDIVIDUAL' });
    const exported = await exportBuffer();
    await request(app).patch('/api/settings').send({ inventoryView: 'GROUPED' });
    expect((await settings()).inventoryView).toBe('GROUPED');
    const res = await octet(exported);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: 22, schemaVersion: 22 });
    expect((await settings()).inventoryView).toBe('INDIVIDUAL');
  });

  test('exportar com GROUPED, mudar para INDIVIDUAL e importar restaura GROUPED', async () => {
    await request(app).patch('/api/settings').send({ inventoryView: 'GROUPED' });
    const exported = await exportBuffer();
    await request(app).patch('/api/settings').send({ inventoryView: 'INDIVIDUAL' });
    expect((await octet(exported)).status).toBe(200);
    expect((await settings()).inventoryView).toBe('GROUPED');
  });

  test('backup v12 (mais novo) -> BACKUP_NEWER_VERSION e a preferência não muda', async () => {
    await request(app).patch('/api/settings').send({ inventoryView: 'INDIVIDUAL' });
    const file = path.join(dir, 'v12.sqlite');
    const newer = database.openDatabase(file);
    newer.pragma('user_version = 99');
    newer.close();
    const res = await octet(fs.readFileSync(file));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BACKUP_NEWER_VERSION');
    expect((await settings()).inventoryView).toBe('INDIVIDUAL');
  });
});
