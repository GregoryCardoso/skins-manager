const fs = require('fs');
const os = require('os');
const path = require('path');

// QA da prévia da importação (12.8): versões intermediárias, chave do CSFloat dentro do arquivo enviado, Host, sem efeito colateral.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-preview-qa-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(60000);
let request;
let database;
let app;
let Database;

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
  Database = require('better-sqlite3');
  database = require('../../src/config/database');
  require('../../src/services/catalogService').setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024 });
  database.getDb();
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

const octet = (url, buf) => request(app).post(url).set('Content-Type', 'application/octet-stream').send(buf);
const preview = (buf) => octet('/api/backup/import-preview', buf);
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const exportBuffer = async () => (await request(app).get('/api/backup/export').buffer(true).parse(binary)).body;
const listDir = (sub) => (fs.existsSync(path.join(dir, sub)) ? fs.readdirSync(path.join(dir, sub)) : []);
const SECRET = 'CHAVE-SECRETA-ABCDEF123456';

function makeOldFile(file, maxVersion) {
  const { MIGRATIONS } = require('../../src/config/migrations');
  const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= maxVersion) });
  old.close();
}

describe('versões antigas e a atual', () => {
  test.each([1, 11, 20, 26])('arquivo na v%i: schemaVersion, migrationsToApply e currentSchemaVersion', async (version) => {
    const file = path.join(dir, `v${version}.sqlite`);
    makeOldFile(file, version);
    const res = await preview(fs.readFileSync(file));
    expect(res.status).toBe(200);
    const latest = database.getLatestSchemaVersion();
    expect(res.body.data.schemaVersion).toBe(version);
    expect(res.body.data.currentSchemaVersion).toBe(latest);
    expect(res.body.data.migrationsToApply).toEqual(Array.from({ length: latest - version }, (_, i) => version + 1 + i));
    expect(listDir('tmp')).toEqual([]);
  });

  test('arquivo na versão atual (v027 ou a mais nova): sem migrações a aplicar', async () => {
    const latest = database.getLatestSchemaVersion();
    expect(latest).toBeGreaterThanOrEqual(27);
    const res = await preview(await exportBuffer());
    expect(res.body.data.schemaVersion).toBe(latest);
    expect(res.body.data.migrationsToApply).toEqual([]);
  });

  test('arquivo recém-criado: exportedAt é nulo ou texto, e nunca estoura', async () => {
    const file = path.join(dir, 'fresh.sqlite');
    makeOldFile(file, database.getLatestSchemaVersion());
    const res = await preview(fs.readFileSync(file));
    expect(res.status).toBe(200);
    expect(res.body.data.exportedAt === null || typeof res.body.data.exportedAt === 'string').toBe(true);
  });
});

describe('versão mais nova que o app', () => {
  test('latest + 1 -> BACKUP_NEWER_VERSION', async () => {
    const future = path.join(dir, 'future2.sqlite');
    fs.writeFileSync(future, await exportBuffer());
    const db = new Database(future);
    db.pragma(`user_version = ${database.getLatestSchemaVersion() + 1}`);
    db.close();
    const res = await preview(fs.readFileSync(future));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BACKUP_NEWER_VERSION');
  });
});

describe('arquivo corrompido', () => {
  test('cabeçalho SQLite válido com o resto lixo -> erro 400 padrão, sem 500', async () => {
    const buf = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(4096, 0xab)]);
    const res = await preview(buf);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(['BACKUP_CORRUPTED', 'BACKUP_INVALID_FILE']).toContain(res.body.error.code);
    expect(listDir('tmp')).toEqual([]);
  });
  test('JSON enviado como octet-stream -> BACKUP_INVALID_FILE', async () => {
    const res = await preview(Buffer.from('{"a":1}'));
    expect(res.body.error.code).toBe('BACKUP_INVALID_FILE');
  });
});

describe('segurança e privacidade', () => {
  test('a chave do CSFloat gravada no arquivo enviado não vaza na resposta nem em campos extras', async () => {
    // O export tira a chave de propósito; o arquivo enviado pode trazê-la (backup antigo ou feito à mão), então ela é gravada na cópia.
    const keyed = path.join(dir, 'keyed.sqlite');
    fs.writeFileSync(keyed, await exportBuffer());
    const copy = new Database(keyed);
    copy.prepare('UPDATE integrations SET api_key = ?, api_key_saved_at = ? WHERE source = ?').run(SECRET, '2026-11-01T00:00:00.000Z', 'CSFLOAT');
    copy.pragma('wal_checkpoint(TRUNCATE)');
    copy.close();
    const file = fs.readFileSync(keyed);
    expect(file.includes(Buffer.from(SECRET))).toBe(true); // o arquivo realmente contém a chave
    const res = await preview(file);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toMatch(/api_?key/i);
  });

  test('Content-Type binário é exigido: json, texto e formulário dão 415', async () => {
    for (const type of ['application/json', 'text/plain', 'application/x-www-form-urlencoded']) {
      const res = await request(app).post('/api/backup/import-preview').set('Content-Type', type).send(type === 'application/json' ? '{}' : 'x');
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });

  test('Host estranho é recusado', async () => {
    const res = await request(app).post('/api/backup/import-preview').set('Host', 'evil.example.com').set('Content-Type', 'application/octet-stream').send(await exportBuffer());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });

  test('GET na rota não é uma prévia', async () => {
    const res = await request(app).get('/api/backup/import-preview');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('sem efeito colateral', () => {
  const state = () => {
    const db = database.getDb();
    return JSON.stringify({
      version: db.pragma('user_version', { simple: true }),
      stores: db.prepare('SELECT * FROM stores ORDER BY id').all(),
      settings: db.prepare('SELECT * FROM settings').all(),
      items: db.prepare('SELECT COUNT(*) AS n FROM items').get(),
    });
  };
  test('várias prévias seguidas (válida, antiga, inválida) não criam backup, não tocam no banco e não deixam temporário', async () => {
    const stateBefore = state();
    const backupsBefore = listDir('backups');
    const old = path.join(dir, 'v6b.sqlite');
    makeOldFile(old, 6);
    await preview(await exportBuffer());
    await preview(fs.readFileSync(old));
    await preview(Buffer.from('lixo'));
    await preview(Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(2048, 7)]));
    expect(state()).toBe(stateBefore);
    expect(listDir('backups')).toEqual(backupsBefore);
    expect(listDir('tmp')).toEqual([]);
  });

  test('o banco continua respondendo normalmente depois das prévias', async () => {
    expect((await request(app).get('/api/stores')).status).toBe(200);
  });
});
