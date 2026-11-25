const fs = require('fs');
const os = require('os');
const path = require('path');

// 10.4 (D363), QA: backup da v19 importado migra para a v20 (loja Steam preenchida só com exatamente uma Steam em BRL; dados intactos);
// backup ida e volta com aberturas (caixa, terminal comprado, terminal recusado, desfeita) e a loja Steam do app.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-open-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(60000);
let request;
let database;
let app;
let CAT;
let MIGRATIONS;

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
  database = require('../../src/config/database');
  ({ CAT } = require('../helpers/catalog'));
  ({ MIGRATIONS } = require('../../src/config/migrations'));
  const catalogService = require('../../src/services/catalogService');
  catalogService.setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  database.getDb();
  require('../helpers/catalog').importCatalogFixture();
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => new Date('2026-11-19T15:00:00.000Z') });
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
const json = async (url) => (await request(app).get(url)).body.data;
const storeIdOf = async (name) => (await json('/api/stores')).find((s) => s.name === name).id;

function makeV19(file, prepare) {
  const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 19) });
  prepare(old);
  old.close();
}

test('backup v19 com uma loja Steam em BRL, importado: migra para a v20, a loja Steam do app vem preenchida e os dados não mudam', async () => {
  const v19 = path.join(dir, 'v19.sqlite');
  let rows;
  makeV19(v19, (old) => {
    const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    old.prepare(
      `INSERT INTO items (name, category, variant, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, acquired_at, status, created_at, updated_at)
       VALUES ('AK-47 | Redline', 'SKIN', 'NORMAL', 'COMPRA', ?, 1000, 'USD', '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`
    ).run(csf);
    rows = old.prepare('SELECT * FROM items ORDER BY id').all();
  });
  const res = await octet(fs.readFileSync(v19));
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ fileVersion: 19, schemaVersion: 22, migrationsApplied: [20, 21, 22] });
  expect(database.getDb().pragma('foreign_key_check')).toEqual([]);
  const settings = await json('/api/settings');
  expect(settings.steamStoreId).toBe(await storeIdOf('Steam'));
  expect((await json('/api/stores')).filter((s) => s.isSteamStore).map((s) => s.name)).toEqual(['Steam']);
  const strip = ({ updated_at: u, catalog_id: c, ...rest }) => rest; // eslint-disable-line no-unused-vars -- o vínculo de legados ao catálogo ocorre depois da migração
  expect(database.getDb().prepare('SELECT * FROM items ORDER BY id').all().map(strip)).toEqual(rows.map(strip));
});

test('backup v19 ambíguo (duas lojas Steam em BRL) ou sem Steam em BRL: a loja Steam do app fica nula', async () => {
  for (const [label, prepare] of [
    ['duas', (old) => {
      old.prepare(
        `INSERT INTO stores (name, currency, is_active, is_primary, sale_fee_rounding, sale_fixed_fee_cents, allows_withdrawal, withdrawal_fixed_fee_cents,
           sale_hold_days, created_at, updated_at) VALUES ('steam ', 'BRL', 1, 0, 'CEIL', 0, 0, 0, 0, 'c', 'u')`
      ).run();
    }],
    ['usd', (old) => old.prepare("UPDATE stores SET currency = 'USD' WHERE name = 'Steam'").run()],
  ]) {
    const file = path.join(dir, `v19-${label}.sqlite`);
    makeV19(file, prepare);
    const res = await octet(fs.readFileSync(file));
    expect(res.status).toBe(200);
    expect((await json('/api/settings')).steamStoreId).toBeNull();
  }
});

test('exportar e importar leva a abertura de caixa, o terminal comprado, o recusado, a desfeita e a loja Steam do app', async () => {
  require('../helpers/catalog').importCatalogFixture();
  const CatalogItem = require('../../src/models/CatalogItem');
  const { normalizeSearchText } = require('../../src/services/catalog/csgoApiAdapter');
  const crate = (id, category, name) => ({
    id, source: 'CRATES', category, name, nameKey: normalizeSearchText(name), searchText: normalizeSearchText(name), minFloat: null, maxFloat: null,
    hasStattrak: false, hasSouvenir: false,
  });
  CatalogItem.upsertMany([crate('crate-kilowatt', 'CAIXA', 'Kilowatt Case'), crate('crate-5176', 'OUTRO', 'Sealed Genesis Terminal')]);
  const csfloat = await storeIdOf('CSFloat');
  const steam = await storeIdOf('Steam');
  expect((await request(app).put('/api/settings/steam-store').send({ storeId: steam })).status).toBe(200);
  expect((await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5 })).status).toBe(200);
  const make = async (body) => {
    const created = await request(app).post('/api/items').send({ acquisitionType: 'COMPRA', purchaseStoreId: csfloat, acquiredAt: '2026-11-10T12:00:00.000Z', ...body });
    if (created.status !== 201) throw new Error(JSON.stringify(created.body));
    return created.body.data;
  };
  const open = async (id, body) => {
    const res = await request(app).post(`/api/items/${id}/open`).send({ openedAt: '2026-11-15T12:00:00.000Z', ...body });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body.data;
  };
  const box = await make({ catalogId: 'crate-kilowatt', purchasePriceCents: 200 });
  const key = await make({ category: 'OUTRO', name: 'Kilowatt Case Key', purchasePriceCents: 300 });
  const terminalBuy = await make({ catalogId: 'crate-5176', purchasePriceCents: 400 });
  const terminalLost = await make({ catalogId: 'crate-5176', purchasePriceCents: 100 });
  const terminalUndone = await make({ catalogId: 'crate-5176', purchasePriceCents: 100 });
  const caseOpen = await open(box.id, { keyItemId: key.id, generated: { catalogId: CAT.AK_REDLINE, variant: 'NORMAL', floatValue: 0.15 } });
  const bought = await open(terminalBuy.id, { decision: 'BUY', paidPriceCents: 1000, generated: { catalogId: CAT.AWP_DLORE, variant: 'NORMAL', floatValue: 0.1 } });
  await open(terminalLost.id, { decision: 'DECLINE' });
  const undone = await open(terminalUndone.id, { decision: 'DECLINE' });
  expect((await request(app).post(`/api/operations/${undone.operation.id}/undo`).send({})).status).toBe(200);

  const snapshot = async () => ({
    profit: await json('/api/profit/summary'),
    settings: (({ catalogUpdatedAt, ...rest }) => rest)(await json('/api/settings')), // eslint-disable-line no-unused-vars
    items: (await json('/api/items?status=EM_ESTOQUE')).items.map((i) => i.id),
    consumed: (await json('/api/items?status=CONSUMIDO')).items.map((i) => i.id),
    generatedCase: await json(`/api/items/${caseOpen.generatedItem.id}`),
    generatedBought: await json(`/api/items/${bought.generatedItem.id}`),
    opsTerminal: await json(`/api/items/${terminalUndone.id}/operations`),
    opsBox: await json(`/api/items/${box.id}/operations`),
  });
  const before = await snapshot();
  expect(before.profit.consumptionLosses.count).toBe(1);
  const file = await exportBuffer();

  // estraga o estado: desfaz a abertura da caixa e troca a loja Steam
  expect((await request(app).post(`/api/operations/${caseOpen.operation.id}/undo`).send({})).status).toBe(200);
  await request(app).put('/api/settings/steam-store').send({ storeId: null });

  const res = await octet(file);
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ schemaVersion: 22 });
  const after = await snapshot();
  expect(after).toEqual(before);
  expect(after.settings.steamStoreId).toBe(steam);
  expect(after.opsTerminal[0].detail.undoneGenerated).toBeNull(); // o DECLINE não tinha gerada
  expect(after.generatedBought).toMatchObject({ acquisitionType: 'COMPRA', purchaseStoreId: steam, purchasePriceCents: 1000 });
  // depois de importar, as aberturas restauradas continuam podendo ser desfeitas
  expect((await request(app).post(`/api/operations/${caseOpen.operation.id}/undo`).send({})).status).toBe(200);
  expect((await json(`/api/items/${box.id}`)).status).toBe('EM_ESTOQUE');
});
