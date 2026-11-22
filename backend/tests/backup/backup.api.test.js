const fs = require('fs');
const os = require('os');
const path = require('path');

// Banco de arquivo numa pasta temporária (nunca backend/data): env é lido ao carregar, então reinicia os módulos.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(60000);
let request;
let database;
let app;
let Database;
let settingsService;

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
  Database = require('better-sqlite3');
  database = require('../../src/config/database');
  const catalogService = require('../../src/services/catalogService');
  settingsService = require('../../src/services/settingsService');
  catalogService.setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024 });
  database.getDb();
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const exportBuffer = async () => (await request(app).get('/api/backup/export').buffer(true).parse(binary)).body;
const tmpFiles = () => (fs.existsSync(path.join(dir, 'tmp')) ? fs.readdirSync(path.join(dir, 'tmp')) : []);
const backupFiles = () => (fs.existsSync(path.join(dir, 'backups')) ? fs.readdirSync(path.join(dir, 'backups')) : []);

describe('exportar', () => {
  test('envia um SQLite válido com os cabeçalhos e apaga o temporário', async () => {
    const res = await request(app).get('/api/backup/export').buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/vnd\.sqlite3/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="skins-manager-backup-v\d+-\d{4}-\d{2}-\d{2}-\d{4}\.sqlite"$/
    );
    expect(res.body.subarray(0, 15).toString('latin1')).toBe('SQLite format 3');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(tmpFiles()).toEqual([]);
    const copy = path.join(dir, 'check.sqlite');
    fs.writeFileSync(copy, res.body);
    const db = new Database(copy);
    expect(db.pragma('user_version', { simple: true })).toBe(database.getLatestSchemaVersion());
    expect(db.pragma('application_id', { simple: true })).toBe(1397444935);
    db.close();
  });

  test('o CORS expõe Content-Disposition', async () => {
    const res = await request(app).get('/api/backup/export').set('Origin', 'http://localhost:3000').buffer(true).parse(binary);
    expect(res.headers['access-control-expose-headers']).toMatch(/Content-Disposition/i);
  });
});

describe('importar: recusas', () => {
  test('415 sem octet-stream', async () => {
    const res = await request(app).post('/api/backup/import').set('Content-Type', 'application/json').send({});
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  test('413 acima do limite', async () => {
    const res = await octet(Buffer.alloc(61 * 1024 * 1024, 1));
    expect(res.status).toBe(413);
    expect(res.body.error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', params: { maxBytes: 60 * 1024 * 1024 } });
  });

  test('corpo vazio e texto -> BACKUP_INVALID_FILE', async () => {
    expect((await octet(Buffer.alloc(0))).body.error.code).toBe('BACKUP_INVALID_FILE');
    const res = await octet(Buffer.from('isto nao e um banco'));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BACKUP_INVALID_FILE');
  });

  test('SQLite de outro app -> BACKUP_INVALID_FILE', async () => {
    const other = path.join(dir, 'other.sqlite');
    const db = new Database(other);
    db.exec('CREATE TABLE x (a); PRAGMA user_version = 2;');
    db.close();
    const res = await octet(fs.readFileSync(other));
    expect(res.body.error.code).toBe('BACKUP_INVALID_FILE');
  });

  test('arquivo truncado -> BACKUP_CORRUPTED', async () => {
    const good = await exportBuffer();
    const res = await octet(good.subarray(0, Math.floor(good.length / 2)));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BACKUP_CORRUPTED');
  });

  test('versão futura -> BACKUP_NEWER_VERSION sem tocar no banco', async () => {
    const future = path.join(dir, 'future.sqlite');
    fs.writeFileSync(future, await exportBuffer());
    const db = new Database(future);
    db.pragma('user_version = 99');
    db.close();
    const before = backupFiles().length;
    const res = await octet(fs.readFileSync(future));
    expect(res.body.error).toMatchObject({ code: 'BACKUP_NEWER_VERSION', params: { fileVersion: 99 } });
    expect(backupFiles().length).toBe(before);
    expect(tmpFiles()).toEqual([]);
  });

  test('BACKUP_BUSY com atualização em andamento', async () => {
    const file = await exportBuffer();
    const spy = jest.spyOn(settingsService, 'isFxRefreshInProgress').mockReturnValue(true);
    const res = await octet(file);
    spy.mockRestore();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BACKUP_BUSY');
  });
});

describe('importar: sucesso', () => {
  test('ida e volta, backup automático e temporários limpos', async () => {
    await request(app).patch('/api/settings').send({ language: 'en' });
    const file = await exportBuffer();
    await request(app).patch('/api/settings').send({ language: 'pt-BR' });
    const res = await octet(file);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ migrationsApplied: [], counts: { items: 0 } });
    expect(res.body.data.preImportBackupFile).toMatch(/^inventory-before-import-v\d+-.*\.sqlite$/);
    expect(backupFiles()).toContain(res.body.data.preImportBackupFile);
    expect((await request(app).get('/api/settings')).body.data.language).toBe('en');
    expect(tmpFiles()).toEqual([]);
  });

  test('banco v3 é migrado ao importar', async () => {
    const v3 = path.join(dir, 'v3.sqlite');
    const { MIGRATIONS } = require('../../src/config/migrations');
    database.openDatabase(v3, { migrations: MIGRATIONS.slice(0, 3) }).close();
    const res = await octet(fs.readFileSync(v3));
    expect(res.status).toBe(200);
    expect(res.body.data.fileVersion).toBe(3);
    expect(res.body.data.migrationsApplied).toEqual(MIGRATIONS.filter((m) => m.version > 3).map((m) => m.version));
    expect(database.getSchemaVersion()).toBe(database.getLatestSchemaVersion());
  });

  test('banco v4 (com PTAX salva) é migrado para v5 ao importar, preservando a cotação e a data', async () => {
    const v4 = path.join(dir, 'v4.sqlite');
    const { MIGRATIONS } = require('../../src/config/migrations');
    const old = database.openDatabase(v4, { migrations: MIGRATIONS.slice(0, 4) });
    old.prepare(
      "UPDATE settings SET usd_brl_rate = 5.3012, usd_brl_rate_source = 'PTAX', ptax_quoted_at = '2026-11-19T16:04:28.123Z'"
    ).run();
    old.close();
    const res = await octet(fs.readFileSync(v4));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: 4, schemaVersion: 11, migrationsApplied: [5, 6, 7, 8, 9, 10, 11] });
    const settings = (await request(app).get('/api/settings')).body.data;
    expect(settings).toMatchObject({
      usdBrlRate: 5.3012, usdBrlRateSource: 'PTAX', rateQuotedAt: '2026-11-19T16:04:28.123Z', fxRefreshSource: 'AWESOMEAPI',
    });
  });

  test('falha na reabertura restaura o banco anterior e devolve 500', async () => {
    await request(app).patch('/api/settings').send({ language: 'en' });
    const file = await exportBuffer();
    await request(app).patch('/api/settings').send({ language: 'pt-BR' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const spy = jest.spyOn(database, 'getDb').mockImplementationOnce(() => {
      throw new Error('falha simulada');
    });
    const res = await octet(file);
    spy.mockRestore();
    console.error.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('BACKUP_IMPORT_FAILED');
    expect((await request(app).get('/api/settings')).body.data.language).toBe('pt-BR');
    expect(tmpFiles()).toEqual([]);
  });

  test('retenção: só os 10 backups de importação mais novos sobram', async () => {
    const file = await exportBuffer();
    for (let i = 0; i < 12; i += 1) {
      const res = await octet(file);
      expect(res.status).toBe(200);
    }
    const imports = backupFiles().filter((n) => n.startsWith('inventory-before-import-v'));
    expect(imports).toHaveLength(10);
  });
});
