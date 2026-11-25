'use strict';

// QA 11.4 (D369, Adendo 1): NEW_STORE sem perder nada, FOLLOW e o critério "tem lançamentos", precisão por moeda em cada endpoint de valor,
// lucro real com lojas EUR/JPY (com e sem cotação) contra a conta manual e entradas hostis. Bancos em memória; sem rede.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, expectError, NOW, storeId, purchaseBody, createItemViaApi } = require('../helpers/apiFixtures');
const settingsService = require('../../src/services/settingsService');
const Setting = require('../../src/models/Setting');
const Store = require('../../src/models/Store');
const FxRate = require('../../src/models/FxRate');
const { CURRENCIES, ZERO_DECIMAL_CURRENCIES } = require('../../src/config/constants');
const { findMinSalePriceCents } = require('../../src/services/pricingService');
const { getSaleFeeStrategy, computeSaleFee } = require('../../src/services/fees');

afterAll(() => closeDb());

const JSON_TYPE = 'application/json';
const post = (app, url, body) => request(app).post(url).set('Content-Type', JSON_TYPE).send(body);
const patch = (app, url, body) => request(app).patch(url).set('Content-Type', JSON_TYPE).send(body);
const patchSettings = (app, body) => patch(app, '/api/settings', body);
const get = async (app, url) => (await request(app).get(url)).body.data;
const setRate = (currency, rate) => FxRate.upsert(currency, { rate, source: 'MANUAL' }, { now: NOW });
const steamId = () => Setting.get().steamStoreId;

let app;
beforeEach(() => {
  settingsService.resetAutoFxForTests();
  freshDb({ displayCurrency: null }); // instalação nova: tudo em USD
  app = makeCatalogApp(NOW);
});

const storeBody = (currency, extra = {}) => ({
  name: `Loja ${currency}`, currency, saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeeRounding: 'CEIL', allowsWithdrawal: true, ...extra,
});
const rowsOf = (table) => getDb().prepare(`SELECT * FROM ${table} ORDER BY id`).all();
const D = '2026-11-10T12:00:00.000Z';

// Histórico completo na Steam (USD): compra, venda, item fora de venda, aporte, saque e conferência com ajuste.
async function seedSteamHistory() {
  const steam = steamId();
  getDb().prepare('UPDATE stores SET allows_withdrawal = 1, sale_hold_days = 3 WHERE id = ?').run(steam);
  const a = await createItemViaApi(app, purchaseBody({ purchaseStoreId: steam, purchasePriceCents: 1000 }));
  const sold = await post(app, `/api/items/${a.id}/sell`, { saleStoreId: steam, salePriceCents: 2000, soldAt: '2026-11-12T12:00:00.000Z' });
  expect(sold.status).toBe(200);
  const b = await createItemViaApi(app, purchaseBody({ purchaseStoreId: steam, purchasePriceCents: 500 }));
  expect((await post(app, `/api/items/${b.id}/off-sale`, {})).status).toBe(200);
  expect((await post(app, '/api/deposits', { storeId: steam, amountStoreCents: 5000, amountBrlCents: 27000, amountBrlCurrency: 'BRL', depositedAt: D })).status).toBe(201);
  expect((await post(app, '/api/withdrawals', { storeId: steam, amountStoreCents: 1000, feeCents: 50, amountBrlCents: 5000, amountBrlCurrency: 'BRL', withdrawnAt: D })).status).toBe(201);
  expect((await post(app, '/api/store-balances', { storeId: steam, balanceCents: 4000, recordedAt: D, adjust: true, note: 'ajuste' })).status).toBe(201);
  return { steam, soldId: a.id, offId: b.id };
}

// O que não pode mudar em NEW_STORE: moeda base (USD) do lucro e o saldo da loja antiga.
function core(summary, balances, oldId) {
  const row = (list) => list.find((r) => r.storeId === oldId);
  const noNames = (value) => JSON.parse(JSON.stringify(value, (k, v) => (k === 'storeName' || k === 'approxCents' || k === 'approxCurrency' || k === 'availableApproxCents' || k === 'isActive' ? undefined : v)));
  const pick = (r) => noNames(r);
  return {
    totals: {
      deposits: summary.depositsUsdCents, withdrawals: summary.withdrawalsNetUsdCents, platform: summary.platformBalanceUsdCents,
      pending: summary.pendingBalanceUsdCents, stock: summary.stockUsdCents, profit: summary.realProfitUsdCents,
      forSale: summary.stockBreakdown.forSale.usdCents, offSale: summary.stockBreakdown.offSale.usdCents,
    },
    oldStoreSummary: pick(row(summary.balancesByStore)),
    oldStoreCurrent: pick(row(balances.stores)),
  };
}

describe('NEW_STORE: nada se perde', () => {
  test('itens, vendas, aportes, saques e conferências ficam na Steam antiga, com valores e moeda idênticos; lucro e saldos idênticos', async () => {
    const { steam } = await seedSteamHistory();
    setRate('EUR', 0.9);
    const tables = ['items', 'deposits', 'withdrawals', 'store_balances'];
    const rowsBefore = Object.fromEntries(tables.map((t) => [t, rowsOf(t)]));
    const before = core(await get(app, '/api/profit/summary'), await get(app, '/api/store-balances/current'), steam);
    expect(before.oldStoreCurrent.breakdown.purchasesCents).toBe(1500);

    const res = await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' });
    expect(res.status).toBe(200);
    const fresh = res.body.data.steamStore;
    expect(fresh).toMatchObject({ currency: 'EUR', created: true, previousStoreId: steam });

    for (const t of tables) expect(rowsOf(t)).toEqual(rowsBefore[t]); // nenhuma linha tocada (inclusive updated_at)
    const after = core(await get(app, '/api/profit/summary'), await get(app, '/api/store-balances/current'), steam);
    expect(after).toEqual(before);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM items WHERE purchase_store_id = ? OR sale_store_id = ?').get(steam, steam).n).toBe(2);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM items WHERE purchase_store_id = ?').get(fresh.id).n).toBe(0);
    expect(getDb().prepare('SELECT currency FROM stores WHERE id = ?').get(steam).currency).toBe('USD');
    expect(getDb().pragma('foreign_key_check')).toEqual([]);
    expect(getDb().prepare('SELECT steam_store_id AS s FROM settings').get().s).toBe(fresh.id);
  });

  test('a Steam antiga inativa some do filtro de ativas (seletores), mas continua no histórico (lista, itens e saques)', async () => {
    const { steam, soldId } = await seedSteamHistory();
    await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' });
    const active = await get(app, '/api/stores?activeOnly=true');
    expect(active.map((s) => s.id)).not.toContain(steam);
    expect(active.filter((s) => s.name === 'Steam')).toHaveLength(1);
    const all = await get(app, '/api/stores');
    expect(all.find((s) => s.id === steam)).toMatchObject({ name: 'Steam (USD)', isActive: false, inUse: true, isSteamStore: false, currency: 'USD' });
    const sold = await get(app, `/api/items/${soldId}`);
    expect(sold).toMatchObject({ saleStoreId: steam, saleCurrency: 'USD', purchaseCurrency: 'USD' });
    const wl = await get(app, '/api/withdrawals');
    expect((wl.withdrawals ?? wl).every((w) => w.storeId === steam)).toBe(true);
    const dl = await get(app, '/api/deposits');
    expect((dl.deposits ?? dl).every((w) => w.storeId === steam)).toBe(true);
    expectError(await patch(app, `/api/stores/${steam}`, { currency: 'EUR' }), 409, 'STORE_CURRENCY_LOCKED');
  });

  test('a loja nova nasce sem lançamentos; compra nova vai para ela e a antiga mantém só o que já tinha', async () => {
    const { steam } = await seedSteamHistory();
    setRate('EUR', 0.5);
    const fresh = (await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' })).body.data.steamStore.id;
    expect((await get(app, '/api/stores')).find((s) => s.id === fresh).inUse).toBe(false);
    const item = await createItemViaApi(app, purchaseBody({ purchaseStoreId: fresh, purchasePriceCents: 1000 }));
    expect(item).toMatchObject({ purchaseCurrency: 'EUR', fxRateAtPurchase: 0.5 });
    const current = await get(app, '/api/store-balances/current');
    expect(current.stores.find((s) => s.storeId === fresh).breakdown.purchasesCents).toBe(1000);
    expect(current.stores.find((s) => s.storeId === steam).breakdown.purchasesCents).toBe(1500);
  });

  test('NEW_STORE repetido (BRL -> GBP -> EUR -> GBP -> EUR): nomes certos e sem colisão; só uma Steam ativa', async () => {
    freshDb({ displayCurrency: 'BRL' }); // Steam em BRL
    app = makeCatalogApp(NOW);
    setRate('GBP', 0.8);
    setRate('EUR', 0.9);
    const addEntry = (id) => getDb().prepare("INSERT INTO withdrawals (store_id, amount_store_cents, withdrawn_at, created_at, updated_at) VALUES (?, 100, ?, 'c', 'u')").run(id, D);
    addEntry(steamId());
    const first = (await patchSettings(app, { displayCurrency: 'GBP', steamStore: 'NEW_STORE' })).body.data.steamStore;
    expect(first.currency).toBe('GBP');
    addEntry(first.id);
    const second = (await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' })).body.data.steamStore;
    expect(second).toMatchObject({ currency: 'EUR', previousStoreId: first.id });
    expect((await get(app, '/api/stores')).map((s) => `${s.name}|${s.currency}|${s.isActive}`)).toEqual(expect.arrayContaining([
      'Steam (BRL)|BRL|false', 'Steam (GBP)|GBP|false', 'Steam|EUR|true',
    ]));
    addEntry(second.id);
    const third = (await patchSettings(app, { displayCurrency: 'GBP', steamStore: 'NEW_STORE' })).body.data.steamStore;
    addEntry(third.id);
    const fourth = await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' });
    expect(fourth.status).toBe(200);
    const stores = await get(app, '/api/stores');
    const names = stores.map((s) => s.name);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['Steam (BRL)', 'Steam (GBP)', 'Steam (GBP) 2', 'Steam (EUR)', 'Steam']));
    expect(stores.filter((s) => s.isSteamStore).map((s) => s.id)).toEqual([fourth.body.data.steamStore.id]);
    expect(stores.filter((s) => s.name === 'Steam' && s.isActive)).toHaveLength(1);
  });

  test('a Steam principal: a marca passa para a nova (uma só principal, ativa)', async () => {
    const { steam } = await seedSteamHistory();
    await patch(app, `/api/stores/${steam}`, { isPrimary: true });
    const fresh = (await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' })).body.data.steamStore.id;
    const primaries = (await get(app, '/api/stores')).filter((s) => s.isPrimary);
    expect(primaries.map((s) => s.id)).toEqual([fresh]);
    expect(primaries[0].isActive).toBe(true);
  });

  test('Steam desativada pelo usuário e com lançamentos: NEW_STORE cria a nova ativa e aponta steam_store_id', async () => {
    const { steam } = await seedSteamHistory();
    await patch(app, `/api/stores/${steam}`, { isActive: false });
    const res = await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' });
    expect(res.status).toBe(200);
    const stores = await get(app, '/api/stores');
    expect(stores.find((s) => s.id === res.body.data.steamStore.id)).toMatchObject({ isActive: true, isSteamStore: true, currency: 'EUR' });
    expect(stores.find((s) => s.id === steam)).toMatchObject({ isActive: false });
  });

  test('falha no meio (Store.create lança depois do rename; Setting.update do steam_store_id lança): tudo desfeito', async () => {
    const { steam } = await seedSteamHistory();
    const snapshot = () => ({ stores: rowsOf('stores'), settings: rowsOf('settings') });
    const before = snapshot();
    const createSpy = jest.spyOn(Store, 'create').mockImplementation(() => { throw new Error('falha ao criar'); });
    try {
      expect((await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' })).status).toBe(500);
    } finally { createSpy.mockRestore(); }
    expect(snapshot()).toEqual(before);

    const real = Setting.update;
    const updateSpy = jest.spyOn(Setting, 'update').mockImplementation((changes, opts) => {
      if (changes && changes.steamStoreId !== undefined) throw new Error('falha ao apontar');
      return real(changes, opts);
    });
    try {
      expect((await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' })).status).toBe(500);
    } finally { updateSpy.mockRestore(); }
    expect(snapshot()).toEqual(before);
    expect((await get(app, '/api/settings')).displayCurrency).toBe('USD');
    expect(Setting.get().steamStoreId).toBe(steam);
  });
});

describe('FOLLOW e "tem lançamentos" (critério D30 / Store.isInUse)', () => {
  const entries = {
    'item comprado na Steam': () => getDb().prepare("INSERT INTO items (name, category, acquisition_type, purchase_store_id, purchase_price_cents, acquired_at, created_at, updated_at) VALUES ('x', 'OUTRO', 'COMPRA', ?, 100, 'a', 'c', 'u')").run(steamId()),
    aporte: () => getDb().prepare("INSERT INTO deposits (store_id, amount_store_cents, deposited_at, created_at, updated_at) VALUES (?, 100, 'a', 'c', 'u')").run(steamId()),
    saque: () => getDb().prepare("INSERT INTO withdrawals (store_id, amount_store_cents, withdrawn_at, created_at, updated_at) VALUES (?, 100, 'a', 'c', 'u')").run(steamId()),
    conferência: () => getDb().prepare("INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, 100, 'a', 'c')").run(steamId()),
  };
  test.each(Object.keys(entries))('Steam só com %s conta como lançamento: FOLLOW -> STORE_CURRENCY_LOCKED, NEW_STORE funciona', async (kind) => {
    entries[kind]();
    expect((await get(app, '/api/settings/currency-change-preview?currency=EUR')).steamStore.hasEntries).toBe(true);
    expectError(await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'FOLLOW' }), 409, 'STORE_CURRENCY_LOCKED');
    expect((await get(app, '/api/settings')).displayCurrency).toBe('USD');
    expect((await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' })).status).toBe(200);
  });

  test('item VENDIDO com a Steam só como loja de venda também conta (sale_store_id)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 100 }));
    expect((await post(app, `/api/items/${item.id}/sell`, { saleStoreId: steamId(), salePriceCents: 500, soldAt: D })).status).toBe(200);
    expectError(await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'FOLLOW' }), 409, 'STORE_CURRENCY_LOCKED');
  });

  test('Steam sem lançamentos mas OUTRA loja com lançamentos: FOLLOW funciona (só a Steam importa)', async () => {
    await createItemViaApi(app, purchaseBody());
    expect((await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'FOLLOW' })).status).toBe(200);
    expect(Store.findById(steamId()).currency).toBe('EUR');
  });

  test('FOLLOW sem cotação: a taxa fixa e a de saque da Steam não são levadas (ficam 0) e a mínima vira nula', async () => {
    getDb().prepare('UPDATE stores SET sale_fixed_fee_cents = 50, sale_min_fee_cents = 10, withdrawal_fixed_fee_cents = 30 WHERE id = ?').run(steamId());
    expect((await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'FOLLOW' })).status).toBe(200);
    expect(Store.findById(steamId())).toMatchObject({ currency: 'EUR', saleFixedFeeCents: 0, saleMinFeeCents: null, withdrawalFixedFeeCents: 0 });
  });

  test('FOLLOW com cotação: converte com CEIL, e em JPY o valor sobe para a unidade', async () => {
    setRate('EUR', 0.91);
    setRate('JPY', 155);
    getDb().prepare('UPDATE stores SET sale_fixed_fee_cents = 50, sale_min_fee_cents = 10, withdrawal_fixed_fee_cents = 30 WHERE id = ?').run(steamId());
    expect((await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'FOLLOW' })).status).toBe(200);
    // 50 x 0,91 = 45,5 -> 46; 10 x 0,91 = 9,1 -> 10; 30 x 0,91 = 27,3 -> 28
    expect(Store.findById(steamId())).toMatchObject({ currency: 'EUR', saleFixedFeeCents: 46, saleMinFeeCents: 10, withdrawalFixedFeeCents: 28 });
    expect((await patchSettings(app, { displayCurrency: 'JPY', steamStore: 'FOLLOW' })).status).toBe(200);
    const jpy = Store.findById(steamId());
    expect(jpy.currency).toBe('JPY');
    for (const f of [jpy.saleFixedFeeCents, jpy.saleMinFeeCents, jpy.withdrawalFixedFeeCents]) expect(f % 100).toBe(0);
    // 0,46 EUR = 0,5055 USD = 78,35 ienes; a conversão passa por US$ com CEIL (51 centavos -> 79,05) e sobe de novo: 80 ienes (conservador)
    expect(jpy.saleFixedFeeCents).toBeGreaterThanOrEqual(7900);
    expect(jpy.saleFixedFeeCents).toBeLessThanOrEqual(8000);
  });

  test('FOLLOW com a Steam desativada pelo usuário e sem lançamentos: acompanha a moeda e continua inativa', async () => {
    await patch(app, `/api/stores/${steamId()}`, { isActive: false });
    expect((await patchSettings(app, { displayCurrency: 'GBP', steamStore: 'FOLLOW' })).status).toBe(200);
    expect(Store.findById(steamId())).toMatchObject({ currency: 'GBP', isActive: false });
  });

  test('FOLLOW com a Steam principal sem lançamentos: continua principal', async () => {
    await patch(app, `/api/stores/${steamId()}`, { isPrimary: true });
    expect((await patchSettings(app, { displayCurrency: 'GBP', steamStore: 'FOLLOW' })).status).toBe(200);
    expect(Store.findById(steamId())).toMatchObject({ currency: 'GBP', isPrimary: true });
  });

  test('FOLLOW para KRW sem cotação não derruba', async () => {
    expect((await patchSettings(app, { displayCurrency: 'KRW', steamStore: 'FOLLOW' })).status).toBe(200);
    expect(Store.findById(steamId()).currency).toBe('KRW');
  });

  test('steam_store_id nulo: preview null, KEEP ok, FOLLOW e NEW_STORE -> INVALID_FIELD, nada gravado', async () => {
    getDb().prepare('UPDATE settings SET steam_store_id = NULL').run();
    expect((await get(app, '/api/settings/currency-change-preview?currency=EUR')).steamStore).toBeNull();
    for (const choice of ['FOLLOW', 'NEW_STORE']) expectError(await patchSettings(app, { displayCurrency: 'EUR', steamStore: choice }), 400, 'INVALID_FIELD', { field: 'steamStore' });
    expect((await get(app, '/api/settings')).displayCurrency).toBe('USD');
    expect((await patchSettings(app, { displayCurrency: 'EUR' })).body.data.steamStore).toBeNull();
  });
});

describe('precisão por moeda em cada endpoint de valor', () => {
  const ZERO = ZERO_DECIMAL_CURRENCIES;
  const BAD = [1, 99, 150];
  let stores;
  beforeEach(async () => {
    stores = {};
    for (const currency of [...ZERO, 'EUR', 'GBP', 'BRL']) {
      setRate(currency, { JPY: 150, KRW: 1300, CLP: 900 }[currency] ?? 0.9);
      stores[currency] = (await post(app, '/api/stores', storeBody(currency, { name: `L-${currency}`, saleHoldDays: 0 }))).body.data;
    }
  });
  const withdraw = (currency, extra) => post(app, '/api/withdrawals', { storeId: stores[currency].id, amountStoreCents: 100000, withdrawnAt: D, ...extra });
  const balance = (currency, balanceCents) => post(app, '/api/store-balances', { storeId: stores[currency].id, balanceCents, recordedAt: D });
  const buy = (currency, price) => post(app, '/api/items', purchaseBody({ purchaseStoreId: stores[currency].id, purchasePriceCents: price }));
  const quote = (currency, price) => request(app).get(`/api/stores/${stores[currency].id}/sale-quote?salePriceCents=${price}`);

  test.each(ZERO)('%s: valores 1, 99 e 150 -> AMOUNT_PRECISION_INVALID; 100 aceito; negativos recusados', async (currency) => {
    for (const bad of BAD) {
      expectError(await buy(currency, bad), 400, 'AMOUNT_PRECISION_INVALID', { field: 'purchasePriceCents' });
      expectError(await quote(currency, bad * 100 + bad), 400, 'AMOUNT_PRECISION_INVALID', { field: 'salePriceCents' });
      expectError(await withdraw(currency, { amountStoreCents: bad }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'amountStoreCents' });
      expectError(await withdraw(currency, { feeCents: bad }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'feeCents' });
      expectError(await withdraw(currency, { amountBrlCents: bad, amountBrlCurrency: currency }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'amountBrlCents' });
      expectError(await balance(currency, bad), 400, 'AMOUNT_PRECISION_INVALID', { field: 'balanceCents' });
      expectError(await post(app, '/api/stores', storeBody(currency, { name: `x${bad}`, saleMinFeeCents: bad })), 400, 'AMOUNT_PRECISION_INVALID', { field: 'saleMinFeeCents' });
    }
    expect((await buy(currency, 100)).status).toBe(201);
    expect((await quote(currency, 100000)).status).toBe(200);
    expect((await withdraw(currency, { amountStoreCents: 100, feeCents: 100 })).status).toBe(201);
    expect((await balance(currency, 100)).status).toBe(201);
    for (const neg of [-100, -1]) {
      for (const res of [await buy(currency, neg), await withdraw(currency, { amountStoreCents: neg }), await balance(currency, neg)]) {
        expect(res.status).toBe(400);
        expect(res.body.error.code).toMatch(/INVALID_AMOUNT|AMOUNT_PRECISION_INVALID/);
      }
    }
  });

  test.each(ZERO)('%s: venda com preço e líquido fora da unidade recusados; venda válida fica na unidade', async (currency) => {
    const item = (await buy(currency, 100000)).body.data;
    const body = { saleStoreId: stores[currency].id, soldAt: D };
    expectError(await post(app, `/api/items/${item.id}/sell`, { ...body, salePriceCents: 150 }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'salePriceCents' });
    expectError(await post(app, `/api/items/${item.id}/sell`, { ...body, salePriceCents: 200000, netReceivedCents: 150 }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'netReceivedCents' });
    const ok = await post(app, `/api/items/${item.id}/sell`, { ...body, salePriceCents: 200000 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.item.netReceivedCents % 100).toBe(0);
    expect(ok.body.data.item.netReceivedCents).toBe(196000); // 2% de 2.000 = 40
  });

  test.each(['EUR', 'GBP', 'BRL', 'USD'])('%s (2 casas): 1 centavo continua aceito em compra, saque, conferência, quote e taxas', async (currency) => {
    const id = currency === 'USD' ? storeId('CSFloat') : stores[currency].id;
    if (currency !== 'USD') expect((await buy(currency, 1)).status).toBe(201);
    else expect((await post(app, '/api/items', purchaseBody({ purchasePriceCents: 1 }))).status).toBe(201);
    expect((await post(app, '/api/withdrawals', { storeId: id, amountStoreCents: 1, feeCents: 1, withdrawnAt: D })).status).toBe(201);
    expect((await post(app, '/api/store-balances', { storeId: id, balanceCents: 1, recordedAt: D })).status).toBe(201);
    expect((await request(app).get(`/api/stores/${id}/sale-quote?salePriceCents=1`)).status).toBe(200);
    expect((await post(app, '/api/stores', storeBody(currency, { name: `fee${currency}`, saleFixedFeeCents: 1, saleMinFeeCents: 1, withdrawalFixedFeeCents: 1 }))).status).toBe(201);
  });

  test('o valor informativo usa a precisão da moeda dele, não a da loja', async () => {
    expectError(await withdraw('EUR', { amountBrlCents: 10050, amountBrlCurrency: 'JPY' }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'amountBrlCents' });
    expect((await withdraw('EUR', { amountBrlCents: 10000, amountBrlCurrency: 'JPY' })).status).toBe(201);
    expect((await withdraw('JPY', { amountBrlCents: 10050, amountBrlCurrency: 'EUR' })).status).toBe(201);
    const dep = (cents, currency) => post(app, '/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 1000, amountBrlCents: cents, amountBrlCurrency: currency, depositedAt: D });
    expectError(await dep(5050, 'KRW'), 400, 'AMOUNT_PRECISION_INVALID', { field: 'amountBrlCents' });
    expect((await dep(5000, 'KRW')).status).toBe(201);
    expect((await dep(5050, 'USD')).status).toBe(201);
  });

  test('trocar a moeda de uma loja sem lançamentos de EUR (taxa fixa 150) para KRW é recusado pela unidade e nada muda', async () => {
    const eur = (await post(app, '/api/stores', storeBody('EUR', { name: 'Trocavel', saleFixedFeeCents: 150 }))).body.data;
    expectError(await patch(app, `/api/stores/${eur.id}`, { currency: 'KRW' }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'saleFixedFeeCents' });
    expect(Store.findById(eur.id)).toMatchObject({ currency: 'EUR', saleFixedFeeCents: 150 });
    expect((await patch(app, `/api/stores/${eur.id}`, { currency: 'KRW', saleFixedFeeCents: 100 })).status).toBe(200);
  });

  describe('taxa e preço mínimo na unidade (propriedades)', () => {
    const modes = ['CEIL', 'ROUND', 'FLOOR'];
    const make = (feeType, rate, rounding, unitCents) => ({ feeType, rate, rounding, minFeeCents: null, fixedFeeCents: 0, unitCents });

    test.each(modes)('JPY, %s: a taxa é sempre múltiplo de 100 e respeita o modo', (rounding) => {
      for (const base of [100, 100100, 102500, 149900, 99999900]) {
        const fee = computeSaleFee(base, make('DEDUCTED', 0.02, rounding, 100));
        expect(fee % 100).toBe(0);
        const exact = base * 0.02;
        if (rounding === 'CEIL') expect(fee).toBeGreaterThanOrEqual(exact - 1e-6);
        if (rounding === 'FLOOR') expect(fee).toBeLessThanOrEqual(exact + 1e-6);
        expect(Math.abs(fee - exact)).toBeLessThanOrEqual(100);
      }
    });

    test.each([['DEDUCTED', 0.02], ['ADDED', 0.15], ['DEDUCTED', 0.1325], ['ADDED', 0.0001]])('%s %s: preço mínimo em KRW é o menor múltiplo de 100 cujo líquido cobre o custo', (feeType, rate) => {
      for (const rounding of modes) {
        for (const cost of [0, 100, 150000, 4999900, 123400]) {
          const params = make(feeType, rate, rounding, 100);
          const price = findMinSalePriceCents(cost, params);
          const strategy = getSaleFeeStrategy(feeType);
          expect(price % 100).toBe(0);
          expect(price).toBeGreaterThanOrEqual(100);
          expect(strategy.net(price, params)).toBeGreaterThanOrEqual(cost);
          if (price > 100) expect(strategy.net(price - 100, params)).toBeLessThan(cost);
        }
      }
    });

    test('taxa percentual em JPY combinada com taxa mínima e fixa', () => {
      const p = { feeType: 'DEDUCTED', rate: 0.02, rounding: 'CEIL', minFeeCents: 300, fixedFeeCents: 100, unitCents: 100 };
      expect(computeSaleFee(10000, p)).toBe(400); // 2% = 2 ienes < mínima de 3, mais 1 de fixa
      expect(computeSaleFee(1000000, p)).toBe(20100); // 200 ienes + 1 de fixa
    });
  });
});

describe('lucro real com lojas em EUR e JPY', () => {
  async function scenario() {
    const eur = (await post(app, '/api/stores', storeBody('EUR', { name: 'Loja EUR', saleHoldDays: 0 }))).body.data;
    const jpy = (await post(app, '/api/stores', storeBody('JPY', { name: 'Loja JPY', saleHoldDays: 0 }))).body.data;
    expect((await post(app, '/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 5000, depositedAt: D })).status).toBe(201);
    return { eur, jpy };
  }
  async function trade({ eur, jpy }) {
    const a = await createItemViaApi(app, purchaseBody({ purchaseStoreId: eur.id, purchasePriceCents: 1000 }));
    expect((await post(app, `/api/items/${a.id}/sell`, { saleStoreId: eur.id, salePriceCents: 3000, soldAt: '2026-11-12T12:00:00.000Z' })).status).toBe(200);
    expect((await post(app, '/api/withdrawals', { storeId: eur.id, amountStoreCents: 2000, feeCents: 100, withdrawnAt: '2026-11-13T12:00:00.000Z' })).status).toBe(201);
    await createItemViaApi(app, purchaseBody({ purchaseStoreId: jpy.id, purchasePriceCents: 100000 }));
  }

  test('com cotações fixas o resultado bate com a conta manual', async () => {
    setRate('EUR', 0.5);
    setRate('JPY', 100);
    await trade(await scenario());
    const s = await get(app, '/api/profit/summary');
    // EUR: compra 10,00 (US$ 20,00); venda 30,00, taxa 2% = 0,60, líquido 29,40; saque 20,00 com taxa 1,00 -> líquido 19,00 (US$ 38,00)
    //      saldo = -10,00 + 29,40 - 20,00 = -0,60 EUR = -US$ 1,20
    // JPY: compra 1.000 ienes = US$ 10,00 (saldo -US$ 10,00; estoque US$ 10,00). CSFloat: aporte US$ 50,00.
    expect(s.depositsUsdCents).toBe(5000);
    expect(s.withdrawalsNetUsdCents).toBe(3800);
    expect(s.platformBalanceUsdCents).toBe(5000 - 120 - 1000);
    expect(s.stockUsdCents).toBe(1000);
    expect(s.realProfitUsdCents).toBe(3800 + 3880 + 1000 - 5000);
    expect(s.estimated).toBe(true);
    expect(s.balancesByStore.find((r) => r.storeName === 'Loja EUR')).toMatchObject({ availableCents: -60, availableUsdCents: -120 });
    expect(s.balancesByStore.find((r) => r.storeName === 'Loja JPY')).toMatchObject({ availableCents: -100000, availableUsdCents: -1000 });
    expect(s.approxCurrency).toBe('USD');
    const current = await get(app, '/api/store-balances/current');
    expect(current.stores.find((r) => r.storeName === 'Loja EUR').availableUsdCents).toBe(-120);
  });

  test('trocar a moeda de conversão para EUR não muda a base USD do lucro', async () => {
    setRate('EUR', 0.5);
    setRate('JPY', 100);
    await trade(await scenario());
    const before = await get(app, '/api/profit/summary');
    await patchSettings(app, { displayCurrency: 'EUR' });
    const after = await get(app, '/api/profit/summary');
    expect(after.realProfitUsdCents).toBe(before.realProfitUsdCents);
    expect(after.approxCurrency).toBe('EUR');
    expect(after.approx.realProfit).not.toBeNull();
  });

  test('sem cotação de EUR e JPY: 200, sem NaN, lucro nulo, valores das lojas sem cotação nulos e aviso presente', async () => {
    setRate('EUR', 0.5);
    setRate('JPY', 100);
    await trade(await scenario());
    getDb().prepare('DELETE FROM fx_rates').run(); // as cotações somem depois dos lançamentos
    const res = await request(app).get('/api/profit/summary');
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/NaN|Infinity/);
    const s = res.body.data;
    expect(s.realProfitUsdCents).toBeNull();
    expect(s.balancesByStore.find((r) => r.storeName === 'Loja EUR').availableUsdCents).toBeNull();
    expect(s.warnings.length).toBeGreaterThan(0);
    const current = await request(app).get('/api/store-balances/current');
    expect(current.status).toBe(200);
    expect(current.text).not.toMatch(/NaN|Infinity/);
    expect((await request(app).get('/api/items')).status).toBe(200);
    expect((await request(app).get('/api/items/stats?name=Caixa&category=OUTRO')).status).toBe(200);
  });

  test('só uma das cotações (JPY sim, EUR não): 200 e as parcelas de JPY aparecem', async () => {
    setRate('JPY', 100);
    setRate('EUR', 0.5);
    await trade(await scenario());
    getDb().prepare("DELETE FROM fx_rates WHERE currency = 'EUR'").run();
    const res = await request(app).get('/api/profit/summary');
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.realProfitUsdCents).toBeNull();
    expect(s.balancesByStore.find((r) => r.storeName === 'Loja JPY').availableUsdCents).toBe(-1000);
    expect(s.balancesByStore.find((r) => r.storeName === 'Loja EUR').availableUsdCents).toBeNull();
  });
});

describe('entradas hostis', () => {
  const HOSTILE = ['eur', 'XXX', ' USD', 'USD ', 'EURO', 'US', '', 123, null, true, ['USD'], { c: 'USD' }];

  test.each(HOSTILE.map((v) => [JSON.stringify(v), v]))('POST /api/stores com currency %s -> 400 e nada criado', async (_label, currency) => {
    const before = (await get(app, '/api/stores')).length;
    const res = await post(app, '/api/stores', storeBody('USD', { name: 'Hostil', currency }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toMatch(/INVALID_CURRENCY|INVALID_FIELD|REQUIRED_FIELD/);
    expect((await get(app, '/api/stores')).length).toBe(before);
  });

  test.each(HOSTILE.filter((v) => v !== null).map((v) => [JSON.stringify(v), v]))('PATCH /api/stores/:id com currency %s -> 400 e a moeda não muda', async (_label, currency) => {
    const created = (await post(app, '/api/stores', storeBody('EUR', { name: 'Alvo' }))).body.data;
    const res = await patch(app, `/api/stores/${created.id}`, { currency });
    expect(res.status).toBe(400);
    expect(Store.findById(created.id).currency).toBe('EUR');
  });

  test('o banco também recusa formato inválido de moeda (defesa em profundidade)', () => {
    const insert = (cur) => getDb().prepare("INSERT INTO stores (name, currency, created_at, updated_at) VALUES (?, ?, 'c', 'u')").run(`n${cur}`, cur);
    for (const bad of ['eur', 'EU', 'EURO', '']) expect(() => insert(bad)).toThrow(/CHECK/);
  });

  const BAD_STEAM = ['follow', 'new_store', '', 1, true, ['FOLLOW'], { a: 1 }, null, 'KEEP ', 'XXX'];
  test.each(BAD_STEAM.map((v) => [JSON.stringify(v), v]))('steamStore %s -> 400 INVALID_FIELD e nada gravado', async (_label, steamStore) => {
    const res = await patchSettings(app, { displayCurrency: 'EUR', steamStore });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FIELD');
    expect((await get(app, '/api/settings')).displayCurrency).toBe('USD');
    expect(Store.findById(steamId()).currency).toBe('USD');
  });

  test('steamStore sem displayCurrency -> INVALID_FIELD; displayCurrency inválido + steamStore válido -> erro sem gravar', async () => {
    expectError(await patchSettings(app, { steamStore: 'FOLLOW' }), 400, 'INVALID_FIELD', { field: 'steamStore' });
    for (const displayCurrency of ['eur', 'XXX', 5, null, ' EUR']) {
      const res = await patchSettings(app, { displayCurrency, steamStore: 'FOLLOW' });
      expect(res.status).toBe(400);
      expect(Store.findById(steamId()).currency).toBe('USD');
    }
    expect((await get(app, '/api/settings')).displayCurrency).toBe('USD');
  });

  const BAD_CUR = ['brl', 'XXX', ' BRL', 'BRL ', '', 123, true, ['BRL'], 'EURO'];
  test.each(BAD_CUR.map((v) => [JSON.stringify(v), v]))('amountBrlCurrency %s -> 400 em saque e aporte (criar e editar)', async (_label, amountBrlCurrency) => {
    const eur = (await post(app, '/api/stores', storeBody('EUR', { name: 'Loja E' }))).body.data;
    expect((await post(app, '/api/withdrawals', { storeId: eur.id, amountStoreCents: 1000, amountBrlCents: 500, amountBrlCurrency, withdrawnAt: D })).status).toBe(400);
    expect((await post(app, '/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 1000, amountBrlCents: 500, amountBrlCurrency, depositedAt: D })).status).toBe(400);
    const okW = (await post(app, '/api/withdrawals', { storeId: eur.id, amountStoreCents: 1000, amountBrlCents: 500, amountBrlCurrency: 'BRL', withdrawnAt: D })).body.data;
    const okD = (await post(app, '/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 1000, amountBrlCents: 500, amountBrlCurrency: 'BRL', depositedAt: D })).body.data;
    expect((await patch(app, `/api/withdrawals/${okW.id}`, { amountBrlCurrency })).status).toBe(400);
    expect((await patch(app, `/api/deposits/${okD.id}`, { amountBrlCurrency })).status).toBe(400);
    expect(rowsOf('withdrawals').pop().amount_brl_currency).toBe('BRL');
  });

  test('amountBrlCurrency sem amountBrlCents: nunca 500', async () => {
    const eur = (await post(app, '/api/stores', storeBody('EUR', { name: 'Loja E' }))).body.data;
    for (const amountBrlCurrency of ['XXX', null, 'JPY']) {
      const res = await post(app, '/api/withdrawals', { storeId: eur.id, amountStoreCents: 1000, amountBrlCurrency, withdrawnAt: D });
      expect(res.status).toBeLessThan(500);
    }
  });

  test('editar só o valor informativo mantém a moeda gravada; trocar a moeda exige respeitar a unidade', async () => {
    const eur = (await post(app, '/api/stores', storeBody('EUR', { name: 'Loja E' }))).body.data;
    await patchSettings(app, { displayCurrency: 'GBP' });
    const w = (await post(app, '/api/withdrawals', { storeId: eur.id, amountStoreCents: 1000, amountBrlCents: 500, withdrawnAt: D })).body.data;
    expect(w.amountBrlCurrency).toBe('GBP');
    await patchSettings(app, { displayCurrency: 'JPY' });
    const edited = await patch(app, `/api/withdrawals/${w.id}`, { amountBrlCents: 777 });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ amountBrlCents: 777, amountBrlCurrency: 'GBP' });
    expectError(await patch(app, `/api/withdrawals/${w.id}`, { amountBrlCurrency: 'JPY' }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'amountBrlCents' });
  });
});

describe('cobertura das 17 moedas', () => {
  test('a lista tem 17 moedas e as de zero casas são JPY, KRW e CLP', () => {
    expect(CURRENCIES).toHaveLength(17);
    expect([...ZERO_DECIMAL_CURRENCIES].sort()).toEqual(['CLP', 'JPY', 'KRW']);
  });
});
