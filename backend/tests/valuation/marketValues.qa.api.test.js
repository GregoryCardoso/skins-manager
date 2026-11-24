'use strict';

// 10.5 (D364, Adendo 1): complementos de QA da API: intervalo e travas, orçamento, falhas, valor da unidade (trade lock, custo efetivo,
// abertura, BRL) e invariantes. Banco em memória, relógio e fetchFn injetados (nenhuma rede real), dados INVENTADOS.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, CAT } = require('../helpers/catalog');
const { purchaseBody, expectError, storeId } = require('../helpers/apiFixtures');
const {
  KEY, fakeResponse, meBody, fakeTrade, purchaseTx, routedFetch,
} = require('../helpers/csfloatFixtures');
const { routedListings } = require('../helpers/listingFixtures');
const CatalogItem = require('../../src/models/CatalogItem');
const { normalizeSearchText } = require('../../src/services/catalog/csgoApiAdapter');
const marketValueService = require('../../src/services/valuation/marketValueService');
const valuationLock = require('../../src/services/valuation/valuationLock');
const importService = require('../../src/services/imports/importService');
const backupService = require('../../src/services/backupService');

jest.setTimeout(60000);

const JSON_TYPE = 'application/json';
const NOW = new Date('2026-11-24T12:00:00.000Z');
const MIN = 60000;
const AK_NAME = 'AK-47 | Redline (Field-Tested)';
const STICKER_NAME = 'Sticker | Titan | Katowice 2014';
const PRICES = { [AK_NAME]: 1000, [STICKER_NAME]: 40, '★ Karambit | Doppler (Factory New)': 89000, 'AWP | Dragon Lore (Factory New)': 5000 };

let app;
let clock;
let currentFetch;
let sleepFn;
let consoleSpies;
beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  marketValueService.resetAttemptForTests();
  importService.resetAutoForTests();
  clock = new Date(NOW);
  sleepFn = jest.fn(async () => {});
  currentFetch = routedListings(PRICES);
  app = createApp({ now: () => new Date(clock.getTime()), fetchFn: (...args) => currentFetch(...args), sleepFn });
  consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
  await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY }).expect(200);
});
afterEach(() => {
  const output = JSON.stringify(consoleSpies.flatMap((s) => s.mock.calls));
  consoleSpies.forEach((s) => s.mockRestore());
  expect(output).not.toContain(KEY);
});
afterAll(() => closeDb());

const refresh = (body = {}) => request(app).post('/api/market-values/refresh').set('Content-Type', JSON_TYPE).send(body);
const restart = () => marketValueService.resetAttemptForTests();
const get = async (url) => {
  const res = await request(app).get(url);
  expect(res.status).toBe(200);
  return res.body.data;
};
const post = (url, body = {}) => request(app).post(url).set('Content-Type', JSON_TYPE).send(body);
const create = async (body) => {
  const res = await post('/api/items', body);
  expect(res.status).toBe(201);
  return res.body.data;
};
const ak = (extra = {}) => create(purchaseBody({ exterior: 'FT', purchasePriceCents: 600, ...extra }));
const settingsRow = () => getDb().prepare('SELECT * FROM settings').get();
const cachedKeys = () => getDb().prepare('SELECT price_key FROM market_prices ORDER BY id').all().map((r) => r.price_key);

describe('intervalo de 15 min e tentativa por processo', () => {
  test('14 min 59 s depois -> COOLDOWN (sem rede); a rodada que falhou na 1.ª chamada consome o intervalo', async () => {
    await ak();
    currentFetch = routedListings(PRICES, { failAfter: 0, failStatus: 'network' });
    expect((await refresh()).body.data.failed).toEqual({ code: 'IMPORT_SOURCE_UNREACHABLE' });
    restart();
    clock = new Date(NOW.getTime() + 14 * MIN + 59000);
    currentFetch = routedListings(PRICES);
    expect((await refresh()).body.data).toEqual({ skipped: 'COOLDOWN', result: null, failed: null });
    expect(currentFetch).not.toHaveBeenCalled();
    expect((await get('/api/market-values/summary')).nextAllowedAt).toBe(new Date(NOW.getTime() + 15 * MIN).toISOString());
    clock = new Date(NOW.getTime() + 15 * MIN);
    const res = (await refresh()).body.data;
    expect(res).toMatchObject({ skipped: null, failed: null, result: { fetched: 1 } });
  });

  test('COOLDOWN não consome a tentativa do processo nem grava nada novo; o início do intervalo não anda', async () => {
    await ak();
    await refresh();
    const started = settingsRow().price_refresh_started_at;
    restart();
    clock = new Date(NOW.getTime() + 5 * MIN);
    expect((await refresh()).body.data.skipped).toBe('COOLDOWN');
    expect(settingsRow()).toMatchObject({ price_refresh_started_at: started, price_refresh_last_at: NOW.toISOString() });
    clock = new Date(NOW.getTime() + 20 * MIN); // sem reiniciar de novo: a tentativa não foi consumida pelo COOLDOWN
    expect((await refresh()).body.data.skipped).toBeNull();
  });

  test('a ordem das recusas: ALREADY_RAN vence NOT_CONFIGURED e BUSY', async () => {
    await ak();
    await refresh();
    await request(app).delete('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({}).expect(200);
    const release = valuationLock.acquire();
    try {
      expect((await refresh()).body.data.skipped).toBe('ALREADY_RAN');
    } finally {
      release();
    }
  });

  test('NOT_CONFIGURED não consome a tentativa: ao salvar a chave, a mesma execução roda', async () => {
    await ak();
    await request(app).delete('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({}).expect(200);
    expect((await refresh()).body.data.skipped).toBe('NOT_CONFIGURED');
    await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY }).expect(200);
    expect((await refresh()).body.data.result.fetched).toBe(1);
  });

  test('exportação de backup em andamento -> BUSY sem rede e sem consumir a tentativa', async () => {
    await ak();
    const spy = jest.spyOn(backupService, 'isExportInProgress').mockReturnValue(true);
    try {
      expect((await refresh()).body.data).toEqual({ skipped: 'BUSY', result: null, failed: null });
      expect(currentFetch).not.toHaveBeenCalled();
      expect(settingsRow().price_refresh_started_at).toBeNull();
    } finally {
      spy.mockRestore();
    }
    expect((await refresh()).body.data.result.fetched).toBe(1);
  });

  test('o início do intervalo é gravado ANTES da 1.ª chamada (rodada interrompida também conta)', async () => {
    await ak();
    let seen = null;
    currentFetch = jest.fn(async (...args) => {
      seen = settingsRow().price_refresh_started_at;
      return routedListings(PRICES)(...args);
    });
    await refresh();
    expect(seen).toBe(NOW.toISOString());
  });

  test('a trava é liberada mesmo se a fonte lançar um erro inesperado (não-UpstreamError)', async () => {
    await ak();
    currentFetch = jest.fn(async () => {
      throw new TypeError('bug inesperado');
    });
    const res = await refresh();
    expect(res.status).toBeGreaterThanOrEqual(200); // pode virar failed ou erro 500; o que importa é soltar a trava
    expect(valuationLock.isValuationInProgress()).toBe(false);
  });
});

describe('orçamento da rodada', () => {
  const freeItems = async (n) => {
    for (let i = 0; i < n; i += 1) await create({ name: `Item livre ${i}`, category: 'OUTRO', acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' });
  };

  test('remaining 10 na 1.ª resposta -> para quando chega a 3 (8 chamadas) e o resto fica para a próxima abertura', async () => {
    await freeItems(20);
    currentFetch = routedListings({}, { remaining: 10 });
    const res = (await refresh()).body.data.result;
    expect(res).toMatchObject({ requested: 20, fetched: 8, remaining: 12, stoppedBy: 'IMPORT_RATE_LIMITED', budgetUsed: 8 });
    expect(currentFetch.mock.calls).toHaveLength(8);
    expect(sleepFn.mock.calls.filter(([ms]) => ms === 1000)).toHaveLength(7);
    expect((await get('/api/market-values/summary')).staleKeys).toBe(12);
  });

  test('a 1.ª chamada sai mesmo com o limite quase esgotado (remaining 2) e a rodada para logo depois', async () => {
    await freeItems(5);
    currentFetch = routedListings({}, { remaining: 2 });
    const res = (await refresh()).body.data.result;
    expect(res).toMatchObject({ fetched: 1, remaining: 4, stoppedBy: 'IMPORT_RATE_LIMITED' });
  });

  test('limite 200 com 300 chaves: cerca de 197 chamadas, depois PARTIAL; sobra para a próxima abertura', async () => {
    const insert = getDb().prepare(
      "INSERT INTO items (name, category, variant, acquisition_type, acquired_at, status, created_at, updated_at) VALUES (?, 'OUTRO', NULL, 'GANHEI', '2026-11-10T12:00:00.000Z', 'EM_ESTOQUE', 'c', 'u')"
    );
    for (let i = 0; i < 300; i += 1) insert.run(`Item em lote ${String(i).padStart(3, '0')}`);
    currentFetch = routedListings({}, { remaining: 199 });
    const res = (await refresh()).body.data.result;
    expect(res.requested).toBe(300);
    expect(res.fetched).toBe(197); // remaining depois da chamada n = 200 - n; para quando <= 3
    expect(res.stoppedBy).toBe('IMPORT_RATE_LIMITED');
    expect(res.remaining).toBe(300 - res.fetched);
    expect(getDb().prepare('SELECT price_refresh_last_status AS s FROM settings').get().s).toBe('PARTIAL');
  });

  test('limite igual ao exato do estoque: com folga, termina OK sem stoppedBy', async () => {
    await freeItems(3);
    currentFetch = routedListings({}, { remaining: 199 });
    const res = (await refresh()).body.data.result;
    expect(res).toMatchObject({ fetched: 3, remaining: 0, stoppedBy: null });
    expect(getDb().prepare('SELECT price_refresh_last_status AS s FROM settings').get().s).toBe('OK');
  });

  test('429 no meio: espera única e para, com os anteriores gravados (PARTIAL, sem failed)', async () => {
    await freeItems(4);
    let n = 0;
    const inner = routedListings({});
    currentFetch = jest.fn(async (...args) => {
      n += 1;
      if (n >= 3) return fakeResponse(429, {}, { 'x-ratelimit-reset': String(Math.floor(NOW.getTime() / 1000) + 1) });
      return inner(...args);
    });
    const res = (await refresh()).body.data;
    expect(res.failed).toBeNull();
    expect(res.result).toMatchObject({ fetched: 2, stoppedBy: 'IMPORT_RATE_LIMITED', remaining: 2 });
    expect(settingsRow()).toMatchObject({ price_refresh_last_status: 'PARTIAL', price_refresh_last_error_code: 'IMPORT_RATE_LIMITED' });
    expect(cachedKeys()).toHaveLength(2);
  });

  test('status FAILED só quando nada foi gravado; PARTIAL por prazo guarda errorCode nulo', async () => {
    await ak();
    await create(purchaseBody({ catalogId: CAT.AWP_DLORE, exterior: 'FN' }));
    let t = 0;
    const nowFn = () => { t += 130000; return t; };
    const out = await marketValueService.refreshPrices({ now: clock, fetchFn: routedListings(PRICES), nowFn, sleepFn });
    expect(out.result.stoppedBy).toBe('VALUATION_DEADLINE');
    expect(settingsRow()).toMatchObject({ price_refresh_last_status: 'PARTIAL', price_refresh_last_error_code: null });
    expect(valuationLock.isValuationInProgress()).toBe(false);
  });

  test('401 no meio (depois de gravar): PARTIAL com o código; sem failed', async () => {
    await ak();
    await create(purchaseBody({ catalogId: CAT.AWP_DLORE, exterior: 'FN' }));
    currentFetch = routedListings(PRICES, { failAfter: 1, failStatus: 401 });
    const res = (await refresh()).body.data;
    expect(res.failed).toBeNull();
    expect(res.result).toMatchObject({ fetched: 1, stoppedBy: 'CSFLOAT_AUTH_FAILED' });
  });

  test('unidades só com itens não avaliáveis: requested 0, sem rede, status OK e início do intervalo intacto', async () => {
    await ak({ exterior: undefined });
    const res = (await refresh()).body.data.result;
    expect(res).toMatchObject({ requested: 0, notPriceableUnits: 1 });
    expect(currentFetch).not.toHaveBeenCalled();
    expect(settingsRow()).toMatchObject({ price_refresh_started_at: null, price_refresh_last_status: 'OK' });
  });

  test('NOT_FOUND sem preço anterior: unidade NO_PRICE e a chave não é buscada de novo dentro de 24 h', async () => {
    const a = await ak();
    currentFetch = routedListings({});
    await refresh();
    expect((await get(`/api/items/${a.id}`)).marketValue).toMatchObject({ status: 'NO_PRICE', marketValueUsdCents: null });
    const row = getDb().prepare('SELECT * FROM market_prices').get();
    expect(row).toMatchObject({ status: 'NOT_FOUND', base_price_cents: null, priced_at: null });
    expect((await get('/api/market-values/summary')).staleKeys).toBe(0);
    expect((await get('/api/market-values/summary')).lastRefreshAt).toBeNull();
  });

  test('o mesmo sticker em armas diferentes = 1 chamada', async () => {
    const comp = [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 0 }];
    await ak({ components: comp });
    await create(purchaseBody({ catalogId: CAT.AWP_DLORE, exterior: 'FN', components: comp }));
    await refresh();
    expect(currentFetch.calls.filter((c) => c.query.market_hash_name === STICKER_NAME)).toHaveLength(1);
  });
});

describe('travas com importação e backup', () => {
  test('a importação automática durante a busca é pulada (BUSY) sem erro e sem chamar a rede de trades', async () => {
    const state = { me: meBody(), trades: [fakeTrade({ id: '1001' })], transactions: [purchaseTx('91001', 1250)] };
    const csfloat = routedFetch(state);
    currentFetch = (url, init) => (String(url).includes('/listings') ? routedListings(PRICES)(url, init) : csfloat(url, init));
    const cutoff = '2026-11-01T00:00:00.000Z';
    expect((await post('/api/imports/csfloat/run', { cutoffAt: cutoff })).status).toBe(200);
    await request(app).patch('/api/integrations/csfloat').set('Content-Type', JSON_TYPE).send({ autoImportOnOpen: true }).expect(200);
    csfloat.calls.length = 0;
    const release = valuationLock.acquire();
    try {
      const res = await post('/api/imports/csfloat/run', { trigger: 'AUTO' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ skipped: 'BUSY' });
      expect(csfloat.calls).toHaveLength(0);
    } finally {
      release();
    }
    // depois de liberar, a automática (não consumida pelo BUSY) roda
    const after = await post('/api/imports/csfloat/run', { trigger: 'AUTO' });
    expect(after.body.data.skipped ?? null).toBeNull();
  });
});

describe('valor da unidade pela API', () => {
  test('item em trade lock entra no valor e em "à venda"; o líquido usa a taxa da loja da integração', async () => {
    const locked = await ak({ tradeUnlockAt: '2026-12-01T12:00:00.000Z' });
    await refresh();
    const view = await get(`/api/items/${locked.id}`);
    expect(view.marketValue).toMatchObject({ status: 'OK', marketValueUsdCents: 1000 });
    const s = await get('/api/market-values/summary');
    expect(s.byState.forSale).toMatchObject({ pricedUnits: 1, marketValueUsdCents: 1000 });
    expect(s.byState.holding).toMatchObject({ pricedUnits: 0, unitCount: 0 });
  });

  test('sticker aplicado do estoque: a arma herda o custo (efetivo 150); o sticker consumido sai do valor e o aplicado vai só em stickersInfoCents', async () => {
    const weapon = await ak({ purchasePriceCents: 100 });
    const sticker = await create(purchaseBody({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 50 }));
    const applied = await post(`/api/items/${weapon.id}/apply-component`, { sourceItemId: sticker.id, appliedAt: '2026-11-15T12:00:00.000Z', slot: 1 });
    expect(applied.status).toBe(201);
    const res = (await refresh()).body.data.result;
    expect(res.requested).toBe(2); // arma e o sticker aplicado; o consumido não conta como unidade
    expect(res.notPriceableUnits).toBe(0);
    const view = await get(`/api/items/${weapon.id}`);
    expect(view.marketValue).toMatchObject({ marketValueUsdCents: 1000, costUsdCents: 150, unrealizedUsdCents: 850, parts: { stickersInfoCents: 40 } });
    expect((await get(`/api/items/${sticker.id}`)).marketValue).toBeNull();
    expect((await get('/api/market-values/summary')).totals).toMatchObject({ unitCount: 1, costUsdCents: 150 });
  });

  test('unidade gerada por abertura de caixa herda caixa + chave e é avaliada pelo nome', async () => {
    const row = (id, name) => ({ id, source: 'CRATES', category: 'CAIXA', name, nameKey: normalizeSearchText(name), searchText: normalizeSearchText(name), minFloat: null, maxFloat: null, hasStattrak: false, hasSouvenir: false });
    CatalogItem.upsertMany([row('crate-kilowatt', 'Kilowatt Case')]);
    const box = await create(purchaseBody({ catalogId: 'crate-kilowatt', purchasePriceCents: 200 }));
    const key = await create(purchaseBody({ category: 'OUTRO', name: 'Kilowatt Case Key', catalogId: undefined, purchasePriceCents: 300 }));
    const opened = await post(`/api/items/${box.id}/open`, { keyItemId: key.id, openedAt: '2026-11-15T12:00:00.000Z', generated: { catalogId: CAT.AK_REDLINE, variant: 'NORMAL', floatValue: 0.15 } });
    expect(opened.status).toBe(201);
    const generatedId = opened.body.data.generated?.id ?? opened.body.data.item?.id ?? opened.body.data.generatedItem?.id;
    expect(generatedId).toBeDefined();
    await refresh();
    const view = await get(`/api/items/${generatedId}`);
    expect(view.marketValue).toMatchObject({ status: 'OK', marketValueUsdCents: 1000, costUsdCents: 500, unrealizedUsdCents: 500 });
    expect((await get(`/api/items/${box.id}`)).marketValue).toBeNull();
  });

  test('compra em BRL (Steam): custo pela cotação gravada, costEstimated true; cotação das configurações só muda o "≈ R$"', async () => {
    const item = await create(purchaseBody({ exterior: 'FT', purchaseStoreId: storeId('Steam'), purchasePriceCents: 500, fxRateAtPurchase: 5 }));
    await refresh();
    const mv = (await get(`/api/items/${item.id}`)).marketValue;
    expect(mv).toMatchObject({ costUsdCents: 100, costEstimated: true, unrealizedUsdCents: 900 });
    await request(app).put('/api/settings/fx-rate').set('Content-Type', JSON_TYPE).send({ usdBrlRate: 7 }).expect(200);
    const mv2 = (await get(`/api/items/${item.id}`)).marketValue;
    expect({ ...mv2, approxBrl: undefined }).toEqual({ ...mv, approxBrl: undefined });
    expect(mv2.approxBrl.marketValue).toBe(7000);
  });

  test('GANHEI: custo 0 e lucro igual ao valor; sem cotação, "≈ R$" é nulo', async () => {
    const won = await create({ catalogId: CAT.AK_REDLINE, exterior: 'FT', acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' });
    await refresh();
    const mv = (await get(`/api/items/${won.id}`)).marketValue;
    expect(mv).toMatchObject({ costUsdCents: 0, unrealizedUsdCents: 1000, costEstimated: false });
    expect(mv.approxBrl).toEqual({ marketValue: null, unrealized: null, unrealizedNet: null });
  });

  test('sem loja da integração: líquido nulo com NO_INTEGRATION_STORE; com a loja sem taxas: FEES_NOT_CONFIGURED', async () => {
    const a = await ak();
    await refresh();
    const withStore = (await get(`/api/items/${a.id}`)).marketValue;
    expect(withStore.netUnavailableReason).toBeNull();
    expect(withStore.unrealizedNetUsdCents).toBe(1000 - 20 - 600);
    getDb().prepare("UPDATE integrations SET store_id = NULL WHERE source = 'CSFLOAT'").run();
    expect((await get(`/api/items/${a.id}`)).marketValue).toMatchObject({ unrealizedNetUsdCents: null, netUnavailableReason: 'NO_INTEGRATION_STORE', unrealizedUsdCents: 400 });
  });

  test('vendida, restaurada (desfazer venda) e fora de venda: vendida -> null; ao desfazer volta a ter valor', async () => {
    const a = await ak();
    await refresh();
    const sold = await post(`/api/items/${a.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 900, soldAt: '2026-11-20T12:00:00.000Z' });
    expect(sold.status).toBe(200);
    expect((await get(`/api/items/${a.id}`)).marketValue).toBeNull();
    expect((await get('/api/market-values/summary')).totals.unitCount).toBe(0);
    expect((await post(`/api/items/${a.id}/unsell`)).status).toBe(200);
    expect((await get(`/api/items/${a.id}`)).marketValue).toMatchObject({ status: 'OK', marketValueUsdCents: 1000 });
  });

  test('sem chave configurada o resumo mostra configured false e os totais do cache que houver', async () => {
    await ak();
    await refresh();
    await request(app).delete('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({}).expect(200);
    const s = await get('/api/market-values/summary');
    expect(s).toMatchObject({ configured: false, totals: { pricedUnits: 1, marketValueUsdCents: 1000 } });
  });

  test('o resumo de GET /summary não grava nada (updated_at e cache intactos) e a filtragem de itens fora de venda continua no holding', async () => {
    const a = await ak();
    await refresh();
    await post(`/api/items/${a.id}/off-sale`);
    const snap = JSON.stringify([getDb().prepare('SELECT * FROM items').all(), getDb().prepare('SELECT * FROM market_prices').all(), settingsRow()]);
    const s = await get('/api/market-values/summary');
    expect(s.byState.holding.pricedUnits).toBe(1);
    expect(s.byState.forSale.unitCount).toBe(0);
    expect(JSON.stringify([getDb().prepare('SELECT * FROM items').all(), getDb().prepare('SELECT * FROM market_prices').all(), settingsRow()])).toBe(snap);
  });
});

describe('invariantes (com e sem preços)', () => {
  test('lucro real, saldos, estatísticas, preço mínimo e vendas idênticos antes e depois; cada leitura devolve 200', async () => {
    await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 100000, depositedAt: '2026-11-01T12:00:00.000Z' }).then((r) => expect(r.status).toBe(201));
    const a = await ak();
    await create(purchaseBody({ catalogId: CAT.AWP_DLORE, exterior: 'FN', purchasePriceCents: 4000 }));
    const sold = await ak({ purchasePriceCents: 500 });
    expect((await post(`/api/items/${sold.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 900, soldAt: '2026-11-20T12:00:00.000Z' })).status).toBe(200);
    const stats = `/api/items/stats?category=SKIN&name=${encodeURIComponent('AK-47 | Redline')}&exterior=FT`;
    const snapshot = async () => ({
      profit: await get('/api/profit/summary'),
      balances: await get('/api/store-balances/current'),
      sales: await get('/api/items/sales'),
      stats: await get(stats),
      deposits: await get('/api/deposits'),
      minPrices: (await get(`/api/items/${a.id}`)).minPrices,
      itemsRows: getDb().prepare('SELECT * FROM items ORDER BY id').all(),
      storesRows: getDb().prepare('SELECT * FROM stores ORDER BY id').all(),
      batches: getDb().prepare('SELECT COUNT(*) AS n FROM import_batches').get().n,
    });
    const strip = (snap) => JSON.parse(JSON.stringify(snap, (key, value) => (key === 'generatedAt' || key === 'marketValue' ? undefined : value)));
    const before = strip(await snapshot());
    expect(before.stats).toBeTruthy();
    expect(before.minPrices).not.toBeNull();
    await refresh();
    expect(cachedKeys().length).toBeGreaterThan(0);
    expect(strip(await snapshot())).toEqual(before);
  });

  test('GET /api/items/stats e /api/items/sales nunca trazem marketValue; o lucro real não menciona valor de mercado', async () => {
    await ak();
    await refresh();
    const stats = JSON.stringify(await get(`/api/items/stats?category=SKIN&name=${encodeURIComponent('AK-47 | Redline')}&exterior=FT`));
    const profit = JSON.stringify(await get('/api/profit/summary'));
    const sales = JSON.stringify(await get('/api/items/sales'));
    for (const text of [stats, profit, sales]) expect(text).not.toMatch(/marketValue|market_value|unrealized/i);
  });

  test('GET /api/settings e as respostas dos PUT/PATCH de configurações não expõem as colunas da rodada', async () => {
    await ak();
    await refresh();
    const bodies = [
      JSON.stringify(await get('/api/settings')),
      JSON.stringify((await request(app).put('/api/settings/fx-rate').set('Content-Type', JSON_TYPE).send({ usdBrlRate: 5 })).body),
      JSON.stringify((await request(app).patch('/api/settings').set('Content-Type', JSON_TYPE).send({ theme: 'dark' })).body),
    ];
    for (const text of bodies) expect(text).not.toMatch(/price_?refresh|priceRefresh/i);
  });
});
