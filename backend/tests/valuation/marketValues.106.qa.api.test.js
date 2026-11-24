'use strict';

// 10.6 (D365, QA): B2 e B3 pela API (motivo do NO_PRICE e netUnits no resumo, nas unidades e nos grupos) e a invariante de que o lucro
// real não muda com os novos campos. Banco em memória, relógio e fetchFn injetados (nenhuma rede real), dados INVENTADOS.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, CAT } = require('../helpers/catalog');
const { purchaseBody, storeId } = require('../helpers/apiFixtures');
const { KEY } = require('../helpers/csfloatFixtures');
const { routedListings } = require('../helpers/listingFixtures');
const marketValueService = require('../../src/services/valuation/marketValueService');
const importService = require('../../src/services/imports/importService');

jest.setTimeout(60000);

const JSON_TYPE = 'application/json';
const NOW = new Date('2026-11-24T12:00:00.000Z');
const PRICES = { 'AK-47 | Redline (Field-Tested)': 1000, '★ Karambit | Doppler (Factory New)': 89000 };

let app;
let currentFetch;
beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  marketValueService.resetAttemptForTests();
  importService.resetAutoForTests();
  currentFetch = routedListings(PRICES);
  app = createApp({ now: () => new Date(NOW), fetchFn: (...args) => currentFetch(...args), sleepFn: jest.fn(async () => {}) });
  await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY }).expect(200);
});
afterAll(() => closeDb());

const refresh = () => request(app).post('/api/market-values/refresh').set('Content-Type', JSON_TYPE).send({});
const get = async (url) => {
  const res = await request(app).get(url);
  expect(res.status).toBe(200);
  return res.body.data;
};
const create = async (body) => {
  const res = await request(app).post('/api/items').set('Content-Type', JSON_TYPE).send(body);
  expect(res.status).toBe(201);
  return res.body.data;
};
const ak = (extra = {}) => create(purchaseBody({ exterior: 'FT', purchasePriceCents: 600, ...extra }));
const setIntegrationStore = (id) => request(app).patch('/api/integrations/csfloat').set('Content-Type', JSON_TYPE).send({ storeId: id });

describe('B2 pela API: motivo do NO_PRICE', () => {
  test('antes de buscar: NOT_FETCHED; item sem anúncio na fonte: NOT_FOUND; arma sem desgaste: NO_EXTERIOR; nenhum com valor', async () => {
    const a = await ak();
    const awp = await create(purchaseBody({ catalogId: CAT.AWP_DLORE, exterior: 'FN', purchasePriceCents: 4000 }));
    const noExterior = await create(purchaseBody({ catalogId: CAT.AWP_DLORE, exterior: null, purchasePriceCents: 100 }));
    expect((await get(`/api/items/${a.id}`)).marketValue).toMatchObject({ status: 'NO_PRICE', reason: 'NOT_FETCHED' });
    await refresh();
    expect((await get(`/api/items/${a.id}`)).marketValue).toMatchObject({ status: 'OK', reason: null, marketValueUsdCents: 1000 });
    expect((await get(`/api/items/${awp.id}`)).marketValue).toMatchObject({ status: 'NO_PRICE', reason: 'NOT_FOUND', marketValueUsdCents: null });
    expect((await get(`/api/items/${noExterior.id}`)).marketValue).toMatchObject({ status: 'NOT_PRICEABLE', reason: 'NO_EXTERIOR' });
    const s = await get('/api/market-values/summary');
    expect(s.totals).toMatchObject({ pricedUnits: 1, unpricedUnits: 1, notPriceableUnits: 1, unitCount: 3 });
  });
});

describe('B3 pela API: netUnits', () => {
  test('com a loja da integração: netUnits = unidades com valor e custo; sem a loja: 0, líquido 0 e motivo NO_INTEGRATION_STORE', async () => {
    await ak();
    await ak({ purchasePriceCents: 700 });
    await create(purchaseBody({ catalogId: CAT.AWP_DLORE, exterior: 'FN', purchasePriceCents: 4000 })); // sem preço
    await refresh();
    // salvar a chave já liga a loja CSFloat (taxa de 2%): 1000 - 20 = 980 de líquido por unidade
    const withStore = await get('/api/market-values/summary');
    expect(withStore.totals).toMatchObject({ pricedUnits: 2, netUnits: 2, unrealizedNetUsdCents: (980 - 600) + (980 - 700) });
    expect(withStore.byState.forSale.netUnits + withStore.byState.holding.netUnits).toBe(withStore.totals.netUnits);
    const groupWith = (await get('/api/items/groups')).groups.find((g) => g.marketValue.pricedUnits === 2);
    expect(groupWith.marketValue.netUnits).toBe(2);

    const patch = await setIntegrationStore(null);
    expect(patch.status).toBe(200);
    const none = await get('/api/market-values/summary');
    expect(none.totals).toMatchObject({ pricedUnits: 2, netUnits: 0, unrealizedNetUsdCents: 0 });
    const group = (await get('/api/items/groups')).groups.find((g) => g.marketValue.pricedUnits === 2);
    expect(group.marketValue).toMatchObject({ netUnits: 0, unrealizedNetUsdCents: 0 });
    expect(group.units.every((u) => u.marketValue.netUnavailableReason === 'NO_INTEGRATION_STORE' && u.marketValue.unrealizedNetUsdCents === null)).toBe(true);
  });
});

describe('invariante: o lucro real não muda com B1, B2 e B3', () => {
  test('profit/summary idêntico antes e depois da rodada e de escolher a loja da integração', async () => {
    await request(app).post('/api/deposits').set('Content-Type', JSON_TYPE).send({ storeId: storeId('CSFloat'), amountStoreCents: 100000, depositedAt: '2026-11-01T12:00:00.000Z' }).expect(201);
    await ak();
    await create(purchaseBody({ catalogId: CAT.AWP_DLORE, exterior: null, purchasePriceCents: 100 }));
    const strip = (data) => JSON.parse(JSON.stringify(data, (key, value) => (key === 'generatedAt' ? undefined : value)));
    const before = strip(await get('/api/profit/summary'));
    await refresh();
    await setIntegrationStore(storeId('CSFloat'));
    expect(strip(await get('/api/profit/summary'))).toEqual(before);
    expect(JSON.stringify(before)).not.toMatch(/marketValue|unrealized|netUnits/i);
  });
});
