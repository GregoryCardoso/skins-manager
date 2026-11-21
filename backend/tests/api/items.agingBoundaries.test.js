'use strict';

// Fronteiras dos limites de giro (D159) e casos de borda do trade lock (D160) pela API. now = 2026-11-19T15:00:00Z.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const day = (n) => new Date(Date.UTC(2026, 10, 19 + n, 15, 0, 0)).toISOString();
const patch = (body) => request(app).patch('/api/settings').send(body);
const sell = (id, soldDay) =>
  request(app).post(`/api/items/${id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 500, soldAt: day(soldDay) });

describe('fronteiras d = F, F+1, S, S+1 (estoque e vendas)', () => {
  test.each([
    [7, 21, [[7, 'RECENTE'], [8, 'EM_GIRO'], [21, 'EM_GIRO'], [22, 'AGARRADO']]],
    [10, 30, [[10, 'RECENTE'], [11, 'EM_GIRO'], [30, 'EM_GIRO'], [31, 'AGARRADO']]],
    [1, 2, [[1, 'RECENTE'], [2, 'EM_GIRO'], [3, 'AGARRADO']]],
  ])('F=%i, S=%i no estoque', async (F, S, cases) => {
    expect((await patch({ fastTurnoverDays: F, slowItemDays: S })).status).toBe(200);
    for (const [d, bucket] of cases) {
      const item = await createItemViaApi(app, purchaseBody({ acquiredAt: day(-d) }));
      const view = (await request(app).get(`/api/items/${item.id}`)).body.data;
      expect([d, view.aging.daysForSale, view.aging.agingBucket]).toEqual([d, d, bucket]);
    }
    const stagnant = (await request(app).get('/api/items?stagnantOnly=true')).body.data.items;
    expect(stagnant.every((i) => i.aging.daysForSale > S)).toBe(true);
    expect(stagnant).toHaveLength(cases.filter(([, b]) => b === 'AGARRADO').length);
  });

  test.each([
    [7, 21, [[7, 'GIRO_RAPIDO'], [8, 'GIRO_NORMAL'], [21, 'GIRO_NORMAL'], [22, 'DEMOROU_VENDER']]],
    [10, 30, [[10, 'GIRO_RAPIDO'], [11, 'GIRO_NORMAL'], [30, 'GIRO_NORMAL'], [31, 'DEMOROU_VENDER']]],
  ])('F=%i, S=%i nas vendas', async (F, S, cases) => {
    await patch({ fastTurnoverDays: F, slowItemDays: S });
    for (const [d, bucket] of cases) {
      const item = await createItemViaApi(app, purchaseBody({ acquiredAt: day(-d) }));
      const res = await sell(item.id, 0);
      expect([d, res.body.data.item.aging.turnaroundDays, res.body.data.item.aging.turnaroundBucket]).toEqual([d, d, bucket]);
    }
  });

  test('23h59 após F ainda conta F dias (floor)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ acquiredAt: new Date(Date.UTC(2026, 10, 12, 15, 1)).toISOString() }));
    const view = (await request(app).get(`/api/items/${item.id}`)).body.data;
    expect(view.aging).toMatchObject({ daysForSale: 6, agingBucket: 'RECENTE' });
  });
});

describe('trade lock: bordas', () => {
  test('tradeUnlockAt anterior a acquiredAt conta de acquiredAt', async () => {
    const item = await createItemViaApi(app, purchaseBody({ acquiredAt: day(-10), tradeUnlockAt: day(-20) }));
    const view = (await request(app).get(`/api/items/${item.id}`)).body.data;
    expect(view.aging).toEqual({ daysInInventory: 10, daysForSale: 10, agingBucket: 'EM_GIRO' });
  });

  test('turnaroundDays limitado a 0 para dado legado (soldAt antes de tradeUnlockAt, via SQL)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ acquiredAt: day(-10) }));
    await sell(item.id, -3);
    getDb().prepare('UPDATE items SET trade_unlock_at = ? WHERE id = ?').run(day(5), item.id);
    const view = (await request(app).get(`/api/items/${item.id}`)).body.data;
    expect(view.aging).toEqual({ turnaroundDays: 0, turnaroundBucket: 'GIRO_RAPIDO', daysHeld: 7 });
    const sales = (await request(app).get('/api/items/sales')).body.data;
    expect(sales.items[0].aging.turnaroundDays).toBe(0);
    expect(sales.summary.avgTurnaroundDays).toBe(0);
    expect(view.aging.turnaroundBucket).not.toBe('EM_TRADE_LOCK');
  });

  test('em lock: venda recusada com ITEM_TRADE_LOCKED e item segue EM_TRADE_LOCK', async () => {
    const item = await createItemViaApi(app, purchaseBody({ acquiredAt: day(-1), tradeUnlockAt: day(2) }));
    const res = await sell(item.id, 0);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ITEM_TRADE_LOCKED');
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.aging.agingBucket).toBe('EM_TRADE_LOCK');
  });

  test('itens em lock com limites mudados continuam em EM_TRADE_LOCK e fora do stagnantOnly', async () => {
    await createItemViaApi(app, purchaseBody({ acquiredAt: day(-1), tradeUnlockAt: day(3) }));
    await patch({ fastTurnoverDays: 1, slowItemDays: 2 });
    const list = (await request(app).get('/api/items')).body.data.items;
    expect(list[0].aging.agingBucket).toBe('EM_TRADE_LOCK');
    expect((await request(app).get('/api/items?stagnantOnly=true')).body.data.items).toEqual([]);
  });
});
