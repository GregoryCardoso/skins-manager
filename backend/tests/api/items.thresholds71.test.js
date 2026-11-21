'use strict';

// T81 (7.1): com limites salvos 3/10 nas configurações, lista, detalhe, vendas e criação classificam com 3/10.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const daysAgo = (n) => new Date(Date.UTC(2026, 10, 19 - n, 15, 0, 0)).toISOString();

describe('T81: limites salvos 3/10 chegam a toda resposta de item', () => {
  // Com o padrão 7/21: 5 dias = RECENTE; 12 dias = EM_GIRO. Com 3/10: 5 = EM_GIRO; 12 = AGARRADO.
  test('lista, detalhe, filtro stagnantOnly e meta usam 3/10', async () => {
    const a = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(5) }));
    const b = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(12) }));
    expect((await request(app).patch('/api/settings').send({ fastTurnoverDays: 3, slowItemDays: 10 })).status).toBe(200);

    const list = await request(app).get('/api/items');
    const byId = Object.fromEntries(list.body.data.items.map((i) => [i.id, i.aging.agingBucket]));
    expect(byId).toEqual({ [a.id]: 'EM_GIRO', [b.id]: 'AGARRADO' });
    expect(list.body.data.meta).toMatchObject({ fastTurnoverDays: 3, slowItemDays: 10 });

    expect((await request(app).get(`/api/items/${a.id}`)).body.data.aging.agingBucket).toBe('EM_GIRO');
    expect((await request(app).get(`/api/items/${b.id}`)).body.data.aging.agingBucket).toBe('AGARRADO');
    expect((await request(app).get('/api/items?stagnantOnly=true')).body.data.items.map((i) => i.id)).toEqual([b.id]);
  });

  test('vendas e a resposta da própria venda classificam o giro com 3/10', async () => {
    const item = await createItemViaApi(app, purchaseBody({ acquiredAt: daysAgo(5) }));
    await request(app).patch('/api/settings').send({ fastTurnoverDays: 3, slowItemDays: 10 });
    const sold = await request(app)
      .post(`/api/items/${item.id}/sell`)
      .send({ saleStoreId: storeId('CSFloat'), salePriceCents: 500, soldAt: daysAgo(0) });
    expect(sold.status).toBe(200);
    expect(sold.body.data.item.aging).toMatchObject({ turnaroundDays: 5, turnaroundBucket: 'GIRO_NORMAL' }); // padrão 7 daria GIRO_RAPIDO
    const sales = await request(app).get('/api/items/sales');
    expect(sales.body.data.items[0].aging.turnaroundBucket).toBe('GIRO_NORMAL');
    expect(sales.body.data.meta).toMatchObject({ fastTurnoverDays: 3, slowItemDays: 10 });
  });

  test('criação, edição e desfazer venda também usam os limites salvos', async () => {
    await request(app).patch('/api/settings').send({ fastTurnoverDays: 3, slowItemDays: 10 });
    const created = await request(app).post('/api/items').send(purchaseBody({ acquiredAt: daysAgo(12) }));
    expect(created.status).toBe(201);
    expect(created.body.data.aging.agingBucket).toBe('AGARRADO');
    const patched = await request(app).patch(`/api/items/${created.body.data.id}`).send({ acquiredAt: daysAgo(5) });
    expect(patched.status).toBe(200);
    expect(patched.body.data.aging.agingBucket).toBe('EM_GIRO');
  });
});
