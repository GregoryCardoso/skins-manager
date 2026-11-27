const fs = require('fs');
const os = require('os');
const path = require('path');

// Prévia da importação do backup (12.8): só lê e resume, não grava nada. Banco numa pasta temporária (nunca o real).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-preview-'));
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
const tmpFiles = () => (fs.existsSync(path.join(dir, 'tmp')) ? fs.readdirSync(path.join(dir, 'tmp')) : []);
const backupFiles = () => (fs.existsSync(path.join(dir, 'backups')) ? fs.readdirSync(path.join(dir, 'backups')) : []);
const snapshot = () => {
  const db = database.getDb();
  return JSON.stringify({
    items: db.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM items').get(),
    stores: db.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM stores').get(),
    settings: db.prepare('SELECT MAX(updated_at) AS u FROM settings').get(),
  });
};

function makeV6Backup(file) {
  const { MIGRATIONS } = require('../../src/config/migrations');
  const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 6) });
  const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, acquired_at, status, sale_store_id, sale_price_cents,
       sale_currency, net_received_cents, sold_at, sale_fee_type_applied, sale_fee_rate_applied, sale_fee_rounding_applied,
       sale_fixed_fee_cents_applied, created_at, updated_at)
     VALUES ('Vendida', 'CAIXA', 'GANHEI', ?, '2026-01-01T00:00:00.000Z', 'VENDIDO', ?, 1000, 'USD', 980,
       '2026-11-15T12:00:00.000Z', 'DEDUCTED', 0.02, 'CEIL', 0, '2026-01-01T00:00:00.000Z', '2026-12-30T10:00:00.000Z')`
  ).run(csf, csf);
  old.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, note, created_at, updated_at) VALUES (50000, '2026-10-01T12:00:00.000Z', NULL, 'a', 'c', 'u')").run();
  old.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, note, created_at, updated_at) VALUES (30000, '2026-10-05T12:00:00.000Z', ?, 'b', 'c', 'u')").run(csf);
  old.prepare("INSERT INTO withdrawals (amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (10000, '2026-11-02T12:00:00.000Z', 'c', 'u')").run();
  old.close();
}

describe('prévia de um backup exportado pelo próprio app', () => {
  test('devolve versões, contagens e tamanho, e bate com o resultado da importação', async () => {
    const file = await exportBuffer();
    const res = await preview(file);
    expect(res.status).toBe(200);
    const latest = database.getLatestSchemaVersion();
    expect(res.body.data).toMatchObject({
      schemaVersion: latest,
      currentSchemaVersion: latest,
      migrationsToApply: [],
      appVersion: require('../../package.json').version,
      sizeBytes: file.length,
      counts: { items: 0, sales: 0, stores: 3, deposits: 0, withdrawals: 0 },
    });
    expect(typeof res.body.data.exportedAt).toBe('string');
    const imported = await octet('/api/backup/import', file);
    expect(imported.status).toBe(200);
    expect(imported.body.data.counts).toMatchObject({ items: res.body.data.counts.items, stores: res.body.data.counts.stores });
  });

  test('o banco aberto não muda e nenhum temporário sobra', async () => {
    const file = await exportBuffer();
    const before = snapshot();
    const backupsBefore = backupFiles().length;
    expect((await preview(file)).status).toBe(200);
    expect(snapshot()).toBe(before);
    expect(backupFiles().length).toBe(backupsBefore);
    expect(tmpFiles()).toEqual([]);
  });

  test('a chave do CSFloat não aparece na resposta', async () => {
    const db = database.getDb();
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'integrations'").get();
    if (hasTable) db.prepare("UPDATE integrations SET api_key = 'CHAVE-SECRETA-123456'").run();
    const res = await preview(await exportBuffer());
    expect(JSON.stringify(res.body)).not.toContain('CHAVE-SECRETA');
    expect(Object.keys(res.body.data).sort()).toEqual([
      'appVersion', 'counts', 'currentSchemaVersion', 'exportedAt', 'migrationsToApply', 'schemaVersion', 'sizeBytes',
    ]);
  });
});

describe('arquivo de esquema antigo', () => {
  test('v6: migrationsToApply, contagens e a última alteração registrada', async () => {
    const file = path.join(dir, 'v6.sqlite');
    makeV6Backup(file);
    const res = await preview(fs.readFileSync(file));
    expect(res.status).toBe(200);
    const latest = database.getLatestSchemaVersion();
    expect(res.body.data.schemaVersion).toBe(6);
    expect(res.body.data.currentSchemaVersion).toBe(latest);
    expect(res.body.data.migrationsToApply).toEqual(Array.from({ length: latest - 6 }, (_, i) => 7 + i));
    expect(res.body.data.counts).toEqual({ items: 1, sales: 1, stores: 3, deposits: 2, withdrawals: 1 });
    expect(res.body.data.exportedAt).toBe('2026-12-30T10:00:00.000Z');
    expect(tmpFiles()).toEqual([]);
  });
});

describe('recusas (as mesmas da importação)', () => {
  test('415 sem octet-stream', async () => {
    const res = await request(app).post('/api/backup/import-preview').set('Content-Type', 'application/json').send({});
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
  test('413 acima do limite', async () => {
    const res = await preview(Buffer.alloc(61 * 1024 * 1024, 1));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
  test('corpo vazio e texto -> BACKUP_INVALID_FILE', async () => {
    expect((await preview(Buffer.alloc(0))).body.error.code).toBe('BACKUP_INVALID_FILE');
    expect((await preview(Buffer.from('isto nao e um banco'))).body.error.code).toBe('BACKUP_INVALID_FILE');
  });
  test('SQLite de outro app -> BACKUP_INVALID_FILE', async () => {
    const other = path.join(dir, 'other.sqlite');
    const db = new Database(other);
    db.exec('CREATE TABLE x (a); PRAGMA user_version = 2;');
    db.close();
    const res = await preview(fs.readFileSync(other));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BACKUP_INVALID_FILE');
  });
  test('arquivo truncado -> BACKUP_CORRUPTED', async () => {
    const good = await exportBuffer();
    const res = await preview(good.subarray(0, Math.floor(good.length / 2)));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BACKUP_CORRUPTED');
    expect(tmpFiles()).toEqual([]);
  });
  test('versão futura -> BACKUP_NEWER_VERSION com params', async () => {
    const future = path.join(dir, 'future.sqlite');
    fs.writeFileSync(future, await exportBuffer());
    const db = new Database(future);
    db.pragma('user_version = 99');
    db.close();
    const res = await preview(fs.readFileSync(future));
    expect(res.body.error).toMatchObject({ code: 'BACKUP_NEWER_VERSION', params: { fileVersion: 99 } });
    expect(tmpFiles()).toEqual([]);
  });
  test('a prévia não é recusada por BACKUP_BUSY', async () => {
    const settingsService = require('../../src/services/settingsService');
    const file = await exportBuffer();
    const spy = jest.spyOn(settingsService, 'isFxRefreshInProgress').mockReturnValue(true);
    const res = await preview(file);
    spy.mockRestore();
    expect(res.status).toBe(200);
  });
});
