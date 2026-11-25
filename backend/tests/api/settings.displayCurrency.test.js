'use strict';

// 11.2 (D369, Adendo 1): moeda de conversão, cotações por moeda, prévia da troca e o "≈" nas respostas com dinheiro.
// Rede sempre falsa (fetchFn); bancos em memória.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, expectError, NOW, storeId } = require('../helpers/apiFixtures');
const { AWESOMEAPI_PAIRS, CURRENCIES } = require('../../src/config/constants');
const fxRateService = require('../../src/services/fxRateService');
const settingsService = require('../../src/services/settingsService');

afterAll(() => closeDb());
beforeEach(() => {
  settingsService.resetAutoFxForTests();
});

const JSON_TYPE = 'application/json';
const get = (app, url) => request(app).get(url);
const patch = (app, body) => request(app).patch('/api/settings').set('Content-Type', JSON_TYPE).send(body);
const putRate = (app, body) => request(app).put('/api/settings/fx-rate').set('Content-Type', JSON_TYPE).send(body);
const refresh = (app, body = {}) => request(app).post('/api/settings/fx-rate/refresh').set('Content-Type', JSON_TYPE).send(body);
const settings = async (app) => (await get(app, '/api/settings')).body.data;
const ok = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
const awesome = (currency, ask = '0.9142', extra = {}) => ({
  [`USD${currency}`]: { code: 'USD', codein: currency, bid: ask, ask, timestamp: '1763650800', create_date: '2026-11-20 12:00:00', ...extra },
});

describe('instalação nova (USD) e banco existente (BRL)', () => {
  test('freshDb({ displayCurrency: null }) = instalação nova: USD, sem cotações e sem "≈"', async () => {
    freshDb({ displayCurrency: null });
    const app = makeCatalogApp(NOW);
    const s = await settings(app);
    expect(s).toMatchObject({ displayCurrency: 'USD', fxRates: [] });
    await putRate(app, { usdBrlRate: 5 });
    const summary = (await get(app, '/api/profit/summary')).body.data;
    expect(summary.approxCurrency).toBe('USD');
    expect(Object.values(summary.approx).every((v) => v === null)).toBe(true);
  });

  test('o banco de teste padrão (como um banco existente após a v24) está em BRL', async () => {
    freshDb();
    expect((await settings(makeCatalogApp(NOW))).displayCurrency).toBe('BRL');
  });
});

describe('PATCH /api/settings com displayCurrency', () => {
  let app;
  beforeEach(() => { freshDb({ displayCurrency: null }); app = makeCatalogApp(NOW); });

  test.each(CURRENCIES)('aceita %s e responde { settings, steamStore }', async (currency) => {
    const res = await patch(app, { displayCurrency: currency });
    expect(res.status).toBe(200);
    expect(res.body.data.settings.displayCurrency).toBe(currency);
    expect(res.body.data.steamStore).toEqual({ id: expect.any(Number), currency: 'USD', created: false }); // instalação nova: Steam em USD, sem escolha = KEEP
    expect((await settings(app)).displayCurrency).toBe(currency);
  });

  test.each(['XXX', 'eur', 'US', '', 5, null])('%p -> INVALID_CURRENCY (ou INVALID_FIELD para tipo errado) e nada muda', async (bad) => {
    const res = await patch(app, { displayCurrency: bad });
    expect(res.status).toBe(400);
    expect(['INVALID_CURRENCY', 'INVALID_FIELD']).toContain(res.body.error.code);
    expect((await settings(app)).displayCurrency).toBe('USD');
  });

  test('steamStore: KEEP aceito; NEW_STORE sem lançamentos e valores soltos são recusados; FOLLOW é aceito (11.4)', async () => {
    expect((await patch(app, { displayCurrency: 'EUR', steamStore: 'KEEP' })).status).toBe(200);
    for (const choice of ['NEW_STORE', 'x']) {
      expectError(await patch(app, { displayCurrency: 'GBP', steamStore: choice }), 400, 'INVALID_FIELD', { field: 'steamStore' });
    }
    expectError(await patch(app, { steamStore: 'KEEP' }), 400, 'INVALID_FIELD', { field: 'steamStore' });
    expect((await settings(app)).displayCurrency).toBe('EUR'); // as recusas não gravaram nada
  });

  test('trocar o idioma nunca muda a moeda de conversão (e vice-versa)', async () => {
    await patch(app, { displayCurrency: 'EUR' });
    const lang = await patch(app, { language: 'pt-BR' });
    expect(lang.body.data.displayCurrency).toBe('EUR');
    await patch(app, { language: 'en' });
    expect((await settings(app)).displayCurrency).toBe('EUR');
    await patch(app, { displayCurrency: 'JPY' });
    expect((await settings(app)).language).toBe('en');
  });

  test('sem displayCurrency a resposta continua sendo o Settings direto', async () => {
    const res = await patch(app, { theme: 'DARK' });
    expect(res.body.data).toMatchObject({ theme: 'DARK', displayCurrency: 'USD' });
    expect(res.body.data).not.toHaveProperty('settings');
  });
});

describe('GET /api/settings/currency-change-preview', () => {
  let app;
  beforeEach(() => { freshDb({ displayCurrency: null, steamCurrency: 'BRL' }); app = makeCatalogApp(NOW); });
  const preview = (q) => get(app, `/api/settings/currency-change-preview${q}`);

  test('traz a loja Steam sem lançamentos, sem cotação e com atualização automática', async () => {
    const res = await preview('?currency=EUR');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      currency: 'EUR',
      steamStore: { id: expect.any(Number), name: 'Steam', currency: 'BRL', hasEntries: false, hasFixedFees: false },
      fxRateAvailable: false,
      automaticSource: true,
    });
  });

  test('com cotação gravada: fxRateAvailable = true; USD sempre disponível e sem fonte automática', async () => {
    await putRate(app, { currency: 'EUR', rate: 0.92 });
    expect((await preview('?currency=EUR')).body.data.fxRateAvailable).toBe(true);
    const usd = (await preview('?currency=USD')).body.data;
    expect(usd).toMatchObject({ currency: 'USD', fxRateAvailable: true, automaticSource: false });
  });

  test('hasEntries da loja Steam: true depois de uma conferência de saldo nela; a consulta não grava nada', async () => {
    const { getDb } = require('../../src/config/database');
    const steam = storeId('Steam');
    expect((await preview('?currency=GBP')).body.data.steamStore.hasEntries).toBe(false);
    getDb().prepare('INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, 100, ?, ?)').run(steam, '2026-11-01T00:00:00.000Z', 'c');
    const before = await settings(app);
    expect((await preview('?currency=GBP')).body.data.steamStore).toMatchObject({ currency: 'BRL', hasEntries: true });
    expect(await settings(app)).toEqual(before);
  });

  test('sem loja Steam escolhida: steamStore nulo', async () => {
    await request(app).put('/api/settings/steam-store').set('Content-Type', JSON_TYPE).send({ storeId: null });
    expect((await preview('?currency=CAD')).body.data.steamStore).toBeNull();
  });

  test.each(['?currency=XXX', '?currency=usd', '?currency='])('%s -> INVALID_CURRENCY', async (q) => {
    expectError(await preview(q), 400, 'INVALID_CURRENCY');
  });

  test('sem currency -> REQUIRED_FIELD; parâmetro extra -> UNKNOWN_FIELD', async () => {
    expectError(await preview(''), 400, 'REQUIRED_FIELD');
    expectError(await preview('?currency=EUR&x=1'), 400, 'UNKNOWN_FIELD');
  });

  test.each(CURRENCIES.filter((c) => c !== 'USD'))('%s: automaticSource reflete os pares verificados da AwesomeAPI', async (currency) => {
    expect((await preview(`?currency=${currency}`)).body.data.automaticSource).toBe(AWESOMEAPI_PAIRS.includes(currency));
  });
});

describe('PUT /api/settings/fx-rate por moeda', () => {
  let app;
  beforeEach(() => { freshDb(); app = makeCatalogApp(NOW); });

  test('{ currency, rate } grava a cotação da moeda (origem MANUAL) sem tocar nas outras', async () => {
    await putRate(app, { usdBrlRate: 5.4 });
    const res = await putRate(app, { currency: 'EUR', rate: 0.914 });
    expect(res.status).toBe(200);
    expect(res.body.data.fxRates).toEqual([
      { currency: 'BRL', rate: 5.4, source: 'MANUAL', refreshSource: 'AWESOMEAPI', quotedAt: null, updatedAt: NOW.toISOString() },
      { currency: 'EUR', rate: 0.914, source: 'MANUAL', refreshSource: 'AWESOMEAPI', quotedAt: null, updatedAt: NOW.toISOString() },
    ]);
    expect(res.body.data.usdBrlRate).toBe(5.4);
  });

  test('sem currency o padrão é BRL; os campos antigos continuam derivados do BRL', async () => {
    const res = await putRate(app, { rate: 5.5 });
    expect(res.body.data).toMatchObject({ usdBrlRate: 5.5, usdBrlRateSource: 'MANUAL', fxRefreshSource: 'AWESOMEAPI' });
  });

  test('USD e moeda desconhecida -> INVALID_CURRENCY', async () => {
    for (const currency of ['USD', 'XXX', 'eur', '']) expectError(await putRate(app, { currency, rate: 1 }), 400, 'INVALID_CURRENCY');
  });

  test('valor inválido -> INVALID_FX_RATE; tipo errado -> INVALID_FIELD; faltando -> REQUIRED_FIELD', async () => {
    expectError(await putRate(app, { currency: 'EUR', rate: 0 }), 400, 'INVALID_FX_RATE');
    expectError(await putRate(app, { currency: 'EUR', rate: -1 }), 400, 'INVALID_FX_RATE');
    expectError(await putRate(app, { currency: 'EUR', rate: '0.9' }), 400, 'INVALID_FIELD');
    expectError(await putRate(app, { currency: 5, rate: 0.9 }), 400, 'INVALID_FIELD');
    expectError(await putRate(app, { currency: 'EUR' }), 400, 'REQUIRED_FIELD');
    expectError(await putRate(app, { usdBrlRate: 5, rate: 5 }), 400, 'INVALID_FIELD');
    expectError(await putRate(app, { usdBrlRate: 5, currency: 'EUR' }), 400, 'INVALID_FIELD');
    expectError(await putRate(app, { rate: 5, foo: 1 }), 400, 'UNKNOWN_FIELD');
  });

  test('requiredFxCurrencies: moeda de conversão + moedas das lojas + BRL com aporte legado', async () => {
    freshDb({ displayCurrency: null, steamCurrency: 'BRL' });
    app = makeCatalogApp(NOW);
    expect((await settings(app)).requiredFxCurrencies).toEqual(['BRL']); // a Steam do seed está em BRL
    await patch(app, { displayCurrency: 'EUR' });
    expect((await settings(app)).requiredFxCurrencies).toEqual(['BRL', 'EUR']);
    await patch(app, { displayCurrency: 'USD' });
    expect((await settings(app)).requiredFxCurrencies).toEqual(['BRL']);
    expect(fxRateService.requiredCurrencies()).toEqual(['BRL']);
  });
});

describe('POST /api/settings/fx-rate/refresh por moeda (fetch falso)', () => {
  beforeEach(() => freshDb());

  // Cotações plausíveis (dentro da faixa de sanidade de cada moeda), do tipo que a AwesomeAPI devolveu na verificação de 2026-11-25.
  const ASK = {
    BRL: '5.1254', EUR: '0.9142', RUB: '82.6', TRY: '50.6', CNY: '6.66', PLN: '4.09', UAH: '41.5', JPY: '159.17', KRW: '1349.2',
    GBP: '0.7654', KZT: '473.3', CAD: '1.4242', AUD: '1.52', MXN: '19.7', ARS: '1610.28', CLP: '1043.37',
  };

  test.each(AWESOMEAPI_PAIRS)('%s: consulta USD-%s, grava ask, origem AWESOMEAPI e a data da cotação', async (currency) => {
    const fetchFn = jest.fn(async () => ok(awesome(currency, ASK[currency])));
    const app = makeCatalogApp(NOW, { fetchFn });
    const res = await refresh(app, { currency });
    expect(res.status).toBe(200);
    expect(fetchFn.mock.calls[0][0]).toBe(`https://economia.awesomeapi.com.br/json/last/USD-${currency}`);
    expect(res.body.data.currency).toBe(currency);
    expect(res.body.data.quote.rate).toBe(Number(ASK[currency]));
    expect(res.body.data.settings.fxRates.find((r) => r.currency === currency)).toMatchObject({
      rate: Number(ASK[currency]), source: 'AWESOMEAPI', quotedAt: '2025-11-20T15:00:00.000Z', updatedAt: NOW.toISOString(),
    });
  });

  test('sem currency continua sendo o BRL (compatibilidade)', async () => {
    const fetchFn = jest.fn(async () => ok(awesome('BRL', '5.1254')));
    const res = await refresh(makeCatalogApp(NOW, { fetchFn }));
    expect(res.status).toBe(200);
    expect(fetchFn.mock.calls[0][0]).toBe('https://economia.awesomeapi.com.br/json/last/USD-BRL');
    expect(res.body.data.settings.usdBrlRate).toBe(5.1254);
  });

  test('PTAX para outra moeda -> FX_SOURCE_NOT_SUPPORTED, sem chamar a rede', async () => {
    const fetchFn = jest.fn();
    const app = makeCatalogApp(NOW, { fetchFn });
    expectError(await refresh(app, { currency: 'EUR', source: 'PTAX' }), 400, 'FX_SOURCE_NOT_SUPPORTED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('PTAX explícita para o BRL funciona (e não muda a fonte salva)', async () => {
    const fetchFn = jest.fn(async () => ok({ value: [{ cotacaoCompra: 5.2987, cotacaoVenda: 5.3012, dataHoraCotacao: '2026-11-19 13:04:28.123' }] }));
    const app = makeCatalogApp(NOW, { fetchFn });
    const res = await refresh(app, { currency: 'BRL', source: 'PTAX' });
    expect(res.status).toBe(200);
    expect(res.body.data.settings).toMatchObject({ usdBrlRate: 5.3012, usdBrlRateSource: 'PTAX', fxRefreshSource: 'AWESOMEAPI' });
  });

  test('moeda inválida ou USD -> INVALID_CURRENCY; fonte inexistente -> FX_SOURCE_NOT_SUPPORTED', async () => {
    const app = makeCatalogApp(NOW, { fetchFn: jest.fn() });
    for (const currency of ['USD', 'XXX']) expectError(await refresh(app, { currency }), 400, 'INVALID_CURRENCY');
    expectError(await refresh(app, { currency: 'EUR', source: 'BCB' }), 400, 'FX_SOURCE_NOT_SUPPORTED');
  });

  test('resposta com outra chave ou outro codein -> FX_INVALID_RESPONSE e nada é gravado', async () => {
    const wrongCodein = jest.fn(async () => ok(awesome('EUR', '0.9', { codein: 'GBP' })));
    let app = makeCatalogApp(NOW, { fetchFn: wrongCodein });
    expectError(await refresh(app, { currency: 'EUR' }), 502, 'FX_INVALID_RESPONSE');
    const wrongKey = jest.fn(async () => ok({ USDGBP: awesome('GBP').USDGBP }));
    app = makeCatalogApp(NOW, { fetchFn: wrongKey });
    expectError(await refresh(app, { currency: 'EUR' }), 502, 'FX_INVALID_RESPONSE');
    expect((await settings(app)).fxRates).toEqual([]);
  });

  test('cotação fora da faixa de sanidade da moeda -> FX_INVALID_RESPONSE (EUR 40 não existe; BRL fora de 1 a 50 também)', async () => {
    let app = makeCatalogApp(NOW, { fetchFn: async () => ok(awesome('EUR', '40')) });
    expectError(await refresh(app, { currency: 'EUR' }), 502, 'FX_INVALID_RESPONSE');
    app = makeCatalogApp(NOW, { fetchFn: async () => ok(awesome('BRL', '51')) });
    expectError(await refresh(app, { currency: 'BRL' }), 502, 'FX_INVALID_RESPONSE');
    // RUB acima de 50 é válido (o limite do BRL não vale para ele)
    app = makeCatalogApp(NOW, { fetchFn: async () => ok(awesome('RUB', '82.6')) });
    expect((await refresh(app, { currency: 'RUB' })).status).toBe(200);
  });

  test('AUTO: pula a moeda MANUAL, repete só uma vez por moeda e cada moeda tem a sua tentativa', async () => {
    const fetchFn = jest.fn(async (url) => ok(url.endsWith('EUR') ? awesome('EUR', '0.9142') : awesome('GBP', '0.7654')));
    const app = makeCatalogApp(NOW, { fetchFn });
    await putRate(app, { currency: 'GBP', rate: 0.8 }); // manual: nunca é sobrescrita
    const gbp = await refresh(app, { currency: 'GBP', trigger: 'AUTO' });
    expect(gbp.body.data).toMatchObject({ currency: 'GBP', quote: null, skipped: 'MANUAL_RATE' });
    const eur1 = await refresh(app, { currency: 'EUR', trigger: 'AUTO' });
    expect(eur1.body.data.quote).toMatchObject({ source: 'AWESOMEAPI', rate: 0.9142 });
    const eur2 = await refresh(app, { currency: 'EUR', trigger: 'AUTO' });
    expect(eur2.body.data).toMatchObject({ quote: null, skipped: 'ALREADY_RAN' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('AUTO em moeda sem fonte automática (fora do mapa) pula em silêncio', async () => {
    // simula uma moeda sem par: a PTAX só serve ao BRL, então 'PTAX' + EUR no AUTO também pula
    const fetchFn = jest.fn();
    const app = makeCatalogApp(NOW, { fetchFn });
    const res = await refresh(app, { currency: 'EUR', source: 'PTAX', trigger: 'AUTO' });
    expect(res.body.data).toMatchObject({ quote: null, skipped: 'NOT_SUPPORTED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('PATCH fxRefreshSource continua sendo a fonte do BRL', () => {
  test('grava na linha do BRL de fx_rates e nenhuma outra moeda é afetada', async () => {
    freshDb();
    const app = makeCatalogApp(NOW);
    await putRate(app, { currency: 'EUR', rate: 0.9 });
    expect((await patch(app, { fxRefreshSource: 'PTAX' })).body.data.fxRefreshSource).toBe('PTAX');
    const rates = (await settings(app)).fxRates;
    expect(rates.find((r) => r.currency === 'BRL').refreshSource).toBe('PTAX');
    expect(rates.find((r) => r.currency === 'EUR').refreshSource).toBe('AWESOMEAPI');
  });
});

describe('o "≈" segue a moeda de conversão nas respostas com dinheiro', () => {
  const dep = (app, body) => request(app).post('/api/deposits').set('Content-Type', JSON_TYPE).send(body);

  async function withDeposit(displayCurrency) {
    freshDb({ displayCurrency, steamCurrency: 'BRL' });
    const app = makeCatalogApp(NOW);
    await putRate(app, { usdBrlRate: 5.4321 });
    await putRate(app, { currency: 'EUR', rate: 0.914 });
    await putRate(app, { currency: 'JPY', rate: 159.172 });
    const created = await dep(app, { storeId: storeId('CSFloat'), amountStoreCents: 10000, depositedAt: '2026-11-10T12:00:00.000Z' });
    expect(created.status).toBe(201);
    return app;
  }

  test.each([
    ['BRL', 54321], // idêntico ao de antes
    ['EUR', 9140],
    ['JPY', 1591700], // ¥ 15.917: múltiplo de 100 centavos
    ['USD', null], // sem "≈"
  ])('moeda de conversão %s: aporte de US$ 100,00 -> approxCents %p', async (display, expected) => {
    const app = await withDeposit(display);
    const { deposits, totals } = (await get(app, '/api/deposits')).body.data;
    expect(deposits[0]).toMatchObject({ amountUsdCents: 10000, approxCents: expected, approxCurrency: display });
    expect(totals).toMatchObject({ amountUsdCents: 10000, approxCents: expected, approxCurrency: display });
    const profit = (await get(app, '/api/profit/summary')).body.data;
    expect(profit.approxCurrency).toBe(display);
    expect(profit.approx.deposits).toBe(expected);
  });

  test('trocar a moeda de conversão não muda nenhum valor em USD nem o saldo', async () => {
    const app = await withDeposit('BRL');
    const before = (await get(app, '/api/profit/summary')).body.data;
    await patch(app, { displayCurrency: 'EUR' });
    const after = (await get(app, '/api/profit/summary')).body.data;
    for (const key of ['depositsUsdCents', 'withdrawalsNetUsdCents', 'platformBalanceUsdCents', 'pendingBalanceUsdCents', 'stockUsdCents', 'realProfitUsdCents']) {
      expect(after[key]).toBe(before[key]);
    }
    expect(after.approxCurrency).toBe('EUR');
  });

  test('sem a cotação da moeda de conversão o "≈" some, mas o lucro real calcula', async () => {
    freshDb();
    const app = makeCatalogApp(NOW);
    await putRate(app, { usdBrlRate: 5 });
    await patch(app, { displayCurrency: 'GBP' });
    await dep(app, { storeId: storeId('CSFloat'), amountStoreCents: 10000, depositedAt: '2026-11-10T12:00:00.000Z' });
    const profit = (await get(app, '/api/profit/summary')).body.data;
    expect(profit.depositsUsdCents).toBe(10000);
    expect(profit.approx.deposits).toBeNull();
    expect(profit.approxCurrency).toBe('GBP');
  });

  test('loja em BRL com moeda de conversão EUR: o "≈" vai direto de BRL para EUR', async () => {
    freshDb({ displayCurrency: 'EUR' });
    const app = makeCatalogApp(NOW);
    await putRate(app, { usdBrlRate: 5.4321 });
    await putRate(app, { currency: 'EUR', rate: 0.914 });
    const { getDb } = require('../../src/config/database');
    getDb().prepare('INSERT INTO store_balances (store_id, balance_cents, recorded_at, created_at) VALUES (?, 0, ?, ?)').run(storeId('Steam'), '2026-11-01T00:00:00.000Z', 'c');
    const res = await get(app, '/api/store-balances/current');
    expect(res.body.data.totals.approxCurrency).toBe('EUR');
    expect(res.body.data.displayCurrency).toBe('EUR');
  });
});
