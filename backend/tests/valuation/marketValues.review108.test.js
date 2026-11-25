// 10.8 (QA): M2 em todos os níveis de prioridade, M3 com trava e intervalo, B7 pela API (loja da integração em BRL).
// Banco em memória, relógio e fetchFn injetados; nenhuma rede real; dados inventados.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, CAT } = require('../helpers/catalog');
const { purchaseBody, storeId } = require('../helpers/apiFixtures');
const { KEY, fakeResponse } = require('../helpers/csfloatFixtures');
const { routedListings } = require('../helpers/listingFixtures');
const marketValueService = require('../../src/services/valuation/marketValueService');
const valuationLock = require('../../src/services/valuation/valuationLock');
const importService = require('../../src/services/imports/importService');
const MarketPrice = require('../../src/models/MarketPrice');
const Item = require('../../src/models/Item');

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
let consoleSpy;
beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  marketValueService.resetAttemptForTests();
  importService.resetAutoForTests();
  clock = new Date(NOW);
  currentFetch = routedListings(PRICES);
  app = createApp({ now: () => new Date(clock.getTime()), fetchFn: (...args) => currentFetch(...args), sleepFn: jest.fn(async () => {}) });
  consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY }).expect(200);
});
afterEach(() => consoleSpy.mockRestore());
afterAll(() => closeDb());

const refresh = () => request(app).post('/api/market-values/refresh').set('Content-Type', JSON_TYPE).send({});
const get = async (url) => (await request(app).get(url)).body.data;
const create = async (body) => {
  const res = await request(app).post('/api/items').set('Content-Type', JSON_TYPE).send(body);
  expect(res.status).toBe(201);
  return res.body.data;
};
const rows = () => getDb().prepare('SELECT price_key, status, base_price_cents FROM market_prices ORDER BY id').all();
const rowOf = (prefix) => rows().find((r) => r.price_key.startsWith(prefix));
const settingsRow = () => getDb().prepare('SELECT * FROM settings').get();

// Estoque com uma chave em cada nível: AK (1), chaveiro pendurado (2) e sticker colado (3).
async function stockWithThreeLevels() {
  await create(purchaseBody({
    exterior: 'FT', purchasePriceCents: 600,
    components: [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 0 }, { kind: 'CHARM', catalogId: CAT.CHARM_LIL_AVA, pattern: 7 }],
  }));
}
// A fonte devolve, para o nome pedido, um anúncio de OUTRO item; as demais chaves seguem normais.
function divergingFor(requestedName) {
  const normal = routedListings(PRICES);
  return jest.fn(async (url, init) => {
    const query = Object.fromEntries(new URL(url).searchParams.entries());
    if (query.market_hash_name === requestedName) {
      return fakeResponse(200, { data: [{ reference: { base_price: 7 }, item: { market_hash_name: 'Outro Item (Field-Tested)', paint_index: null } }] });
    }
    return normal(url, init);
  });
}

describe('M2: anúncio de outro item em cada nível de prioridade', () => {
  test.each([
    ['nível 1 (item em estoque)', AK_NAME, 'AK-47'],
    ['nível 2 (chaveiro pendurado)', CHARM_NAME, 'Charm'],
    ['nível 3 (sticker)', STICKER_NAME, 'Sticker'],
  ])('%s: só a chave divergente vira NOT_FOUND e as outras duas são gravadas', async (_label, divergentName, prefix) => {
    await stockWithThreeLevels();
    currentFetch = divergingFor(divergentName);
    const res = (await refresh()).body.data;
    expect(res.failed).toBeNull();
    expect(res.result).toMatchObject({ requested: 3, fetched: 3, updated: 2, notFound: 1, remaining: 0, stoppedBy: null });
    expect(rows()).toHaveLength(3);
    expect(rowOf(prefix)).toMatchObject({ status: 'NOT_FOUND', base_price_cents: null });
    for (const other of rows().filter((r) => !r.price_key.startsWith(prefix))) expect(other).toMatchObject({ status: 'OK' });
    expect(currentFetch.mock.calls).toHaveLength(3); // a rodada continuou até o fim
    expect(valuationLock.isValuationInProgress()).toBe(false);
    expect(settingsRow().price_refresh_last_status).toBe('OK');
  });

  test('paint_index divergente no nível 1 (faca) não impede o AK e o sticker seguintes', async () => {
    await create(purchaseBody({ catalogId: CAT.KARAMBIT_DOPPLER_P1, exterior: 'FN', purchasePriceCents: 50000 }));
    await create(purchaseBody({ exterior: 'FT', purchasePriceCents: 600, components: [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 0 }] }));
    const normal = routedListings(PRICES);
    currentFetch = jest.fn(async (url, init) => {
      const query = Object.fromEntries(new URL(url).searchParams.entries());
      if (query.market_hash_name === KNIFE_NAME) return fakeResponse(200, { data: [{ reference: { base_price: 5 }, item: { market_hash_name: KNIFE_NAME, paint_index: 419 } }] });
      return normal(url, init);
    });
    const res = (await refresh()).body.data;
    expect(res.failed).toBeNull();
    expect(res.result).toMatchObject({ requested: 3, fetched: 3, updated: 2, notFound: 1, stoppedBy: null });
    expect(rowOf('★')).toMatchObject({ status: 'NOT_FOUND', base_price_cents: null });
    expect(rowOf('AK-47')).toMatchObject({ status: 'OK', base_price_cents: 1000 });
    expect(rowOf('Sticker')).toMatchObject({ status: 'OK', base_price_cents: 40 });
  });

  test('a chave divergente nunca vira preço de mercado da unidade (sem valor, motivo de sem preço)', async () => {
    await create(purchaseBody({ exterior: 'FT', purchasePriceCents: 600 }));
    currentFetch = divergingFor(AK_NAME);
    await refresh();
    const items = (await get('/api/items')).items ?? (await get('/api/items'));
    const mv = items[0].marketValue;
    expect(mv.marketValueUsdCents ?? null).toBeNull();
    expect(mv.status).not.toBe('OK');
  });
});

describe('M3: erro interno, trava e intervalo de 15 min', () => {
  test('erro depois de iniciar a rodada: 200, FAILED, trava livre, 2.º POST no mesmo processo = ALREADY_RAN; no próximo processo vale o intervalo', async () => {
    await create(purchaseBody({ exterior: 'FT', purchasePriceCents: 600 }));
    const spy = jest.spyOn(MarketPrice, 'upsertResult').mockImplementation(() => { throw new Error('falha-interna-qa'); });
    try {
      const first = await refresh();
      expect(first.status).toBe(200);
      expect(first.body.data).toEqual({ skipped: null, result: null, failed: { code: 'INTERNAL_ERROR' } });
      expect(valuationLock.isValuationInProgress()).toBe(false);
      expect(settingsRow()).toMatchObject({
        price_refresh_started_at: NOW.toISOString(), price_refresh_last_at: NOW.toISOString(),
        price_refresh_last_status: 'FAILED', price_refresh_last_error_code: 'INTERNAL_ERROR',
      });
      // mesmo processo: nada de nova tentativa, e a rede não é tocada de novo
      const calls = currentFetch.mock.calls.length;
      const again = await refresh();
      expect(again.status).toBe(200);
      expect(again.body.data).toEqual({ skipped: 'ALREADY_RAN', result: null, failed: null });
      expect(currentFetch.mock.calls.length).toBe(calls);
    } finally {
      spy.mockRestore();
    }

    // novo processo 10 min depois: dentro do intervalo, pula sem rede
    marketValueService.resetAttemptForTests();
    clock = new Date(NOW.getTime() + 10 * MIN);
    const before = currentFetch.mock.calls.length;
    expect((await refresh()).body.data).toEqual({ skipped: 'COOLDOWN', result: null, failed: null });
    expect(currentFetch.mock.calls.length).toBe(before);

    // novo processo 16 min depois: o intervalo passou e a rodada roda de verdade
    marketValueService.resetAttemptForTests();
    clock = new Date(NOW.getTime() + 16 * MIN);
    const ok = (await refresh()).body.data;
    expect(ok.failed).toBeNull();
    expect(ok.result).toMatchObject({ requested: 1, fetched: 1, updated: 1 });
    expect(settingsRow()).toMatchObject({ price_refresh_last_status: 'OK', price_refresh_last_error_code: null });
  });

  test('erro antes da trava (leitura do estoque): INTERNAL_ERROR, trava livre, sem início de rodada gravado e sem chamada de rede', async () => {
    await create(purchaseBody({ exterior: 'FT', purchasePriceCents: 600 }));
    const spy = jest.spyOn(Item, 'findAll').mockImplementationOnce(() => { throw new Error('banco-indisponivel-qa'); });
    try {
      const res = await refresh();
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ skipped: null, result: null, failed: { code: 'INTERNAL_ERROR' } });
    } finally {
      spy.mockRestore();
    }
    expect(valuationLock.isValuationInProgress()).toBe(false);
    expect(currentFetch).not.toHaveBeenCalled();
    expect(settingsRow()).toMatchObject({ price_refresh_started_at: null, price_refresh_last_status: 'FAILED', price_refresh_last_error_code: 'INTERNAL_ERROR' });
    // nenhuma rede foi usada, então não há intervalo a cumprir: o próximo processo roda direto
    marketValueService.resetAttemptForTests();
    expect((await refresh()).body.data.result).toMatchObject({ fetched: 1, updated: 1 });
  });

  test('o texto do erro interno não vai para a resposta nem para o estado gravado', async () => {
    await create(purchaseBody({ exterior: 'FT', purchasePriceCents: 600 }));
    const spy = jest.spyOn(MarketPrice, 'upsertResult').mockImplementation(() => { throw new Error('SEGREDO-QA-123'); });
    try {
      const res = await refresh();
      expect(JSON.stringify(res.body)).not.toContain('SEGREDO-QA-123');
      expect(JSON.stringify(settingsRow())).not.toContain('SEGREDO-QA-123');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('B7: loja da integração em BRL pela API', () => {
  test('valor de mercado em US$: líquido nulo com NET_NOT_COMPUTABLE, bruto mantido e totais sem unidade com líquido', async () => {
    const a = await create(purchaseBody({ exterior: 'FT', purchasePriceCents: 600 }));
    await refresh();
    const usd = (await get(`/api/items/${a.id}`)).marketValue;
    expect(usd).toMatchObject({ netUnavailableReason: null, unrealizedUsdCents: 400 });
    expect(usd.unrealizedNetUsdCents).not.toBeNull();

    getDb().prepare("UPDATE integrations SET store_id = ? WHERE source = 'CSFLOAT'").run(storeId('Steam'));
    const brl = (await get(`/api/items/${a.id}`)).marketValue;
    expect(brl).toMatchObject({ unrealizedNetUsdCents: null, netUnavailableReason: 'NET_NOT_COMPUTABLE', unrealizedUsdCents: 400, marketValueUsdCents: 1000 });
    const totals = (await get('/api/market-values/summary')).totals;
    expect(totals).toMatchObject({ unrealizedUsdCents: 400, marketValueUsdCents: 1000 });
    expect(totals.netUnits).toBe(0);
    expect(totals.pricedUnits).toBe(1); // o frontend decide por netUnits === 0 ("indisponível"), não pelo valor do total
  });
});
