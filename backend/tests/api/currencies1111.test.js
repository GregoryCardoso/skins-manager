'use strict';

// 11.11 (D369, Adendo 1): as 25 moedas novas (42 no total), as 6 novas sem casas decimais, as faixas das cotações, a prévia da troca da
// moeda de conversão com `feesWillReset` (M2) e o contrato do PATCH /api/settings. Bancos em memória; rede sempre falsa.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, expectError, NOW, storeId } = require('../helpers/apiFixtures');
const {
  CURRENCIES, ZERO_DECIMAL_CURRENCIES, AWESOMEAPI_PAIRS, FX_RATE_BOUNDS, FX_MANUAL_RATE_BOUNDS, LANGUAGES, MAX_AMOUNT_CENTS,
} = require('../../src/config/constants');
const { minorUnitCents } = require('../../src/services/currencyService');
const settingsService = require('../../src/services/settingsService');
const FxRate = require('../../src/models/FxRate');
const Store = require('../../src/models/Store');

afterAll(() => closeDb());
beforeEach(() => settingsService.resetAutoFxForTests());

const JSON_TYPE = 'application/json';
const post = (app, url, body) => request(app).post(url).set('Content-Type', JSON_TYPE).send(body);
const patchStore = (app, id, body) => request(app).patch(`/api/stores/${id}`).set('Content-Type', JSON_TYPE).send(body);
const patchSettings = (app, body) => request(app).patch('/api/settings').set('Content-Type', JSON_TYPE).send(body);
const putRate = (app, body) => request(app).put('/api/settings/fx-rate').set('Content-Type', JSON_TYPE).send(body);
const preview = (app, currency) => request(app).get(`/api/settings/currency-change-preview?currency=${currency}`);
const ok = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
const setRate = (currency, rate) => FxRate.upsert(currency, { rate, source: 'MANUAL' }, { now: NOW });

// Cotações de referência de 2026-11-26 (AwesomeAPI, `ask`), as mesmas registradas na D369.
const REFERENCE = {
  INR: 92.4751, IDR: 18386, PHP: 63.781, THB: 34.06, VND: 25840, MYR: 4.1178, SGD: 1.29069, CHF: 0.8342, NOK: 9.7667, SEK: 10.22164,
  DKK: 6.81267, CZK: 22.3298, HUF: 339.105, COP: 3541.29, PEN: 3.57305, UYU: 41.790854, CRC: 458.37986, HKD: 7.83683, TWD: 32.9759,
  NZD: 1.82765, ZAR: 17.543, ILS: 3.3147, SAR: 3.872328, AED: 3.6735, QAR: 3.781503,
};
const NEW_CURRENCIES = Object.keys(REFERENCE);
const NEW_WHOLE = ['IDR', 'VND', 'COP', 'CRC', 'HUF', 'TWD'];

describe('a lista das 42 moedas', () => {
  test('USD primeiro, as outras 41 em ordem alfabética, e as 25 novas estão todas lá', () => {
    expect(CURRENCIES).toHaveLength(42);
    expect(CURRENCIES[0]).toBe('USD');
    expect(CURRENCIES.slice(1)).toEqual([...CURRENCIES.slice(1)].sort());
    expect(new Set(CURRENCIES).size).toBe(42);
    for (const code of NEW_CURRENCIES) expect(CURRENCIES).toContain(code);
  });

  test('as sem casas decimais são 9 (3 antigas + IDR, VND, COP, CRC, HUF e TWD) e a unidade mínima delas é 100 centavos', () => {
    expect([...ZERO_DECIMAL_CURRENCIES].sort()).toEqual(['CLP', 'COP', 'CRC', 'HUF', 'IDR', 'JPY', 'KRW', 'TWD', 'VND']);
    for (const code of CURRENCIES) expect(minorUnitCents(code)).toBe(ZERO_DECIMAL_CURRENCIES.includes(code) ? 100 : 1);
  });

  test('a lista de idiomas está na ordem de exibição (alfabética pelo nome nativo; latinas, cirílico, CJK)', () => {
    expect([...LANGUAGES]).toEqual(['de', 'en', 'es', 'fr', 'it', 'pl', 'pt-BR', 'tr', 'ru', 'uk', 'ja', 'zh-CN', 'ko']);
  });

  test('todas as moedas não-USD têm par automático, faixa automática e faixa manual; a automática cabe dentro da manual', () => {
    const nonUsd = CURRENCIES.filter((c) => c !== 'USD');
    expect([...AWESOMEAPI_PAIRS].sort()).toEqual([...nonUsd].sort());
    expect(Object.keys(FX_RATE_BOUNDS).sort()).toEqual([...nonUsd].sort());
    expect(Object.keys(FX_MANUAL_RATE_BOUNDS).sort()).toEqual([...nonUsd].sort());
    for (const code of nonUsd) {
      expect(FX_MANUAL_RATE_BOUNDS[code].min).toBeLessThanOrEqual(FX_RATE_BOUNDS[code].min);
      expect(FX_MANUAL_RATE_BOUNDS[code].max).toBeGreaterThanOrEqual(FX_RATE_BOUNDS[code].max);
    }
  });
});

describe('faixas das 25 moedas novas', () => {
  test.each(NEW_CURRENCIES)('%s: a cotação de referência cabe nas duas faixas, com a margem do critério (0,2x a 5x; manual 0,1x a 10x)', (code) => {
    const ref = REFERENCE[code];
    const auto = FX_RATE_BOUNDS[code];
    const manual = FX_MANUAL_RATE_BOUNDS[code];
    expect(auto.min).toBeLessThan(ref);
    expect(auto.max).toBeGreaterThan(ref);
    expect(auto.min / ref).toBeGreaterThanOrEqual(0.15);
    expect(auto.min / ref).toBeLessThanOrEqual(0.3);
    expect(auto.max / ref).toBeGreaterThanOrEqual(4);
    expect(auto.max / ref).toBeLessThanOrEqual(6);
    expect(manual.min / ref).toBeGreaterThanOrEqual(0.05);
    expect(manual.min / ref).toBeLessThanOrEqual(0.125);
    expect(manual.max / ref).toBeGreaterThanOrEqual(9.5);
    expect(manual.max / ref).toBeLessThanOrEqual(12);
  });

  test.each(NEW_CURRENCIES)('%s: PUT /fx-rate aceita a referência e recusa 1/20 e 20 vezes ela (FX_RATE_OUT_OF_RANGE)', async (code) => {
    freshDb({ displayCurrency: null });
    const app = makeCatalogApp(NOW);
    const accepted = await putRate(app, { currency: code, rate: REFERENCE[code] });
    expect(accepted.status).toBe(200);
    expectError(await putRate(app, { currency: code, rate: REFERENCE[code] / 20 }), 400, 'FX_RATE_OUT_OF_RANGE');
    expectError(await putRate(app, { currency: code, rate: REFERENCE[code] * 20 }), 400, 'FX_RATE_OUT_OF_RANGE');
  });

  test('o preço em centavos nunca estoura: teto x maior cotação das faixas < Number.MAX_SAFE_INTEGER (IDR e VND incluídos)', () => {
    const biggest = Math.max(...CURRENCIES.filter((c) => c !== 'USD').map((c) => FX_MANUAL_RATE_BOUNDS[c].max));
    expect(MAX_AMOUNT_CENTS * biggest).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe('lojas nas moedas novas', () => {
  let app;
  beforeEach(() => { freshDb({ displayCurrency: null }); app = makeCatalogApp(NOW); });
  const body = (currency, extra = {}) => ({
    name: `Loja ${currency}`, currency, saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeeRounding: 'CEIL', allowsWithdrawal: true, ...extra,
  });

  test.each(NEW_CURRENCIES)('cria uma loja em %s (sem migração: o CHECK do banco só confere o formato)', async (code) => {
    const res = await post(app, '/api/stores', body(code));
    expect(res.status).toBe(201);
    expect(res.body.data.currency).toBe(code);
  });

  test.each(NEW_WHOLE)('%s: taxa fixa em centavos soltos -> AMOUNT_PRECISION_INVALID; múltiplo de 100 é aceito', async (code) => {
    const bad = await post(app, '/api/stores', body(code, { saleFixedFeeCents: 150 }));
    expectError(bad, 400, 'AMOUNT_PRECISION_INVALID', { field: 'saleFixedFeeCents' });
    expect(bad.body.error.params).toEqual({ currency: code, unitCents: 100 });
    expect((await post(app, '/api/stores', body(code, { saleFixedFeeCents: 300 }))).status).toBe(201);
  });

  test('moedas novas com centavos (CHF) aceitam 150 centavos', async () => {
    expect((await post(app, '/api/stores', body('CHF', { saleFixedFeeCents: 150 }))).status).toBe(201);
  });

  test.each(['IDR', 'VND'])('%s: a cotação da venda arredonda a taxa na unidade (valores grandes)', async (code) => {
    const created = (await post(app, '/api/stores', body(code))).body.data;
    // 25.840.000 VND / 18.386.000 IDR (cerca de US$ 1.000): preço em centavos de 1/100 da unidade.
    const price = REFERENCE[code] * 1000 * 100;
    const salePriceCents = Math.round(price / 100) * 100;
    const res = await request(app).get(`/api/stores/${created.id}/sale-quote?salePriceCents=${salePriceCents}`);
    expect(res.status).toBe(200);
    expect(res.body.data.feeCents % 100).toBe(0);
    expect(res.body.data.netReceivedCents % 100).toBe(0);
    expect(res.body.data.feeCents + res.body.data.netReceivedCents).toBe(salePriceCents);
    expect(Number.isSafeInteger(res.body.data.feeCents)).toBe(true);
  });

  test('o preço acima do teto de 1e10 centavos é recusado também nas moedas novas', async () => {
    const created = (await post(app, '/api/stores', body('IDR'))).body.data;
    const res = await request(app).get(`/api/stores/${created.id}/sale-quote?salePriceCents=${MAX_AMOUNT_CENTS + 100}`);
    expect(res.status).toBe(400);
  });
});

describe('prévia da troca com fonte automática para uma moeda nova', () => {
  test('IDR: automaticSource = true, sem cotação até a atualização, e com cotação depois dela', async () => {
    freshDb({ displayCurrency: null });
    const fetchFn = async () => ok({ USDIDR: { code: 'USD', codein: 'IDR', bid: '18380', ask: '18386', timestamp: '1763650800', create_date: '2026-11-20 12:00:00' } });
    const app = makeCatalogApp(NOW, { fetchFn });
    const before = (await preview(app, 'IDR')).body.data;
    expect(before).toMatchObject({ currency: 'IDR', fxRateAvailable: false, automaticSource: true });
    const refreshed = await request(app).post('/api/settings/fx-rate/refresh').set('Content-Type', JSON_TYPE).send({ currency: 'IDR' });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.quote.rate).toBe(18386);
    expect((await preview(app, 'IDR')).body.data).toMatchObject({ fxRateAvailable: true, automaticSource: true });
  });

  test('cotação automática fora da faixa da moeda nova é recusada (IDR 5 não passa)', async () => {
    freshDb({ displayCurrency: null });
    const fetchFn = async () => ok({ USDIDR: { code: 'USD', codein: 'IDR', bid: '5', ask: '5', timestamp: '1763650800', create_date: '2026-11-20 12:00:00' } });
    const app = makeCatalogApp(NOW, { fetchFn });
    const res = await request(app).post('/api/settings/fx-rate/refresh').set('Content-Type', JSON_TYPE).send({ currency: 'IDR' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('M2: feesWillReset na prévia (origem e destino precisam de cotação)', () => {
  const withSteam = async (steamCurrency, fees = { saleFixedFeeCents: 50 }) => {
    freshDb({ displayCurrency: null, steamCurrency });
    const app = makeCatalogApp(NOW);
    if (fees) expect((await patchStore(app, storeId('Steam'), fees)).status).toBe(200);
    return app;
  };
  const steamOf = async (app, currency) => (await preview(app, currency)).body.data.steamStore;

  test('Steam em USD com taxa fixa, moeda nova sem cotação: zera, e cita a moeda nova', async () => {
    const app = await withSteam('USD');
    expect(await steamOf(app, 'EUR')).toMatchObject({ hasFixedFees: true, feesWillReset: true, missingRateCurrency: 'EUR' });
  });

  test('Steam em USD com taxa fixa, com cotação da moeda nova: converte (USD é a base e não precisa de cotação)', async () => {
    const app = await withSteam('USD');
    setRate('EUR', 0.92);
    expect(await steamOf(app, 'EUR')).toMatchObject({ feesWillReset: false, missingRateCurrency: null });
  });

  test('exemplo: Steam em EUR sem cotação do EUR, trocando para BRL com cotação do BRL: zera (falta a origem) e cita o EUR', async () => {
    const app = await withSteam('EUR');
    setRate('BRL', 5.4);
    const data = (await preview(app, 'BRL')).body.data;
    expect(data.fxRateAvailable).toBe(true); // só olha a moeda nova: o bug antigo diria "sem problema"
    expect(data.steamStore).toMatchObject({ currency: 'EUR', hasFixedFees: true, feesWillReset: true, missingRateCurrency: 'EUR' });
  });

  test('Steam em EUR com as duas cotações: converte', async () => {
    const app = await withSteam('EUR');
    setRate('BRL', 5.4);
    setRate('EUR', 0.92);
    expect(await steamOf(app, 'BRL')).toMatchObject({ feesWillReset: false, missingRateCurrency: null });
  });

  test('sem cotação nenhuma, a moeda nova tem prioridade no aviso; para USD de destino só a origem importa', async () => {
    const app = await withSteam('EUR');
    expect(await steamOf(app, 'BRL')).toMatchObject({ feesWillReset: true, missingRateCurrency: 'BRL' });
    expect(await steamOf(app, 'USD')).toMatchObject({ feesWillReset: true, missingRateCurrency: 'EUR' });
    setRate('EUR', 0.92);
    expect(await steamOf(app, 'USD')).toMatchObject({ feesWillReset: false });
  });

  test('sem taxa fixa/mínima, sem loja Steam ou na mesma moeda: nunca zera', async () => {
    const noFees = await withSteam('EUR', null);
    expect(await steamOf(noFees, 'BRL')).toMatchObject({ hasFixedFees: false, feesWillReset: false, missingRateCurrency: null });
    const same = await withSteam('EUR');
    expect(await steamOf(same, 'EUR')).toMatchObject({ feesWillReset: false });
    freshDb({ displayCurrency: null });
    const app = makeCatalogApp(NOW);
    Store.findAll(); // banco de teste com Steam: remove a referência para simular "sem loja Steam"
    const settings = require('../../src/models/Setting');
    settings.update({ steamStoreId: null }, { now: NOW });
    expect((await preview(app, 'EUR')).body.data.steamStore).toBeNull();
  });

  test('a previsão bate com o que o PATCH faz: com feesWillReset, FOLLOW grava as taxas zeradas; sem ele, convertidas', async () => {
    const zeroed = await withSteam('USD');
    expect((await steamOf(zeroed, 'EUR')).feesWillReset).toBe(true);
    expect((await patchSettings(zeroed, { displayCurrency: 'EUR', steamStore: 'FOLLOW' })).status).toBe(200);
    expect(Store.findById(storeId('Steam')).saleFixedFeeCents).toBe(0);

    const converted = await withSteam('USD');
    setRate('EUR', 0.5);
    expect((await steamOf(converted, 'EUR')).feesWillReset).toBe(false);
    expect((await patchSettings(converted, { displayCurrency: 'EUR', steamStore: 'FOLLOW' })).status).toBe(200);
    expect(Store.findById(storeId('Steam')).saleFixedFeeCents).toBe(25);
  });
});

describe('B2: contrato do PATCH /api/settings (documentado, não padronizado)', () => {
  test('sem displayCurrency devolve Settings; com displayCurrency devolve { settings, steamStore }', async () => {
    freshDb({ displayCurrency: null });
    const app = makeCatalogApp(NOW);
    const plain = (await patchSettings(app, { theme: 'DARK' })).body.data;
    expect(plain.theme).toBe('DARK');
    expect(plain).not.toHaveProperty('steamStore');
    const withCurrency = (await patchSettings(app, { displayCurrency: 'EUR' })).body.data;
    expect(withCurrency).toHaveProperty('settings.displayCurrency', 'EUR');
    expect(withCurrency).toHaveProperty('steamStore');
  });
});
