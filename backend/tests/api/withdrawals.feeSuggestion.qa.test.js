// QA da 8.2: GET /api/withdrawals/fee-suggestion (E8-Q12, D203). Aritmética inteira, limites, query inválida e loja.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { maxAmountCents } = require('../../src/config/constants');
const MAX_AMOUNT_CENTS = maxAmountCents('USD'); // teto do USD (1e10); o teto por moeda tem testes próprios
const { freshDb } = require('../helpers/fixtures');
const { makeApp, storeId, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const get = (query) => request(app).get('/api/withdrawals/fee-suggestion').query(query);
const setStore = (name, fields) => request(app).patch(`/api/stores/${storeId(name)}`).send(fields).expect(200);
const suggestion = async (name, amount) => (await get({ storeId: storeId(name), amountStoreCents: amount })).body.data;

// Oráculo exato em BigInt: min(ceil(valor * ppm / 1e6) + fixa, valor).
function oracle(amount, rate, fixed) {
  const ppm = BigInt(Math.round(rate * 1e6));
  const ceil = (BigInt(amount) * ppm + 999999n) / 1000000n;
  const total = ceil + BigInt(fixed);
  return Number(total > BigInt(amount) ? BigInt(amount) : total);
}

describe('arredondamento em aritmética inteira', () => {
  test('sem ruído de ponto flutuante: 10% de 30 = 3 (não 4), 7% de 100 = 7, 2,9% de 10000 = 290', async () => {
    await setStore('CSFloat', { withdrawalFeeRate: 0.1 });
    expect((await suggestion('CSFloat', 30)).suggestedFeeCents).toBe(3);
    await setStore('CSFloat', { withdrawalFeeRate: 0.07 });
    expect((await suggestion('CSFloat', 100)).suggestedFeeCents).toBe(7);
    await setStore('CSFloat', { withdrawalFeeRate: 0.029 });
    expect((await suggestion('CSFloat', 10000)).suggestedFeeCents).toBe(290);
  });

  test('confere com oráculo exato para várias taxas, taxas fixas e valores', async () => {
    for (const [rate, fixed] of [[0.025, 0], [0.029, 15], [0.1, 0], [0.07, 1], [0.333333, 0], [0.000001, 0], [0.9, 500]]) {
      await setStore('CSFloat', { withdrawalFeeRate: rate, withdrawalFixedFeeCents: fixed });
      for (const amount of [1, 2, 3, 7, 30, 33, 99, 100, 101, 999, 3333, 10000, 123457, 99999999]) {
        const data = await suggestion('CSFloat', amount);
        expect({ rate, fixed, amount, fee: data.suggestedFeeCents }).toEqual({ rate, fixed, amount, fee: oracle(amount, rate, fixed) });
      }
    }
  });

  test('qualquer fração arredonda para cima: 2,5% de 1 centavo = 1; de 40 = 1; de 41 = 2', async () => {
    expect((await suggestion('CSFloat', 1)).suggestedFeeCents).toBe(1);
    expect((await suggestion('CSFloat', 40)).suggestedFeeCents).toBe(1);
    expect((await suggestion('CSFloat', 41)).suggestedFeeCents).toBe(2);
  });
});

describe('taxa fixa, limite e taxa nula', () => {
  test('taxa 0 sem fixa -> 0 (não nulo, sem aviso); 99% + fixa limita ao valor', async () => {
    await setStore('CSFloat', { withdrawalFeeRate: 0 });
    expect(await suggestion('CSFloat', 500)).toMatchObject({ suggestedFeeCents: 0, warningCode: null });
    await setStore('CSFloat', { withdrawalFeeRate: 0.99, withdrawalFixedFeeCents: 50 });
    expect((await suggestion('CSFloat', 500)).suggestedFeeCents).toBe(500);
  });

  test('taxa percentual nula com taxa fixa: nulo e FEES_NOT_CONFIGURED (a fixa sozinha não conta)', async () => {
    await setStore('CSMoney', { withdrawalFeeRate: null, withdrawalFixedFeeCents: 100 });
    expect(await suggestion('CSMoney', 5000)).toEqual({
      storeId: storeId('CSMoney'), amountStoreCents: 5000, suggestedFeeCents: null, warningCode: 'FEES_NOT_CONFIGURED',
    });
  });

  test('a sugestão é sempre aceita como taxa paga (nunca passa do valor)', async () => {
    await setStore('CSFloat', { withdrawalFeeRate: 0.99, withdrawalFixedFeeCents: 999 });
    for (const amount of [1, 50, 1000]) {
      const fee = (await suggestion('CSFloat', amount)).suggestedFeeCents;
      const res = await request(app).post('/api/withdrawals').send({
        storeId: storeId('CSFloat'), amountStoreCents: amount, feeCents: fee, amountBrlCents: 100, withdrawnAt: '2026-11-10T12:00:00.000Z',
      });
      expect(res.status).toBe(201);
    }
  });
});

describe('query inválida', () => {
  test.each([
    ['sem storeId', { amountStoreCents: 100 }, 'storeId'],
    ['sem amountStoreCents', { storeId: 1 }, 'amountStoreCents'],
    ['storeId 0', { storeId: 0, amountStoreCents: 100 }, 'storeId'],
    ['storeId negativo', { storeId: -1, amountStoreCents: 100 }, 'storeId'],
    ['storeId decimal', { storeId: '1.5', amountStoreCents: 100 }, 'storeId'],
    ['storeId com sinal', { storeId: '+1', amountStoreCents: 100 }, 'storeId'],
    ['storeId notação científica', { storeId: '1e1', amountStoreCents: 100 }, 'storeId'],
    ['storeId vazio', { storeId: '', amountStoreCents: 100 }, 'storeId'],
    ['storeId enorme', { storeId: '99999999999999999999', amountStoreCents: 100 }, 'storeId'],
    ['valor negativo', { storeId: 1, amountStoreCents: -5 }, 'amountStoreCents'],
    ['valor decimal', { storeId: 1, amountStoreCents: '10.5' }, 'amountStoreCents'],
    ['valor com espaço', { storeId: 1, amountStoreCents: '10 ' }, 'amountStoreCents'],
    ['valor zero', { storeId: 1, amountStoreCents: 0 }, 'amountStoreCents'],
  ])('%s -> 400 INVALID_QUERY', async (_n, query, field) => {
    expectError(await get(query), 400, 'INVALID_QUERY', { field });
  });

  test('parâmetro repetido (array) -> INVALID_QUERY', async () => {
    expectError(await request(app).get('/api/withdrawals/fee-suggestion?storeId=1&storeId=2&amountStoreCents=100'), 400, 'INVALID_QUERY', { field: 'storeId' });
    expectError(await request(app).get('/api/withdrawals/fee-suggestion?storeId=1&amountStoreCents=1&amountStoreCents=2'), 400, 'INVALID_QUERY', { field: 'amountStoreCents' });
  });

  test('storeId é validado antes do valor', async () => {
    expectError(await get({ storeId: 'x', amountStoreCents: 'y' }), 400, 'INVALID_QUERY', { field: 'storeId' });
  });

  test('valor acima do limite -> INVALID_AMOUNT (e não INVALID_QUERY); no limite passa', async () => {
    expectError(await get({ storeId: storeId('CSFloat'), amountStoreCents: MAX_AMOUNT_CENTS + 1 }), 400, 'INVALID_AMOUNT', { field: 'amountStoreCents' });
    expect((await get({ storeId: storeId('CSFloat'), amountStoreCents: MAX_AMOUNT_CENTS })).status).toBe(200);
  });
});

describe('loja', () => {
  test('inexistente -> 400 STORE_NOT_FOUND com field storeId (mesmo padrão de referência dos corpos)', async () => {
    expectError(await get({ storeId: 9999, amountStoreCents: 100 }), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
  });

  test('zeros à esquerda são aceitos', async () => {
    const res = await get({ storeId: `0${storeId('CSFloat')}`, amountStoreCents: '0100' });
    expect(res.body.data).toMatchObject({ amountStoreCents: 100, suggestedFeeCents: 3 });
  });

  test('loja sem "permite saque" ou inativa ainda recebe a sugestão (consulta informativa, não valida saque)', async () => {
    await setStore('CSMoney', { allowsWithdrawal: false, isActive: false, withdrawalFeeRate: 0.025 });
    const res = await get({ storeId: storeId('CSMoney'), amountStoreCents: 10000 });
    expect(res.status).toBe(200);
    expect(res.body.data.suggestedFeeCents).toBe(250);
    expect((await suggestion('Steam', 10000)).warningCode).toBe('FEES_NOT_CONFIGURED');
  });

  test('não grava nada e a rota não colide com /:id', async () => {
    await get({ storeId: 1, amountStoreCents: 100 });
    const list = await request(app).get('/api/withdrawals');
    expect(list.body.data.totals.count).toBe(0);
    expectError(await request(app).patch('/api/withdrawals/fee-suggestion').send({ note: 'x' }), 400, 'INVALID_ID');
  });
});
