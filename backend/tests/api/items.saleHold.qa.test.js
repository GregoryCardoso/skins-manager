// QA do snapshot da retenção (D214): loja da VENDA (não da compra), listagens, edição pós-venda e venda com líquido manual.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const sellBody = (name, extra = {}) => ({ saleStoreId: storeId(name), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...extra });
const sell = (id, body) => request(app).post(`/api/items/${id}/sell`).send(body);
const snapshotOf = (id) => getDb().prepare('SELECT sale_hold_days_applied AS h FROM items WHERE id = ?').get(id).h;
const setHold = (name, days) => request(app).patch(`/api/stores/${storeId(name)}`).send({ saleHoldDays: days }).expect(200);
const steamBuy = () => purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 1000, fxRateAtPurchase: 5 });
const steamSale = (extra = {}) => sellBody('Steam', { salePriceCents: 1150, fxRateAtSale: 5.5, ...extra });

describe('a retenção vem da loja da VENDA', () => {
  test('compra na Steam (0) e venda na CSFloat (7) grava 7; compra na CSFloat (7) e venda na Steam (0) grava 0', async () => {
    const a = await createItemViaApi(app, steamBuy());
    expect((await sell(a.id, sellBody('CSFloat'))).body.data.item.saleHoldDaysApplied).toBe(7);
    expect(snapshotOf(a.id)).toBe(7);

    const b = await createItemViaApi(app); // compra na CSFloat
    expect((await sell(b.id, steamSale())).body.data.item.saleHoldDaysApplied).toBe(0);
    expect(snapshotOf(b.id)).toBe(0);
  });

  test('mudar a retenção da loja de COMPRA não afeta a venda; só a da loja de venda conta', async () => {
    const item = await createItemViaApi(app); // comprada na CSFloat
    await setHold('CSFloat', 20);
    await setHold('CSMoney', 11);
    const res = await sell(item.id, sellBody('CSMoney', { netReceivedCents: 100 }));
    expect(res.body.data.item.saleHoldDaysApplied).toBe(11);
  });

  test('retenção 0 (loja nova padrão) e 30 (máximo) gravam exatamente esses valores', async () => {
    const created = (await request(app).post('/api/stores').send({
      name: 'Nova', currency: 'USD', saleFeeType: 'DEDUCTED', saleFeeRate: 0.05,
    }).expect(201)).body.data;
    expect(created.saleHoldDays).toBe(0);
    const a = await createItemViaApi(app);
    await sell(a.id, { ...sellBody('CSFloat'), saleStoreId: created.id }).then((r) => expect(r.status).toBe(200));
    expect(snapshotOf(a.id)).toBe(0);
    await request(app).patch(`/api/stores/${created.id}`).send({ saleHoldDays: 30 }).expect(200);
    const b = await createItemViaApi(app);
    await sell(b.id, { ...sellBody('CSFloat'), saleStoreId: created.id });
    expect(snapshotOf(b.id)).toBe(30);
  });

  test('venda com líquido manual também grava o snapshot', async () => {
    const item = await createItemViaApi(app);
    const res = await sell(item.id, sellBody('CSFloat', { netReceivedCents: 100 }));
    expect(res.status).toBe(200);
    expect(res.body.data.item).toMatchObject({ netReceivedManual: true, saleHoldDaysApplied: 7 });
    expect(snapshotOf(item.id)).toBe(7);
  });
});

describe('venda recusada não deixa snapshot', () => {
  test('venda inválida (preço 0, loja inexistente) mantém o item em estoque com snapshot nulo', async () => {
    const item = await createItemViaApi(app);
    expectError(await sell(item.id, sellBody('CSFloat', { salePriceCents: 0 })), 400, 'INVALID_AMOUNT');
    expect((await sell(item.id, sellBody('CSFloat', { saleStoreId: 9999 }))).status).toBe(400);
    expect(snapshotOf(item.id)).toBeNull();
    expect(getDb().prepare('SELECT status FROM items WHERE id = ?').get(item.id).status).toBe('EM_ESTOQUE');
  });

  test('vender um item já vendido é recusado e preserva o snapshot original', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id, sellBody('CSFloat'));
    await setHold('CSFloat', 2);
    const again = await sell(item.id, sellBody('CSFloat'));
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(snapshotOf(item.id)).toBe(7);
  });
});

describe('listagem e detalhe', () => {
  test('GET /api/items traz o campo nas vendidas (inclusive 0) e nulo no estoque', async () => {
    const sold7 = await createItemViaApi(app);
    const sold0 = await createItemViaApi(app);
    const stock = await createItemViaApi(app);
    await sell(sold7.id, sellBody('CSFloat'));
    await sell(sold0.id, steamSale());
    const list = (await request(app).get('/api/items')).body.data.items;
    const byId = Object.fromEntries(list.map((i) => [i.id, i.saleHoldDaysApplied]));
    expect(byId).toEqual({ [sold7.id]: 7, [sold0.id]: 0, [stock.id]: null });
    const filtered = (await request(app).get('/api/items?status=VENDIDO')).body.data.items;
    expect(filtered.map((i) => i.saleHoldDaysApplied).sort()).toEqual([0, 7]);
  });

  test('GET /api/items/:id devolve 0 (e não nulo/ausente) quando a retenção era 0', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id, steamSale());
    const detail = (await request(app).get(`/api/items/${item.id}`)).body.data;
    expect(detail).toHaveProperty('saleHoldDaysApplied', 0);
  });

  test('o endpoint de vendas (página de vendas) também carrega o snapshot', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id, sellBody('CSFloat'));
    const res = await request(app).get('/api/items/sales');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.data)).toContain('"saleHoldDaysApplied":7');
  });
});

describe('edição e desfazer', () => {
  test('PATCH de campos permitidos num item vendido (nome/nota) mantém o snapshot', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id, sellBody('CSFloat'));
    await setHold('CSFloat', 1);
    const res = await request(app).patch(`/api/items/${item.id}`).send({ originDetail: 'ajustado' });
    expect(res.status).toBe(200);
    expect(snapshotOf(item.id)).toBe(7);
  });

  test('PATCH com saleHoldDaysApplied null/0/texto também é recusado (campo travado), em item vendido ou em estoque', async () => {
    const item = await createItemViaApi(app);
    for (const value of [null, 0, '7']) {
      expectError(await request(app).patch(`/api/items/${item.id}`).send({ saleHoldDaysApplied: value }), 400, 'SALE_FIELDS_LOCKED');
    }
    await sell(item.id, sellBody('CSFloat'));
    for (const value of [null, 0, 99]) {
      expectError(await request(app).patch(`/api/items/${item.id}`).send({ saleHoldDaysApplied: value }), 400, 'SALE_FIELDS_LOCKED');
    }
    expect(snapshotOf(item.id)).toBe(7);
  });

  test('corpo da venda com saleHoldDaysApplied null ou 0 -> UNKNOWN_FIELD', async () => {
    const item = await createItemViaApi(app);
    for (const value of [null, 0, 7]) {
      expectError(await sell(item.id, sellBody('CSFloat', { saleHoldDaysApplied: value })), 400, 'UNKNOWN_FIELD', { field: 'saleHoldDaysApplied' });
    }
    expect(snapshotOf(item.id)).toBeNull();
  });

  test('ciclo vender -> unsell -> mudar loja -> vender -> unsell: snapshot 7, nulo, novo valor, nulo; status coerente com o CHECK', async () => {
    const item = await createItemViaApi(app);
    const json = { 'Content-Type': 'application/json' };
    await sell(item.id, sellBody('CSFloat'));
    expect(snapshotOf(item.id)).toBe(7);
    await request(app).post(`/api/items/${item.id}/unsell`).set(json).send({}).expect(200);
    expect(snapshotOf(item.id)).toBeNull();
    await setHold('CSFloat', 4);
    await sell(item.id, sellBody('CSFloat'));
    expect(snapshotOf(item.id)).toBe(4);
    const un = await request(app).post(`/api/items/${item.id}/unsell`).set(json).send({});
    expect(un.body.data).toMatchObject({ status: 'EM_ESTOQUE', saleHoldDaysApplied: null });
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM items WHERE status = ? AND sale_hold_days_applied IS NOT NULL').get('EM_ESTOQUE').n).toBe(0);
  });

  test('unsell de um item vendido antes da v6 (snapshot nulo) funciona', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id, sellBody('CSFloat'));
    getDb().prepare('UPDATE items SET sale_hold_days_applied = NULL WHERE id = ?').run(item.id); // venda "antiga"
    const res = await request(app).post(`/api/items/${item.id}/unsell`).set('Content-Type', 'application/json').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('EM_ESTOQUE');
  });

  test('excluir um item vendido com snapshot funciona', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id, sellBody('CSFloat'));
    expect((await request(app).delete(`/api/items/${item.id}`)).status).toBe(200);
  });
});
