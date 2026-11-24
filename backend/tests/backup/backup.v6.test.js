const fs = require('fs');
const os = require('os');
const path = require('path');

// Importação de backup anterior à v6 e ida e volta de um v6 (D209, D211). Banco numa pasta temporária.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-v6-'));
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
  require('../../src/services/catalogService').setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024 });
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
const holds = () => Object.fromEntries(database.getDb().prepare('SELECT name, sale_hold_days AS d FROM stores').all().map((r) => [r.name, r.d]));

function makeV5Backup(file) {
  const { MIGRATIONS } = require('../../src/config/migrations');
  const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 5) });
  const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  old.prepare("UPDATE stores SET name = 'csmoney' WHERE name = 'CSMoney'").run();
  old.prepare(
    `INSERT INTO items (name, category, acquisition_type, purchase_store_id, acquired_at, status, sale_store_id, sale_price_cents,
       sale_currency, net_received_cents, sold_at, sale_fee_type_applied, sale_fee_rate_applied, sale_fee_rounding_applied,
       sale_fixed_fee_cents_applied, created_at, updated_at)
     VALUES ('Vendida', 'CAIXA', 'GANHEI', ?, '2026-01-01T00:00:00.000Z', 'VENDIDO', ?, 1000, 'USD', 980,
       '2026-11-15T12:00:00.000Z', 'DEDUCTED', 0.02, 'CEIL', 0, 'c', 'u')`
  ).run(csf, csf);
  old.prepare("INSERT INTO withdrawals (store_id, amount_store_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, 500, 2500, 'w', 'c', 'u')").run(csf);
  old.prepare("INSERT INTO withdrawals (amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (1000, 'w2', 'c', 'u')").run();
  old.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, note, created_at, updated_at) VALUES (30000, '2026-10-05T12:00:00.000Z', ?, 'pix', 'c', 'u')").run(csf);
  old.close();
}

// Backup na versão 6 (esquema anterior à 8.5), com aportes e saques antigos.
function makeV6Backup(file) {
  const { MIGRATIONS } = require('../../src/config/migrations');
  const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 6) });
  const csf = old.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
  old.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, note, created_at, updated_at) VALUES (50000, '2026-10-01T12:00:00.000Z', NULL, 'sem loja', 'c', 'u')").run();
  old.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, note, created_at, updated_at) VALUES (30000, '2026-10-05T12:00:00.000Z', ?, 'com loja', 'c', 'u')").run(csf);
  old.prepare("INSERT INTO withdrawals (store_id, amount_store_cents, fee_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, 10000, 250, 52037, '2026-11-10T12:00:00.000Z', 'c', 'u')").run(csf);
  old.prepare("INSERT INTO withdrawals (amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (10000, '2026-11-02T12:00:00.000Z', 'c', 'u')").run();
  old.close();
}

describe('backup e a retenção do saldo', () => {
  test('importar um backup v5 migra para v10: lojas pelo nome, vendas antigas nulas, saques e itens preservados, aporte legado', async () => {
    const v5 = path.join(dir, 'v5.sqlite');
    makeV5Backup(v5);
    const res = await octet(fs.readFileSync(v5));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: 5, schemaVersion: 21, migrationsApplied: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21] });

    const db = database.getDb();
    expect(holds()).toEqual({ CSFloat: 7, csmoney: 7, Steam: 0 });
    expect(db.prepare('SELECT status, sale_hold_days_applied AS h FROM items').all()).toEqual([{ status: 'VENDIDO', h: null }]);
    expect(db.prepare('SELECT amount_brl_cents AS v, fee_cents AS f, store_id IS NULL AS legacy FROM withdrawals ORDER BY id').all())
      .toEqual([{ v: 2500, f: null, legacy: 0 }, { v: 1000, f: null, legacy: 1 }]);
    // o app segue funcionando e a venda antiga aparece sem retenção registrada
    const item = (await request(app).get('/api/items?status=VENDIDO')).body.data;
    expect(JSON.stringify(item)).toContain('"saleHoldDaysApplied":null');
    // o aporte de um backup antigo vira legado (D234): só o valor em R$, sem valor creditado na loja
    const deposits = (await request(app).get('/api/deposits')).body.data;
    expect(deposits.deposits).toHaveLength(1);
    expect(deposits.deposits[0]).toMatchObject({ legacy: true, amountStoreCents: null, amountBrlCents: 30000, note: 'pix', storeName: 'CSFloat' });
  });

  test('exportar um v6 e reimportar preserva sale_hold_days e os snapshots', async () => {
    const db = database.getDb();
    const csf = db.prepare("SELECT id FROM stores WHERE name = 'CSFloat'").get().id;
    db.prepare('UPDATE stores SET sale_hold_days = 12 WHERE id = ?').run(csf);
    db.prepare("UPDATE items SET sale_hold_days_applied = 12 WHERE name = 'Vendida'").run();
    const exported = await exportBuffer();

    db.prepare('UPDATE stores SET sale_hold_days = 1 WHERE id = ?').run(csf);
    db.prepare("UPDATE items SET sale_hold_days_applied = NULL WHERE name = 'Vendida'").run();

    const res = await octet(exported);
    expect(res.status).toBe(200);
    expect(res.body.data.migrationsApplied).toEqual([]);
    const after = database.getDb();
    expect(after.prepare("SELECT sale_hold_days AS d FROM stores WHERE name = 'CSFloat'").get().d).toBe(12);
    expect(after.prepare("SELECT sale_hold_days_applied AS h FROM items WHERE name = 'Vendida'").get().h).toBe(12);
  });

  test('importar um backup v6 migra para v10: aportes legados, saques e taxas intactos, app segue funcionando', async () => {
    const v6 = path.join(dir, 'v6.sqlite');
    makeV6Backup(v6);
    const res = await octet(fs.readFileSync(v6));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: 6, schemaVersion: 21, migrationsApplied: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21] });

    const deposits = (await request(app).get('/api/deposits')).body.data;
    expect(deposits.totals).toMatchObject({ count: 2, legacyCount: 2 });
    expect(deposits.deposits.every((d) => d.legacy && d.amountStoreCents === null)).toBe(true);
    expect(deposits.deposits.map((d) => d.amountBrlCents).sort()).toEqual([30000, 50000]);
    const withdrawals = (await request(app).get('/api/withdrawals')).body.data;
    expect(withdrawals.withdrawals.map((w) => [w.amountStoreCents, w.feeCents, w.amountBrlCents, w.legacyWithoutStore]).sort())
      .toEqual([[null, null, 10000, true], [10000, 250, 52037, false]]);
    expect((await request(app).get('/api/profit/summary')).status).toBe(200);
    expect(database.getDb().pragma('foreign_key_check')).toEqual([]);
  });
});
