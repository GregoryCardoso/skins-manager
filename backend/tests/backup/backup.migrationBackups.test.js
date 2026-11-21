const fs = require('fs');
const os = require('os');
const path = require('path');

// Import de backup não toca nos backups `inventory-v*` de migração (banco de arquivo temporário, nunca backend/data).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-migbk-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(60000);
let request;
let database;
let app;

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
  database = require('../../src/config/database');
  require('../../src/services/catalogService').setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  app = require('../../src/app').createApp({});
  database.getDb();
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
const backupsDir = () => path.join(dir, 'backups');
const names = (prefix) => (fs.existsSync(backupsDir()) ? fs.readdirSync(backupsDir()) : []).filter((n) => n.startsWith(prefix));
const migrationBackups = () => names('inventory-v').filter((n) => !n.startsWith('inventory-before-import'));

function seedFakeMigrationBackups(count) {
  fs.mkdirSync(backupsDir(), { recursive: true });
  const created = [];
  for (let i = 0; i < count; i += 1) {
    const name = `inventory-v${i + 1}-2026-01-${String(i + 1).padStart(2, '0')}T00-00-00.000Z.sqlite`;
    fs.writeFileSync(path.join(backupsDir(), name), 'x');
    created.push(name);
  }
  return created;
}

test('importar v3 várias vezes não cria nem apaga inventory-v* (nem passa da retenção de import)', async () => {
  const { MIGRATIONS } = require('../../src/config/migrations');
  const v3 = path.join(dir, 'v3.sqlite');
  database.openDatabase(v3, { migrations: MIGRATIONS.slice(0, 3), skipMigrationBackup: true }).close();
  const file = fs.readFileSync(v3);
  const fakes = seedFakeMigrationBackups(12); // acima da retenção de 10: não podem ser podados pelo import
  for (let i = 0; i < 4; i += 1) {
    const res = await octet(file);
    expect(res.status).toBe(200);
    expect(res.body.data.fileVersion).toBe(3);
    expect(res.body.data.migrationsApplied.length).toBeGreaterThan(0);
    expect(migrationBackups().sort()).toEqual([...fakes].sort());
  }
  expect(database.getSchemaVersion()).toBe(database.getLatestSchemaVersion());
});

test('importar um backup já atual também não cria inventory-v*', async () => {
  const before = migrationBackups().sort();
  const exported = await request(app).get('/api/backup/export').buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  for (let i = 0; i < 3; i += 1) expect((await octet(exported.body)).status).toBe(200);
  expect(migrationBackups().sort()).toEqual(before);
});

test('falha na reabertura + restauração não cria nem apaga inventory-v*', async () => {
  const exported = await request(app).get('/api/backup/export').buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  const before = migrationBackups().sort();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const spy = jest.spyOn(database, 'getDb').mockImplementationOnce(() => {
    throw new Error('falha simulada');
  });
  const res = await octet(exported.body);
  spy.mockRestore();
  console.error.mockRestore();
  expect(res.status).toBe(500);
  expect(res.body.error.code).toBe('BACKUP_IMPORT_FAILED');
  expect(migrationBackups().sort()).toEqual(before);
  expect((await request(app).get('/api/health')).status).toBe(200);
});
