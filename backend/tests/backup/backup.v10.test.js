const fs = require('fs');
const os = require('os');
const path = require('path');

// 8.7.2 (D267, D270): importar backups v5, v8 e v9 chega à v10 com todos os itens à venda; backup v10 num app mais antigo é recusado.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-v10-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(60000);
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

function makeBackup(version) {
  const file = path.join(dir, `v${version}.sqlite`);
  const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= version) });
  const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, status, created_at, updated_at)
     VALUES ('Caixa', 'CAIXA', 'COMPRA', ?, 500, '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`
  ).run(csf);
  old.close();
  return fs.readFileSync(file);
}

describe('importar backups antigos (D267)', () => {
  test.each([5, 8, 9])('backup v%i migra até a v10 e todos os itens ficam à venda', async (version) => {
    const res = await octet(makeBackup(version));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: version, schemaVersion: 23 });
    expect(res.body.data.migrationsApplied).toEqual(MIGRATIONS.filter((m) => m.version > version).map((m) => m.version));
    const list = (await request(app).get('/api/items')).body.data;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ saleState: 'FOR_SALE', offSaleAt: null, forSaleSince: null });
    expect(list.meta.saleStateCounts).toEqual({ forSale: 1, offSale: 0 });
  });

  test('ida e volta de um backup v10 com item fora de venda preserva as datas', async () => {
    const id = (await request(app).get('/api/items')).body.data.items[0].id;
    await request(app).post(`/api/items/${id}/off-sale`).send({}).expect(200);
    const chunks = [];
    const exported = await request(app).get('/api/backup/export').buffer(true).parse((res, cb) => {
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    await request(app).post(`/api/items/${id}/for-sale`).send({}).expect(200);
    expect((await octet(exported.body)).status).toBe(200);
    const view = (await request(app).get('/api/items')).body.data.items[0];
    expect(view).toMatchObject({ saleState: 'OFF_SALE', forSaleSince: null });
    expect(view.offSaleAt).toEqual(expect.any(String));
  });

  test('backup de versão mais nova que o app (v12) -> BACKUP_NEWER_VERSION', async () => {
    const file = path.join(dir, 'newer.sqlite');
    const old = database.openDatabase(file);
    old.pragma('user_version = 99');
    old.close();
    const res = await octet(fs.readFileSync(file));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BACKUP_NEWER_VERSION');
  });
});
