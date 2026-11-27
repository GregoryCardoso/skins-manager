'use strict';

// QA da 12.6b (D370): paridade da prévia do desfazer venda com o saldo real após o POST /unsell, em vários cenários,
// moedas sem casas decimais, nenhum efeito colateral, loja apagada e erros.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, NOW, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');
const FxRate = require('../../src/models/FxRate');

afterAll(() => closeDb());

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp(NOW);
});

const JSON_TYPE = 'application/json';
const preview = (id, a = app) => request(a).get(`/api/items/${id}/unsell-preview`);
const post = (url, body = {}, a = app) => request(a).post(url).set('Content-Type', JSON_TYPE).send(body);
const sellVia = (id, body) => post(`/api/items/${id}/sell`, body);
const balanceOf = async (name) => (await request(app).get('/api/store-balances/current')).body.data.stores.find((row) => row.storeName === name);
const csfloatSale = (extra = {}) => ({ saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...extra });
const tableCounts = () => {
  const db = getDb();
  return Object.fromEntries(['items', 'deposits', 'withdrawals', 'store_balances', 'stores', 'settings'].map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
};

async function soldItem(body = csfloatSale(), purchase = {}) {
  const item = await createItemViaApi(app, purchaseBody({ acquiredAt: '2026-11-01T12:00:00.000Z', ...purchase }));
  expect((await sellVia(item.id, body)).status).toBe(200);
  return item;
}

// Prévia -> unsell -> saldo real: o "depois" da prévia tem de ser o saldo que a API passa a mostrar.
async function expectParity(item, storeName) {
  const { data } = (await preview(item.id)).body;
  const before = await balanceOf(storeName);
  expect(before.availableCents).toBe(data.availableBeforeCents);
  expect(before.pending.cents).toBe(data.pendingBeforeCents);
  expect((await post(`/api/items/${item.id}/unsell`)).status).toBe(200);
  const after = await balanceOf(storeName);
  expect(after.availableCents).toBe(data.availableAfterCents);
  expect(after.pending.cents).toBe(data.pendingAfterCents);
  expect(data.balanceEffectCents).toBe((after.availableCents - before.availableCents) + (after.pending.cents - before.pending.cents));
  return data;
}

describe('paridade da prévia com o saldo real após o unsell', () => {
  const cases = [
    ['retida', csfloatSale(), (d) => expect(d.wasReleased).toBe(false)],
    ['liberada', csfloatSale({ soldAt: '2026-11-05T12:00:00.000Z' }), (d) => expect(d.wasReleased).toBe(true)],
    ['now exatamente igual à liberação', csfloatSale({ soldAt: '2026-11-12T15:00:00.000Z' }), (d) => {
      expect(d.wasReleased).toBe(true);
      expect(d.pendingBeforeCents).toBe(0);
    }],
    ['um instante antes da liberação (retida)', csfloatSale({ soldAt: '2026-11-12T15:00:00.001Z' }), (d) => expect(d.wasReleased).toBe(false)],
  ];
  test.each(cases)('%s', async (_name, body, check) => {
    const item = await soldItem(body);
    await soldItem(csfloatSale({ soldAt: '2026-11-03T12:00:00.000Z' })); // outra venda na mesma loja não pode interferir
    const data = await expectParity(item, 'CSFloat');
    check(data);
  });

  test('holding: a venda feita do holding volta ao holding e o saldo bate', async () => {
    const item = await createItemViaApi(app, purchaseBody({ acquiredAt: '2026-11-01T12:00:00.000Z' }));
    await post(`/api/items/${item.id}/off-sale`).then((r) => expect(r.status).toBe(200));
    await sellVia(item.id, csfloatSale());
    const data = await expectParity(item, 'CSFloat');
    expect(data.returnsTo).toBe('OFF_SALE');
    const back = await request(app).get(`/api/items/${item.id}`);
    expect(back.body.data.saleState).toBe('OFF_SALE');
  });

  test('item que volta à venda normal: FOR_SALE e o item volta a EM_ESTOQUE', async () => {
    const item = await soldItem();
    const data = await expectParity(item, 'CSFloat');
    expect(data.returnsTo).toBe('FOR_SALE');
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.status).toBe('EM_ESTOQUE');
  });

  test('venda importada com a liberação real (saleReleaseAt) no futuro e no passado', async () => {
    const future = await soldItem(csfloatSale({ soldAt: '2026-11-05T12:00:00.000Z' }));
    getDb().prepare('UPDATE items SET sale_release_at = ? WHERE id = ?').run('2026-11-30T00:00:00.000Z', future.id);
    expect((await expectParity(future, 'CSFloat')).wasReleased).toBe(false);

    const past = await soldItem(csfloatSale({ soldAt: '2026-11-18T12:00:00.000Z' }));
    getDb().prepare('UPDATE items SET sale_release_at = ? WHERE id = ?').run('2026-11-19T00:00:00.000Z', past.id);
    const data = await expectParity(past, 'CSFloat');
    expect(data).toMatchObject({ wasReleased: true, releasesAt: '2026-11-19T00:00:00.000Z' });
  });

  test('moeda da venda diferente da loja: efeito 0 e o saldo não muda', async () => {
    const item = await soldItem(csfloatSale({ soldAt: '2026-11-05T12:00:00.000Z' }));
    getDb().prepare("UPDATE items SET sale_currency = 'EUR', fx_rate_at_sale = 0.9 WHERE id = ?").run(item.id);
    const data = await expectParity(item, 'CSFloat');
    expect(data).toMatchObject({ balanceEffectCents: 0, currencyMismatch: true });
    expect(Object.is(data.balanceEffectCents, -0)).toBe(false);
  });

  test('soldAt depois do relógio: fora do saldo, efeito 0 e não liberada', async () => {
    const item = await soldItem();
    getDb().prepare('UPDATE items SET sold_at = ? WHERE id = ?').run('2026-11-20T10:00:00.000Z', item.id);
    const data = await expectParity(item, 'CSFloat');
    expect(data).toMatchObject({ balanceEffectCents: 0, wasReleased: false });
  });

  test('saldo disponível negativo depois do desfazer: sem erro e igual ao saldo real', async () => {
    const item = await soldItem(csfloatSale({ soldAt: '2026-11-05T12:00:00.000Z' }));
    const data = await expectParity(item, 'CSFloat');
    expect(data.availableAfterCents).toBeLessThan(0);
  });
});

describe('moedas da loja (inclusive sem casas decimais)', () => {
  const cases = [
    ['BRL', 5, 1000, 1150],
    ['JPY', 150, 100000, 105000],
    ['KRW', 1400, 130000, 150000],
    ['VND', 25000, 2500000, 2800000],
  ];
  test.each(cases)('loja em %s: prévia = saldo real, valores inteiros', async (currency, rate, buy, sell) => {
    const created = await post('/api/stores', {
      name: `Loja ${currency}`, currency, saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeeRounding: 'CEIL', allowsWithdrawal: true,
    });
    expect(created.status).toBe(201);
    const store = created.body.data;
    FxRate.upsert(currency, { rate, source: 'MANUAL' }, { now: NOW });
    const item = await createItemViaApi(app, purchaseBody({
      purchaseStoreId: store.id, purchasePriceCents: buy, fxRateAtPurchase: rate, acquiredAt: '2026-11-01T12:00:00.000Z',
    }));
    const sold = await sellVia(item.id, { saleStoreId: store.id, salePriceCents: sell, fxRateAtSale: rate, soldAt: '2026-11-18T12:00:00.000Z' });
    expect(sold.status).toBe(200);
    const net = sold.body.data.item.netReceivedCents;
    const { data } = (await preview(item.id)).body;
    expect(data).toMatchObject({ storeCurrency: currency, storeName: `Loja ${currency}`, balanceEffectCents: -net, estimated: true });
    for (const key of ['balanceEffectCents', 'availableBeforeCents', 'availableAfterCents', 'pendingBeforeCents', 'pendingAfterCents', 'effectUsdCents']) {
      expect(Number.isInteger(data[key])).toBe(true);
    }
    expect(data.effectUsdCents).toBe(-Math.round(net / rate));
    if (['JPY', 'KRW', 'VND'].includes(currency)) expect(Math.abs(data.balanceEffectCents) % 100).toBe(0);
    await expectParity(item, `Loja ${currency}`);
  });
});

describe('efeitos colaterais e casos defensivos', () => {
  test('várias chamadas não gravam nada em nenhuma tabela nem mudam o item', async () => {
    const item = await soldItem();
    const rowBefore = getDb().prepare('SELECT * FROM items WHERE id = ?').get(item.id);
    const counts = tableCounts();
    const settingsBefore = getDb().prepare('SELECT * FROM settings').all();
    for (let i = 0; i < 3; i += 1) expect((await preview(item.id)).status).toBe(200);
    expect(tableCounts()).toEqual(counts);
    expect(getDb().prepare('SELECT * FROM items WHERE id = ?').get(item.id)).toEqual(rowBefore);
    expect(getDb().prepare('SELECT * FROM settings').all()).toEqual(settingsBefore);
  });

  test('loja da venda apagada (defensivo): loja nula e efeito 0, sem erro', async () => {
    const item = await soldItem();
    const db = getDb();
    db.pragma('foreign_keys = OFF');
    try {
      db.prepare('DELETE FROM stores WHERE id = ?').run(storeId('CSFloat'));
    } finally {
      db.pragma('foreign_keys = ON');
    }
    const res = await preview(item.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      storeId: null, storeName: null, storeCurrency: null, balanceEffectCents: 0, availableBeforeCents: 0, availableAfterCents: 0,
      pendingBeforeCents: 0, pendingAfterCents: 0,
    });
    expect(Object.is(res.body.data.balanceEffectCents, -0)).toBe(false);
  });

  test('depois do unsell a prévia responde 409 ITEM_NOT_SOLD', async () => {
    const item = await soldItem();
    await post(`/api/items/${item.id}/unsell`);
    expectError(await preview(item.id), 409, 'ITEM_NOT_SOLD');
  });

  test('ids inválidos: 0, negativo, decimal e texto dão 400 INVALID_ID', async () => {
    for (const bad of ['0', '-1', '1.5', 'abc']) {
      const res = await request(app).get(`/api/items/${bad}/unsell-preview`);
      expectError(res, 400, 'INVALID_ID');
    }
  });

  test('item inexistente 404; consumido 409; Host estranho (127.0.0.1 ok, outro recusado)', async () => {
    expectError(await preview(987654), 404, 'ITEM_NOT_FOUND');
    const consumed = await createItemViaApi(app, purchaseBody());
    getDb().prepare("UPDATE items SET status = 'CONSUMIDO', consumed_at = '2026-11-10T00:00:00.000Z' WHERE id = ?").run(consumed.id);
    expectError(await preview(consumed.id), 409, 'ITEM_CONSUMED');
    const item = await soldItem();
    expect((await request(app).get(`/api/items/${item.id}/unsell-preview`).set('Host', '127.0.0.1:3001')).status).toBe(200);
    for (const host of ['evil.example.com', 'localhost.evil.com', '192.168.0.10']) {
      const res = await request(app).get(`/api/items/${item.id}/unsell-preview`).set('Host', host);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.success).toBe(false);
    }
  });

  test('só GET: POST/PUT/DELETE na rota da prévia não existem', async () => {
    const item = await soldItem();
    for (const method of ['post', 'put', 'delete']) {
      const res = await request(app)[method](`/api/items/${item.id}/unsell-preview`).set('Content-Type', JSON_TYPE).send({});
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.success).toBe(false);
    }
  });
});
