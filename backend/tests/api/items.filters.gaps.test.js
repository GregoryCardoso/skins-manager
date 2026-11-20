// Lacunas da D56 para filtros sortBy/order/stagnantOnly (testador, revisão independente da Etapa 3).
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

const get = (url, theApp = app) => request(theApp).get(url);
const ids = (res) => res.body.data.items.map((i) => i.id);
const daysAgo = (n) => new Date(Date.UTC(2026, 10, 19 - n, 15, 0, 0)).toISOString();
const sellAt = (id, soldAt, theApp = app) =>
  request(theApp).post(`/api/items/${id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 500, soldAt });

describe('GET /api/items: padrões e combinações', () => {
  test('sem sortBy a ordem é id ASC, mesmo com idades fora de ordem', async () => {
    const a = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(1) }));
    const b = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(30) }));
    const c = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(5) }));
    expect(ids(await get('/api/items'))).toEqual([a.id, b.id, c.id]);
  });

  test('stagnantOnly ausente ou false lista tudo', async () => {
    await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(1) }));
    await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(30) }));
    expect((await get('/api/items')).body.data.items).toHaveLength(2);
    expect((await get('/api/items?stagnantOnly=false')).body.data.items).toHaveLength(2);
  });

  test('stagnantOnly exclui item vendido antigo e combina com sortBy=age asc e category', async () => {
    const old1 = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(40) }));
    const old2 = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(25), category: 'CAIXA' }));
    const soldOld = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(50) }));
    await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(21) }));
    expect((await sellAt(soldOld.id, daysAgo(1))).status).toBe(200);
    expect(ids(await get('/api/items?stagnantOnly=true'))).toEqual([old1.id, old2.id]);
    expect(ids(await get('/api/items?stagnantOnly=true&sortBy=age&order=asc'))).toEqual([old2.id, old1.id]);
    expect(ids(await get('/api/items?stagnantOnly=true&sortBy=age'))).toEqual([old1.id, old2.id]);
    expect(ids(await get('/api/items?stagnantOnly=true&category=CAIXA'))).toEqual([old2.id]);
    const res = await get('/api/items?stagnantOnly=true');
    expect(res.body.data.items.every((i) => i.aging.agingBucket === 'AGARRADO')).toBe(true);
    expect(res.body.data.meta.count).toBe(2);
  });

  test('sortBy=age ordena pelo instante exato (itens do mesmo dia)', async () => {
    const later = await createItemViaApi(app, purchaseBody({ acquiredAt: '2026-11-10T18:00:00.000Z' }));
    const earlier = await createItemViaApi(app, purchaseBody({ acquiredAt: '2026-11-10T08:00:00.000Z' }));
    expect(ids(await get('/api/items?sortBy=age'))).toEqual([earlier.id, later.id]);
    expect(ids(await get('/api/items?sortBy=age&order=asc'))).toEqual([later.id, earlier.id]);
  });

  test('sortBy=turnaround: padrão asc igual a order=asc; desc mantém os em estoque no fim', async () => {
    const stock1 = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(30) }));
    const fast = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(10) }));
    const slow = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(30) }));
    const stock2 = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(2) }));
    expect((await sellAt(fast.id, daysAgo(8))).status).toBe(200); // 2 dias
    expect((await sellAt(slow.id, daysAgo(5))).status).toBe(200); // 25 dias
    const def = ids(await get('/api/items?sortBy=turnaround'));
    expect(def).toEqual(ids(await get('/api/items?sortBy=turnaround&order=asc')));
    expect(def).toEqual([fast.id, slow.id, stock1.id, stock2.id]);
    expect(ids(await get('/api/items?sortBy=turnaround&order=desc'))).toEqual([slow.id, fast.id, stock1.id, stock2.id]);
    expect(ids(await get('/api/items?sortBy=turnaround&status=VENDIDO'))).toEqual([fast.id, slow.id]);
  });

  test('parâmetro de query desconhecido é ignorado', async () => {
    await createItemViaApi(app);
    const res = await get('/api/items?foo=bar&page=2');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
  });

  test.each([
    'order=desc',
    'order=asc&stagnantOnly=true',
    'sortBy=AGE',
    'sortBy=age&order=DESC',
    'stagnantOnly=TRUE',
    'stagnantOnly=1',
    'sortBy=',
    'stagnantOnly=',
    'sortBy=age&sortBy=turnaround',
    'status=EM_ESTOQUE&status=VENDIDO',
  ])('query %s -> INVALID_QUERY', async (q) => {
    expectError(await get(`/api/items?${q}`), 400, 'INVALID_QUERY');
  });
});

describe('SLOW_ITEM_DAYS customizado (30) aplicado pela API', () => {
  test('faixas, stagnantOnly e meta.slowItemDays usam o valor do .env', async () => {
    const previous = process.env.SLOW_ITEM_DAYS;
    process.env.SLOW_ITEM_DAYS = '30';
    let isolated;
    jest.isolateModules(() => {
      const { createApp } = require('../../src/app');
      const database = require('../../src/config/database');
      isolated = { app: createApp({ now: () => new Date('2026-11-19T15:00:00.000Z') }), database };
    });
    process.env.SLOW_ITEM_DAYS = previous;
    try {
      const theApp = isolated.app;
      const make = async (n) => {
        const res = await request(theApp).post('/api/items').send(purchaseBody({ acquiredAt: daysAgo(n), purchaseStoreId: undefined, acquisitionType: 'GANHEI', purchasePriceCents: undefined }));
        expect(res.status).toBe(201);
        return res.body.data;
      };
      const d22 = await make(22);
      const d30 = await make(30);
      const d31 = await make(31);
      expect(d22.aging.agingBucket).toBe('EM_GIRO');
      expect(d30.aging.agingBucket).toBe('EM_GIRO');
      expect(d31.aging.agingBucket).toBe('AGARRADO');
      const res = await request(theApp).get('/api/items?stagnantOnly=true');
      expect(res.body.data.items.map((i) => i.id)).toEqual([d31.id]);
      expect(res.body.data.meta.slowItemDays).toBe(30);
    } finally {
      isolated.database.closeDb();
    }
  });
});
