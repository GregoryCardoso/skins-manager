const fs = require('fs');
const os = require('os');
const path = require('path');

// QA 8.7.2 (D267, D270): importar backups v1 a v9 chega à v10 com todos os itens à venda e o app funcionando;
// ida e volta de um v10 com itens fora de venda. Banco numa pasta temporária.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-v10qa-'));
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
const items = async (q = '') => (await request(app).get(`/api/items${q}`)).body.data;

// Banco na versão `version` com um item livre, um em trade lock e um vendido.
function makeBackup(version) {
  counter += 1;
  const file = path.join(dir, `v${version}-${counter}.sqlite`);
  const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= version) });
  const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const ins = old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, trade_unlock_at, status, created_at, updated_at)
     VALUES (?, 'CAIXA', 'COMPRA', ?, 500, '2026-10-01T00:00:00.000Z', ?, 'EM_ESTOQUE', 'c', 'u')`
  );
  ins.run('Livre', csf, null);
  ins.run('Bloqueado', csf, '2026-12-25T00:00:00.000Z');
  old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, acquired_at, status, sale_store_id, sale_price_cents,
       sale_currency, net_received_cents, sold_at, sale_fee_type_applied, sale_fee_rate_applied, sale_fee_rounding_applied,
       sale_fixed_fee_cents_applied, created_at, updated_at)
     VALUES ('Vendido', 'CAIXA', 'GANHEI', ?, '2026-10-01T00:00:00.000Z', 'VENDIDO', ?, 1000, 'USD', 980,
       '2026-11-15T12:00:00.000Z', 'DEDUCTED', 0.02, 'CEIL', 0, 'c', 'u')`
  ).run(csf, csf);
  old.close();
  return fs.readFileSync(file);
}

describe('importar backups v1 a v9 chega à v10 com tudo à venda', () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('backup v%i: itens à venda, sem datas de fora de venda, giro normal e app funcionando', async (version) => {
    const res = await octet(makeBackup(version));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: version, schemaVersion: 17 });
    expect(res.body.data.migrationsApplied).toEqual(MIGRATIONS.filter((m) => m.version > version).map((m) => m.version));

    const db = database.getDb();
    expect(db.prepare('SELECT COUNT(*) AS n FROM items WHERE off_sale_at IS NOT NULL OR for_sale_since IS NOT NULL').get().n).toBe(0);
    expect(db.pragma('foreign_key_check')).toEqual([]);

    const stock = await items('?status=EM_ESTOQUE');
    expect(stock.meta.saleStateCounts).toEqual({ forSale: 2, offSale: 0 });
    expect(stock.items.every((i) => i.saleState === 'FOR_SALE' && i.offSaleAt === null && i.forSaleSince === null && i.soldWhileOffSale === false)).toBe(true);
    const byName = Object.fromEntries(stock.items.map((i) => [i.name, i]));
    expect(byName.Livre.aging.agingBucket).toBe('AGARRADO'); // giro como antes da migração (comprado em 2026-10-01)
    expect(byName.Bloqueado.aging.agingBucket).toBe('EM_TRADE_LOCK');
    expect((await items('?saleState=OFF_SALE')).items).toEqual([]);
    const sold = (await items('?status=VENDIDO')).items[0];
    expect(sold).toMatchObject({ saleState: null, soldWhileOffSale: false });
    expect(sold.aging.turnaroundBucket).not.toBe('SEM_GIRO');
    expect((await request(app).get('/api/profit/summary')).status).toBe(200);
  });

  test('depois de importar um backup antigo, tirar da venda e voltar funciona', async () => {
    await octet(makeBackup(8));
    const free = (await items('?status=EM_ESTOQUE')).items.find((i) => i.name === 'Livre');
    const off = await request(app).post(`/api/items/${free.id}/off-sale`).send({});
    expect(off.status).toBe(200);
    expect(off.body.data.item).toMatchObject({ saleState: 'OFF_SALE', offSaleAt: '2026-11-22T12:00:00.000Z' });
    expect((await items()).meta.saleStateCounts).toEqual({ forSale: 1, offSale: 1 });
    const back = await request(app).post(`/api/items/${free.id}/for-sale`).send({});
    expect(back.body.data.item).toMatchObject({ saleState: 'FOR_SALE', forSaleSince: '2026-11-22T12:00:00.000Z', aging: { daysForSale: 0, agingBucket: 'RECENTE' } });
  });
});

describe('ida e volta de um backup v10', () => {
  test('exportar e importar preserva offSaleAt, forSaleSince e a venda feita fora de venda', async () => {
    await octet(makeBackup(9));
    const list = (await items('?status=EM_ESTOQUE')).items;
    const free = list.find((i) => i.name === 'Livre');
    const locked = list.find((i) => i.name === 'Bloqueado');
    await request(app).post(`/api/items/${locked.id}/off-sale`).send({});
    await request(app).post(`/api/items/${free.id}/off-sale`).send({});
    await request(app).post(`/api/items/${free.id}/for-sale`).send({});
    await request(app).post(`/api/items/${free.id}/off-sale`).send({});
    const before = (await items('?status=EM_ESTOQUE')).items.map((i) => [i.name, i.saleState, i.offSaleAt, i.forSaleSince]);
    const exported = await exportBuffer();
    // altera o banco atual e reimporta o export
    await request(app).post(`/api/items/${free.id}/for-sale`).send({});
    const res = await octet(exported);
    expect(res.status).toBe(200);
    expect(res.body.data.migrationsApplied).toEqual([]);
    expect((await items('?status=EM_ESTOQUE')).items.map((i) => [i.name, i.saleState, i.offSaleAt, i.forSaleSince])).toEqual(before);
    expect((await items()).meta.saleStateCounts).toEqual({ forSale: 0, offSale: 2 });
  });

  test('backup v12 recusado com BACKUP_NEWER_VERSION e nada muda', async () => {
    await octet(makeBackup(9));
    const before = (await items()).meta.saleStateCounts;
    const file = path.join(dir, 'newer.sqlite');
    const old = database.openDatabase(file);
    old.pragma('user_version = 18');
    old.close();
    const res = await octet(fs.readFileSync(file));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BACKUP_NEWER_VERSION');
    expect((await items()).meta.saleStateCounts).toEqual(before);
  });
});
