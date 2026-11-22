// Formato padronizado de sucesso/erro, ids inválidos, 404 e JSON malformado em todas as rotas da Etapa 3.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { CAT, makeCatalogApp, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const ID_ROUTES = [
  ['get', (id) => `/api/items/${id}`, undefined],
  ['patch', (id) => `/api/items/${id}`, { originDetail: 'x' }],
  ['delete', (id) => `/api/items/${id}`, undefined],
  ['post', (id) => `/api/items/${id}/sell`, { saleStoreId: 1, salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z' }],
  ['post', (id) => `/api/items/${id}/unsell`, undefined],
];

function call(method, url, body) {
  const req = request(app)[method](url);
  if (['post', 'patch', 'put'].includes(method)) req.set('Content-Type', 'application/json');
  return body === undefined ? req : req.send(body);
}

describe('ids inválidos e 404 em todas as rotas com :id', () => {
  const BAD = ['abc', '0', '-1', '1.5', '1e2', '9007199254740993', '%20'];
  test.each(ID_ROUTES.map(([m, u, b]) => [`${m.toUpperCase()} ${u(':id')}`, m, u, b]))(
    '%s: ids inválidos -> 400 INVALID_ID; 999 -> 404 ITEM_NOT_FOUND',
    async (_label, method, url, body) => {
      for (const id of BAD) {
        const res = await call(method, url(id), body);
        expectError(res, 400, 'INVALID_ID');
      }
      expectError(await call(method, url(999), body), 404, 'ITEM_NOT_FOUND');
    }
  );

  test('id com zero à esquerda é aceito como o mesmo item', async () => {
    const item = await createItemViaApi(app);
    const res = await request(app).get(`/api/items/0${item.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(item.id);
  });
});

describe('JSON malformado -> 400 INVALID_JSON em todas as rotas com corpo', () => {
  test.each([
    ['post', '/api/items'],
    ['patch', '/api/items/1'],
    ['post', '/api/items/1/sell'],
    ['post', '/api/items/1/unsell'],
    ['put', '/api/settings/fx-rate'],
  ])('%s %s', async (method, url) => {
    const res = await request(app)[method](url).set('Content-Type', 'application/json').send('{"name": ');
    expectError(res, 400, 'INVALID_JSON');
  });
});

describe('formato de sucesso e cabeçalhos', () => {
  test('respostas de sucesso têm só { success: true, data }', async () => {
    const item = await createItemViaApi(app);
    const responses = [
      await request(app).get('/api/items'),
      await request(app).get(`/api/items/${item.id}`),
      await request(app).get('/api/items/stats?name=x&category=SKIN'),
      await request(app).get('/api/stores'),
      await request(app).get('/api/settings'),
      await request(app).patch(`/api/items/${item.id}`).send({ originDetail: 'y' }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
      expect(res.body.success).toBe(true);
    }
  });

  test('listagem: { items, meta } com as chaves da D49', async () => {
    const res = await request(app).get('/api/items');
    expect(Object.keys(res.body.data).sort()).toEqual(['items', 'meta']);
    expect(Object.keys(res.body.data.meta).sort()).toEqual(['count', 'fastTurnoverDays', 'generatedAt', 'saleStateCounts', 'slowItemDays', 'usdBrlRate']);
  });

  test('ItemView tem tradeLock, aging, minPrices, saleProfitUsdCents e stats', async () => {
    const item = await createItemViaApi(app);
    for (const key of ['tradeLock', 'aging', 'minPrices', 'saleProfitUsdCents', 'stats']) expect(item).toHaveProperty(key);
    expect(Object.keys(item.tradeLock).sort()).toEqual(['formatted', 'isLocked', 'remainingMs', 'tradeUnlockAt']);
  });

  test('erros não expõem X-Powered-By e são JSON', async () => {
    const res = await request(app).get('/api/items/abc');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  test('método não suportado em rota existente cai no 404 padrão', async () => {
    expectError(await request(app).put('/api/items/1').send({ name: 'x' }), 404, 'NOT_FOUND');
    expectError(await request(app).delete('/api/items').send(), 404, 'NOT_FOUND');
  });
});
