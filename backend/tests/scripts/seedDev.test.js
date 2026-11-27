'use strict';

// Guardas e conteúdo do seed:dev (D108). Usa só pastas temporárias; nunca abre backend/data/inventory.sqlite.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const Database = require('better-sqlite3');
const devDb = require('../../scripts/devDb');
const data = require('../../scripts/devSeedData');
const { closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');

const NOW = new Date('2026-11-19T15:00:00.000Z');
const REAL = devDb.DEFAULT_REAL_DB_PATH;
const BACKEND_DIR = path.join(__dirname, '..', '..');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-seed-'));
});
afterEach(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});
afterAll(() => closeDb());

describe('guardas: assertSafeTarget / resolveSeedTarget', () => {
  test('o alvo padrão é o banco dev e nunca o real', () => {
    const target = devDb.resolveSeedTarget({ argv: [] });
    expect(path.basename(target)).toBe('inventory.dev.sqlite');
    expect(target.toLowerCase()).not.toBe(REAL.toLowerCase());
  });

  test('recusa o banco real padrão', () => {
    expect(() => devDb.assertSafeTarget(REAL)).toThrow(/banco real/);
  });

  test('recusa o banco real com maiúsculas diferentes', () => {
    expect(() => devDb.assertSafeTarget(REAL.toUpperCase())).toThrow(/banco real/);
    expect(() => devDb.assertSafeTarget(REAL.replace('inventory', 'INVENTORY'))).toThrow(/banco real/);
  });

  test('recusa o banco real com barras normais, invertidas e mistas', () => {
    expect(() => devDb.assertSafeTarget(REAL.replace(/\\/g, '/'))).toThrow(/banco real/);
    expect(() => devDb.assertSafeTarget(REAL.replace(/[\\/]/g, '\\'))).toThrow(/banco real/);
  });

  test('recusa caminho relativo equivalente e com ".."', () => {
    expect(() => devDb.assertSafeTarget('data/inventory.sqlite')).toThrow(/banco real/);
    expect(() => devDb.assertSafeTarget('./data/../data/inventory.sqlite')).toThrow(/banco real/);
    expect(() => devDb.assertSafeTarget('.\\DATA\\Inventory.SQLite')).toThrow(/banco real/);
  });

  test('o banco dev é aceito', () => {
    expect(devDb.assertSafeTarget(devDb.DEV_DB_PATH)).toBe(devDb.DEV_DB_PATH);
    expect(() => devDb.assertSafeTarget(path.join(tmp, 'x.dev.sqlite'))).not.toThrow();
  });

  test('DB_PATH real vindo do .env (e do ambiente) é recusado, em qualquer grafia', () => {
    const real = path.join(tmp, 'Meu', 'Real.sqlite');
    fs.mkdirSync(path.dirname(real), { recursive: true });
    const envFile = path.join(tmp, '.env');
    fs.writeFileSync(envFile, `DB_PATH=${real}\nSLOW_ITEM_DAYS=21\n`);
    const paths = devDb.resolveRealDbPaths({ envFile, env: {} });
    expect(paths.map((p) => p.toLowerCase())).toContain(real.toLowerCase());
    expect(paths).toContain(REAL);
    for (const variant of [real, real.toUpperCase(), real.replace(/\\/g, '/'), path.join(tmp, 'Meu', '..', 'Meu', 'REAL.sqlite')]) {
      expect(() => devDb.assertSafeTarget(variant, { realDbPaths: paths })).toThrow(/banco real/);
    }
    const viaEnv = devDb.resolveRealDbPaths({ envFile: path.join(tmp, 'nao-existe.env'), env: { DB_PATH: real } });
    expect(() => devDb.assertSafeTarget(real.toUpperCase(), { realDbPaths: viaEnv })).toThrow(/banco real/);
  });

  test('DB_PATH relativo no .env é resolvido a partir de backend/', () => {
    const envFile = path.join(tmp, '.env');
    fs.writeFileSync(envFile, 'DB_PATH=./data/outro-real.sqlite\n');
    const paths = devDb.resolveRealDbPaths({ envFile, env: {} });
    expect(paths).toContain(path.join(BACKEND_DIR, 'data', 'outro-real.sqlite'));
  });

  test('hard link para o mesmo arquivo do "banco real" é recusado', () => {
    const real = path.join(tmp, 'real.sqlite');
    fs.writeFileSync(real, 'x');
    const link = path.join(tmp, 'apelido.sqlite');
    try {
      fs.linkSync(real, link);
    } catch (err) {
      return; // sistema sem hard link: nada a testar
    }
    expect(() => devDb.assertSafeTarget(link, { realDbPaths: [real] })).toThrow(/banco real/);
  });

  test('":memory:" é recusado por padrão e aceito só com allowMemory', () => {
    expect(() => devDb.assertSafeTarget(':memory:')).toThrow(/:memory:/);
    expect(devDb.assertSafeTarget(':memory:', { allowMemory: true })).toBe(':memory:');
  });

  test('recusa qualquer argumento extra', () => {
    for (const argv of [['--force-real-db'], ['x'], ['--db', REAL], ['']]) {
      expect(() => devDb.resolveSeedTarget({ argv })).toThrow(/Argumento desconhecido/);
    }
  });

  test('resolveSeedTarget recusa se o banco dev coincidir com o real', () => {
    expect(() => devDb.resolveSeedTarget({ argv: [], devDbPath: REAL })).toThrow(/banco real/);
    expect(() => devDb.resolveSeedTarget({ argv: [], devDbPath: REAL.toUpperCase() })).toThrow(/banco real/);
  });
});

describe('removeDbFiles', () => {
  test('apaga *.dev.sqlite e os arquivos -wal/-shm', () => {
    const file = path.join(tmp, 'a.dev.sqlite');
    for (const s of ['', '-wal', '-shm']) fs.writeFileSync(file + s, 'x');
    devDb.removeDbFiles(file);
    for (const s of ['', '-wal', '-shm']) expect(fs.existsSync(file + s)).toBe(false);
  });

  test('aceita arquivo inexistente e extensão em maiúsculas', () => {
    expect(() => devDb.removeDbFiles(path.join(tmp, 'nada.dev.sqlite'))).not.toThrow();
    const file = path.join(tmp, 'B.DEV.SQLITE');
    fs.writeFileSync(file, 'x');
    devDb.removeDbFiles(file);
    expect(fs.existsSync(file)).toBe(false);
  });

  test.each(['inventory.sqlite', 'inventory.db', 'dev.sqlite', 'x.dev.sqlite.bak', 'inventory.dev.sqlite3'])(
    'recusa apagar %s e não mexe no arquivo',
    (name) => {
      const file = path.join(tmp, name);
      fs.writeFileSync(file, 'precioso');
      expect(() => devDb.removeDbFiles(file)).toThrow(/Recusado/);
      expect(fs.readFileSync(file, 'utf8')).toBe('precioso');
    },
  );

  test('arquivo travado (aberto) no Windows: erro pedindo para fechar o backend de demonstração', () => {
    if (process.platform !== 'win32') return;
    const file = path.join(tmp, 'travado.dev.sqlite');
    const db = new Database(file);
    try {
      db.pragma('journal_mode = WAL');
      db.exec('CREATE TABLE t (a)');
      let error;
      try {
        devDb.removeDbFiles(file);
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.message).toMatch(/em uso/);
      expect(error.message).toMatch(/dev:backend:demo/);
    } finally {
      db.close();
    }
  });
});

describe('runDevSeed em :memory:', () => {
  function seedInMemory() {
    freshDb();
    const { runDevSeed } = require('../../scripts/seedDev');
    return runDevSeed({ now: NOW, allowMemory: true });
  }

  async function listAll() {
    const app = createApp({ now: () => new Date(NOW.getTime()) });
    const stock = (await request(app).get('/api/items?status=EM_ESTOQUE&sortBy=age&order=desc')).body.data.items;
    const sold = (await request(app).get('/api/items?status=VENDIDO')).body.data.items;
    return { app, stock, sold };
  }

  test('recusa :memory: sem allowMemory, e com allowMemory fora de NODE_ENV=test', () => {
    freshDb();
    const { runDevSeed } = require('../../scripts/seedDev');
    expect(() => runDevSeed({ now: NOW })).toThrow(/:memory:/);
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => runDevSeed({ now: NOW, allowMemory: true })).toThrow(/:memory:/);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  test('cria os itens com a cobertura exigida (catálogo real)', async () => {
    const result = seedInMemory();
    expect(result).toMatchObject({ inStock: 33, sold: 9, total: 42, importPending: 3 });
    expect(result.catalogImported).toBeGreaterThan(1000);
    const { stock, sold } = await listAll();
    expect(stock).toHaveLength(33);
    expect(sold).toHaveLength(9);
    const all = [...stock, ...sold];

    const cats = new Set(all.map((i) => i.category));
    for (const c of ['SKIN', 'FACA', 'LUVA', 'STICKER', 'CAIXA', 'CAPSULA', 'PINGENTE', 'PERSONAGEM', 'OUTRO']) {
      expect(cats.has(c)).toBe(true);
    }

    const withFloat = all.filter((i) => ['SKIN', 'FACA', 'LUVA'].includes(i.category) && i.floatValue !== null);
    expect(withFloat.length).toBeGreaterThanOrEqual(5);
    for (const i of withFloat) {
      if (i.catalog && i.catalog.minFloat !== null) expect(i.floatValue).toBeGreaterThanOrEqual(i.catalog.minFloat);
      if (i.catalog && i.catalog.maxFloat !== null) expect(i.floatValue).toBeLessThanOrEqual(i.catalog.maxFloat);
      expect(i.exterior).toBeTruthy();
    }
    expect(all.some((i) => i.variant === 'STATTRAK')).toBe(true);
    expect(all.find((i) => i.category === 'FACA').phase).toBeTruthy();

    const won = all.filter((i) => i.acquisitionType === 'GANHEI');
    expect(won.length).toBeGreaterThanOrEqual(3);
    for (const i of won) expect(i.purchasePriceCents).toBe(0);
    expect(won.some((i) => i.originDetail === 'Mimo semanal')).toBe(true);

    expect(stock.filter((i) => i.tradeLock.isLocked).length).toBeGreaterThanOrEqual(3);
    expect(stock.filter((i) => i.aging.agingBucket === 'AGARRADO').length).toBeGreaterThanOrEqual(3);
    expect(stock.some((i) => i.aging.agingBucket === 'RECENTE')).toBe(true);
    expect(stock.some((i) => i.aging.agingBucket === 'EM_GIRO')).toBe(true);

    const byDays = (d) => stock.filter((i) => i.aging.daysInInventory === d);
    for (const d of [7, 8, 21, 22]) expect(byDays(d).length).toBeGreaterThanOrEqual(1);
    expect(byDays(7).every((i) => i.aging.agingBucket === 'RECENTE')).toBe(true);
    expect(byDays(8).every((i) => i.aging.agingBucket === 'EM_GIRO')).toBe(true);
    expect(byDays(21).every((i) => i.aging.agingBucket === 'EM_GIRO')).toBe(true);
    expect(byDays(22).every((i) => i.aging.agingBucket === 'AGARRADO')).toBe(true);
    const days = new Set(stock.map((i) => i.aging.daysInInventory));
    for (const d of [1, 3, 7, 8, 12, 21, 22, 30, 40, 120]) expect(days.has(d)).toBe(true);

    expect(sold.every((i) => i.status === 'VENDIDO' && i.salePriceCents > 0)).toBe(true);
    expect(sold.every((i) => Number.isInteger(i.aging.turnaroundDays))).toBe(true);
    expect(sold.some((i) => i.saleCurrency === 'BRL')).toBe(true);
    expect(sold.some((i) => i.saleCurrency === 'USD')).toBe(true);
    expect(sold.some((i) => i.tradeUnlockAt && i.tradeUnlockAt < i.soldAt)).toBe(true);

    const bought = all.filter((i) => i.acquisitionType === 'COMPRA');
    expect(new Set(bought.map((i) => i.purchaseStoreId)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(bought.map((i) => i.purchaseCurrency))).toEqual(new Set(['USD', 'BRL', 'EUR']));

    const inspect = all.filter((i) => i.inspectLink);
    expect(inspect.length).toBeGreaterThanOrEqual(3);
    for (const i of inspect) expect(i.inspectLink).toMatch(/^steam:\/\//);

    const one = stock.find((i) => i.name === 'Sticker | Shooter');
    expect(one.minPrices.find((m) => m.storeName === 'CSMoney')).toMatchObject({ minPriceCents: null, warningCode: 'FEES_NOT_CONFIGURED' });
    const csf = one.minPrices.find((m) => m.storeName === 'CSFloat');
    expect(csf.approx).toEqual({ currency: 'BRL', cents: Math.round(csf.minPriceCents * 5.4) });
  });

  test('itens com catalogId existente (só o OUTRO é livre) e a lista declarativa tem 42 itens', async () => {
    seedInMemory();
    const { stock, sold } = await listAll();
    const linked = [...stock, ...sold].filter((i) => i.category !== 'OUTRO');
    for (const i of linked) {
      expect(i.isLegacy).toBe(false);
      expect(i.catalog).toBeTruthy();
    }
    expect(data.STOCK_ITEMS.length + data.SOLD_ITEMS.length + data.EXTRA_STOCK_ITEMS.length + data.EXTRA_SOLD_ITEMS.length).toBe(42);
  });

  test('stagnantOnly devolve exatamente os agarrados do seed', async () => {
    seedInMemory();
    const { app, stock } = await listAll();
    const res = await request(app).get('/api/items?status=EM_ESTOQUE&stagnantOnly=true&sortBy=age&order=desc');
    expect(res.body.data.items).toHaveLength(stock.filter((i) => i.aging.agingBucket === 'AGARRADO').length);
  });
});

describe('runDevSeed em arquivo temporário (DB_PATH isolado)', () => {
  // O env.dbPath é lido uma vez por módulo: carrega os módulos em um registro novo apontando para o arquivo temporário.
  function runInFile(file, now = NOW) {
    const previous = process.env.DB_PATH;
    process.env.DB_PATH = file;
    let summary;
    let snapshot;
    try {
      jest.isolateModules(() => {
        const seed = require('../../scripts/seedDev');
        const db = require('../../src/config/database');
        try {
          summary = seed.runDevSeed({ now });
          snapshot = {
            items: db.getDb().prepare(
              `SELECT catalog_id, name, category, status, variant, float_value, acquisition_type, purchase_price_cents,
                      acquired_at, sale_price_cents FROM items ORDER BY id`,
            ).all(),
            fx: db.getDb().prepare("SELECT rate AS usd_brl_rate FROM fx_rates WHERE currency = 'BRL'").get(),
            catalogCount: db.getDb().prepare('SELECT COUNT(*) AS n FROM catalog_items').get().n,
          };
        } finally {
          db.closeDb();
        }
      });
    } finally {
      process.env.DB_PATH = previous;
    }
    return { summary, snapshot };
  }

  const dbFile = () => path.join(tmp, 'inventory.dev.sqlite');

  test('cria o arquivo, 42 itens e cotação 5,40', () => {
    const { summary, snapshot } = runInFile(dbFile());
    expect(summary).toMatchObject({ total: 42, inStock: 33, sold: 9, dbPath: dbFile() });
    expect(fs.existsSync(dbFile())).toBe(true);
    expect(snapshot.items).toHaveLength(42);
    expect(snapshot.fx.usd_brl_rate).toBe(5.4);
    expect(snapshot.catalogCount).toBeGreaterThan(1000);
  });

  test('idempotente: rodar duas vezes dá o mesmo conjunto (recria, não soma)', () => {
    const first = runInFile(dbFile());
    const second = runInFile(dbFile());
    expect(second.snapshot.items).toHaveLength(42);
    expect(second.snapshot.items).toEqual(first.snapshot.items);
    expect(second.summary.total).toBe(first.summary.total);
  });

  test('com outro "now", mesmo conjunto de itens (datas relativas)', () => {
    const a = runInFile(dbFile(), NOW);
    const b = runInFile(dbFile(), new Date(NOW.getTime() + 5 * 86400000));
    const strip = (rows) => rows.map(({ acquired_at: _a, ...rest }) => rest);
    expect(strip(b.snapshot.items)).toEqual(strip(a.snapshot.items));
    expect(b.snapshot.items.map((r) => r.acquired_at)).not.toEqual(a.snapshot.items.map((r) => r.acquired_at));
  });

  test('banco existente alterado é recriado do zero', () => {
    runInFile(dbFile());
    const extra = new Database(dbFile());
    extra.prepare('DELETE FROM items WHERE id = (SELECT MIN(id) FROM items)').run();
    extra.close();
    expect(runInFile(dbFile()).snapshot.items).toHaveLength(42);
  });

  test('recusa gravar em arquivo que não é *.dev.sqlite e não o apaga', () => {
    const file = path.join(tmp, 'qualquer.sqlite');
    fs.writeFileSync(file, 'dados do usuario');
    expect(() => runInFile(file)).toThrow(/Recusado/);
    expect(fs.readFileSync(file, 'utf8')).toBe('dados do usuario');
  });

  test('DB_PATH apontando para o banco real é recusado antes de abrir/criar/apagar', () => {
    const stat = () => (fs.existsSync(REAL) ? `${fs.statSync(REAL).mtimeMs}:${fs.statSync(REAL).size}` : null);
    const before = stat();
    for (const variant of [REAL, REAL.toUpperCase(), REAL.replace(/\\/g, '/')]) {
      expect(() => runInFile(variant)).toThrow(/banco real/);
    }
    expect(stat()).toBe(before);
  });

  test('arquivo travado em pasta temporária: erro claro e arquivo preservado (Windows)', () => {
    if (process.platform !== 'win32') return;
    const file = dbFile();
    runInFile(file);
    const locker = new Database(file);
    try {
      expect(() => runInFile(file)).toThrow(/em uso/);
    } finally {
      locker.close();
    }
    expect(fs.existsSync(file)).toBe(true);
    expect(runInFile(file).snapshot.items).toHaveLength(42);
  });
});

describe('banco de exemplo ampliado (12.11)', () => {
  // Roda o seed num banco :memory: e confere as situações principais pelos models e pela API (nada toca no banco real).
  async function seeded() {
    freshDb();
    const { runDevSeed } = require('../../scripts/seedDev');
    runDevSeed({ now: NOW, allowMemory: true });
    const app = createApp({ now: () => new Date(NOW.getTime()) });
    const stock = (await request(app).get('/api/items?status=EM_ESTOQUE&sortBy=age&order=desc')).body.data.items;
    const sold = (await request(app).get('/api/items?status=VENDIDO')).body.data.items;
    return { app, stock, sold };
  }

  test('lojas em USD, BRL, EUR e JPY, com a Steam e cotações de exemplo', async () => {
    await seeded();
    const Store = require('../../src/models/Store');
    const byName = Object.fromEntries(Store.findAll().map((s) => [s.name, s]));
    expect(Object.fromEntries(Object.entries(byName).map(([name, s]) => [name, s.currency]))).toEqual({
      CSFloat: 'USD', CSMoney: 'USD', Steam: 'BRL', 'Loja EUR': 'EUR', 'Loja JPY': 'JPY',
    });
    const FxRate = require('../../src/models/FxRate');
    expect(Object.fromEntries(FxRate.findAll().filter((r) => r.rate).map((r) => [r.currency, r.rate]))).toMatchObject({ BRL: 5.4, EUR: 0.92, JPY: 150 });
  });

  test('estoque: todas as faixas de giro, trade lock, fora de venda e componentes', async () => {
    const { stock } = await seeded();
    expect(stock).toHaveLength(33);
    const offSale = stock.filter((i) => i.saleState === 'OFF_SALE');
    expect(offSale.map((i) => i.name).sort()).toEqual(['AWP | Dragon Lore', 'M4A4 | Howl', 'Sticker | Crown (Foil)']);
    for (const i of offSale) expect(i.aging.agingBucket).toBe('FORA_DE_VENDA');
    const onSale = stock.filter((i) => i.saleState === 'FOR_SALE');
    for (const bucket of ['RECENTE', 'EM_GIRO', 'AGARRADO']) expect(onSale.some((i) => i.aging.agingBucket === bucket)).toBe(true);
    expect(stock.filter((i) => i.tradeLock.isLocked).length).toBeGreaterThanOrEqual(5);

    const withComponents = stock.filter((i) => i.components.length > 0);
    expect(withComponents.map((i) => i.name).sort()).toEqual(['AK-47 | Asiimov', 'Desert Eagle | Blaze', 'M4A1-S | Printstream']);
    const ak = withComponents.find((i) => i.name === 'AK-47 | Asiimov');
    expect(ak.components.filter((c) => c.kind === 'STICKER')).toHaveLength(4);
    expect(ak.components.filter((c) => c.kind === 'CHARM')).toHaveLength(1);
    expect(withComponents.find((i) => i.name === 'Desert Eagle | Blaze').components[0].kind).toBe('STICKER_SLAB');
  });

  test('caixas com chave (Fracture Case + 2 chaves) e sem chave, e unidades repetidas para o agrupado', async () => {
    const { stock } = await seeded();
    const count = (name) => stock.filter((i) => i.name === name).length;
    expect(count('Fracture Case')).toBe(3);
    expect(count('Fracture Case Key')).toBe(2);
    expect(count('Dreams & Nightmares Case')).toBe(2);
    expect(count('Kilowatt Case')).toBe(3);
    expect(stock.filter((i) => i.name === 'Sticker | Crown (Foil)')).toHaveLength(3);
    // As chaves são itens OUTRO de nome livre (sem catálogo); nenhuma caixa sem chave tem uma "... Key" correspondente.
    expect(stock.filter((i) => i.name.endsWith(' Key')).every((i) => i.category === 'OUTRO' && i.isLegacy === false)).toBe(true);
    expect(stock.some((i) => i.name === 'Dreams & Nightmares Case Key')).toBe(false);
  });

  test('vendas retidas e liberadas, em USD, BRL, EUR e JPY', async () => {
    const { sold } = await seeded();
    expect(sold).toHaveLength(9);
    const held = sold.filter((i) => i.saleRelease && i.saleRelease.isHeld);
    const released = sold.filter((i) => i.saleRelease && !i.saleRelease.isHeld);
    expect(held.length).toBeGreaterThanOrEqual(3); // AWP (CSFloat, 1 dia), AK (5 dias), + as extras de 1 e 3 dias
    expect(released.length).toBeGreaterThanOrEqual(5);
    expect(new Set(sold.map((i) => i.saleCurrency))).toEqual(new Set(['USD', 'BRL', 'EUR', 'JPY']));
    for (const i of sold.filter((x) => x.saleCurrency === 'JPY')) expect(i.salePriceCents % 100).toBe(0);
  });

  test('aportes, saques, conferência com ajuste (Steam) e conferência sem diferença (CSFloat)', async () => {
    await seeded();
    const Deposit = require('../../src/models/Deposit');
    const Withdrawal = require('../../src/models/Withdrawal');
    const StoreBalance = require('../../src/models/StoreBalance');
    const Store = require('../../src/models/Store');
    expect(Deposit.findAll()).toHaveLength(4);
    expect(Withdrawal.findAll()).toHaveLength(2);
    const id = Object.fromEntries(Store.findAll().map((s) => [s.name, s.id]));
    const checks = StoreBalance.findAllEntries();
    const steam = checks.find((c) => c.storeId === id.Steam);
    expect(steam.adjustmentCents).not.toBeNull();
    expect(steam.adjustmentCents).not.toBe(0);
    expect(steam.note).toBeTruthy();
    const csfloat = checks.find((c) => c.storeId === id.CSFloat);
    expect(csfloat.adjustmentCents).toBeNull();
    expect(csfloat.balanceCents).toBe(csfloat.computedCents);
  });

  test('importação do CSFloat com 3 pendências para conferir', async () => {
    const { app } = await seeded();
    const ImportBatchEntry = require('../../src/models/ImportBatchEntry');
    expect(ImportBatchEntry.countOpen()).toBe(3);
    const res = await request(app).get('/api/imports/entries?open=true');
    expect(res.status).toBe(200);
    const list = res.body.data.entries || res.body.data.items || res.body.data;
    expect(list.map((e) => e.outcome).sort()).toEqual(['FAILED', 'POSSIBLE_DUPLICATE', 'REVERTED']);
  });

  test('o saldo calculado das lojas não fica negativo no exemplo', async () => {
    const { app } = await seeded();
    const res = await request(app).get('/api/store-balances/current');
    expect(res.status).toBe(200);
    const stores = res.body.data.stores;
    expect(stores.length).toBeGreaterThanOrEqual(4);
    for (const s of stores) expect(s.negative).toBe(false);
  });

  test('os dados de exemplo não trazem e-mails, chaves nem caminhos pessoais', () => {
    const text = JSON.stringify([data.EXTRA_STORES, data.EXTRA_STOCK_ITEMS, data.EXTRA_SOLD_ITEMS, data.EXTRA_DEPOSITS, data.EXTRA_WITHDRAWALS, data.EXTRA_BALANCE_CHECKS, data.EXTRA_IMPORT]);
    expect(text).not.toMatch(/@|https?:\/\/|AppData|Users\\/i);
  });
});
