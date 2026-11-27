const fs = require('fs');
const os = require('os');
const path = require('path');

// QA 11.4: importar backups v22, v23 e v24 (lojas BRL, itens com cotação, aportes e saques) chega à v25 sem mudar nenhum valor;
// as colunas de moeda do valor informativo nascem em BRL; ida e volta (exportar) preserva tudo. Só bancos temporários.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-v25-'));
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
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => new Date('2026-11-25T12:00:00.000Z') });
  database.getDb();
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
const STRIP = ['updated_at'];

function makeBackup(version) {
  const file = path.join(dir, `v${version}.sqlite`);
  const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= version) });
  const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  const steam = old.prepare("SELECT id FROM stores WHERE name = 'Steam'").get().id;
  old.prepare("UPDATE stores SET currency = 'BRL' WHERE id = ?").run(steam);
  const hasDisplay = old.prepare("SELECT 1 FROM pragma_table_info('settings') WHERE name = 'display_currency'").get();
  if (hasDisplay) old.prepare("UPDATE settings SET display_currency = 'BRL'").run();
  const insert = old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, purchase_currency, fx_rate_at_purchase, acquired_at, status, created_at, updated_at)
     VALUES (?, 'CAIXA', 'COMPRA', ?, ?, ?, ?, '2026-10-01T00:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')`
  );
  insert.run('Caixa USD', csf, 500, 'USD', null);
  const brl = Number(insert.run('Caixa BRL', steam, 2750, 'BRL', 5.5).lastInsertRowid);
  old.prepare(
    `UPDATE items SET status = 'VENDIDO', sale_store_id = ?, sale_price_cents = 4000, sale_currency = 'BRL', fx_rate_at_sale = 5.4, sale_fee_type_applied = 'ADDED',
       sale_fee_rate_applied = 0.15, sale_fee_rounding_applied = 'CEIL', sale_fixed_fee_cents_applied = 0, net_received_cents = 3478, sold_at = '2026-11-10T12:00:00.000Z' WHERE id = ?`
  ).run(steam, brl);
  old.prepare("INSERT INTO deposits (store_id, amount_store_cents, amount_brl_cents, deposited_at, created_at, updated_at) VALUES (?, 20000, 100000, '2026-10-01T00:00:00.000Z', 'c', 'u')").run(csf);
  old.prepare("INSERT INTO withdrawals (store_id, amount_store_cents, fee_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, 5000, 100, 25000, '2026-10-20T00:00:00.000Z', 'c', 'u')").run(csf);
  const rows = {
    stores: old.prepare('SELECT * FROM stores ORDER BY id').all(),
    items: old.prepare('SELECT * FROM items ORDER BY id').all(),
    deposits: old.prepare('SELECT * FROM deposits ORDER BY id').all(),
    withdrawals: old.prepare('SELECT * FROM withdrawals ORDER BY id').all(),
  };
  old.close();
  return { buffer: fs.readFileSync(file), rows };
}

describe('importar backups v22, v23 e v24 na v25', () => {
  test.each([22, 23, 24])('backup v%i: valores idênticos, moeda informativa em BRL, FKs ok e o app funciona depois', async (version) => {
    const { buffer, rows } = makeBackup(version);
    const res = await octet(buffer);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: version, schemaVersion: 27 });
    expect(res.body.data.migrationsApplied).toEqual(MIGRATIONS.filter((m) => m.version > version).map((m) => m.version));
    const db = database.getDb();
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const strip = (list) => list.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !STRIP.includes(k))));
    // colunas que migrações posteriores à do backup podem ter acrescentado ficam de fora da comparação (comparamos as que existiam)
    const onlyOld = (after, before) => after.map((row, i) => Object.fromEntries(Object.keys(before[i]).filter((k) => !STRIP.includes(k)).map((k) => [k, row[k]])));
    for (const table of ['stores', 'items', 'deposits', 'withdrawals']) {
      const after = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
      expect(onlyOld(after, rows[table])).toEqual(strip(rows[table]));
    }
    expect(db.prepare('SELECT DISTINCT amount_brl_currency AS c FROM deposits').all()).toEqual([{ c: 'BRL' }]);
    expect(db.prepare('SELECT DISTINCT amount_brl_currency AS c FROM withdrawals').all()).toEqual([{ c: 'BRL' }]);

    // o app lê tudo (itens com cotação e vendido em BRL) e o resumo do lucro não quebra
    const list = (await request(app).get('/api/items')).body;
    expect(list.success).toBe(true);
    expect((await request(app).get('/api/profit/summary')).status).toBe(200);
    expect((await request(app).get('/api/store-balances/current')).status).toBe(200);
    const stores = (await request(app).get('/api/stores')).body.data;
    expect(stores.find((s) => s.name === 'Steam').currency).toBe('BRL');
  });

  test('ida e volta: exportar o banco já na v25 e importar de novo mantém tudo', async () => {
    const before = database.getDb().prepare('SELECT * FROM items ORDER BY id').all();
    const exported = await new Promise((resolve, reject) => {
      const chunks = [];
      request(app).get('/api/backup/export').buffer(true).parse((r, cb) => { r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); })
        .end((err) => (err ? reject(err) : resolve(Buffer.concat(chunks))));
    });
    const res = await octet(exported);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: 27, schemaVersion: 27, migrationsApplied: [] });
    expect(database.getDb().prepare('SELECT * FROM items ORDER BY id').all()).toEqual(before);
  });
});
