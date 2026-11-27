'use strict';

// Lacunas de D86 nas migrações: v1 com dados completos -> v2, conteúdo do backup, falha da própria v2,
// nova tentativa depois da falha, idempotência e banco de versão futura sem efeitos colaterais.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDatabase, runMigrations } = require('../../src/config/database');
const { stripV6Rows } = require('../helpers/stripV6');
const { MIGRATIONS } = require('../../src/config/migrations');
const v001 = require('../../src/config/migrations/v001_initial');
const v002 = require('../../src/config/migrations/v002_catalog');

let tmpRoot;
let counter = 0;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-gaps-'));
});
afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const newDbPath = () => {
  counter += 1;
  return path.join(tmpRoot, `case${counter}`, 'inventory.sqlite');
};
const backupsOf = (dbPath) => {
  const dir = path.join(path.dirname(dbPath), 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Banco v1 com dados em todas as tabelas, inclusive um item vendido.
function seedV1(dbPath) {
  const db = openDatabase(dbPath, { migrations: [v001] });
  const item = db.prepare(
    `INSERT INTO items (name, category, variant, float_value, exterior, acquisition_type, purchase_store_id,
       purchase_price_cents, purchase_currency, fx_rate_at_purchase, acquired_at, status, sale_store_id,
       sale_price_cents, sale_currency, fx_rate_at_sale, sale_fee_type_applied, sale_fee_rate_applied,
       sale_fee_rounding_applied, sale_fixed_fee_cents_applied, net_received_cents, sold_at, created_at, updated_at)
     VALUES (@name, 'SKIN', 'NORMAL', @float, @ext, @acq, @store, @price, @cur, @fx, '2026-01-01T00:00:00.000Z',
       @status, @sstore, @sprice, @scur, @sfx, @stype, @srate, @sround, @sfixed, @net, @sold, 'c', 'u')`
  );
  const base = {
    float: null, ext: null, store: null, price: 0, cur: 'USD', fx: null, status: 'EM_ESTOQUE', sstore: null,
    sprice: null, scur: null, sfx: null, stype: null, srate: null, sround: null, sfixed: null, net: null, sold: null,
  };
  item.run({ ...base, name: 'Ganhei BRL com cotação', acq: 'GANHEI', price: 500, cur: 'BRL', fx: 5.2, float: 0.12, ext: 'MW' });
  item.run({ ...base, name: 'Ganhei USD com custo', acq: 'GANHEI', price: 700 });
  item.run({ ...base, name: 'Ganhei USD com cotação (inconsistente só em dados antigos)', acq: 'GANHEI', price: 0, cur: 'BRL', fx: 4.9 });
  item.run({ ...base, name: 'Compra USD zero', acq: 'COMPRA', store: 1, price: 0 });
  item.run({
    ...base, name: 'Ganhei vendido', acq: 'GANHEI', price: 300, status: 'VENDIDO', sstore: 1, sprice: 1000, scur: 'USD',
    stype: 'DEDUCTED', srate: 0.02, sround: 'CEIL', sfixed: 0, net: 980, sold: '2026-01-20T00:00:00.000Z',
  });
  db.prepare("INSERT INTO deposits (amount_brl_cents, deposited_at, store_id, note, created_at, updated_at) VALUES (10000, '2026-01-02T00:00:00.000Z', 1, 'n', 'c', 'u')").run();
  db.prepare("INSERT INTO withdrawals (store_id, amount_store_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (1, 500, 2500, '2026-01-03T00:00:00.000Z', 'c', 'u')").run();
  db.prepare("INSERT INTO store_balances (store_id, balance_cents, fx_rate, recorded_at, created_at) VALUES (1, 900, 5.1, '2026-01-04T00:00:00.000Z', 'c')").run();
  db.prepare("UPDATE settings SET usd_brl_rate = 5.5, usd_brl_rate_updated_at = '2026-01-05T00:00:00.000Z'").run();
  db.close();
}

function dump(db, table, orderBy = 'id') {
  return db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
}

describe('v1 com dados -> v2', () => {
  test('todas as tabelas antigas ficam intactas; só os 3 campos de GANHEI mudam (T32); venda preservada', () => {
    const dbPath = newDbPath();
    seedV1(dbPath);
    const raw = new Database(dbPath, { readonly: true });
    const before = { items: dump(raw, 'items'), stores: dump(raw, 'stores'), deposits: dump(raw, 'deposits'), withdrawals: dump(raw, 'withdrawals'), balances: dump(raw, 'store_balances') };
    raw.close();

    const db = openDatabase(dbPath);
    try {
      expect(stripV6Rows(dump(db, 'stores'))).toEqual(before.stores); // v6 acrescenta a retenção
      expect(stripV6Rows(dump(db, 'deposits'))).toEqual(before.deposits);
      expect(stripV6Rows(dump(db, 'withdrawals'))).toEqual(before.withdrawals);
      expect(stripV6Rows(dump(db, 'store_balances'))).toEqual(before.balances); // v8 acrescenta o tipo e o ajuste

      const after = dump(db, 'items');
      expect(after).toHaveLength(before.items.length);
      after.forEach((row, i) => {
        const old = before.items[i];
        const { catalog_id: catalogId, net_received_manual: manual, sale_hold_days_applied: hold, off_sale_at: offSale, for_sale_since: forSale, sale_release_at: saleReleaseAt, components_imported_at: componentsImportedAt, consumed_at: consumedAt, ...rest } = row;
        expect([offSale, forSale]).toEqual([null, null]); // v10: todos à venda
        expect(manual).toBe(0);
        expect(catalogId).toBeNull();
        if (old.acquisition_type === 'GANHEI') {
          // Só custo, moeda e cotação mudam; o resto (inclusive venda e updated_at) fica igual.
          expect({ ...rest, purchase_price_cents: 0, purchase_currency: 'USD', fx_rate_at_purchase: null }).toEqual({
            ...old, purchase_price_cents: 0, purchase_currency: 'USD', fx_rate_at_purchase: null,
          });
          expect(rest.purchase_price_cents).toBe(0);
          expect(rest.purchase_currency).toBe('USD');
          expect(rest.fx_rate_at_purchase).toBeNull();
        } else {
          expect(rest).toEqual(old);
        }
      });
      const sold = after.find((r) => r.name === 'Ganhei vendido');
      expect(sold).toMatchObject({ status: 'VENDIDO', sale_price_cents: 1000, net_received_cents: 980, sale_store_id: 1 });

      expect(db.prepare('SELECT usd_brl_rate, usd_brl_rate_updated_at, theme, language, catalog_updated_at FROM settings').get()).toEqual({
        usd_brl_rate: 5.5, usd_brl_rate_updated_at: '2026-01-05T00:00:00.000Z', theme: 'SYSTEM', language: 'pt-BR', catalog_updated_at: null,
      });
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.prepare('SELECT COUNT(*) AS n FROM catalog_items').get().n).toBe(0);
    } finally {
      db.close();
    }
  });

  test('o backup guarda o v1 com os valores ORIGINAIS de GANHEI (anterior ao UPDATE de T32)', () => {
    const dbPath = newDbPath();
    seedV1(dbPath);
    openDatabase(dbPath, { now: new Date('2026-11-20T08:00:00.000Z') }).close();
    const [backup] = backupsOf(dbPath);
    const raw = new Database(path.join(path.dirname(dbPath), 'backups', backup), { readonly: true });
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(1);
      expect(raw.prepare("SELECT purchase_price_cents AS c, purchase_currency AS cur, fx_rate_at_purchase AS fx FROM items WHERE name = 'Ganhei BRL com cotação'").get()).toEqual({ c: 500, cur: 'BRL', fx: 5.2 });
      expect(raw.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('items') WHERE name = 'catalog_id'").get().n).toBe(0);
      expect(raw.prepare('SELECT COUNT(*) AS n FROM items').get().n).toBe(5);
    } finally {
      raw.close();
    }
  });
});

describe('falha na própria v2', () => {
  // Executa a v2 real e lança no fim: tudo (DDL, ALTERs e o UPDATE de T32) precisa ser desfeito.
  const failingV2 = { version: 2, name: 'catalog-falha', up: (db) => { v002.up(db); throw new Error('falhou no fim da v2'); } };

  test('rollback completo: sem catalog_items, sem catalog_id, T32 não aplicado, v1 mantido, backup existe', () => {
    const dbPath = newDbPath();
    seedV1(dbPath);
    expect(() => openDatabase(dbPath, { migrations: [v001, failingV2], now: new Date('2026-11-20T09:00:00.000Z') })).toThrow('falhou no fim da v2');

    const raw = new Database(dbPath, { readonly: true });
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(1);
      expect(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'catalog_items'").get().n).toBe(0);
      expect(raw.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('items') WHERE name = 'catalog_id'").get().n).toBe(0);
      expect(raw.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('settings') WHERE name IN ('theme','language','catalog_updated_at')").get().n).toBe(0);
      expect(raw.prepare("SELECT purchase_price_cents AS c, purchase_currency AS cur, fx_rate_at_purchase AS fx FROM items WHERE name = 'Ganhei BRL com cotação'").get()).toEqual({ c: 500, cur: 'BRL', fx: 5.2 });
    } finally {
      raw.close();
    }
    expect(backupsOf(dbPath)).toHaveLength(1);
    expect(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })).not.toThrow(); // handle liberado
  });

  test('depois da falha, abrir com a v2 correta migra normalmente', () => {
    const dbPath = newDbPath();
    seedV1(dbPath);
    expect(() => openDatabase(dbPath, { migrations: [v001, failingV2], now: new Date('2026-11-20T09:00:00.000Z') })).toThrow();
    const db = openDatabase(dbPath, { now: new Date('2026-11-20T09:05:00.000Z') });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(27);
      expect(db.prepare("SELECT purchase_price_cents AS c FROM items WHERE name = 'Ganhei BRL com cotação'").get().c).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS n FROM items').get().n).toBe(5);
    } finally {
      db.close();
    }
    expect(backupsOf(dbPath)).toHaveLength(2); // uma por tentativa de migrar
  });
});

describe('idempotência', () => {
  test('reabrir várias vezes um banco v2 não altera dados, não migra e não cria backup', () => {
    const dbPath = newDbPath();
    seedV1(dbPath);
    openDatabase(dbPath, { now: new Date('2026-11-20T08:00:00.000Z') }).close();
    const backups = backupsOf(dbPath);
    expect(backups).toHaveLength(1);

    const snapshots = [];
    for (let i = 0; i < 3; i += 1) {
      const db = openDatabase(dbPath, { now: new Date(`2026-11-2${i + 1}T08:00:00.000Z`) });
      snapshots.push(JSON.stringify([dump(db, 'items'), dump(db, 'stores'), dump(db, 'settings')]));
      expect(db.pragma('user_version', { simple: true })).toBe(27);
      db.close();
    }
    expect(new Set(snapshots).size).toBe(1);
    expect(backupsOf(dbPath)).toEqual(backups);
  });

  test('runMigrations repetido em memória: segunda chamada aplica nada', () => {
    const db = openDatabase(':memory:', { migrations: [v001] });
    try {
      expect(runMigrations(db, MIGRATIONS)).toMatchObject({ from: 1, to: 27, applied: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27], backupPath: null });
      expect(runMigrations(db, MIGRATIONS)).toMatchObject({ from: 27, to: 27, applied: [], backupPath: null });
    } finally {
      db.close();
    }
  });
});

describe('versão futura', () => {
  test('banco com dados e user_version 99: recusa, sem WAL novo, sem backup e arquivo byte a byte igual', () => {
    const dbPath = newDbPath();
    seedV1(dbPath);
    const raw = new Database(dbPath);
    raw.pragma('user_version = 99');
    raw.pragma('wal_checkpoint(TRUNCATE)');
    raw.close();
    for (const ext of ['-wal', '-shm']) fs.rmSync(dbPath + ext, { force: true });
    const before = sha(dbPath);
    const entriesBefore = fs.readdirSync(path.dirname(dbPath)).sort();

    expect(() => openDatabase(dbPath)).toThrow(/versão mais nova do Skins Manager/);
    expect(sha(dbPath)).toBe(before);
    expect(backupsOf(dbPath)).toEqual([]);
    expect(fs.readdirSync(path.dirname(dbPath)).sort()).toEqual(entriesBefore);
  });
});
