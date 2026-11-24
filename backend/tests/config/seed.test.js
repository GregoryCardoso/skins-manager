const { getDb, closeDb } = require('../../src/config/database');
const { runSeed } = require('../../src/config/seed');

const NOW = new Date('2026-03-01T10:00:00.000Z');

const storeRow = (name) => getDb().prepare('SELECT * FROM stores WHERE name = ?').get(name);
const countStores = () => getDb().prepare('SELECT COUNT(*) AS n FROM stores').get().n;
const countSettings = () => getDb().prepare('SELECT COUNT(*) AS n FROM settings').get().n;

beforeEach(() => {
  closeDb();
  getDb();
});
afterAll(() => closeDb());

describe('config/seed', () => {
  test('rodar o seed 2x mantém 3 lojas e 1 settings', () => {
    runSeed(getDb(), NOW);
    runSeed(getDb(), NOW);
    expect(countStores()).toBe(3);
    expect(countSettings()).toBe(1);
  });

  test('seed insere na ordem CSFloat, Steam, CSMoney', () => {
    const names = getDb().prepare('SELECT name FROM stores ORDER BY id').all().map((r) => r.name);
    expect(names).toEqual(['CSFloat', 'Steam', 'CSMoney']);
  });

  test('valores do CSFloat conferem', () => {
    expect(storeRow('CSFloat')).toMatchObject({
      currency: 'USD', is_active: 1, is_primary: 1, sale_fee_type: 'DEDUCTED', sale_fee_rate: 0.02,
      sale_fee_rounding: 'CEIL', sale_min_fee_cents: null, sale_fixed_fee_cents: 0, allows_withdrawal: 1,
      withdrawal_fee_rate: 0.025, withdrawal_fixed_fee_cents: 0,
    });
  });

  test('valores da Steam conferem', () => {
    expect(storeRow('Steam')).toMatchObject({
      currency: 'BRL', is_active: 1, is_primary: 0, sale_fee_type: 'ADDED', sale_fee_rate: 0.15,
      sale_fee_rounding: 'CEIL', sale_min_fee_cents: null, sale_fixed_fee_cents: 0, allows_withdrawal: 0,
      withdrawal_fee_rate: null, withdrawal_fixed_fee_cents: 0,
    });
  });

  test('valores da CSMoney conferem (taxas NULL, não 0)', () => {
    const row = storeRow('CSMoney');
    expect(row).toMatchObject({
      currency: 'USD', is_active: 1, is_primary: 0, sale_fee_rounding: 'CEIL', sale_min_fee_cents: null,
      sale_fixed_fee_cents: 0, allows_withdrawal: 1, withdrawal_fixed_fee_cents: 0,
    });
    expect(row.sale_fee_type).toBeNull();
    expect(row.sale_fee_rate).toBeNull();
    expect(row.withdrawal_fee_rate).toBeNull();
  });

  test('só uma loja principal (CSFloat)', () => {
    expect(getDb().prepare('SELECT name FROM stores WHERE is_primary = 1').all()).toEqual([{ name: 'CSFloat' }]);
  });

  test('settings inicia com cotação nula', () => {
    expect(getDb().prepare('SELECT * FROM settings').get()).toMatchObject({
      id: 1, usd_brl_rate: null, usd_brl_rate_updated_at: null,
    });
  });

  test('usa o now recebido em created_at/updated_at', () => {
    const db = getDb();
    db.exec('DELETE FROM stores; DELETE FROM settings;');
    runSeed(db, NOW);
    const rows = db.prepare('SELECT created_at, updated_at FROM stores').all();
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.created_at).toBe(NOW.toISOString());
      expect(r.updated_at).toBe(NOW.toISOString());
    }
    expect(db.prepare('SELECT updated_at FROM settings').get().updated_at).toBe(NOW.toISOString());
  });

  test('após editar e apagar loja (restando alguma) o seed não muda nada', () => {
    const db = getDb();
    db.prepare("DELETE FROM stores WHERE name = 'CSMoney'").run();
    db.prepare("UPDATE stores SET sale_fee_rate = 0.05, name = 'Steam BR' WHERE name = 'Steam'").run();
    const before = db.prepare('SELECT * FROM stores ORDER BY id').all();
    runSeed(db, NOW);
    expect(db.prepare('SELECT * FROM stores ORDER BY id').all()).toEqual(before);
    expect(storeRow('CSMoney')).toBeUndefined();
    expect(storeRow('Steam BR').sale_fee_rate).toBe(0.05);
  });

  test('seed não sobrescreve settings existente', () => {
    const db = getDb();
    db.prepare("UPDATE settings SET usd_brl_rate = 5.25, usd_brl_rate_updated_at = 'a', updated_at = 'b'").run();
    runSeed(db, NOW);
    expect(db.prepare('SELECT * FROM settings').get()).toEqual({
      id: 1, usd_brl_rate: 5.25, usd_brl_rate_updated_at: 'a', updated_at: 'b',
      catalog_updated_at: null, theme: 'SYSTEM', language: 'pt-BR', inventory_view: 'GROUPED',
      usd_brl_rate_source: null, rate_quoted_at: null, slow_item_days: null, fast_turnover_days: null, stores_seeded: 1, fx_refresh_source: 'AWESOMEAPI', steam_store_id: null,
    });
  });
});
