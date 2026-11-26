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

describe('/api/settings', () => {
  test('GET inicial sem id (T1)', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      usdBrlRate: null, usdBrlRateUpdatedAt: null, usdBrlRateSource: null, catalogUpdatedAt: null, theme: 'SYSTEM', language: 'en', inventoryView: 'GROUPED',
      agingThresholdsAdjusted: false, fastTurnoverDays: 7, fastTurnoverDaysCustom: null, fastTurnoverDaysDefault: 7,
      slowItemDays: 21, slowItemDaysCustom: null, slowItemDaysDefault: 21, steamStoreId: expect.any(Number), rateQuotedAt: null, fxRefreshSource: 'AWESOMEAPI', displayCurrency: 'BRL', fxRates: expect.any(Array), requiredFxCurrencies: expect.any(Array), updatedAt: expect.any(String),
    });
    expect(res.body.data).not.toHaveProperty('id');
  });

  test('PUT /fx-rate grava com o relógio injetado e o GET devolve o valor', async () => {
    const res = await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.25 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      usdBrlRate: 5.25,
      usdBrlRateUpdatedAt: '2026-11-19T15:00:00.000Z',
      catalogUpdatedAt: null, theme: 'SYSTEM', language: 'en', inventoryView: 'GROUPED', usdBrlRateSource: 'MANUAL',
      agingThresholdsAdjusted: false, fastTurnoverDays: 7, fastTurnoverDaysCustom: null, fastTurnoverDaysDefault: 7,
      slowItemDays: 21, slowItemDaysCustom: null, slowItemDaysDefault: 21, steamStoreId: expect.any(Number), rateQuotedAt: null, fxRefreshSource: 'AWESOMEAPI', displayCurrency: 'BRL', fxRates: expect.any(Array), requiredFxCurrencies: expect.any(Array),
      updatedAt: '2026-11-19T15:00:00.000Z',
    });
    expect((await request(app).get('/api/settings')).body.data.usdBrlRate).toBe(5.25);
  });

  test.each([0, -1])('cotação %p -> INVALID_FX_RATE', async (v) => {
    expectError(await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: v }), 400, 'INVALID_FX_RATE');
  });

  test.each(['5.25', true, null])('cotação %p -> INVALID_FIELD', async (v) => {
    expectError(await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: v }), 400, 'INVALID_FIELD');
  });

  test('{} -> REQUIRED_FIELD; campo extra -> UNKNOWN_FIELD; array -> INVALID_BODY', async () => {
    expectError(await request(app).put('/api/settings/fx-rate').send({}), 400, 'REQUIRED_FIELD');
    expectError(await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5, foo: 1 }), 400, 'UNKNOWN_FIELD');
    expectError(await request(app).put('/api/settings/fx-rate').send([1]), 400, 'INVALID_BODY');
  });

  test('PUT /api/settings não existe', async () => {
    expectError(await request(app).put('/api/settings').send({ usdBrlRate: 5 }), 404, 'NOT_FOUND');
  });

  describe('PATCH /api/settings (preferências, D83)', () => {
    const patch = (body) => request(app).patch('/api/settings').set('Content-Type', 'application/json').send(body);

    test('GET inicial traz theme SYSTEM, language en e catalogUpdatedAt nulo', async () => {
      const res = await request(app).get('/api/settings');
      expect(res.body.data).toMatchObject({ theme: 'SYSTEM', language: 'en', inventoryView: 'GROUPED', catalogUpdatedAt: null });
    });

    test.each([
      [{ theme: 'DARK' }, { theme: 'DARK', language: 'en' }],
      [{ theme: 'LIGHT' }, { theme: 'LIGHT', language: 'en' }],
      [{ language: 'en' }, { theme: 'SYSTEM', language: 'en' }],
      [{ theme: 'DARK', language: 'en' }, { theme: 'DARK', language: 'en' }],
    ])('%j grava e responde Settings completo', async (body, expected) => {
      const res = await patch(body);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        usdBrlRate: null, usdBrlRateUpdatedAt: null, usdBrlRateSource: null, catalogUpdatedAt: null, inventoryView: 'GROUPED', ...expected,
        agingThresholdsAdjusted: false, fastTurnoverDays: 7, fastTurnoverDaysCustom: null, fastTurnoverDaysDefault: 7,
      slowItemDays: 21, slowItemDaysCustom: null, slowItemDaysDefault: 21, steamStoreId: expect.any(Number), rateQuotedAt: null, fxRefreshSource: 'AWESOMEAPI', displayCurrency: 'BRL', fxRates: expect.any(Array), requiredFxCurrencies: expect.any(Array), updatedAt: '2026-11-19T15:00:00.000Z',
      });
      expect((await request(app).get('/api/settings')).body.data).toMatchObject(expected);
    });

    test('um campo não apaga o outro, nem a cotação', async () => {
      await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.5 });
      await patch({ theme: 'DARK' });
      const res = await patch({ language: 'en' });
      expect(res.body.data).toMatchObject({ theme: 'DARK', language: 'en', usdBrlRate: 5.5 });
    });

    test('{} e corpos que não são objeto -> INVALID_BODY', async () => {
      expectError(await patch({}), 400, 'INVALID_BODY');
      expectError(await patch([{ theme: 'DARK' }]), 400, 'INVALID_BODY');
      expectError(await request(app).patch('/api/settings').send('texto'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    });

    test('outras chaves (usdBrlRate, catalogUpdatedAt, foo) -> UNKNOWN_FIELD e nada muda', async () => {
      expectError(await patch({ usdBrlRate: 5 }), 400, 'UNKNOWN_FIELD');
      expectError(await patch({ catalogUpdatedAt: '2026-01-01T00:00:00.000Z' }), 400, 'UNKNOWN_FIELD');
      expectError(await patch({ theme: 'DARK', foo: 1 }), 400, 'UNKNOWN_FIELD');
      expect((await request(app).get('/api/settings')).body.data).toMatchObject({ theme: 'SYSTEM', usdBrlRate: null, catalogUpdatedAt: null });
    });

    test.each([[null], [1], [true], [['DARK']], [{}]])('theme %j -> INVALID_FIELD', async (theme) => {
      expectError(await patch({ theme }), 400, 'INVALID_FIELD');
    });

    test('language não string -> INVALID_FIELD', async () => {
      expectError(await patch({ language: null }), 400, 'INVALID_FIELD');
      expectError(await patch({ language: 5 }), 400, 'INVALID_FIELD');
    });

    test('valor fora da lista -> INVALID_THEME / INVALID_LANGUAGE', async () => {
      expectError(await patch({ theme: 'BLUE' }), 400, 'INVALID_THEME');
      expectError(await patch({ theme: 'dark' }), 400, 'INVALID_THEME');
      expectError(await patch({ language: 'sv' }), 400, 'INVALID_LANGUAGE');
      expectError(await patch({ theme: 'DARK', language: 'sv' }), 400, 'INVALID_LANGUAGE');
      expect((await request(app).get('/api/settings')).body.data).toMatchObject({ theme: 'SYSTEM', language: 'en' });
    });

    test('PUT /fx-rate continua funcionando e não mexe nas preferências', async () => {
      await patch({ theme: 'DARK', language: 'en' });
      const res = await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5 });
      expect(res.body.data).toMatchObject({ usdBrlRate: 5, theme: 'DARK', language: 'en' });
    });
  });

  describe('integração com itens', () => {
    beforeEach(() => importCatalogFixture());
    const steamBuy = () => purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 1000 });

    test('Steam sem cotação -> FX_RATE_REQUIRED; depois do PUT usa a cotação; nova cotação não muda o item gravado', async () => {
      expectError(await request(app).post('/api/items').send(steamBuy()), 400, 'FX_RATE_REQUIRED');
      await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5 });
      const created = await createItemViaApi(app, steamBuy());
      expect(created).toMatchObject({ purchaseCurrency: 'BRL', fxRateAtPurchase: 5 });
      await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 6 });
      const again = (await request(app).get(`/api/items/${created.id}`)).body.data;
      expect(again.fxRateAtPurchase).toBe(5);
    });

    test('minPrices Steam de item USD passa de "cotação não configurada" a valor após o PUT', async () => {
      const item = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 1000 }));
      const steamBefore = item.minPrices.find((m) => m.storeName === 'Steam');
      expect(steamBefore).toMatchObject({ minPriceCents: null, warning: 'cotação não configurada', warningCode: 'FX_NOT_CONFIGURED' });
      await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5 });
      const after = (await request(app).get(`/api/items/${item.id}`)).body.data;
      expect(after.minPrices.find((m) => m.storeName === 'Steam')).toMatchObject({ minPriceCents: 5750, warning: null, warningCode: null });
    });
  });
});

describe('PATCH /api/settings language (11.1, D369)', () => {
  test.each(['es-ES', 'es-MX', 'ES', 'De', 'fr-FR', 'ru-RU', 'UK', 'zh-TW', 'ZH-CN', 'ja-JP', 'ko-KR', '', 'xx', 'sv', 'pt-br', 'EN'])('código %j fora da lista -> INVALID_LANGUAGE e nada é gravado', async (code) => {
    expectError(await request(app).patch('/api/settings').send({ language: code }), 400, 'INVALID_LANGUAGE');
    expect((await request(app).get('/api/settings')).body.data.language).toBe('en');
  });

  test('os 13 idiomas (en, pt-BR, es, ru, tr, fr, it, zh-CN, de, pl, uk, ja e ko) são aceitos (11.9)', async () => {
    for (const code of ['pt-BR', 'es', 'ru', 'tr', 'fr', 'it', 'zh-CN', 'de', 'pl', 'uk', 'ja', 'ko', 'en']) {
      const res = await request(app).patch('/api/settings').send({ language: code });
      expect(res.status).toBe(200);
      expect(res.body.data.language).toBe(code);
    }
  });
});
