// Lacunas da D56/D62 para /api/settings (testador, revisão independente da Etapa 3).
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture } = require('../helpers/catalog');
const { makeApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const put = (body, theApp = app) => request(theApp).put('/api/settings/fx-rate').send(body);
const getSettings = async () => (await request(app).get('/api/settings')).body;

describe('PUT /api/settings/fx-rate (lacunas)', () => {
  test('GET no formato padrão; updatedAt inicial é ISO', async () => {
    const body = await getSettings();
    expect(Object.keys(body).sort()).toEqual(['data', 'success']);
    expect(Object.keys(body.data).sort()).toEqual(['agingThresholdsAdjusted', 'catalogUpdatedAt', 'displayCurrency', 'fastTurnoverDays', 'fastTurnoverDaysCustom', 'fastTurnoverDaysDefault', 'fxManualRateBounds', 'fxRates', 'fxRefreshSource', 'inventoryDensity', 'inventoryView', 'language', 'rateQuotedAt', 'requiredFxCurrencies', 'slowItemDays', 'slowItemDaysCustom', 'slowItemDaysDefault', 'steamStoreId', 'theme', 'updatedAt', 'usdBrlRate', 'usdBrlRateSource', 'usdBrlRateUpdatedAt']);
    expect(new Date(body.data.updatedAt).toISOString()).toBe(body.data.updatedAt);
  });

  test('sem corpo ou corpo texto -> INVALID_BODY', async () => {
    expectError(await request(app).put('/api/settings/fx-rate').set('Content-Type', 'application/json'), 400, 'REQUIRED_FIELD');
    expectError(await request(app).put('/api/settings/fx-rate').set('Content-Type', 'text/plain').send('5.25'), 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  test('-0 -> INVALID_FX_RATE com a mensagem da D62', async () => {
    const res = await put({ usdBrlRate: -0 });
    expectError(res, 400, 'INVALID_FX_RATE');
    expect(res.body.error.message).toBe('Cotação USD→BRL inválida: informe um número maior que zero.');
  });

  test('valores positivos sem limite de casas são aceitos dentro da faixa manual do BRL (0,5 a 100)', async () => {
    expect((await put({ usdBrlRate: 0.5 })).body.data.usdBrlRate).toBe(0.5);
    expect((await put({ usdBrlRate: 5.123456789 })).body.data.usdBrlRate).toBe(5.123456789);
    expect((await put({ usdBrlRate: 100 })).body.data.usdBrlRate).toBe(100);
  });

  test('valores fora da faixa manual do BRL -> FX_RATE_OUT_OF_RANGE (0,0001 e 1e6 deixaram de valer)', async () => {
    for (const v of [0.0001, 0.49, 100.01, 1e6]) {
      const res = await put({ usdBrlRate: v });
      expectError(res, 400, 'FX_RATE_OUT_OF_RANGE');
      expect(res.body.error.params).toEqual({ currency: 'BRL', min: 0.5, max: 100 });
    }
  });

  test('string vazia, objeto e array -> INVALID_FIELD', async () => {
    for (const v of ['', {}, [5]]) expectError(await put({ usdBrlRate: v }), 400, 'INVALID_FIELD');
  });

  test('PUT inválido não altera a cotação nem os timestamps', async () => {
    await put({ usdBrlRate: 5 });
    const before = (await getSettings()).data;
    const later = makeApp(new Date('2026-11-20T10:00:00.000Z'));
    expectError(await put({ usdBrlRate: 0 }, later), 400, 'INVALID_FX_RATE');
    expectError(await put({ usdBrlRate: null }, later), 400, 'INVALID_FIELD');
    expect((await getSettings()).data).toEqual(before);
  });

  test('novo PUT em outro instante atualiza usdBrlRateUpdatedAt e updatedAt', async () => {
    await put({ usdBrlRate: 5 });
    const later = makeApp(new Date('2026-11-20T10:00:00.000Z'));
    const res = await put({ usdBrlRate: 5.5 }, later);
    expect(res.body).toEqual({
      success: true,
      data: {
        usdBrlRate: 5.5, usdBrlRateUpdatedAt: '2026-11-20T10:00:00.000Z', catalogUpdatedAt: null,
        theme: 'SYSTEM', language: 'en', inventoryView: 'GROUPED', inventoryDensity: 'COMPACT', usdBrlRateSource: 'MANUAL',
        agingThresholdsAdjusted: false, fastTurnoverDays: 7, fastTurnoverDaysCustom: null, fastTurnoverDaysDefault: 7,
      slowItemDays: 21, slowItemDaysCustom: null, slowItemDaysDefault: 21, steamStoreId: expect.any(Number), rateQuotedAt: null, fxRefreshSource: 'AWESOMEAPI', displayCurrency: 'BRL', fxManualRateBounds: expect.any(Object), fxRates: expect.any(Array), requiredFxCurrencies: expect.any(Array), updatedAt: '2026-11-20T10:00:00.000Z',
      },
    });
  });

  test('outras rotas de configurações não existem', async () => {
    expectError(await request(app).get('/api/settings/fx-rate'), 404, 'NOT_FOUND');
    // PATCH /api/settings existe desde a Etapa 4A (D83), mas só aceita theme e language.
    expectError(await request(app).patch('/api/settings').send({ usdBrlRate: 5 }), 400, 'UNKNOWN_FIELD');
    expectError(await request(app).patch('/api/settings/fx-rate').send({ usdBrlRate: 5 }), 404, 'NOT_FOUND');
    expectError(await request(app).post('/api/settings/fx-rate').send({ usdBrlRate: 5 }), 404, 'NOT_FOUND');
  });
});

describe('integração settings <-> itens (lacunas)', () => {
  beforeEach(() => importCatalogFixture());

  test('meta.usdBrlRate da listagem reflete a cotação salva', async () => {
    expect((await request(app).get('/api/items')).body.data.meta.usdBrlRate).toBeNull();
    await put({ usdBrlRate: 5.25 });
    expect((await request(app).get('/api/items')).body.data.meta.usdBrlRate).toBe(5.25);
  });

  test('cotação informada na compra vence a salva', async () => {
    await put({ usdBrlRate: 5 });
    const item = await createItemViaApi(app, purchaseBody({ purchaseStoreId: storeId('Steam'), fxRateAtPurchase: 6 }));
    expect(item.fxRateAtPurchase).toBe(6);
  });

  test('preço mínimo Steam de item USD acompanha a cotação atual; o fxRateAtPurchase de item BRL não muda', async () => {
    await put({ usdBrlRate: 5 });
    const usd = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 1000 }));
    const brl = await createItemViaApi(app, purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 1000 }));
    const steamMin = (item) => item.minPrices.find((m) => m.storeName === 'Steam').minPriceCents;
    expect(steamMin(usd)).toBe(5750);
    await put({ usdBrlRate: 6 });
    const usdAfter = (await request(app).get(`/api/items/${usd.id}`)).body.data;
    expect(steamMin(usdAfter)).toBe(6900);
    const brlAfter = (await request(app).get(`/api/items/${brl.id}`)).body.data;
    expect(brlAfter.fxRateAtPurchase).toBe(5);
    expect(steamMin(brlAfter)).toBe(steamMin(brl)); // mesma moeda: sem conversão
  });
});
