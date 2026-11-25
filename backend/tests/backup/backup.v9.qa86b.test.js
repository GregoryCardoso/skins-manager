const fs = require('fs');
const os = require('os');
const path = require('path');

// QA Revisão 23 (D253, D256): importar backups v1 a v8 chega à v9 sem nenhum INITIAL, com os registros antigos preservados,
// e o fluxo novo da conferência (BEFORE_LAST ignora registros antigos; lastCheck conta todos). Banco numa pasta temporária.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-v9qa-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(60000);
let request;
let database;
let app;
let MIGRATIONS;
let counter = 0;

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
const csfRow = async () => (await current()).stores.find((s) => s.storeName === 'CSFloat');
const history = async (storeId) => (await request(app).get(`/api/store-balances?storeId=${storeId}`)).body.data.balances;

// Banco na versão `version` com registros de saldo da CSFloat (3) e da Steam (1); na v8 o mais recente de cada loja é INITIAL
// e há uma conferência com cálculo e ajuste de -100.
function makeBackup(version) {
  counter += 1;
  const file = path.join(dir, `v${version}-${counter}.sqlite`);
  const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= version) });
  const id = (name) => old.prepare('SELECT id FROM stores WHERE name = ?').get(name).id;
  const csf = id('CSFloat');
  const steam = id('Steam');
  if (version >= 8) {
    const ins = old.prepare('INSERT INTO store_balances (store_id, kind, balance_cents, computed_cents, adjustment_cents, recorded_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    ins.run(csf, 'CHECK', 1000, null, null, '2026-11-01T12:00:00.000Z', 'a');
    ins.run(csf, 'CHECK', 900, 1000, -100, '2026-11-12T12:00:00.000Z', 'b');
    ins.run(csf, 'INITIAL', 2500, null, null, '2026-11-18T12:00:00.000Z', 'c');
    ins.run(steam, 'INITIAL', 4590, null, null, '2026-11-05T12:00:00.000Z', 'd');
  } else {
    const ins = old.prepare('INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, ?, ?, ?)');
    ins.run(csf, 1000, '2026-11-01T12:00:00.000Z', 'a');
    ins.run(csf, 2500, '2026-11-18T12:00:00.000Z', 'b');
    ins.run(csf, 1800, '2026-11-10T12:00:00.000Z', 'c');
    ins.run(steam, 4590, '2026-11-05T12:00:00.000Z', 'd');
  }
  old.close();
  return fs.readFileSync(file);
}

describe('importar backups v1 a v8 chega à v9 sem nenhum INITIAL', () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8])('backup v%i: todos os registros viram CHECK; saldo calculado a partir de 0; app segue funcionando', async (version) => {
    const res = await octet(makeBackup(version));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: version, schemaVersion: 25 });
    expect(res.body.data.migrationsApplied).toEqual(MIGRATIONS.filter((m) => m.version > version).map((m) => m.version));

    const db = database.getDb();
    expect(db.prepare("SELECT COUNT(*) AS n FROM store_balances WHERE kind <> 'CHECK'").get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM store_balances').get().n).toBe(4);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ux_store_balances_initial'").all()).toEqual([]);

    const csf = await csfRow();
    expect(csf).not.toHaveProperty('initialBalance');
    expect(csf.breakdown).not.toHaveProperty('initialCents');
    // sem movimentações, o disponível parte de 0; na v8 só o ajuste com cálculo (−100) conta
    expect(csf.availableCents).toBe(version >= 8 ? -100 : 0);
    // lastCheck conta os registros antigos (o mais recente é o de 11-18)
    expect(csf.lastCheck).toMatchObject({ kind: 'CHECK', balanceCents: 2500, recordedAt: '2026-11-18T12:00:00.000Z', legacy: true });
    expect(csf.daysSinceLastCheck).toBe(4);
    const hist = await history(csf.storeId);
    expect(hist.every((h) => h.kind === 'CHECK')).toBe(true);
    expect(hist).toHaveLength(3);
    expect((await request(app).get('/api/profit/summary')).status).toBe(200);
  });

  test('o INITIAL da v8 preserva a nota; a conferência com cálculo e ajuste continua com os valores', async () => {
    await octet(makeBackup(8));
    const csf = await csfRow();
    const hist = await history(csf.storeId);
    const withAdjust = hist.find((h) => h.adjustmentCents === -100);
    expect(withAdjust).toMatchObject({ computedCents: 1000, differenceCents: -100, legacy: false });
    expect(hist.filter((h) => h.legacy)).toHaveLength(2);
  });

  test('depois de importar: conferência anterior a um registro antigo é aceita (BEFORE_LAST ignora registros antigos)', async () => {
    await octet(makeBackup(7));
    const csf = (await csfRow()).storeId;
    // os três registros antigos são de 11-01, 11-10 e 11-18: uma conferência em 11-05 é aceita
    const early = await request(app).post('/api/store-balances').send({ storeId: csf, balanceCents: 0, recordedAt: '2026-11-05T12:00:00.000Z' });
    expect(early.status).toBe(201);
    expect(early.body.data).toMatchObject({ computedCents: 0, legacy: false });
    const earlier = await request(app).post('/api/store-balances').send({ storeId: csf, balanceCents: 0, recordedAt: '2026-11-04T12:00:00.000Z' });
    expect(earlier.status).toBe(400);
    expect(earlier.body.error).toMatchObject({ code: 'BALANCE_CHECK_BEFORE_LAST', field: 'recordedAt' });
    const same = await request(app).post('/api/store-balances').send({ storeId: csf, balanceCents: 0, recordedAt: '2026-11-05T12:00:00.000Z' });
    expect(same.status).toBe(201);
    // a "última conferência" continua sendo a mais recente por data, inclusive o registro antigo de 11-18
    expect((await csfRow()).lastCheck.recordedAt).toBe('2026-11-18T12:00:00.000Z');
  });

  test('ida e volta de um backup v9 preserva as conferências; backup mais novo que o app é recusado', async () => {
    await octet(makeBackup(8));
    const csf = (await csfRow()).storeId;
    const before = await history(csf);
    const exported = await exportBuffer();
    await request(app).delete(`/api/store-balances/${before[0].id}`);
    const res = await octet(exported);
    expect(res.status).toBe(200);
    expect(res.body.data.migrationsApplied).toEqual([]);
    expect(await history(csf)).toEqual(before);

    const file = path.join(dir, 'newer.sqlite');
    const old = database.openDatabase(file);
    old.pragma('user_version = 99');
    old.close();
    const newer = await octet(fs.readFileSync(file));
    expect(newer.status).toBe(400);
    expect(newer.body.error.code).toBe('BACKUP_NEWER_VERSION');
    expect(await history(csf)).toEqual(before);
  });
});
