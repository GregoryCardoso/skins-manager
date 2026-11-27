// GET /api/stores/fee-preview (12.8): exemplo de taxa de uma loja ainda não gravada, pelas mesmas Strategies do sale-quote.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, expectError } = require('../helpers/apiFixtures');
const { CURRENCIES, ZERO_DECIMAL_CURRENCIES, examplePriceCents, maxAmountCents } = require('../../src/config/constants');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const preview = (params) => request(app).get('/api/stores/fee-preview').query(params);
const base = { currency: 'USD', saleFeeType: 'DEDUCTED', rate: '0.02' };

describe('exemplos reais da CSFloat (2%, CEIL)', () => {
  test.each([[3, 1], [120, 3], [125, 3], [130, 3]])('preço %i centavos -> taxa %i', async (price, fee) => {
    const res = await preview({ ...base, priceCents: price });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ currency: 'USD', saleFeeType: 'DEDUCTED', priceCents: price, feeCents: fee, netCents: price - fee });
  });
});

describe('arredondamento, mínima e fixa', () => {
  test('CEIL, ROUND e FLOOR mudam a taxa', async () => {
    const fee = async (rounding, priceCents) => (await preview({ ...base, priceCents, rounding })).body.data.feeCents;
    expect(await fee('CEIL', 120)).toBe(3);
    expect(await fee('ROUND', 120)).toBe(2);
    expect(await fee('FLOOR', 120)).toBe(2);
    expect(await fee('CEIL', 130)).toBe(3);
    expect(await fee('ROUND', 130)).toBe(3);
    expect(await fee('FLOOR', 130)).toBe(2);
  });
  test('rounding ausente = CEIL', async () => {
    expect((await preview({ ...base, priceCents: 120 })).body.data.feeCents).toBe(3);
  });
  test('taxa mínima e fixa entram pela fórmula da 2.4', async () => {
    const res = await preview({ ...base, priceCents: 1000, minCents: 50, fixedCents: 10 });
    expect(res.body.data.feeCents).toBe(60); // max(20, 50) + 10
    expect(res.body.data.netCents).toBe(940);
  });
  test('minCents vazio = sem mínima', async () => {
    const res = await preview({ ...base, priceCents: 1000, minCents: '' });
    expect(res.body.data.feeCents).toBe(20);
  });
});

describe('ADDED', () => {
  test('é igual ao sale-quote de uma loja gravada com os mesmos parâmetros', async () => {
    const created = await request(app).post('/api/stores').send({
      name: 'Teste ADDED', currency: 'EUR', saleFeeType: 'ADDED', saleFeeRate: 0.1, saleFeeRounding: 'ROUND', saleMinFeeCents: 30, saleFixedFeeCents: 5,
    });
    expect(created.status).toBe(201);
    const quote = await request(app).get(`/api/stores/${created.body.data.id}/sale-quote`).query({ salePriceCents: 1500 });
    const res = await preview({
      currency: 'EUR', saleFeeType: 'ADDED', rate: '0.1', rounding: 'ROUND', minCents: 30, fixedCents: 5, priceCents: 1500,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.feeCents).toBe(quote.body.data.feeCents);
    expect(res.body.data.netCents).toBe(quote.body.data.netReceivedCents);
  });
});

describe('moedas e preço de exemplo', () => {
  test('sem priceCents devolve o preço de exemplo da moeda', async () => {
    const usd = await preview(base);
    expect(usd.body.data.priceCents).toBe(1000);
    const brl = await preview({ ...base, currency: 'BRL' });
    expect(brl.body.data.priceCents).toBe(examplePriceCents('BRL'));
  });
  test('JPY: múltiplo de 100 passa e 15,5 é recusado', async () => {
    const ok = await preview({ ...base, currency: 'JPY', priceCents: 150000 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.priceCents % 100).toBe(0);
    expect(ok.body.data.feeCents % 100).toBe(0);
    expectError(await preview({ ...base, currency: 'JPY', priceCents: 1550 }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'priceCents' });
    expectError(await preview({ ...base, currency: 'JPY', minCents: 1550, priceCents: 150000 }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'minCents' });
    expectError(await preview({ ...base, currency: 'JPY', fixedCents: 1, priceCents: 150000 }), 400, 'AMOUNT_PRECISION_INVALID', { field: 'fixedCents' });
  });
  test('VND no teto passa e USD acima do teto é recusado com a moeda e o limite', async () => {
    const ok = await preview({ ...base, currency: 'VND', priceCents: maxAmountCents('VND') });
    expect(ok.status).toBe(200);
    const max = maxAmountCents('USD');
    expect((await preview({ ...base, priceCents: max })).status).toBe(200);
    expectError(await preview({ ...base, priceCents: max + 1 }), 400, 'INVALID_QUERY', {
      field: 'priceCents', params: { maxCents: max, currency: 'USD' },
    });
  });
  test('a taxa maior que o preço dá NET_RECEIVED_NEGATIVE', async () => {
    expectError(await preview({ ...base, priceCents: 100, fixedCents: 500 }), 400, 'NET_RECEIVED_NEGATIVE');
  });
});

describe('examplePriceCents', () => {
  test.each(CURRENCIES)('%s: inteiro positivo alinhado à unidade mínima e dentro do teto', (currency) => {
    const price = examplePriceCents(currency);
    const unit = ZERO_DECIMAL_CURRENCIES.includes(currency) ? 100 : 1;
    expect(Number.isSafeInteger(price)).toBe(true);
    expect(price).toBeGreaterThan(0);
    expect(price % unit).toBe(0);
    expect(price).toBeLessThanOrEqual(maxAmountCents(currency));
  });
  test('USD é US$ 10', () => expect(examplePriceCents('USD')).toBe(1000));
  test('o exemplo de toda moeda passa pela prévia', async () => {
    for (const currency of CURRENCIES) {
      const res = await preview({ ...base, currency });
      expect(res.status).toBe(200);
    }
  });
});

describe('validação da forma', () => {
  test.each([
    [{ ...base, currency: 'XXX' }, 'currency'],
    [{ saleFeeType: 'DEDUCTED', rate: '0.02' }, 'currency'],
    [{ ...base, saleFeeType: 'X' }, 'saleFeeType'],
    [{ currency: 'USD', rate: '0.02' }, 'saleFeeType'],
    [{ ...base, rate: 'abc' }, 'rate'],
    [{ currency: 'USD', saleFeeType: 'DEDUCTED' }, 'rate'],
    [{ ...base, rounding: 'UP' }, 'rounding'],
    [{ ...base, minCents: '-1' }, 'minCents'],
    [{ ...base, fixedCents: '1.5' }, 'fixedCents'],
    [{ ...base, priceCents: '0' }, 'priceCents'],
    [{ ...base, priceCents: 'x' }, 'priceCents'],
    [{ ...base, extra: '1' }, 'extra'],
  ])('%j -> INVALID_QUERY em %s', async (params, field) => {
    expectError(await preview(params), 400, 'INVALID_QUERY', { field });
  });
  test('taxa fora de 0 <= r < 1 ou com casas demais -> INVALID_RATE', async () => {
    expectError(await preview({ ...base, rate: '1' }), 400, 'INVALID_RATE', { field: 'rate' });
    expectError(await preview({ ...base, rate: '0.0000001' }), 400, 'INVALID_RATE', { field: 'rate' });
    expect((await preview({ ...base, rate: '0' })).status).toBe(200);
  });
});

describe('roteamento e segurança', () => {
  test('a rota não é capturada por /:id', async () => {
    const res = await preview(base);
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
  });
  test('Host estranho é recusado', async () => {
    const res = await request(app).get('/api/stores/fee-preview').set('Host', 'evil.example.com').query(base);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });
  test('não grava nada', async () => {
    const before = (await request(app).get('/api/stores')).body.data.length;
    await preview(base);
    expect((await request(app).get('/api/stores')).body.data).toHaveLength(before);
  });
});
