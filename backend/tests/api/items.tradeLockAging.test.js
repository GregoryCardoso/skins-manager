'use strict';

// Giro contado a partir da liberação do trade lock (D160) pela API. now = 2026-11-19T15:00:00Z.
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

const get = (url) => request(app).get(url);
const ids = (res) => res.body.data.items.map((i) => i.id);
const day = (n) => new Date(Date.UTC(2026, 10, 19 + n, 15, 0, 0)).toISOString(); // n < 0 passado, n > 0 futuro
const make = (acquiredDaysAgo, unlockDay, extra = {}) =>
  createItemViaApi(app, purchaseBody({
    acquiredAt: day(-acquiredDaysAgo),
    ...(unlockDay === undefined ? {} : { tradeUnlockAt: day(unlockDay) }),
    ...extra,
  }));
const sell = (id, soldDay) =>
  request(app).post(`/api/items/${id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 500, soldAt: day(soldDay) });

describe('estoque: daysForSale e EM_TRADE_LOCK', () => {
  test('liberado conta da liberação; daysInInventory continua desde a aquisição', async () => {
    const a = await make(30, -20); // à venda há 20
    const res = await get(`/api/items/${a.id}`);
    expect(res.body.data.aging).toEqual({ daysInInventory: 30, daysForSale: 20, agingBucket: 'EM_GIRO' });
  });

  test('em lock: EM_TRADE_LOCK, daysForSale nulo e tradeLock com tempo restante', async () => {
    const a = await make(2, 3);
    const view = (await get(`/api/items/${a.id}`)).body.data;
    expect(view.aging).toEqual({ daysInInventory: 2, daysForSale: null, agingBucket: 'EM_TRADE_LOCK' });
    expect(view.tradeLock).toMatchObject({ isLocked: true });
  });

  test('sem tradeUnlockAt conta de acquiredAt (nada muda)', async () => {
    const a = await make(25);
    expect((await get(`/api/items/${a.id}`)).body.data.aging).toEqual({ daysInInventory: 25, daysForSale: 25, agingBucket: 'AGARRADO' });
  });

  test('GANHEI com tradeUnlockAt: mesma regra', async () => {
    const g = await createItemViaApi(app, {
      catalogId: purchaseBody().catalogId, acquisitionType: 'GANHEI', acquiredAt: day(-40), tradeUnlockAt: day(-5),
    });
    expect((await get(`/api/items/${g.id}`)).body.data.aging).toMatchObject({ daysForSale: 5, agingBucket: 'RECENTE' });
  });

  test('tradeUnlockAt exatamente igual a now: liberado com 0 dias', async () => {
    const a = await make(10, 0);
    expect((await get(`/api/items/${a.id}`)).body.data.aging).toMatchObject({ daysForSale: 0, agingBucket: 'RECENTE' });
  });

  test('desfazer a venda de item ainda em lock (dado legado) volta a EM_TRADE_LOCK', async () => {
    const a = await make(10, -5);
    expect((await sell(a.id, 0)).status).toBe(200);
    // A API impede vender em lock; o dado legado é simulado direto no banco.
    getDb().prepare('UPDATE items SET trade_unlock_at = ? WHERE id = ?').run(day(2), a.id);
    const sold = (await get(`/api/items/${a.id}`)).body.data;
    expect(sold.aging).toMatchObject({ turnaroundDays: 0, turnaroundBucket: 'GIRO_RAPIDO' });
    const un = await request(app).post(`/api/items/${a.id}/unsell`).set('Content-Type', 'application/json');
    expect(un.body.data.aging.agingBucket).toBe('EM_TRADE_LOCK');
  });
});

describe('filtros e ordenações', () => {
  test('stagnantOnly conta da liberação e exclui itens em lock', async () => {
    const stagnant = await make(40, -30); // à venda há 30
    await make(40, -5); // aquisição antiga, liberado há 5
    await make(60, 3); // em lock
    await make(30); // sem lock, 30 dias
    const res = await get('/api/items?stagnantOnly=true');
    expect(ids(res).slice(0, 1)).toEqual([stagnant.id]);
    expect(res.body.data.items.every((i) => i.aging.agingBucket === 'AGARRADO')).toBe(true);
    expect(res.body.data.items).toHaveLength(2);
  });

  test('sortBy=age: lock sempre no fim (desc e asc), por tradeUnlockAt crescente e depois id', async () => {
    const old = await make(30, -20); // 20 dias à venda
    const fresh = await make(9, -2); // 2 dias à venda
    const lockLater = await make(1, 5);
    const lockSoon = await make(1, 1);
    const lockSoon2 = await make(1, 1);
    const desc = await get('/api/items?sortBy=age');
    expect(ids(desc)).toEqual([old.id, fresh.id, lockSoon.id, lockSoon2.id, lockLater.id]);
    const asc = await get('/api/items?sortBy=age&order=asc');
    expect(ids(asc)).toEqual([fresh.id, old.id, lockSoon.id, lockSoon2.id, lockLater.id]);
  });

  test('sortBy=age usa a liberação e não a aquisição', async () => {
    const acquiredOld = await make(60, -3); // liberado há 3 dias
    const acquiredNew = await make(10); // sem lock, 10 dias
    expect(ids(await get('/api/items?sortBy=age'))).toEqual([acquiredNew.id, acquiredOld.id]);
  });
});

describe('vendas: turnaroundDays, daysHeld e resumo', () => {
  test('turnaround conta da liberação até soldAt; daysHeld desde a aquisição', async () => {
    const a = await make(20, -12); // vendido hoje: 12 dias após liberar, 20 de posse
    const res = await sell(a.id, 0);
    expect(res.status).toBe(200);
    expect(res.body.data.item.aging).toEqual({ turnaroundDays: 12, turnaroundBucket: 'GIRO_NORMAL', daysHeld: 20 });
  });

  test('venda no mesmo instante da liberação: 0 dias, GIRO_RAPIDO', async () => {
    const a = await make(10, -4);
    const res = await sell(a.id, -4);
    expect(res.body.data.item.aging).toMatchObject({ turnaroundDays: 0, turnaroundBucket: 'GIRO_RAPIDO', daysHeld: 6 });
  });

  test('sortBy=turnaround na lista de vendas e de itens usa a nova contagem', async () => {
    const a = await make(30, -5); // 5 dias após liberar
    const b = await make(10); // 10 dias
    await sell(a.id, 0);
    await sell(b.id, 0);
    expect(ids(await get('/api/items/sales?sortBy=turnaround'))).toEqual([a.id, b.id]);
    expect(ids(await get('/api/items/sales?sortBy=turnaround&order=desc'))).toEqual([b.id, a.id]);
    expect(ids(await get('/api/items?status=VENDIDO&sortBy=turnaround')).slice(0, 2)).toEqual([a.id, b.id]);
  });

  test('avgTurnaroundDays do resumo e avgDaysToSell do stats contam da liberação', async () => {
    const a = await make(30, -6);
    const b = await make(30, -10);
    await sell(a.id, 0);
    await sell(b.id, 0);
    const sales = await get('/api/items/sales');
    expect(sales.body.data.summary.avgTurnaroundDays).toBe(8);
    expect(sales.body.data.items[0].stats.avgDaysToSell).toBe(8);
  });
});
