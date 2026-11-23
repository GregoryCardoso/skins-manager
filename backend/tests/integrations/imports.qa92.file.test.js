'use strict';

// QA 9.2 (D290, D292, D303, D309): importação do CSFloat com banco de ARQUIVO temporário: backup (exportar/importar) com as tabelas
// novas, BACKUP_BUSY nos dois sentidos, backup v12 sem as tabelas e privacidade do arquivo exportado. Dados inventados.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-import-file-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(120000);

let request;
let database;
let app;
let state;
let fetchFn;
let backupService;
let fixtures;
let catalog;
let Database;
let MIGRATIONS;
const consoleSpies = [];
const NOW = new Date('2026-11-22T15:00:00.000Z');
const CUTOFF = '2026-11-01T00:00:00.000Z';
const JSON_TYPE = 'application/json';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
  Database = require('better-sqlite3');
  database = require('../../src/config/database');
  ({ MIGRATIONS } = require('../../src/config/migrations'));
  backupService = require('../../src/services/backupService');
  fixtures = require('../helpers/csfloatFixtures');
  catalog = require('../helpers/catalog');
  require('../../src/services/catalogService').setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  state = { me: fixtures.meBody(), trades: [], transactions: [] };
  fetchFn = fixtures.routedFetch(state);
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => new Date(NOW.getTime()), fetchFn, sleepFn: async () => {} });
  database.getDb();
  catalog.importCatalogFixture();
  const res = await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: fixtures.KEY });
  expect(res.status).toBe(200);
});
afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) consoleSpies.push(jest.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => {
  const output = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls));
  while (consoleSpies.length) consoleSpies.pop().mockRestore();
  jest.restoreAllMocks();
  for (const secret of [fixtures.KEY, ...Object.values(fixtures.PII), ...fixtures.TRADE_PII]) expect(output).not.toContain(secret);
});

const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
async function settle() {
  for (let i = 0; i < 200 && backupService.isBackupBusy(); i += 1) await sleep(10);
}
const exportBuffer = async () => {
  const res = await request(app).get('/api/backup/export').buffer(true).parse(binary);
  expect(res.status).toBe(200);
  await settle();
  return res.body;
};
const importFile = async (buf) => {
  await settle();
  return request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
};
const run = (body = {}) => request(app).post('/api/imports/csfloat/run').set('Content-Type', JSON_TYPE).send(body);
const rows = (sql, ...p) => database.getDb().prepare(sql).all(...p);
const count = (table) => rows(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
const hasBytes = (buf, text) => Buffer.from(buf).includes(Buffer.from(text));
const code = (res) => res.body.error && res.body.error.code;

const { fakeTrade, purchaseTx } = (() => require('../helpers/csfloatFixtures'))();

describe('backup com as tabelas da importação', () => {
  test('exportar e importar preservam lotes, registros, vínculos e entradas; depois de restaurar, importar não duplica e desfazer funciona', async () => {
    state.trades = [
      fakeTrade({ id: '1001' }),
      fakeTrade({ id: '1002', createdAt: '2026-11-19T10:00:00.000Z', state: 'weird', item: { float_value: 0.4, paint_seed: 4 } }),
    ];
    state.transactions = [purchaseTx('91001', 1250)];
    const first = await run({ cutoffAt: CUTOFF });
    expect(first.status).toBe(200);
    const batchId = first.body.data.batch.id;
    const snapshot = {
      batches: rows('SELECT * FROM import_batches ORDER BY id'),
      records: rows('SELECT * FROM external_records ORDER BY id'),
      links: rows('SELECT * FROM external_links ORDER BY id'),
      entries: rows('SELECT * FROM import_batch_entries ORDER BY id'),
      items: rows('SELECT * FROM items ORDER BY id'),
      cutoff: rows('SELECT trades_cutoff_at AS c, last_transaction_id AS t, last_import_at AS a FROM integrations')[0],
    };
    expect(snapshot.batches).toHaveLength(1);
    expect(snapshot.links).toHaveLength(1);
    const exported = await exportBuffer();

    // muda o estado: mais um lote com mais um item
    state.trades = [fakeTrade({ id: '1003', createdAt: '2026-11-21T10:00:00.000Z', item: { float_value: 0.5, paint_seed: 5 } }), ...state.trades];
    expect((await run({})).body.data.batch.counts.purchasesCreated).toBe(1);
    expect(count('import_batches')).toBe(2);

    const restored = await importFile(exported);
    expect(restored.status).toBe(200);
    expect(rows('SELECT * FROM import_batches ORDER BY id')).toEqual(snapshot.batches);
    expect(rows('SELECT * FROM external_records ORDER BY id')).toEqual(snapshot.records);
    expect(rows('SELECT * FROM external_links ORDER BY id')).toEqual(snapshot.links);
    expect(rows('SELECT * FROM import_batch_entries ORDER BY id')).toEqual(snapshot.entries);
    expect(rows('SELECT * FROM items ORDER BY id')).toEqual(snapshot.items);
    expect(rows('SELECT trades_cutoff_at AS c, last_transaction_id AS t, last_import_at AS a FROM integrations')[0]).toEqual(snapshot.cutoff);
    expect(database.getDb().pragma('foreign_key_check')).toEqual([]);
    // a chave atual continua (D290) e o app segue importando sem duplicar
    expect((await request(app).get('/api/integrations/csfloat')).body.data.hasApiKey).toBe(true);
    const again = await run({});
    expect(again.status).toBe(200);
    expect(again.body.data.batch.counts).toMatchObject({ known: 1, purchasesCreated: 1 }); // só o 1003, que o backup não tinha
    expect(count('items')).toBe(2);
    // o lote restaurado deixa de ser o último; desfaz o novo e depois o restaurado
    const latest = again.body.data.batch.id;
    expect((await request(app).post(`/api/imports/batches/${latest}/undo`).set('Content-Type', JSON_TYPE).send({})).status).toBe(200);
    expect((await request(app).post(`/api/imports/batches/${batchId}/undo`).set('Content-Type', JSON_TYPE).send({})).status).toBe(200);
    expect(count('items')).toBe(0);
  });

  test('o arquivo exportado não contém dados da outra parte, token, URL de troca, IDs de pagamento nem a chave', async () => {
    await run({ cutoffAt: CUTOFF }); // garante pelo menos um lote
    const exported = await exportBuffer();
    const secrets = [fixtures.KEY, ...Object.values(fixtures.PII), ...fixtures.TRADE_PII, 'steam://rungame'];
    for (const secret of secrets) expect(hasBytes(exported, secret)).toBe(false);
    const file = path.join(dir, 'exp-privacy.sqlite');
    fs.writeFileSync(file, exported);
    const copy = new Database(file, { readonly: true });
    try {
      expect(copy.prepare('SELECT COUNT(*) AS n FROM import_batches').get().n).toBeGreaterThan(0);
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      copy.close();
    }
  });

  test('backup v12 (sem as tabelas novas) importa, ganha as tabelas vazias pela migração e a primeira importação funciona', async () => {
    const v12 = path.join(dir, 'v12.sqlite');
    const old = new Database(v12);
    old.close();
    fs.rmSync(v12, { force: true });
    const db = database.openDatabase(v12, { migrations: MIGRATIONS.filter((m) => m.version <= 12) });
    const csf = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    db.prepare(
      `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, status, created_at, updated_at)
       VALUES ('Caixa A', 'CAIXA', 'COMPRA', ?, 500, '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`
    ).run(csf);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    const res = await importFile(fs.readFileSync(v12));
    expect(res.status).toBe(200);
    for (const table of ['import_batches', 'external_records', 'external_links', 'import_batch_entries']) expect(count(table)).toBe(0);
    expect(database.getDb().pragma('user_version', { simple: true })).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
    expect(rows('SELECT name FROM items')).toEqual([{ name: 'Caixa A' }]);
    // o catálogo do app foi substituído pelo do arquivo: o importado do CSFloat vira "OUTRO" (sem catálogo) ou falha, sem quebrar
    catalog.importCatalogFixture();
    state.trades = [fakeTrade({ id: '2001' })];
    state.transactions = [];
    const imported = await run({ cutoffAt: CUTOFF });
    expect(imported.status).toBe(200);
    expect(imported.body.data.batch.counts.purchasesCreated).toBe(1);
  });
});

describe('BACKUP_BUSY nos dois sentidos', () => {
  async function gate() {
    let release;
    const wait = new Promise((resolve) => { release = resolve; });
    const slow = fixtures.routedFetch(state);
    const gated = jest.fn(async (url, init) => { await wait; return slow(url, init); });
    gated.calls = slow.calls;
    const gatedApp = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => new Date(NOW.getTime()), fetchFn: gated, sleepFn: async () => {} });
    return { release, gatedApp };
  }

  test('importar backup enquanto uma importação do CSFloat roda: 409 BACKUP_BUSY e o banco fica como estava', async () => {
    await settle();
    const exported = await exportBuffer();
    state.trades = [fakeTrade({ id: '3001' })];
    const before = count('items');
    const hasCutoff = rows('SELECT trades_cutoff_at AS c FROM integrations')[0].c !== null;
    const { release, gatedApp } = await gate();
    // Promise.resolve dispara o envio (o superagent só envia quando alguém chama then)
    const running = Promise.resolve(request(gatedApp).post('/api/imports/csfloat/run').set('Content-Type', JSON_TYPE).send(hasCutoff ? {} : { cutoffAt: CUTOFF }));
    await sleep(50);
    expect(backupService.isBackupBusy()).toBe(true);
    const blocked = await request(gatedApp).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(exported);
    expect(blocked.status).toBe(409);
    expect(code(blocked)).toBe('BACKUP_BUSY');
    release();
    const done = await running;
    expect(done.status).toBe(200);
    expect(count('items')).toBeGreaterThanOrEqual(before);
    await settle();
    expect(backupService.isBackupBusy()).toBe(false);
  });

  test('importar do CSFloat enquanto há exportação de backup em andamento: 409 BACKUP_BUSY, sem leitura de rede, e a trava é liberada depois', async () => {
    await settle();
    const exportedCalls = fetchFn.mock.calls.length;
    // uma exportação em andamento é uma trava de módulo: a mesma que o backupService consulta
    const spy = jest.spyOn(backupService, 'isBackupBusy').mockReturnValue(true);
    const res = await run({});
    expect(res.status).toBe(409);
    expect(code(res)).toBe('BACKUP_BUSY');
    expect(fetchFn.mock.calls.length).toBe(exportedCalls);
    spy.mockRestore();
    expect((await run({})).status).not.toBe(409);
  });

  test('exportação real em andamento (stream aberto) bloqueia a importação até terminar', async () => {
    await settle();
    const created = backupService.createExport({ now: NOW });
    try {
      expect(backupService.isBackupBusy()).toBe(true);
      const res = await run({});
      expect(res.status).toBe(409);
      expect(code(res)).toBe('BACKUP_BUSY');
    } finally {
      created.cleanup();
    }
    await settle();
    expect(backupService.isBackupBusy()).toBe(false);
    expect((await run({})).status).not.toBe(409);
  });
});
