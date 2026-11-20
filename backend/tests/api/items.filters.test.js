const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

const get = (url) => request(app).get(url);
const ids = (res) => res.body.data.items.map((i) => i.id);
// now = 2026-11-19T15:00Z; acquiredAt = mesma hora, N dias antes -> exatamente N dias.
const daysAgo = (n) => new Date(Date.UTC(2026, 10, 19 - n, 15, 0, 0)).toISOString();

async function seed() {
  const a = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(7) }));
  const b = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(8) }));
  const c = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(21) }));
  const d = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(22), category: 'CAIXA' }));
  return { a, b, c, d };
}

describe('GET /api/items filtros e ordenação', () => {
  test('faixas 7/8/21/22 e meta', async () => {
    await seed();
    const res = await get('/api/items');
    expect(res.body.data.items.map((i) => i.aging.agingBucket)).toEqual(['RECENTE', 'EM_GIRO', 'EM_GIRO', 'AGARRADO']);
    expect(res.body.data.meta).toEqual({ count: 4, slowItemDays: 21, usdBrlRate: null, generatedAt: '2026-11-19T15:00:00.000Z' });
  });

  test('stagnantOnly só 22+ em estoque; com status=VENDIDO vazio', async () => {
    const { d } = await seed();
    expect(ids(await get('/api/items?stagnantOnly=true'))).toEqual([d.id]);
    const empty = await get('/api/items?stagnantOnly=true&status=VENDIDO');
    expect(empty.body.data.items).toEqual([]);
    expect(empty.body.data.meta.count).toBe(0);
  });

  test('sortBy=age padrão desc, order=asc, desempate por id', async () => {
    const { a, b, c, d } = await seed();
    const e = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(7) }));
    expect(ids(await get('/api/items?sortBy=age'))).toEqual([d.id, c.id, b.id, a.id, e.id]);
    expect(ids(await get('/api/items?sortBy=age&order=asc'))).toEqual([a.id, e.id, b.id, c.id, d.id]);
  });

  test('sortBy=turnaround asc com em estoque no fim', async () => {
    const { a, b, c } = await seed();
    const sell = (id, soldAt) =>
      request(app).post(`/api/items/${id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 500, soldAt });
    expect((await sell(c.id, daysAgo(1))).status).toBe(200); // 20 dias
    expect((await sell(a.id, daysAgo(3))).status).toBe(200); // 4 dias
    const res = await get('/api/items?sortBy=turnaround');
    expect(ids(res).slice(0, 2)).toEqual([a.id, c.id]);
    expect(ids(res)[2]).toBe(b.id);
    const desc = await get('/api/items?sortBy=turnaround&order=desc');
    expect(ids(desc).slice(0, 2)).toEqual([c.id, a.id]);
  });

  test('status e category', async () => {
    const { d } = await seed();
    expect(ids(await get('/api/items?category=CAIXA'))).toEqual([d.id]);
    expect(ids(await get('/api/items?status=VENDIDO'))).toEqual([]);
    expect((await get('/api/items?status=EM_ESTOQUE')).body.data.items).toHaveLength(4);
  });

  test.each(['sortBy=price', 'sortBy=age&order=up', 'stagnantOnly=yes', 'order=asc', 'status=X', 'category=ZZ'])(
    'query %s -> INVALID_QUERY',
    async (q) => {
      expectError(await get(`/api/items?${q}`), 400, 'INVALID_QUERY');
    }
  );
});
