const fs = require('fs');
const os = require('os');
const path = require('path');

// QA 8.6 (D248, D253): importar backups v1 a v8 chega à v9 com o mesmo resultado (sem saldo inicial) e o saldo calculado funciona;
// ida e volta de um backup v8. Banco numa pasta temporária.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-v8qa-'));
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
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const exportBuffer = async () => (await request(app).get('/api/backup/export').buffer(true).parse(binary)).body;
const current = async () => (await request(app).get('/api/store-balances/current')).body.data;
const history = async (storeId) => (await request(app).get(`/api/store-balances?storeId=${storeId}`)).body.data.balances;

// Banco na versão `version` com registros de saldo em duas lojas (CSFloat com 3, Steam com 1; CSMoney sem nenhum).
function makeBackup(version) {
  const file = path.join(dir, `v${version}-${(makeBackup.n = (makeBackup.n || 0) + 1)}.sqlite`);
  const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= version) });
  const id = (name) => old.prepare('SELECT id FROM stores WHERE name = ?').get(name).id;
  const ins = old.prepare('INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, ?, ?, ?)');
  ins.run(id('CSFloat'), 1000, '2026-11-01T12:00:00.000Z', 'a');
  ins.run(id('CSFloat'), 2500, '2026-11-18T12:00:00.000Z', 'b');
  ins.run(id('CSFloat'), 1800, '2026-11-10T12:00:00.000Z', 'c');
  ins.run(id('Steam'), 4590, '2026-11-05T12:00:00.000Z', 'd');
  old.close();
  return fs.readFileSync(file);
}

describe('importar backups v1 a v8 (D248, D253)', () => {
  test.each([1, 2, 3, 4, 5, 6, 7])('backup v%i migra para a v9: todos os registros viram registro antigo e nenhum saldo inicial sobra', async (version) => {
    const res = await octet(makeBackup(version));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: version, schemaVersion: 9 });
    expect(res.body.data.migrationsApplied).toEqual(MIGRATIONS.filter((m) => m.version > version).map((m) => m.version));

    const data = await current();
    const csf = data.stores.find((s) => s.storeName === 'CSFloat');
    const money = data.stores.find((s) => s.storeName === 'CSMoney');
    // sem saldo inicial: o saldo calculado parte de 0 (nenhuma movimentação neste backup)
    expect(csf).not.toHaveProperty('initialBalance');
    expect(csf.breakdown).not.toHaveProperty('initialCents');
    expect(csf.availableCents).toBe(0);
    expect(csf.lastCheck).toMatchObject({ kind: 'CHECK', balanceCents: 2500, legacy: true });
    expect(money.lastCheck).toBeNull();
    expect(money.warningCode).toBeNull();

    const hist = await history(csf.storeId);
    expect(hist.map((h) => [h.kind, h.balanceCents, h.legacy])).toEqual([['CHECK', 2500, true], ['CHECK', 1800, true], ['CHECK', 1000, true]]);
    expect(hist.every((h) => h.computedCents === null && h.differenceCents === null && h.adjustmentCents === null)).toBe(true);
    expect(database.getDb().prepare("SELECT COUNT(*) AS n FROM store_balances WHERE kind <> 'CHECK'").get().n).toBe(0);
    expect(database.getDb().pragma('foreign_key_check')).toEqual([]);
    expect((await request(app).get('/api/profit/summary')).status).toBe(200);
  });

  test('backup v8 (com saldo inicial) migra só pela v9: o INITIAL vira registro antigo e o resto fica', async () => {
    const file = path.join(dir, 'v8-direto.sqlite');
    const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 8) });
    const csfId = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    old.prepare("INSERT INTO store_balances (store_id, kind, balance_cents, recorded_at, created_at, note) VALUES (?, 'INITIAL', 0, '2026-10-01T00:00:00.000Z', 'a', 'início')").run(csfId);
    old.prepare("INSERT INTO store_balances (store_id, kind, balance_cents, computed_cents, adjustment_cents, recorded_at, created_at, note) VALUES (?, 'CHECK', 90, 100, -10, '2026-11-01T00:00:00.000Z', 'b', 'taxa')").run(csfId);
    old.close();
    const res = await octet(fs.readFileSync(file));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: 8, schemaVersion: 9, migrationsApplied: [9] });
    const hist = await history(csfId);
    expect(hist.map((h) => [h.kind, h.balanceCents, h.legacy, h.adjustmentCents, h.note])).toEqual([
      ['CHECK', 90, false, -10, 'taxa'], ['CHECK', 0, true, null, 'início'],
    ]);
  });

  test('registro antigo migrado pode ser excluído; a última conferência vem dos que sobram', async () => {
    await octet(makeBackup(7));
    const data = await current();
    const csf = data.stores.find((s) => s.storeName === 'CSFloat');
    expect(csf.lastCheck).toMatchObject({ kind: 'CHECK', legacy: true, balanceCents: 2500 });
    expect((await request(app).delete(`/api/store-balances/${csf.lastCheck.id}`)).status).toBe(200);
    const after = (await current()).stores.find((s) => s.storeName === 'CSFloat');
    expect(after.lastCheck).toMatchObject({ kind: 'CHECK', legacy: true, balanceCents: 1800 });
  });

  test('registros antigos não bloqueiam uma conferência nova com data anterior a eles (D252)', async () => {
    await octet(makeBackup(5));
    const csf = (await current()).stores.find((s) => s.storeName === 'CSFloat').storeId;
    const check = await request(app).post('/api/store-balances').send({ storeId: csf, balanceCents: 10, recordedAt: '2026-11-02T12:00:00.000Z' });
    expect(check.status).toBe(201);
    expect(check.body.data).toMatchObject({ computedCents: 0, differenceCents: 10, legacy: false });
  });
});

describe('ida e volta de um backup v8', () => {
  test('exportar e importar preserva kind, calculado, ajuste, nota e o saldo disponível', async () => {
    await octet(makeBackup(7));
    const csf = (await current()).stores.find((s) => s.storeName === 'CSFloat').storeId;
    const check = await request(app).post('/api/store-balances').send({
      storeId: csf, balanceCents: 2400, recordedAt: '2026-11-20T12:00:00.000Z', adjust: true, note: 'taxa não registrada',
    });
    expect(check.status).toBe(201);
    expect(check.body.data).toMatchObject({ computedCents: 0, adjustmentCents: 2400 });
    const before = await history(csf);
    const availableBefore = (await current()).stores.find((s) => s.storeId === csf).availableCents;
    expect(availableBefore).toBe(2400);

    const exported = await exportBuffer();
    // altera o banco atual e reimporta o export
    await request(app).delete(`/api/store-balances/${check.body.data.id}`);
    const res = await octet(exported);
    expect(res.status).toBe(200);
    expect(res.body.data.migrationsApplied).toEqual([]);
    expect(await history(csf)).toEqual(before);
    expect((await current()).stores.find((s) => s.storeId === csf).availableCents).toBe(2400);
  });

  test('um backup de versão mais nova que o app é recusado com BACKUP_NEWER_VERSION e nada muda', async () => {
    await octet(makeBackup(7));
    const rowsBefore = database.getDb().prepare('SELECT COUNT(*) AS n FROM store_balances').get().n;
    const file = path.join(dir, 'newer.sqlite');
    const old = database.openDatabase(file);
    old.pragma('user_version = 10');
    old.close();
    const res = await octet(fs.readFileSync(file));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BACKUP_NEWER_VERSION');
    expect(database.getDb().prepare('SELECT COUNT(*) AS n FROM store_balances').get().n).toBe(rowsBefore);
  });
});
