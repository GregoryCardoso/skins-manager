'use strict';

// QA 11.2: entradas hostis, Content-Type, concorrência e regras AUTO/MANUAL por moeda, invariância dos valores em USD diante da moeda de
// conversão e comportamento idêntico ao anterior com BRL. Rede sempre falsa; bancos em memória.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Item = require('../../src/models/Item');
const Deposit = require('../../src/models/Deposit');
const Withdrawal = require('../../src/models/Withdrawal');
const FxRate = require('../../src/models/FxRate');
const { freshDb, wonSkin, soldFields } = require('../helpers/fixtures');
const { makeCatalogApp, expectError, NOW, storeId } = require('../helpers/apiFixtures');
const settingsService = require('../../src/services/settingsService');

afterAll(() => closeDb());
beforeEach(() => settingsService.resetAutoFxForTests());

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
const rateOf = async (app, currency) => (await settings(app)).fxRates.find((r) => r.currency === currency);

describe('displayCurrency hostil no PATCH /api/settings', () => {
  let app;
  beforeEach(() => { freshDb({ displayCurrency: null }); app = makeCatalogApp(NOW); });

  const BAD = ['usd', 'usd ', ' USD', 'USD ', 'Usd', 'XXX', '', 'A'.repeat(100000), '💵', 'EUR\n', 'EUR\u0000', 'ＥＵＲ', '__proto__'];
  test.each(BAD.map((v) => [JSON.stringify(v).slice(0, 30), v]))('%s -> 400 INVALID_CURRENCY e nada muda', async (_label, value) => {
    const res = await patch(app, { displayCurrency: value });
    expectError(res, 400, 'INVALID_CURRENCY', { field: 'displayCurrency' });
    expect((await settings(app)).displayCurrency).toBe('USD');
  });

  test.each([[null], [5], [true], [[]], [['EUR']], [{}], [{ code: 'EUR' }]])('tipo errado %j -> 400 INVALID_FIELD', async (value) => {
    const res = await patch(app, { displayCurrency: value });
    expectError(res, 400, 'INVALID_FIELD', { field: 'displayCurrency' });
    expect((await settings(app)).displayCurrency).toBe('USD');
  });

  test('campo desconhecido junto: recusa tudo e não grava a moeda', async () => {
    expectError(await patch(app, { displayCurrency: 'EUR', foo: 1 }), 400, 'UNKNOWN_FIELD', { field: 'foo' });
    expectError(await patch(app, { displayCurrency: 'EUR', currency: 'EUR' }), 400, 'UNKNOWN_FIELD', { field: 'currency' });
    expectError(await patch(app, { displayCurrency: 'EUR', usdBrlRate: 5 }), 400, 'UNKNOWN_FIELD', { field: 'usdBrlRate' });
    expect((await settings(app)).displayCurrency).toBe('USD');
  });

  test('__proto__ no JSON cru não vira campo válido nem contamina o objeto', async () => {
    const res = await request(app).patch('/api/settings').set('Content-Type', JSON_TYPE).send('{"__proto__":{"displayCurrency":"EUR"},"theme":"DARK"}');
    expect([200, 400]).toContain(res.status);
    expect(({}).displayCurrency).toBeUndefined();
    expect((await settings(app)).displayCurrency).toBe('USD');
  });

  test('PATCH atômico: um campo inválido junto impede também a troca da moeda', async () => {
    expect((await patch(app, { displayCurrency: 'EUR', theme: 'NEON' })).status).toBe(400);
    expect((await patch(app, { displayCurrency: 'EUR', language: 'xx-YY' })).status).toBe(400);
    expect((await patch(app, { displayCurrency: 'EUR', fastTurnoverDays: -1 })).status).toBe(400);
    const s = await settings(app);
    expect(s.displayCurrency).toBe('USD');
    expect(s.theme).toBe('SYSTEM');
  });

  test('steamStore sem displayCurrency (sozinho ou com outros campos) é recusado e nada é gravado', async () => {
    expectError(await patch(app, { steamStore: 'KEEP' }), 400, 'INVALID_FIELD', { field: 'steamStore' });
    expectError(await patch(app, { theme: 'DARK', steamStore: 'KEEP' }), 400, 'INVALID_FIELD', { field: 'steamStore' });
    expect((await settings(app)).theme).not.toBe('DARK');
  });

  test.each([[null], [5], [true], [['KEEP']], [{}], ['keep'], ['KEEP '], ['']])('steamStore %j com displayCurrency -> 400 e a moeda não muda', async (value) => {
    const res = await patch(app, { displayCurrency: 'EUR', steamStore: value });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FIELD');
    expect(res.body.error.field).toBe('steamStore');
    expect((await settings(app)).displayCurrency).toBe('USD');
  });

  test('moeda igual à atual: aceita (idempotente) e não cria loja nem mexe em cotação', async () => {
    const before = (await get(app, '/api/stores')).body.data.length;
    const res = await patch(app, { displayCurrency: 'USD', steamStore: 'KEEP' });
    expect(res.status).toBe(200);
    expect((await get(app, '/api/stores')).body.data.length).toBe(before);
    expect((await settings(app)).fxRates).toEqual([]);
  });

  test('idioma e moeda são independentes (os dois sentidos, e juntos)', async () => {
    await patch(app, { displayCurrency: 'JPY' });
    for (const language of ['pt-BR', 'en', 'pt-BR']) {
      await patch(app, { language });
      const s = await settings(app);
      expect(s.displayCurrency).toBe('JPY');
      expect(s.language).toBe(language);
    }
    await patch(app, { displayCurrency: 'GBP' });
    expect((await settings(app)).language).toBe('pt-BR');
    const both = await patch(app, { displayCurrency: 'BRL', language: 'en' });
    expect(both.body.data.settings).toMatchObject({ displayCurrency: 'BRL', language: 'en' });
    // PUT de cotação e fonte também não mexem em nenhum dos dois
    await putRate(app, { currency: 'EUR', rate: 0.9 });
    await patch(app, { fxRefreshSource: 'PTAX' });
    expect(await settings(app)).toMatchObject({ displayCurrency: 'BRL', language: 'en' });
  });
});

describe('Content-Type diferente de JSON nas rotas que gravam', () => {
  let app;
  beforeEach(() => { freshDb(); app = makeCatalogApp(NOW, { fetchFn: jest.fn(async () => ok(awesome('EUR'))) }); });

  const TYPES = [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonp',
    'text/plain; application/json', 'application/octet-stream', 'text/json', 'application/xjson'];
  const routes = [
    ['PATCH', '/api/settings', '{"displayCurrency":"EUR"}'],
    ['PUT', '/api/settings/fx-rate', '{"currency":"EUR","rate":0.9}'],
    ['PUT', '/api/settings/steam-store', '{"storeId":null}'],
    ['POST', '/api/settings/fx-rate/refresh', '{"currency":"EUR"}'],
    ['POST', '/api/settings/fx-rate/refresh', ''],
  ];

  test.each(TYPES.flatMap((t) => routes.map((r) => [t, ...r])))('%s em %s %s -> 415 e nada muda', async (type, method, url, body) => {
    let req = request(app)[method.toLowerCase()](url);
    if (type !== undefined) req = req.set('Content-Type', type);
    const res = await req.send(body);
    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ success: false, error: { code: 'UNSUPPORTED_MEDIA_TYPE' } });
    const s = await settings(app);
    expect(s.displayCurrency).toBe('BRL');
    expect(s.fxRates.some((r) => r.currency === 'EUR')).toBe(false);
  });

  test('JSON com charset e em maiúsculas é aceito', async () => {
    const res = await request(app).patch('/api/settings').set('Content-Type', 'Application/JSON; charset=utf-8').send('{"displayCurrency":"EUR"}');
    expect(res.status).toBe(200);
  });

  test('GET do currency-change-preview não exige Content-Type', async () => {
    expect((await get(app, '/api/settings/currency-change-preview?currency=EUR')).status).toBe(200);
  });
});

describe('GET /api/settings/currency-change-preview hostil', () => {
  let app;
  beforeEach(() => { freshDb(); app = makeCatalogApp(NOW); });

  test('parâmetro repetido (array) e objeto aninhado -> 400 sem lançar 500', async () => {
    for (const url of [
      '/api/settings/currency-change-preview?currency=EUR&currency=BRL',
      '/api/settings/currency-change-preview?currency[]=EUR',
      '/api/settings/currency-change-preview?currency[a]=EUR',
    ]) {
      const res = await get(app, url);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(['INVALID_FIELD', 'INVALID_CURRENCY', 'UNKNOWN_FIELD']).toContain(res.body.error.code);
    }
  });

  test('minúscula, com espaço, vazia e enorme -> INVALID_CURRENCY', async () => {
    for (const value of ['eur', 'EUR%20', '%20EUR', '', 'X'.repeat(4000), 'XXX', '%00']) {
      const res = await get(app, `/api/settings/currency-change-preview?currency=${value}`);
      expectError(res, 400, 'INVALID_CURRENCY');
    }
  });

  test('parâmetro extra repetido ou desconhecido -> UNKNOWN_FIELD; nada é gravado', async () => {
    expectError(await get(app, '/api/settings/currency-change-preview?currency=EUR&x=1'), 400, 'UNKNOWN_FIELD', { field: 'x' });
    expectError(await get(app, '/api/settings/currency-change-preview'), 400, 'REQUIRED_FIELD', { field: 'currency' });
    expect((await settings(app)).displayCurrency).toBe('BRL');
  });
});

describe('PUT /api/settings/fx-rate hostil', () => {
  let app;
  beforeEach(() => { freshDb(); app = makeCatalogApp(NOW); });

  test.each([['0'], ['5'], [null], [[]], [{}], [true]])('rate %j -> 400 (tipo)', async (rate) => {
    const res = await putRate(app, { currency: 'EUR', rate });
    expect(res.status).toBe(400);
    expect(['INVALID_FIELD', 'INVALID_FX_RATE']).toContain(res.body.error.code);
    expect(await rateOf(app, 'EUR')).toBeUndefined();
  });

  test.each([[0], [-1], [-0.0001]])('rate %p -> INVALID_FX_RATE', async (rate) => {
    expectError(await putRate(app, { currency: 'EUR', rate }), 400, 'INVALID_FX_RATE');
    expect(await rateOf(app, 'EUR')).toBeUndefined();
  });

  test('1e999 (Infinity após o parse) -> recusado', async () => {
    const res = await request(app).put('/api/settings/fx-rate').set('Content-Type', JSON_TYPE).send('{"currency":"EUR","rate":1e999}');
    expect(res.status).toBe(400);
    expect(await rateOf(app, 'EUR')).toBeUndefined();
  });

  test.each([['eur'], ['USD'], ['XXX'], [''], [' EUR'], ['EUR ']])('currency %j -> INVALID_CURRENCY', async (currency) => {
    expectError(await putRate(app, { currency, rate: 0.9 }), 400, 'INVALID_CURRENCY');
  });

  test('currency nula ou numérica -> INVALID_FIELD; usdBrlRate junto com currency/rate recusado', async () => {
    expectError(await putRate(app, { currency: null, rate: 1 }), 400, 'INVALID_FIELD', { field: 'currency' });
    expectError(await putRate(app, { currency: 5, rate: 1 }), 400, 'INVALID_FIELD', { field: 'currency' });
    expectError(await putRate(app, { usdBrlRate: 5, currency: 'BRL' }), 400, 'INVALID_FIELD');
    expectError(await putRate(app, { usdBrlRate: 5, rate: 5 }), 400, 'INVALID_FIELD');
    expectError(await putRate(app, { currency: 'EUR', rate: 1, extra: 1 }), 400, 'UNKNOWN_FIELD', { field: 'extra' });
    expect((await settings(app)).fxRates).toEqual([]);
  });

  // Desde a 11.3 a API recusa esses valores (faixa manual); a cotação já gravada fora da faixa (banco antigo) segue sendo lida.
  test('cotação gravada extrema não produz NaN, Infinity nem 500 no "≈"', async () => {
    for (const rate of [1e308, 1e-300, Number.MAX_VALUE, Number.MIN_VALUE]) {
      FxRate.upsert('GBP', { rate, source: 'MANUAL', quotedAt: null, updatedAt: NOW.toISOString() }, { now: NOW });
      await patch(app, { displayCurrency: 'GBP' });
      await putRate(app, { currency: 'EUR', rate: 0.9 });
      await request(app).post('/api/deposits').set('Content-Type', JSON_TYPE)
        .send({ storeId: storeId('CSFloat'), amountStoreCents: 10000, depositedAt: '2026-11-10T12:00:00.000Z' });
      const profit = await get(app, '/api/profit/summary');
      expect(profit.status).toBe(200);
      const text = JSON.stringify(profit.body);
      expect(text).not.toMatch(/NaN|Infinity/);
      for (const v of Object.values(profit.body.data.approx)) {
        if (v !== null) expect(Number.isSafeInteger(v)).toBe(true);
      }
      getDb().prepare('DELETE FROM deposits').run();
    }
  });
});

describe('POST /api/settings/fx-rate/refresh: respostas ruins da AwesomeAPI e concorrência', () => {
  beforeEach(() => freshDb());

  test.each([
    ['ask ausente', { ask: undefined }],
    ['ask zero', { ask: '0' }],
    ['ask negativo', { ask: '-0.9' }],
    ['ask texto', { ask: 'abc' }],
    ['ask vazio', { ask: '' }],
    ['ask NaN', { ask: 'NaN' }],
    ['ask Infinity', { ask: 'Infinity' }],
    ['ask gigante', { ask: '1e308' }],
    ['ask minúsculo', { ask: '0.0000001' }],
    ['codein de outra moeda', { codein: 'GBP' }],
    ['codein minúsculo', { codein: 'eur' }],
    ['code diferente de USD', { code: 'EUR' }],
  ])('%s -> FX_INVALID_RESPONSE e nada gravado', async (_label, extra) => {
    const fetchFn = jest.fn(async () => ok(awesome('EUR', '0.9142', extra)));
    const app = makeCatalogApp(NOW, { fetchFn });
    await putRate(app, { currency: 'EUR', rate: 0.8 });
    const before = await rateOf(app, 'EUR');
    const res = await refresh(app, { currency: 'EUR' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(600);
    expect(res.body.error.code).toMatch(/^FX_/);
    expect(await rateOf(app, 'EUR')).toEqual(before);
    expect(fxRefreshIdle()).toBe(true);
  });

  const fxRefreshIdle = () => require('../../src/services/fxRateService').isRefreshInProgress() === false;

  test.each([
    ['sem a chave do par', {}],
    ['chave de outro par', awesome('GBP')],
    ['lista', []],
    ['nulo', null],
    ['texto', 'oi'],
  ])('corpo %s -> erro FX_ e nada gravado (não grava em outra moeda)', async (_label, payload) => {
    const app = makeCatalogApp(NOW, { fetchFn: jest.fn(async () => ok(payload)) });
    const res = await refresh(app, { currency: 'EUR' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.error.code).toMatch(/^FX_/);
    expect((await settings(app)).fxRates).toEqual([]);
  });

  test('HTTP 500, JSON quebrado e rede caída: erro FX_ e nada gravado; trava liberada', async () => {
    for (const fetchFn of [
      jest.fn(async () => ({ ok: false, status: 500, text: async () => 'x' })),
      jest.fn(async () => ({ ok: true, status: 200, text: async () => '{quebrado' })),
      jest.fn(async () => { throw new Error('ECONNRESET'); }),
    ]) {
      const app = makeCatalogApp(NOW, { fetchFn });
      const res = await refresh(app, { currency: 'EUR' });
      expect(res.body.error.code).toMatch(/^FX_/);
      expect((await settings(app)).fxRates).toEqual([]);
      expect(fxRefreshIdle()).toBe(true);
    }
  });

  test('uma atualização em andamento: segunda recusada, PUT manual recusado, AUTO pula BUSY; depois tudo volta ao normal', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fetchFn = jest.fn(async () => { await gate; return ok(awesome('EUR', '0.9142')); });
    const app = makeCatalogApp(NOW, { fetchFn });
    const first = refresh(app, { currency: 'EUR' }).then((r) => r);
    // espera a primeira chegar na rede
    for (let i = 0; i < 100 && fetchFn.mock.calls.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const second = await refresh(app, { currency: 'GBP' });
    expectError(second, 409, 'FX_REFRESH_IN_PROGRESS');
    const manual = await putRate(app, { currency: 'GBP', rate: 0.8 });
    expectError(manual, 409, 'FX_REFRESH_IN_PROGRESS');
    const auto = await refresh(app, { currency: 'GBP', trigger: 'AUTO' });
    expect(auto.body.data).toMatchObject({ quote: null, skipped: 'BUSY' });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    release();
    const done = await first;
    expect(done.status).toBe(200);
    expect((await rateOf(app, 'EUR')).rate).toBe(0.9142);
    expect(await rateOf(app, 'GBP')).toBeUndefined(); // nem a recusada nem a manual gravaram
    // o BUSY não gastou a tentativa automática de GBP
    const fetch2 = jest.fn(async () => ok(awesome('GBP', '0.7654')));
    const app2 = makeCatalogApp(NOW, { fetchFn: fetch2 });
    const retry = await refresh(app2, { currency: 'GBP', trigger: 'AUTO' });
    expect(retry.body.data.quote).toMatchObject({ rate: 0.7654 });
  });

  test('AUTO: a tentativa que falhou também conta (uma por moeda por processo)', async () => {
    const fetchFn = jest.fn(async () => { throw new Error('rede'); });
    const app = makeCatalogApp(NOW, { fetchFn });
    const a = await refresh(app, { currency: 'EUR', trigger: 'AUTO' });
    expect(a.body.error.code).toMatch(/^FX_/);
    const b = await refresh(app, { currency: 'EUR', trigger: 'AUTO' });
    expect(b.body.data).toMatchObject({ quote: null, skipped: 'ALREADY_RAN' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // o botão manual não é limitado pela tentativa automática
    const c = await refresh(app, { currency: 'EUR' });
    expect(c.body.error.code).toMatch(/^FX_/);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test('o AUTO nunca sobrescreve uma MANUAL, mesmo após PUT depois de outra fonte', async () => {
    const fetchFn = jest.fn(async () => ok(awesome('EUR', '0.9142')));
    const app = makeCatalogApp(NOW, { fetchFn });
    await refresh(app, { currency: 'EUR' }); // AWESOMEAPI
    await putRate(app, { currency: 'EUR', rate: 0.5 }); // vira MANUAL
    const auto = await refresh(app, { currency: 'EUR', trigger: 'AUTO' });
    expect(auto.body.data.skipped).toBe('MANUAL_RATE');
    expect(await rateOf(app, 'EUR')).toMatchObject({ rate: 0.5, source: 'MANUAL' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // o botão manual ("atualizar") pode sobrescrever
    const manualButton = await refresh(app, { currency: 'EUR' });
    expect(manualButton.status).toBe(200);
    expect(await rateOf(app, 'EUR')).toMatchObject({ rate: 0.9142, source: 'AWESOMEAPI' });
  });

  test('PTAX para qualquer moeda diferente do BRL -> FX_SOURCE_NOT_SUPPORTED sem rede (MANUAL e AUTO do botão)', async () => {
    const fetchFn = jest.fn();
    const app = makeCatalogApp(NOW, { fetchFn });
    for (const currency of ['EUR', 'JPY', 'ARS', 'CLP']) {
      expectError(await refresh(app, { currency, source: 'PTAX' }), 400, 'FX_SOURCE_NOT_SUPPORTED');
    }
    for (const source of ['ptax', 'BCB', '', 'MANUAL']) {
      const res = await refresh(app, { currency: 'EUR', source });
      expect(res.status).toBe(400);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('corpo hostil do refresh: tipos errados e campos desconhecidos', async () => {
    const app = makeCatalogApp(NOW, { fetchFn: jest.fn() });
    expectError(await refresh(app, { currency: 5 }), 400, 'INVALID_FIELD', { field: 'currency' });
    expectError(await refresh(app, { source: 5 }), 400, 'INVALID_FIELD', { field: 'source' });
    expectError(await refresh(app, { trigger: 'auto' }), 400, 'INVALID_FIELD', { field: 'trigger' });
    expectError(await refresh(app, { foo: 1 }), 400, 'UNKNOWN_FIELD', { field: 'foo' });
    expectError(await refresh(app, { currency: 'usd' }), 400, 'INVALID_CURRENCY');
    const res = await request(app).post('/api/settings/fx-rate/refresh').set('Content-Type', JSON_TYPE).send('[]');
    expect(res.status).toBe(400);
  });
});

// Cenário fixo com aporte, compras (USD e BRL), venda em USD e em BRL, saque e conferência de saldo.
function seedScenario() {
  const at = new Date('2026-11-20T12:00:00.000Z');
  const csf = storeId('CSFloat');
  const steam = storeId('Steam');
  Deposit.create({ storeId: csf, amountStoreCents: 20000, amountBrlCents: 100000, depositedAt: '2026-10-01T12:00:00.000Z', note: null }, { now: at });
  Deposit.create({ storeId: null, amountStoreCents: null, amountBrlCents: 30000, depositedAt: '2026-10-05T12:00:00.000Z', note: null }, { now: at });
  Item.create(wonSkin({
    name: 'AK-47 | Redline', acquisitionType: 'COMPRA', purchaseStoreId: csf, purchasePriceCents: 1234, purchaseCurrency: 'USD',
    acquiredAt: '2026-11-01T12:00:00.000Z', status: 'EM_ESTOQUE',
  }), { now: at });
  Item.create(wonSkin({
    name: 'M4A4 | Howl', acquisitionType: 'COMPRA', purchaseStoreId: steam, purchasePriceCents: 2500, purchaseCurrency: 'BRL',
    fxRateAtPurchase: 5.0, acquiredAt: '2026-11-02T12:00:00.000Z', status: 'EM_ESTOQUE',
  }), { now: at });
  Item.create(wonSkin({
    name: 'AWP | Asiimov',
    ...soldFields(csf, { soldAt: '2026-11-10T12:00:00.000Z', netReceivedCents: 2501, salePriceCents: 2501, saleCurrency: 'USD', saleHoldDaysApplied: 7 }),
    acquiredAt: '2026-10-01T12:00:00.000Z',
  }), { now: at });
  Item.create(wonSkin({
    name: 'USP-S | Kill Confirmed',
    ...soldFields(steam, { soldAt: '2026-11-12T12:00:00.000Z', netReceivedCents: 833, salePriceCents: 833, saleCurrency: 'BRL', saleHoldDaysApplied: 0, fxRateAtSale: 5.4321 }),
    acquiredAt: '2026-10-01T12:00:00.000Z',
  }), { now: at });
  Withdrawal.create({ storeId: csf, amountStoreCents: 1000, feeCents: 123, amountBrlCents: 5000, withdrawnAt: '2026-11-15T12:00:00.000Z', note: null }, { now: at });
}

const ENDPOINTS = ['/api/profit/summary', '/api/store-balances/current', '/api/items', '/api/items/sales', '/api/deposits', '/api/withdrawals'];

function stripApprox(value) {
  if (Array.isArray(value)) return value.map(stripApprox);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (/approx|displayCurrency/i.test(key)) continue;
      out[key] = stripApprox(inner);
    }
    return out;
  }
  return value;
}

describe('a moeda de conversão só mexe nos campos de "≈"', () => {
  async function snapshot(display) {
    freshDb({ displayCurrency: display, steamCurrency: 'BRL' });
    const app = makeCatalogApp(NOW);
    await putRate(app, { usdBrlRate: 5.4321 });
    await putRate(app, { currency: 'EUR', rate: 0.914 });
    await putRate(app, { currency: 'JPY', rate: 159.172 });
    await putRate(app, { currency: 'KRW', rate: 1349.2 });
    seedScenario();
    const out = {};
    for (const url of ENDPOINTS) {
      const res = await get(app, url);
      expect(res.status).toBe(200);
      out[url] = res.body.data;
    }
    return out;
  }

  test('USD, BRL, EUR, JPY e KRW: tudo que não é "≈" é idêntico; nada de NaN/Infinity', async () => {
    const base = await snapshot('BRL');
    for (const display of ['USD', 'EUR', 'JPY', 'KRW']) {
      const other = await snapshot(display);
      for (const url of ENDPOINTS) {
        expect(stripApprox(other[url])).toEqual(stripApprox(base[url]));
        expect(JSON.stringify(other[url])).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  test('BRL: "≈" do lucro real = round(US$ × cotação) como antes, com approxCurrency BRL', async () => {
    const snap = await snapshot('BRL');
    const profit = snap['/api/profit/summary'];
    expect(profit.approxCurrency).toBe('BRL');
    const pairs = [['deposits', 'depositsUsdCents'], ['platformBalance', 'platformBalanceUsdCents'], ['stock', 'stockUsdCents'],
      ['realProfit', 'realProfitUsdCents']];
    let checked = 0;
    for (const [approxKey, usdKey] of pairs) {
      if (!(approxKey in profit.approx) || profit[usdKey] === undefined) continue;
      const usd = profit[usdKey];
      const expected = usd === 0 ? 0 : Math.sign(usd) * Math.round(Math.abs(usd) * 5.4321);
      expect(profit.approx[approxKey]).toBe(expected);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test('moedas sem casas (JPY e KRW): todo "≈" numérico do lucro real é múltiplo de 100', async () => {
    for (const display of ['JPY', 'KRW']) {
      const profit = (await snapshot(display))['/api/profit/summary'];
      expect(profit.approxCurrency).toBe(display);
      const values = Object.values(profit.approx).filter((v) => typeof v === 'number');
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(Math.abs(v) % 100).toBe(0);
    }
  });

  test('USD: nenhum "≈" numérico em lugar nenhum (todos nulos)', async () => {
    const profit = (await snapshot('USD'))['/api/profit/summary'];
    for (const v of Object.values(profit.approx)) expect(v).toBeNull();
  });

  test('sem a cotação da moeda de conversão: "≈" nulo em todas as telas, sem erro', async () => {
    freshDb({ displayCurrency: 'CAD' });
    const app = makeCatalogApp(NOW);
    await putRate(app, { usdBrlRate: 5.4321 });
    seedScenario();
    for (const url of ENDPOINTS) {
      const res = await get(app, url);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/NaN|Infinity/);
    }
    const profit = (await get(app, '/api/profit/summary')).body.data;
    expect(profit.approxCurrency).toBe('CAD');
    for (const v of Object.values(profit.approx)) expect(v).toBeNull();
    expect(profit.realProfitUsdCents).not.toBeNull();
  });
});
