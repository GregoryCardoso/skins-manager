'use strict';

// 11.4 (D369, Adendo 1, A3 a A5): lojas nas 17 moedas, unidade mínima (JPY, KRW e CLP), STORE_CURRENCY_LOCKED, a loja Steam na moeda
// do usuário (FOLLOW, KEEP e NEW_STORE, atômico) e o lucro real com lojas em EUR e JPY. Bancos em memória; sem rede.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, expectError, NOW, storeId, purchaseBody, createItemViaApi } = require('../helpers/apiFixtures');
const { CURRENCIES } = require('../../src/config/constants');
const settingsService = require('../../src/services/settingsService');
const Setting = require('../../src/models/Setting');
const FxRate = require('../../src/models/FxRate');
const { findMinSalePriceCents } = require('../../src/services/pricingService');
const { computeSaleFee } = require('../../src/services/fees');

afterAll(() => closeDb());

const JSON_TYPE = 'application/json';
const post = (app, url, body) => request(app).post(url).set('Content-Type', JSON_TYPE).send(body);
const patchStore = (app, id, body) => request(app).patch(`/api/stores/${id}`).set('Content-Type', JSON_TYPE).send(body);
const patchSettings = (app, body) => request(app).patch('/api/settings').set('Content-Type', JSON_TYPE).send(body);
const getSettings = async (app) => (await request(app).get('/api/settings')).body.data;
const listStores = async (app) => (await request(app).get('/api/stores')).body.data;
const setRate = (currency, rate) => FxRate.upsert(currency, { rate, source: 'MANUAL' }, { now: NOW });

let app;
beforeEach(() => {
  settingsService.resetAutoFxForTests();
  freshDb({ displayCurrency: null }); // instalação nova: USD, Steam em USD
  app = makeCatalogApp(NOW);
});

const storeBody = (currency, extra = {}) => ({
  name: `Loja ${currency}`, currency, saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeeRounding: 'CEIL', allowsWithdrawal: true, ...extra,
});

describe('lojas nas 17 moedas (A3)', () => {
  test.each(CURRENCIES)('cria uma loja em %s', async (currency) => {
    const res = await post(app, '/api/stores', storeBody(currency));
    expect(res.status).toBe(201);
    expect(res.body.data.currency).toBe(currency);
  });

  test('moeda fora da lista ou em formato errado -> INVALID_CURRENCY', async () => {
    for (const bad of ['XXX', 'eur', 'EURO', 'US']) {
      expectError(await post(app, '/api/stores', storeBody(bad)), 400, 'INVALID_CURRENCY', { field: 'currency' });
    }
  });

  test.each(['JPY', 'KRW', 'CLP'])('%s: taxa mínima, taxa fixa e taxa de saque fixa precisam ser múltiplos de 100 centavos', async (currency) => {
    for (const field of ['saleMinFeeCents', 'saleFixedFeeCents', 'withdrawalFixedFeeCents']) {
      const res = await post(app, '/api/stores', storeBody(currency, { [field]: 150 }));
      expectError(res, 400, 'AMOUNT_PRECISION_INVALID', { field });
      expect(res.body.error.params).toEqual({ currency, unitCents: 100 });
    }
    const ok = await post(app, '/api/stores', storeBody(currency, { saleMinFeeCents: 100, saleFixedFeeCents: 200, withdrawalFixedFeeCents: 300 }));
    expect(ok.status).toBe(201);
  });

  test('em moedas com centavos, a taxa fixa de 150 centavos continua valendo', async () => {
    expect((await post(app, '/api/stores', storeBody('EUR', { saleFixedFeeCents: 150 }))).status).toBe(201);
  });

  test('moeda de loja SEM lançamentos pode mudar; COM lançamentos -> STORE_CURRENCY_LOCKED', async () => {
    const created = (await post(app, '/api/stores', storeBody('EUR', { name: 'Minha' }))).body.data;
    expect((await patchStore(app, created.id, { currency: 'GBP' })).body.data.currency).toBe('GBP');
    // JPY com taxa fixa fora da unidade é recusado na troca
    await patchStore(app, created.id, { saleFixedFeeCents: 150 });
    expectError(await patchStore(app, created.id, { currency: 'JPY' }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'saleFixedFeeCents' });
    // com um lançamento (item comprado nela) a moeda trava
    setRate('GBP', 0.8);
    await createItemViaApi(app, purchaseBody({ purchaseStoreId: created.id, purchasePriceCents: 1000 }));
    expectError(await patchStore(app, created.id, { currency: 'EUR' }), 409, 'STORE_CURRENCY_LOCKED', { field: 'currency' });
    expect((await patchStore(app, created.id, { currency: 'GBP', name: 'Renomeada' })).status).toBe(200); // mesma moeda passa
  });
});

describe('valores na unidade mínima (JPY, KRW e CLP)', () => {
  let jpy;
  beforeEach(() => {
    setRate('JPY', 150);
    return post(app, '/api/stores', storeBody('JPY', { name: 'Loja JPY', saleHoldDays: 0 })).then((res) => { jpy = res.body.data; });
  });

  test('compra: preço fora da unidade -> AMOUNT_PRECISION_INVALID; dentro da unidade é aceito', async () => {
    const bad = await post(app, '/api/items', purchaseBody({ purchaseStoreId: jpy.id, purchasePriceCents: 150050 }));
    expectError(bad, 400, 'AMOUNT_PRECISION_INVALID', { field: 'purchasePriceCents' });
    const ok = await post(app, '/api/items', purchaseBody({ purchaseStoreId: jpy.id, purchasePriceCents: 150000 }));
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ purchaseCurrency: 'JPY', fxRateAtPurchase: 150, purchasePriceCents: 150000 });
  });

  test('compra sem cotação da moeda da loja -> FX_RATE_REQUIRED (cotação é a da moeda da loja)', async () => {
    FxRate.upsert('JPY', { rate: null }, { now: NOW });
    getDb().prepare("UPDATE fx_rates SET rate = NULL WHERE currency = 'JPY'").run();
    expectError(await post(app, '/api/items', purchaseBody({ purchaseStoreId: jpy.id, purchasePriceCents: 100000 })), 400, 'FX_RATE_REQUIRED', { field: 'fxRateAtPurchase' });
  });

  test('venda: preço e líquido digitado fora da unidade -> AMOUNT_PRECISION_INVALID; a taxa CEIL arredonda no iene', async () => {
    const item = await createItemViaApi(app, purchaseBody({ purchaseStoreId: jpy.id, purchasePriceCents: 100000 }));
    const sellUrl = `/api/items/${item.id}/sell`;
    const body = { saleStoreId: jpy.id, soldAt: '2026-11-18T12:00:00.000Z' };
    expectError(await post(app, sellUrl, { ...body, salePriceCents: 105050 }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'salePriceCents' });
    expectError(await post(app, sellUrl, { ...body, salePriceCents: 105000, netReceivedCents: 100050 }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'netReceivedCents' });
    // 1.050 ienes, 2% = 21 ienes exatos (2100 centavos); 1.001 ienes dá 20,02 -> 21 ienes (CEIL no iene, não no centavo)
    const quote = await request(app).get(`/api/stores/${jpy.id}/sale-quote?salePriceCents=100100`);
    expect(quote.body.data).toMatchObject({ currency: 'JPY', feeCents: 2100, netReceivedCents: 98000 });
    const res = await post(app, sellUrl, { ...body, salePriceCents: 105000 });
    expect(res.status).toBe(200);
    expect(res.body.data.item).toMatchObject({ saleCurrency: 'JPY', netReceivedCents: 102900 });
  });

  test('sale-quote com preço fora da unidade -> AMOUNT_PRECISION_INVALID', async () => {
    expectError(await request(app).get(`/api/stores/${jpy.id}/sale-quote?salePriceCents=100150`), 400, 'AMOUNT_PRECISION_INVALID', { field: 'salePriceCents' });
  });

  test('saque: valor sacado e taxa paga na unidade; "recebido" informativo na unidade da sua moeda', async () => {
    const w = (extra) => post(app, '/api/withdrawals', { storeId: jpy.id, amountStoreCents: 500000, withdrawnAt: '2026-11-10T12:00:00.000Z', ...extra });
    expectError(await w({ amountStoreCents: 500050 }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'amountStoreCents' });
    expectError(await w({ feeCents: 150 }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'feeCents' });
    expectError(await w({ amountBrlCents: 10050, amountBrlCurrency: 'KRW' }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'amountBrlCents' });
    expectError(await w({ amountBrlCents: 10050, amountBrlCurrency: 'XXX' }), 400, 'INVALID_CURRENCY', { field: 'amountBrlCurrency' });
    const ok = await w({ feeCents: 10000, amountBrlCents: 10050, amountBrlCurrency: 'EUR' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ amountBrlCents: 10050, amountBrlCurrency: 'EUR' });
  });

  test('saque sem moeda informada grava a moeda de conversão do momento; registros antigos ficam em BRL', async () => {
    await patchSettings(app, { displayCurrency: 'EUR' });
    const res = await post(app, '/api/withdrawals', { storeId: jpy.id, amountStoreCents: 500000, amountBrlCents: 3000, withdrawnAt: '2026-11-10T12:00:00.000Z' });
    expect(res.body.data).toMatchObject({ amountBrlCurrency: 'EUR' });
    const withoutAmount = await post(app, '/api/withdrawals', { storeId: jpy.id, amountStoreCents: 500000, withdrawnAt: '2026-11-11T12:00:00.000Z' });
    expect(withoutAmount.body.data).toMatchObject({ amountBrlCents: null, amountBrlCurrency: 'BRL' });
  });

  test('conferência de saldo: valor fora da unidade -> AMOUNT_PRECISION_INVALID', async () => {
    const res = await post(app, '/api/store-balances', { storeId: jpy.id, balanceCents: 12345, recordedAt: '2026-11-10T12:00:00.000Z' });
    expectError(res, 400, 'AMOUNT_PRECISION_INVALID', { field: 'balanceCents' });
    const ok = await post(app, '/api/store-balances', { storeId: jpy.id, balanceCents: 12300, recordedAt: '2026-11-10T12:00:00.000Z' });
    expect(ok.status).toBe(201);
  });
});

describe('arredondamento na unidade mínima (funções puras)', () => {
  const params = (extra = {}) => ({ feeType: 'DEDUCTED', rate: 0.02, rounding: 'CEIL', minFeeCents: null, fixedFeeCents: 0, unitCents: 100, ...extra });

  test('CEIL, ROUND e FLOOR arredondam a taxa para múltiplos da unidade', () => {
    // 1.001 ienes (100100) x 2% = 20,02 ienes
    expect(computeSaleFee(100100, params({ rounding: 'CEIL' }))).toBe(2100);
    expect(computeSaleFee(100100, params({ rounding: 'ROUND' }))).toBe(2000);
    expect(computeSaleFee(100100, params({ rounding: 'FLOOR' }))).toBe(2000);
    // 1.025 ienes x 2% = 20,5 ienes -> ROUND sobe (meio afastando de zero)
    expect(computeSaleFee(102500, params({ rounding: 'ROUND' }))).toBe(2100);
  });

  test('taxa mínima e fixa somam em múltiplos da unidade', () => {
    expect(computeSaleFee(10000, params({ minFeeCents: 500, fixedFeeCents: 100 }))).toBe(600);
  });

  test('o preço mínimo em KRW anda de won em won (nunca em centavo de won)', () => {
    // custo 1.000 won (100000); 2% CEIL: 1.021 won -> taxa 21 -> líquido 1.000
    expect(findMinSalePriceCents(100000, params())).toBe(102100);
    expect(findMinSalePriceCents(100000, params({ unitCents: 1 }))).toBe(102041); // referência com centavos: não é múltiplo de 100
    expect(findMinSalePriceCents(0, params())).toBe(100); // mínimo: uma unidade
  });

  test('ADDED: o valor recebido anda de unidade em unidade e o preço pago é consistente', () => {
    const added = params({ feeType: 'ADDED', rate: 0.15 });
    const price = findMinSalePriceCents(100000, added);
    expect(price % 100).toBe(0);
    expect(price).toBeGreaterThanOrEqual(115000);
  });
});

describe('seed de uma instalação nova', () => {
  test('a Steam nasce em USD e é a loja Steam configurada; CSFloat e CSMoney continuam em USD', async () => {
    const stores = await listStores(app);
    expect(stores.find((s) => s.name === 'Steam')).toMatchObject({ currency: 'USD', isSteamStore: true });
    expect(stores.find((s) => s.name === 'CSFloat').currency).toBe('USD');
    expect(Setting.get().steamStoreId).toBe(storeId('Steam'));
  });
});

describe('steamStore no PATCH /api/settings (A4 e A5)', () => {
  const steamRow = () => getDb().prepare("SELECT id, name, currency, is_active FROM stores WHERE id = ?").get(Setting.get().steamStoreId);
  const addEntry = (id) => getDb().prepare("INSERT INTO withdrawals (store_id, amount_store_cents, amount_brl_cents, withdrawn_at, created_at, updated_at) VALUES (?, 100, 1, '2026-11-01T00:00:00.000Z', 'c', 'u')").run(id);

  test('FOLLOW com a Steam sem lançamentos: ela passa para a moeda nova, junto com a moeda de conversão', async () => {
    const res = await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'FOLLOW' });
    expect(res.status).toBe(200);
    expect(res.body.data.settings.displayCurrency).toBe('EUR');
    expect(res.body.data.steamStore).toEqual({ id: storeId('Steam'), currency: 'EUR', created: false });
    expect(steamRow()).toMatchObject({ currency: 'EUR', is_active: 1 });
  });

  test('FOLLOW em moeda sem casas (JPY): as taxas fixas da Steam seguem a unidade', async () => {
    const res = await patchSettings(app, { displayCurrency: 'JPY', steamStore: 'FOLLOW' });
    expect(res.status).toBe(200);
    expect(steamRow().currency).toBe('JPY');
  });

  test('KEEP (ou ausente) não mexe na Steam', async () => {
    await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'KEEP' });
    await patchSettings(app, { displayCurrency: 'GBP' });
    expect(steamRow().currency).toBe('USD');
  });

  test('FOLLOW com a Steam já na moeda nova: sem erro e sem mudança', async () => {
    const res = await patchSettings(app, { displayCurrency: 'USD', steamStore: 'FOLLOW' });
    expect(res.status).toBe(200);
    expect(res.body.data.steamStore).toEqual({ id: storeId('Steam'), currency: 'USD', created: false });
  });

  test('FOLLOW com a Steam com lançamentos -> STORE_CURRENCY_LOCKED e nada é gravado', async () => {
    addEntry(storeId('Steam'));
    expectError(await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'FOLLOW' }), 409, 'STORE_CURRENCY_LOCKED', { field: 'steamStore' });
    expect((await getSettings(app)).displayCurrency).toBe('USD');
    expect(steamRow().currency).toBe('USD');
  });

  test('NEW_STORE sem lançamentos -> INVALID_FIELD; valor solto -> INVALID_FIELD', async () => {
    expectError(await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' }), 400, 'INVALID_FIELD', { field: 'steamStore' });
    expectError(await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'x' }), 400, 'INVALID_FIELD', { field: 'steamStore' });
    expect((await getSettings(app)).displayCurrency).toBe('USD');
  });

  test('NEW_STORE com a Steam na moeda nova -> INVALID_FIELD', async () => {
    addEntry(storeId('Steam'));
    expectError(await patchSettings(app, { displayCurrency: 'USD', steamStore: 'NEW_STORE' }), 400, 'INVALID_FIELD', { field: 'steamStore' });
  });

  test('NEW_STORE com lançamentos: antiga desativada e renomeada, nova criada, steam_store_id trocado; nada é convertido', async () => {
    const oldId = storeId('Steam');
    getDb().prepare("UPDATE stores SET sale_hold_days = 3, sale_min_fee_cents = 0 WHERE id = ?").run(oldId);
    // uma compra na Steam antiga (USD) e um saque: lançamentos que não podem mudar
    const item = await createItemViaApi(app, purchaseBody({ purchaseStoreId: oldId, purchasePriceCents: 1234 }));
    const itemBefore = getDb().prepare('SELECT * FROM items WHERE id = ?').get(item.id);
    addEntry(oldId);
    const profitBefore = (await request(app).get('/api/profit/summary')).body.data;

    const res = await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' });
    expect(res.status).toBe(200);
    const { steamStore, settings } = res.body.data;
    expect(steamStore).toMatchObject({ currency: 'EUR', created: true, previousStoreId: oldId });
    expect(steamStore.id).not.toBe(oldId);
    expect(settings.displayCurrency).toBe('EUR');

    const stores = await listStores(app);
    const old = stores.find((s) => s.id === oldId);
    const fresh = stores.find((s) => s.id === steamStore.id);
    expect(old).toMatchObject({ name: 'Steam (USD)', currency: 'USD', isActive: false, isSteamStore: false });
    expect(fresh).toMatchObject({
      name: 'Steam', currency: 'EUR', isActive: true, isSteamStore: true, saleFeeType: 'ADDED', saleFeeRate: 0.15, saleFeeRounding: 'CEIL',
      saleHoldDays: 3, allowsWithdrawal: false, inUse: false,
    });
    expect(Setting.get().steamStoreId).toBe(steamStore.id);
    // nenhum valor gravado mudou
    expect(getDb().prepare('SELECT * FROM items WHERE id = ?').get(item.id)).toEqual(itemBefore);
    const profitAfter = (await request(app).get('/api/profit/summary')).body.data;
    expect(profitAfter.realProfitUsdCents).toBe(profitBefore.realProfitUsdCents);
    expect(profitAfter.stockUsdCents).toBe(profitBefore.stockUsdCents);
    expect(profitAfter.platformBalanceUsdCents).toBe(profitBefore.platformBalanceUsdCents);
  });

  test('NEW_STORE: nome "Steam (USD)" já existe -> a antiga ganha um sufixo, sem erro', async () => {
    const oldId = storeId('Steam');
    await post(app, '/api/stores', storeBody('USD', { name: 'Steam (USD)' }));
    addEntry(oldId);
    const res = await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' });
    expect(res.status).toBe(200);
    expect((await listStores(app)).find((s) => s.id === oldId).name).toBe('Steam (USD) 2');
  });

  test('NEW_STORE em JPY converte as taxas fixas para a unidade; sem cotação elas ficam vazias', async () => {
    const oldId = storeId('Steam');
    getDb().prepare('UPDATE stores SET sale_fixed_fee_cents = 50, sale_min_fee_cents = 10 WHERE id = ?').run(oldId);
    addEntry(oldId);
    setRate('JPY', 150);
    const res = await patchSettings(app, { displayCurrency: 'JPY', steamStore: 'NEW_STORE' });
    expect(res.status).toBe(200);
    const fresh = (await listStores(app)).find((s) => s.id === res.body.data.steamStore.id);
    expect(fresh.saleFixedFeeCents % 100).toBe(0);
    expect(fresh.saleMinFeeCents % 100).toBe(0);
    expect(fresh.saleFixedFeeCents).toBe(7500); // 0,50 USD x 150 = 75 ienes
  });

  test('NEW_STORE é atômico: se a criação falha, nada muda (rollback)', async () => {
    const oldId = storeId('Steam');
    addEntry(oldId);
    const storeService = require('../../src/services/storeService');
    const spy = jest.spyOn(storeService, 'cloneSteamStoreInCurrency').mockImplementation(() => {
      // simula a falha depois de a loja antiga já ter sido alterada dentro da transação
      getDb().prepare("UPDATE stores SET name = 'quebrada' WHERE id = ?").run(oldId);
      throw new Error('falha simulada');
    });
    try {
      const res = await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'NEW_STORE' });
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect((await getSettings(app)).displayCurrency).toBe('USD');
    expect(getDb().prepare('SELECT name, is_active FROM stores WHERE id = ?').get(oldId)).toEqual({ name: 'Steam', is_active: 1 });
    expect(Setting.get().steamStoreId).toBe(oldId);
  });

  test('sem loja Steam configurada: preview traz steamStore null; FOLLOW e NEW_STORE -> INVALID_FIELD; KEEP funciona', async () => {
    await request(app).put('/api/settings/steam-store').set('Content-Type', JSON_TYPE).send({ storeId: null });
    expect((await request(app).get('/api/settings/currency-change-preview?currency=EUR')).body.data.steamStore).toBeNull();
    expectError(await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'FOLLOW' }), 400, 'INVALID_FIELD', { field: 'steamStore' });
    const keep = await patchSettings(app, { displayCurrency: 'EUR', steamStore: 'KEEP' });
    expect(keep.status).toBe(200);
    expect(keep.body.data.steamStore).toBeNull();
  });

  test('o preview mostra hasEntries e a moeda da Steam para o modal montar as linhas', async () => {
    addEntry(storeId('Steam'));
    const res = await request(app).get('/api/settings/currency-change-preview?currency=EUR');
    expect(res.body.data.steamStore).toEqual({ id: storeId('Steam'), name: 'Steam', currency: 'USD', hasEntries: true, hasFixedFees: false,
      feesWillReset: false, missingRateCurrency: null });
  });

  test('o preview traz hasFixedFees: true quando a Steam tem taxa fixa, mínima ou de saque fixa', async () => {
    const steamId = storeId('Steam');
    const hasFees = async () => (await request(app).get('/api/settings/currency-change-preview?currency=EUR')).body.data.steamStore.hasFixedFees;
    expect(await hasFees()).toBe(false);
    expect((await patchStore(app, steamId, { saleFixedFeeCents: 50 })).status).toBe(200);
    expect(await hasFees()).toBe(true);
    await patchStore(app, steamId, { saleFixedFeeCents: 0, saleMinFeeCents: 10 });
    expect(await hasFees()).toBe(true);
    await patchStore(app, steamId, { saleMinFeeCents: null, saleFixedFeeCents: 0, withdrawalFixedFeeCents: 0 });
    expect(await hasFees()).toBe(false);
  });
});

describe('lucro real com lojas em EUR e JPY (A3)', () => {
  test('o saldo e o lucro convertem pela cotação da moeda de cada loja, com "estimado"', async () => {
    setRate('EUR', 0.5); // 1 USD = 0,50 EUR
    setRate('JPY', 100); // 1 USD = 100 JPY
    const eur = (await post(app, '/api/stores', storeBody('EUR', { name: 'Loja EUR', saleFeeType: 'DEDUCTED' }))).body.data;
    const jpy = (await post(app, '/api/stores', storeBody('JPY', { name: 'Loja JPY' }))).body.data;
    // saques: 50,00 EUR (= US$ 100,00) e 10.000 ienes (= US$ 100,00)
    await post(app, '/api/withdrawals', { storeId: eur.id, amountStoreCents: 5000, withdrawnAt: '2026-11-10T12:00:00.000Z' });
    await post(app, '/api/withdrawals', { storeId: jpy.id, amountStoreCents: 1000000, withdrawnAt: '2026-11-10T12:00:00.000Z' });
    const res = await request(app).get('/api/profit/summary');
    expect(res.status).toBe(200);
    // sem aportes: saques líquidos US$ 200,00 (100 de cada loja) e saldos de -US$ 200,00 no total: lucro 0
    const data = res.body.data;
    expect(data.withdrawalsNetUsdCents).toBe(20000);
    expect(data.platformBalanceUsdCents).toBe(-20000);
    expect(data.realProfitUsdCents).toBe(0);
    expect(data.estimated).toBe(true);
    const rows = data.balancesByStore.filter((r) => ['Loja EUR', 'Loja JPY'].includes(r.storeName));
    expect(rows.map((r) => r.currency).sort()).toEqual(['EUR', 'JPY']);
    // o saldo disponível calculado das duas lojas é -(valor sacado) em moeda nativa; em USD: -100,00 cada
    expect(rows.map((r) => r.availableUsdCents)).toEqual([-10000, -10000]);
  });

  test('moeda sem cotação: as parcelas dela ficam indisponíveis (nulas), sem derrubar a resposta', async () => {
    const eur = (await post(app, '/api/stores', storeBody('EUR', { name: 'Loja EUR' }))).body.data;
    await post(app, '/api/withdrawals', { storeId: eur.id, amountStoreCents: 5000, withdrawnAt: '2026-11-10T12:00:00.000Z' });
    const res = await request(app).get('/api/profit/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.realProfitUsdCents).toBeNull();
  });

  test('item comprado em loja EUR: grava a cotação da moeda da loja e o preço mínimo anda em centavos de euro', async () => {
    setRate('EUR', 0.5);
    const eur = (await post(app, '/api/stores', storeBody('EUR', { name: 'Loja EUR' }))).body.data;
    const item = await createItemViaApi(app, purchaseBody({ purchaseStoreId: eur.id, purchasePriceCents: 1000 }));
    expect(item).toMatchObject({ purchaseCurrency: 'EUR', fxRateAtPurchase: 0.5 });
    const minForEur = item.minPrices.find((m) => m.storeName === 'Loja EUR');
    expect(minForEur.minPriceCents).toBeGreaterThanOrEqual(1000);
    const minForCsfloat = item.minPrices.find((m) => m.storeName === 'CSFloat');
    expect(minForCsfloat.currency).toBe('USD');
    expect(minForCsfloat.minPriceCents).toBeGreaterThanOrEqual(2000); // 10,00 EUR = US$ 20,00 antes da taxa
  });
});
