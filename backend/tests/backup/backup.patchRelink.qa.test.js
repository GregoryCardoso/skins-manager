const fs = require('fs');
const os = require('os');
const path = require('path');

// 10.9 (D368, QA, E-P2-Q63): backup com um patch antigo em OUTRO ("Patch | X") e catálogo sem PATCH. Ao importar, o sync do catálogo
// embutido (que tem PATCHES) religa o item por nome exato, sem mexer em custo nem datas. Banco temporário; nunca o banco real.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-q63-'));
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
  const catalogService = require('../../src/services/catalogService');
  catalogService.setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  database.getDb();
  require('../helpers/catalog').importCatalogFixture(); // fixture de 2026-11-01, sem PATCHES
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => new Date('2026-11-25T15:00:00.000Z') });
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

test('importar o backup religa o "Patch | X" em OUTRO ao PATCH do catálogo embutido', async () => {
  const csfloat = (await request(app).get('/api/stores')).body.data.find((s) => s.name === 'CSFloat').id;
  const created = await request(app).post('/api/items').send({
    category: 'OUTRO', name: 'Patch | Chicken Lover', acquisitionType: 'COMPRA', purchaseStoreId: csfloat, purchasePriceCents: 41,
    acquiredAt: '2026-10-01T12:00:00.000Z',
  });
  expect(created.status).toBe(201);
  const before = created.body.data;
  expect(before).toMatchObject({ category: 'OUTRO', catalogId: null });

  const file = (await request(app).get('/api/backup/export').buffer(true).parse(binary)).body;
  const res = await request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(file);
  expect(res.status).toBe(200);

  const after = (await request(app).get(`/api/items/${before.id}`)).body.data;
  expect(after).toMatchObject({ category: 'PATCH', name: 'Patch | Chicken Lover' });
  expect(after.catalogId).not.toBeNull();
  for (const field of ['purchasePriceCents', 'purchaseCurrency', 'purchaseStoreId', 'acquiredAt', 'acquisitionType', 'status']) {
    expect(after[field]).toEqual(before[field]);
  }
});
