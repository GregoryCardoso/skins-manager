'use strict';

// 10.5 (D364, Adendo 1): atualização dos preços ao abrir o app e valor de mercado nas views. Banco em memória, relógio injetado, fetchFn
// falso (nenhum teste chama a rede de verdade) e dados INVENTADOS.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, CAT } = require('../helpers/catalog');
const { purchaseBody, expectError, storeId } = require('../helpers/apiFixtures');
const { KEY, fakeResponse } = require('../helpers/csfloatFixtures');
const { routedListings, LISTING_PII } = require('../helpers/listingFixtures');
const marketValueService = require('../../src/services/valuation/marketValueService');
const valuationLock = require('../../src/services/valuation/valuationLock');
const importLock = require('../../src/services/imports/importLock');
const importService = require('../../src/services/imports/importService');

jest.setTimeout(60000);

const JSON_TYPE = 'application/json';
const NOW = new Date('2026-11-24T12:00:00.000Z');
const MIN = 60000;
const AK_NAME = 'AK-47 | Redline (Field-Tested)';
const KNIFE_NAME = '★ Karambit | Doppler (Factory New)';
const CHARM_NAME = "Charm | Lil' Ava";
const STICKER_NAME = 'Sticker | Titan | Katowice 2014';
const PRICES = { [AK_NAME]: 1000, [KNIFE_NAME]: 89000, [CHARM_NAME]: 250, [STICKER_NAME]: 40 };

let app;
let clock;
let currentFetch;
let sleepFn;
beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  marketValueService.resetAttemptForTests();
  importService.resetAutoForTests();
  clock = new Date(NOW);
  sleepFn = jest.fn(async () => {});
  currentFetch = routedListings(PRICES);
  app = createApp({ now: () => new Date(clock.getTime()), fetchFn: (...args) => currentFetch(...args), sleepFn });
  await saveKey();
});
afterAll(() => closeDb());

const saveKey = () => request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY }).expect(200);
const refresh = (body = {}) => request(app).post('/api/market-values/refresh').set('Content-Type', JSON_TYPE).send(body);
const summary = async () => (await request(app).get('/api/market-values/summary')).body.data;
const get = async (url) => (await request(app).get(url)).body.data;
const create = async (body) => {
  const res = await request(app).post('/api/items').set('Content-Type', JSON_TYPE).send(body);
  expect(res.status).toBe(201);
  return res.body.data;
};
const ak = (extra = {}) => create(purchaseBody({ exterior: 'FT', purchasePriceCents: 600, ...extra }));
const knife = (extra = {}) => create(purchaseBody({ catalogId: CAT.KARAMBIT_DOPPLER_P1, exterior: 'FN', purchasePriceCents: 50000, ...extra }));
const cachedKeys = () => getDb().prepare('SELECT price_key FROM market_prices ORDER BY id').all().map((r) => r.price_key);
const names = () => currentFetch.calls.map((c) => c.query.market_hash_name);

describe('rodada ao abrir o app', () => {
  test('sem chave da API: pula em silêncio, sem rede e sem gravar nada', async () => {
    await request(app).delete('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({}).expect(200);
    await ak();
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ skipped: 'NOT_CONFIGURED', result: null, failed: null });
    expect(currentFetch).not.toHaveBeenCalled();
    expect(getDb().prepare('SELECT price_refresh_started_at AS s FROM settings').get().s).toBeNull();
  });

  test('busca por prioridade (estoque, pendurado, sticker), uma chamada por item igual, e grava cada preço', async () => {
    await request(app).put('/api/settings/fx-rate').set('Content-Type', JSON_TYPE).send({ usdBrlRate: 5 });
    const a = await ak({
      components: [
        { kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 0, wear: 0.1 },
        { kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 1 },
        { kind: 'CHARM', catalogId: CAT.CHARM_LIL_AVA, pattern: 7 },
      ],
    });
    await ak({ acquisitionType: 'GANHEI', purchaseStoreId: undefined, purchasePriceCents: undefined }); // mesmo item: a mesma chave
    const k = await knife();
    const res = await refresh();
    expect(res.status).toBe(200);
    const { skipped, result, failed } = res.body.data;
    expect(skipped).toBeNull();
    expect(failed).toBeNull();
    expect(result).toMatchObject({ requested: 4, fetched: 4, updated: 4, notFound: 0, remaining: 0, budgetUsed: 4, stoppedBy: null, notPriceableUnits: 0 });
    expect(names()).toEqual([AK_NAME, KNIFE_NAME, CHARM_NAME, STICKER_NAME]); // itens, pendurado, sticker; a chave repetida só uma vez
    expect(currentFetch.calls.find((c) => c.query.market_hash_name === KNIFE_NAME).query.paint_index).toBe('418');
    expect(cachedKeys()).toEqual([`${AK_NAME}|`, `${KNIFE_NAME}|418`, `${CHARM_NAME}|`, `${STICKER_NAME}|`]);
    expect(result.lastRefreshAt).toBe(NOW.toISOString());

    const view = await get(`/api/items/${a.id}`);
    expect(view.marketValue).toMatchObject({
      status: 'OK', marketValueUsdCents: 1250, costUsdCents: 600, unrealizedUsdCents: 650, isComplete: true, isEstimated: true, isStale: false, basis: 'NAME',
      parts: { baseCents: 1000, hangingCents: 250, stickersInfoCents: 80, patchesInfoCents: 0 },
    });
    expect(view.marketValue.approxBrl).toEqual({ marketValue: 6250, unrealized: 3250, unrealizedNet: expect.any(Number) });
    const kv = (await get(`/api/items/${k.id}`)).marketValue;
    expect(kv).toMatchObject({ marketValueUsdCents: 89000, status: 'OK' });
  });

  test('o anúncio mais barato ser um leilão não muda o valor: vale a referência', async () => {
    currentFetch = routedListings({ [KNIFE_NAME]: { base: 89000, price: 32352, type: 'auction' } });
    const k = await knife();
    await refresh();
    expect((await get(`/api/items/${k.id}`)).marketValue.marketValueUsdCents).toBe(89000);
    expect(JSON.stringify(getDb().prepare('SELECT * FROM market_prices').all())).not.toContain('32352');
  });

  test('uma rodada por execução (ALREADY_RAN); o intervalo de 15 min vem do banco e vale entre reinícios (COOLDOWN)', async () => {
    await ak();
    expect((await refresh()).body.data.result.fetched).toBe(1);
    expect((await refresh()).body.data).toEqual({ skipped: 'ALREADY_RAN', result: null, failed: null });
    marketValueService.resetAttemptForTests(); // "reiniciou o app"
    clock = new Date(NOW.getTime() + 14 * MIN);
    await ak({ catalogId: CAT.AWP_DLORE, exterior: 'FN' });
    currentFetch = routedListings({ [AK_NAME]: 1, 'AWP | Dragon Lore (Factory New)': 5 });
    expect((await refresh()).body.data).toEqual({ skipped: 'COOLDOWN', result: null, failed: null });
    expect(currentFetch).not.toHaveBeenCalled();
    clock = new Date(NOW.getTime() + 15 * MIN);
    marketValueService.resetAttemptForTests();
    const again = (await refresh()).body.data;
    expect(again.skipped).toBeNull();
    expect(again.result).toMatchObject({ requested: 1, fetched: 1 }); // só a nova: o AK está em dia (< 24 h)
    expect(names()).toEqual(['AWP | Dragon Lore (Factory New)']);
  });

  test('tudo em dia: requested 0, sem rede, sem tocar no início do intervalo, status OK gravado', async () => {
    await ak();
    await refresh();
    const started = getDb().prepare('SELECT price_refresh_started_at AS s FROM settings').get().s;
    marketValueService.resetAttemptForTests();
    clock = new Date(NOW.getTime() + 20 * MIN);
    currentFetch = routedListings(PRICES);
    const res = (await refresh()).body.data;
    expect(res.result).toMatchObject({ requested: 0, fetched: 0 });
    expect(currentFetch).not.toHaveBeenCalled();
    const row = getDb().prepare('SELECT * FROM settings').get();
    expect(row.price_refresh_started_at).toBe(started);
    expect(row).toMatchObject({ price_refresh_last_at: clock.toISOString(), price_refresh_last_status: 'OK' });
  });

  test('sem itens em estoque: requested 0 sem rede', async () => {
    expect((await refresh()).body.data.result).toMatchObject({ requested: 0, fetched: 0, stoppedBy: null });
    expect(currentFetch).not.toHaveBeenCalled();
    expect(await get('/api/market-values/summary')).toMatchObject({ totals: { unitCount: 0, pricedUnits: 0 } });
  });

  test('desatualizado depois de 24 h: 24 h + 1 min busca de novo; NOT_FOUND depois de um OK mantém o preço antigo', async () => {
    const a = await ak();
    await refresh();
    marketValueService.resetAttemptForTests();
    clock = new Date(NOW.getTime() + 24 * 60 * MIN - MIN);
    expect((await refresh()).body.data.result.requested).toBe(0);
    marketValueService.resetAttemptForTests();
    clock = new Date(NOW.getTime() + 24 * 60 * MIN + MIN);
    currentFetch = routedListings({}); // a fonte não acha mais o item
    const res = (await refresh()).body.data.result;
    expect(res).toMatchObject({ requested: 1, fetched: 1, updated: 0, notFound: 1 });
    const row = getDb().prepare('SELECT * FROM market_prices').get();
    expect(row).toMatchObject({ status: 'NOT_FOUND', base_price_cents: 1000, priced_at: NOW.toISOString(), fetched_at: clock.toISOString() });
    const view = (await get(`/api/items/${a.id}`)).marketValue;
    expect(view).toMatchObject({ status: 'OK', marketValueUsdCents: 1000, isStale: true });
  });

  test('limite da fonte: para ao chegar na reserva (3), com retryAt, e o resto fica para a próxima abertura', async () => {
    await ak();
    await knife();
    await ak({ catalogId: CAT.AWP_DLORE, exterior: 'FN' });
    await ak({ catalogId: CAT.M4A1S_PRINTSTREAM, exterior: 'MW' });
    await ak({ catalogId: CAT.DEAGLE_DDPAT, exterior: 'BS' });
    const state = { remaining: 5 }; // 5, 4, 3 -> a 3.ª resposta chega na reserva
    currentFetch = routedListings({}, state);
    const res = (await refresh()).body.data;
    expect(res.failed).toBeNull();
    expect(res.result).toMatchObject({ requested: 5, fetched: 3, remaining: 2, stoppedBy: 'IMPORT_RATE_LIMITED', budgetUsed: 3 });
    expect(res.result.retryAt).toBe(new Date(1795557734 * 1000).toISOString());
    expect(getDb().prepare('SELECT price_refresh_last_status AS s FROM settings').get().s).toBe('PARTIAL');
    expect(cachedKeys()).toHaveLength(3);
  });

  test('sem os headers de limite: teto de 50 chaves por rodada', async () => {
    for (let n = 0; n < 52; n += 1) await create({ name: `Item livre ${n}`, category: 'OUTRO', acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' });
    currentFetch = routedListings({}, { remaining: null });
    const res = (await refresh()).body.data.result;
    expect(res).toMatchObject({ requested: 52, fetched: 50, remaining: 2, stoppedBy: 'VALUATION_FALLBACK_LIMIT' });
  });

  test('em série (nunca duas chamadas ao mesmo tempo) e com 1 s entre elas', async () => {
    await ak();
    await knife();
    await ak({ catalogId: CAT.AWP_DLORE, exterior: 'FN' });
    const state = {};
    currentFetch = routedListings(PRICES, state);
    await refresh();
    expect(state.maxActive).toBe(1);
    expect(sleepFn.mock.calls.filter(([ms]) => ms === 1000)).toHaveLength(2);
  });

  test('prazo total: para com VALUATION_DEADLINE e mantém o que gravou', async () => {
    await ak();
    await knife();
    await ak({ catalogId: CAT.AWP_DLORE, exterior: 'FN' });
    let t = 0;
    const nowFn = () => { t += 100000; return t; }; // cada leitura do relógio avança 100 s
    const result = await marketValueService.refreshPrices({ now: clock, fetchFn: routedListings(PRICES), nowFn, sleepFn });
    expect(result.result.stoppedBy).toBe('VALUATION_DEADLINE');
    expect(result.result.fetched).toBeGreaterThanOrEqual(1);
    expect(result.result.remaining).toBeGreaterThan(0);
  });
});

describe('falhas silenciosas', () => {
  test('sem internet na 1.ª chamada: 200 com failed.code, nada gravado no cache, status FAILED, e o lock é liberado', async () => {
    await ak();
    currentFetch = routedListings(PRICES, { failAfter: 0, failStatus: 'network' });
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ skipped: null, failed: { code: 'IMPORT_SOURCE_UNREACHABLE' } });
    expect(cachedKeys()).toEqual([]);
    expect(getDb().prepare('SELECT * FROM settings').get()).toMatchObject({
      price_refresh_last_status: 'FAILED', price_refresh_last_error_code: 'IMPORT_SOURCE_UNREACHABLE', price_refresh_started_at: NOW.toISOString(),
    });
    expect(valuationLock.isValuationInProgress()).toBe(false);
    expect((await summary()).lastRun).toMatchObject({ status: 'FAILED', errorCode: 'IMPORT_SOURCE_UNREACHABLE' });
  });

  test('cai na 3.ª chamada: os 2 preços ficam gravados e o resultado é parcial (failed nulo, stoppedBy com o código)', async () => {
    await ak();
    await knife();
    await ak({ catalogId: CAT.AWP_DLORE, exterior: 'FN' });
    currentFetch = routedListings(PRICES, { failAfter: 2, failStatus: 'network' });
    const res = (await refresh()).body.data;
    expect(res.failed).toBeNull();
    expect(res.result).toMatchObject({ fetched: 2, remaining: 1, stoppedBy: 'IMPORT_SOURCE_UNREACHABLE' });
    expect(cachedKeys()).toHaveLength(2);
    expect(getDb().prepare('SELECT price_refresh_last_status AS s FROM settings').get().s).toBe('PARTIAL');
  });

  test.each([[401, 'CSFLOAT_AUTH_FAILED'], [503, 'IMPORT_SOURCE_UNAVAILABLE']])('HTTP %s na 1.ª chamada -> failed.code %s', async (status, code) => {
    await ak();
    currentFetch = routedListings(PRICES, { failAfter: 0, failStatus: status });
    expect((await refresh()).body.data.failed).toEqual({ code });
  });

  test('429 duas vezes: para sem gravar e devolve IMPORT_RATE_LIMITED', async () => {
    await ak();
    currentFetch = jest.fn(async () => fakeResponse(429, {}, { 'x-ratelimit-reset': String(Math.floor(NOW.getTime() / 1000) + 1) }));
    const res = (await refresh()).body.data;
    expect(res.failed).toEqual({ code: 'IMPORT_RATE_LIMITED' });
    expect(cachedKeys()).toEqual([]);
  });

  test('a fonte ignorou o filtro (nome ou paint_index diferente): IMPORT_SOURCE_FORMAT_CHANGED e nunca grava preço de outro item', async () => {
    await knife();
    currentFetch = jest.fn(async () => fakeResponse(200, { data: [{ reference: { base_price: 5 }, item: { market_hash_name: KNIFE_NAME, paint_index: 419 } }] }));
    expect((await refresh()).body.data.failed).toEqual({ code: 'IMPORT_SOURCE_FORMAT_CHANGED' });
    expect(cachedKeys()).toEqual([]);
  });
});

describe('travas e segurança', () => {
  test('BUSY (atualização, importação) não consome a tentativa: depois de liberar, a rodada roda', async () => {
    await ak();
    const release = valuationLock.acquire();
    expect((await refresh()).body.data).toEqual({ skipped: 'BUSY', result: null, failed: null });
    release();
    const releaseImport = importLock.acquire();
    expect((await refresh()).body.data.skipped).toBe('BUSY');
    releaseImport();
    expect(currentFetch).not.toHaveBeenCalled();
    expect((await refresh()).body.data.result.fetched).toBe(1);
  });

  test('dois pedidos ao mesmo tempo: só um busca; o outro vem como ALREADY_RAN', async () => {
    await ak();
    const [one, two] = await Promise.all([refresh(), refresh()]);
    const skipped = [one.body.data.skipped, two.body.data.skipped];
    expect(skipped.filter((s) => s === null)).toHaveLength(1);
    expect(skipped.filter((s) => s === 'ALREADY_RAN')).toHaveLength(1);
    expect(currentFetch).toHaveBeenCalledTimes(1);
  });

  test('importação manual e conferência com a loja durante a busca recebem VALUATION_IN_PROGRESS; backup fica ocupado', async () => {
    const release = valuationLock.acquire();
    try {
      expectError(await request(app).post('/api/imports/csfloat/run').set('Content-Type', JSON_TYPE).send({ cutoffAt: '2026-11-01T00:00:00.000Z' }), 409, 'VALUATION_IN_PROGRESS');
      expectError(await request(app).get('/api/integrations/csfloat/balance-check/explain'), 409, 'VALUATION_IN_PROGRESS');
      expect(require('../../src/services/backupService').isBackupBusy()).toBe(true);
    } finally {
      release();
    }
    expect(require('../../src/services/backupService').isBackupBusy()).toBe(false);
  });

  test('corpo com campo (inclusive scope), sem Content-Type JSON ou com Host estranho: recusado', async () => {
    expectError(await refresh({ scope: 'ALL' }), 400, 'UNKNOWN_FIELD');
    expectError(await refresh({ scope: 'STALE' }), 400, 'UNKNOWN_FIELD');
    const noType = await request(app).post('/api/market-values/refresh').set('Content-Type', 'text/plain').send('{}');
    expect(noType.status).toBeGreaterThanOrEqual(400);
    const badHost = await request(app).post('/api/market-values/refresh').set('Host', 'evil.example.com').set('Content-Type', JSON_TYPE).send({});
    expect(badHost.status).toBeGreaterThanOrEqual(400);
    expect(currentFetch).not.toHaveBeenCalled();
  });

  test('a chave nunca aparece em resposta nem no console; o cache não guarda dados do anúncio', async () => {
    const spies = ['log', 'warn', 'error', 'info'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    try {
      await ak();
      currentFetch = routedListings(PRICES, { failAfter: 0, failStatus: 'network' });
      const failed = await refresh();
      marketValueService.resetAttemptForTests();
      getDb().prepare('UPDATE settings SET price_refresh_started_at = NULL').run();
      currentFetch = routedListings(PRICES);
      const ok = await refresh();
      const sum = await request(app).get('/api/market-values/summary');
      const everything = JSON.stringify([failed.body, ok.body, sum.body, spies.map((s) => s.mock.calls)]);
      expect(everything).not.toContain(KEY);
      const dump = JSON.stringify(getDb().prepare('SELECT * FROM market_prices').all());
      for (const marker of Object.values(LISTING_PII)) expect(dump).not.toContain(marker);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  test('as colunas da rodada não aparecem na API de configurações', async () => {
    const body = JSON.stringify(await get('/api/settings'));
    expect(body).not.toMatch(/price_?refresh/i);
    const res = await request(app).patch('/api/settings').set('Content-Type', JSON_TYPE).send({ priceRefreshStartedAt: '2026-01-01T00:00:00.000Z' });
    expect(res.status).toBe(400);
  });
});

describe('resumo e views', () => {
  test('summary: totais, à venda x fora de venda, última rodada, próximo horário permitido e "≈ R$"', async () => {
    await request(app).put('/api/settings/fx-rate').set('Content-Type', JSON_TYPE).send({ usdBrlRate: 5 });
    const a = await ak();
    await knife();
    await ak({ catalogId: CAT.AWP_DLORE, exterior: 'FN' }); // sem preço na fonte -> NOT_FOUND
    await request(app).post(`/api/items/${a.id}/off-sale`).set('Content-Type', JSON_TYPE).send({});
    await refresh();
    const s = await summary();
    expect(s).toMatchObject({
      configured: true, inProgress: false, source: 'CSFLOAT_LISTINGS', staleHours: 24, isEstimated: true, lastRefreshAt: NOW.toISOString(),
      lastRun: { at: NOW.toISOString(), status: 'OK', errorCode: null }, nextAllowedAt: new Date(NOW.getTime() + 15 * MIN).toISOString(), staleKeys: 0,
    });
    expect(s.totals).toMatchObject({ marketValueUsdCents: 90000, costUsdCents: 50600, pricedUnits: 2, unpricedUnits: 1, notPriceableUnits: 0, unitCount: 3 });
    expect(s.byState.holding).toMatchObject({ marketValueUsdCents: 1000, pricedUnits: 1, unitCount: 1 });
    expect(s.byState.forSale).toMatchObject({ marketValueUsdCents: 89000, unitCount: 2, unpricedUnits: 1 });
    expect(s.totals.approxBrl.marketValue).toBe(90000 * 5);
    // mudar a cotação muda só o "≈ R$"
    await request(app).put('/api/settings/fx-rate').set('Content-Type', JSON_TYPE).send({ usdBrlRate: 6 });
    const s2 = await summary();
    expect(s2.totals.marketValueUsdCents).toBe(90000);
    expect(s2.totals.approxBrl.marketValue).toBe(90000 * 6);
    // depois do intervalo, nextAllowedAt volta a nulo
    clock = new Date(NOW.getTime() + 16 * MIN);
    expect((await summary()).nextAllowedAt).toBeNull();
  });

  test('sem preço buscado: marketValue sem valor (NO_PRICE), vendida e consumida nulas; grupos somam o estoque do grupo', async () => {
    const a = await ak();
    const b = await ak({ purchasePriceCents: 700 });
    const sold = await ak({ purchasePriceCents: 500 });
    const sell = await request(app).post(`/api/items/${sold.id}/sell`).set('Content-Type', JSON_TYPE).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 900, soldAt: '2026-11-20T12:00:00.000Z' });
    expect(sell.status).toBe(200);
    expect((await get(`/api/items/${a.id}`)).marketValue).toMatchObject({ status: 'NO_PRICE', marketValueUsdCents: null, costUsdCents: 600 });
    expect((await get(`/api/items/${sold.id}`)).marketValue).toBeNull();
    await refresh();
    const groups = (await get('/api/items/groups')).groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].marketValue).toMatchObject({ pricedUnits: 2, unitCount: 2, marketValueUsdCents: 2000, costUsdCents: 1300, isComplete: true });
    expect(groups[0].units.map((u) => u.marketValue.marketValueUsdCents)).toEqual([1000, 1000]);
    expect((await get('/api/items')).items.find((i) => i.id === sold.id).marketValue).toBeNull();
    expect((await get('/api/items/sales')).items[0].marketValue).toBeNull();
    expect(b.id).toBeGreaterThan(a.id);
  });

  test('arma sem exterior e fase sem índice: unidade fora da avaliação, sem chamada à fonte', async () => {
    const noExterior = await ak({ exterior: undefined });
    const res = (await refresh()).body.data.result;
    expect(res).toMatchObject({ requested: 0, notPriceableUnits: 1 });
    expect(currentFetch).not.toHaveBeenCalled();
    expect((await get(`/api/items/${noExterior.id}`)).marketValue).toMatchObject({ status: 'NOT_PRICEABLE', reason: 'NO_EXTERIOR', marketValueUsdCents: null });
  });

  test('a atualização não muda lucro real, saldos, vendas, estatísticas nem o updated_at dos itens', async () => {
    await request(app).post('/api/deposits').set('Content-Type', JSON_TYPE).send({ storeId: storeId('CSFloat'), amountStoreCents: 100000, depositedAt: '2026-11-01T12:00:00.000Z' });
    const a = await ak();
    await knife();
    const sold = await ak({ purchasePriceCents: 500 });
    await request(app).post(`/api/items/${sold.id}/sell`).set('Content-Type', JSON_TYPE).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 900, soldAt: '2026-11-20T12:00:00.000Z' });
    const snapshot = async () => ({
      profit: await get('/api/profit/summary'),
      balances: await get('/api/store-balances/current'),
      sales: await get('/api/items/sales'),
      stats: await get(`/api/items/stats?category=SKIN&name=${encodeURIComponent('AK-47 | Redline')}`),
      minPrices: (await get(`/api/items/${a.id}`)).minPrices,
      updatedAt: getDb().prepare('SELECT id, updated_at FROM items ORDER BY id').all(),
      batches: getDb().prepare('SELECT COUNT(*) AS n FROM import_batches').get().n,
    });
    const strip = (snap) => JSON.parse(JSON.stringify(snap, (key, value) => (key === 'generatedAt' || key === 'marketValue' ? undefined : value)));
    const before = strip(await snapshot());
    await refresh();
    expect(cachedKeys().length).toBeGreaterThan(0);
    expect(strip(await snapshot())).toEqual(before);
  });
});
