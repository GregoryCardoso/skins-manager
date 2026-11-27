// QA da 12.8: GET /api/stores/fee-preview, casos de borda além de stores.feePreview.test.js.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, expectError } = require('../helpers/apiFixtures');
const { maxAmountCents } = require('../../src/config/constants');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const preview = (params) => request(app).get('/api/stores/fee-preview').query(params);
const base = { currency: 'USD', saleFeeType: 'DEDUCTED', rate: '0.02' };

describe('DEDUCTED x ADDED com os mesmos números', () => {
  test('DEDUCTED: líquido = preço - taxa', async () => {
    const res = await preview({ ...base, priceCents: 1000 });
    expect(res.body.data).toMatchObject({ saleFeeType: 'DEDUCTED', feeCents: 20, netCents: 980 });
  });
  test('ADDED: a taxa é calculada sobre o preço e o líquido volta a ser o preço menos a taxa (igual ao sale-quote)', async () => {
    const created = await request(app).post('/api/stores').send({ name: 'ADDED 2', currency: 'USD', saleFeeType: 'ADDED', saleFeeRate: 0.05, saleFeeRounding: 'FLOOR' });
    const quote = await request(app).get(`/api/stores/${created.body.data.id}/sale-quote`).query({ salePriceCents: 777 });
    const res = await preview({ currency: 'USD', saleFeeType: 'ADDED', rate: '0.05', rounding: 'FLOOR', priceCents: 777 });
    expect(res.status).toBe(200);
    expect(res.body.data.feeCents).toBe(quote.body.data.feeCents);
    expect(res.body.data.netCents).toBe(quote.body.data.netReceivedCents);
  });
  test('igualdade com o sale-quote em DEDUCTED para todos os arredondamentos e vários preços', async () => {
    for (const rounding of ['CEIL', 'FLOOR', 'ROUND']) {
      const created = await request(app).post('/api/stores').send({
        name: `Q ${rounding}`, currency: 'USD', saleFeeType: 'DEDUCTED', saleFeeRate: 0.0285, saleFeeRounding: rounding, saleMinFeeCents: 7,
      });
      for (const price of [10, 99, 101, 1234, 99999]) {
        const quote = await request(app).get(`/api/stores/${created.body.data.id}/sale-quote`).query({ salePriceCents: price });
        const res = await preview({ currency: 'USD', saleFeeType: 'DEDUCTED', rate: '0.0285', rounding, minCents: 7, priceCents: price });
        expect(res.body.data.feeCents).toBe(quote.body.data.feeCents);
        expect(res.body.data.netCents).toBe(quote.body.data.netReceivedCents);
      }
    }
  });
});

describe('taxa 0 e moedas sem casas', () => {
  test('taxa 0 sem mínima nem fixa: fee 0 e líquido = preço', async () => {
    const res = await preview({ ...base, rate: '0', priceCents: 1000 });
    expect(res.body.data).toMatchObject({ feeCents: 0, netCents: 1000 });
  });
  test('taxa 0 com mínima: vale a mínima', async () => {
    const res = await preview({ ...base, rate: '0', priceCents: 1000, minCents: 25 });
    expect(res.body.data.feeCents).toBe(25);
  });
  test.each([['KRW', 1000000], ['VND', 5000000], ['JPY', 150000]])('%s: preço, taxa e líquido em múltiplos de 100', async (currency, price) => {
    for (const rounding of ['CEIL', 'FLOOR', 'ROUND']) {
      const res = await preview({ currency, saleFeeType: 'DEDUCTED', rate: '0.0275', rounding, priceCents: price });
      expect(res.status).toBe(200);
      expect(res.body.data.feeCents % 100).toBe(0);
      expect(res.body.data.netCents % 100).toBe(0);
      expect(res.body.data.feeCents + res.body.data.netCents).toBe(price);
    }
  });
  test('KRW recusa preço com centavos', async () => {
    expectError(await preview({ ...base, currency: 'KRW', priceCents: 1050 }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'priceCents' });
  });
});

describe('preço enorme', () => {
  test('no teto da moeda: inteiros seguros e fee + net = preço', async () => {
    for (const currency of ['USD', 'BRL', 'JPY', 'VND']) {
      const price = maxAmountCents(currency);
      const res = await preview({ currency, saleFeeType: 'DEDUCTED', rate: '0.99', priceCents: price });
      expect(res.status).toBe(200);
      expect(Number.isSafeInteger(res.body.data.feeCents)).toBe(true);
      expect(Number.isSafeInteger(res.body.data.netCents)).toBe(true);
      expect(res.body.data.feeCents + res.body.data.netCents).toBe(price);
    }
  });
  test('acima do inteiro seguro é recusado (400), sem 500', async () => {
    const res = await preview({ ...base, priceCents: '9007199254740993' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    const res2 = await preview({ ...base, priceCents: '1e400' });
    expect(res2.status).toBe(400);
    const res3 = await preview({ ...base, minCents: '9007199254740993', priceCents: 1000 });
    expect(res3.status).toBe(400);
  });
});

describe('parâmetros inválidos devolvem código e campo no formato padrão', () => {
  test('formato do erro', async () => {
    const res = await preview({ ...base, rounding: 'UP' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: 'INVALID_QUERY', field: 'rounding' } });
    expect(typeof res.body.error.message).toBe('string');
  });
  test('parâmetro repetido (array) é recusado', async () => {
    const res = await request(app).get('/api/stores/fee-preview?currency=USD&currency=BRL&saleFeeType=DEDUCTED&rate=0.02');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
  test('taxa negativa, notação científica e vírgula', async () => {
    expect((await preview({ ...base, rate: '-0.01' })).status).toBe(400);
    expect((await preview({ ...base, rate: '2e-2' })).status).toBeGreaterThanOrEqual(200);
    expect((await preview({ ...base, rate: '0,02' })).status).toBe(400);
  });
});

describe('segurança', () => {
  test.each(['evil.example.com', 'localhost.evil.com', '127.0.0.1.evil.com'])('Host %s recusado', async (host) => {
    const res = await request(app).get('/api/stores/fee-preview').set('Host', host).query(base);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });
  test('Host 127.0.0.1 com porta é aceito', async () => {
    const res = await request(app).get('/api/stores/fee-preview').set('Host', '127.0.0.1:3001').query(base);
    expect(res.status).toBe(200);
  });
});
