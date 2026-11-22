// 8.7.2 (D263 a D270): itens "fora de venda" pela API. Banco :memory: novo a cada teste, relógio controlado.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError, NOW } = require('../helpers/apiFixtures');

let app;
const at = (iso) => { app = makeCatalogApp(new Date(iso)); };
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const DAY = 86400000;
const iso = (offsetDays) => new Date(NOW.getTime() + offsetDays * DAY).toISOString();
const offSale = (id, body) => request(app).post(`/api/items/${id}/off-sale`).send(body ?? {});
const forSale = (id, body) => request(app).post(`/api/items/${id}/for-sale`).send(body ?? {});
const sell = (id) => request(app).post(`/api/items/${id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 200, soldAt: NOW.toISOString() });
const list = async (query = '') => (await request(app).get(`/api/items${query}`)).body.data;
const create = (overrides = {}) => createItemViaApi(app, purchaseBody({ acquiredAt: iso(-40), ...overrides }));

describe('POST /api/items/:id/off-sale e /for-sale', () => {
  test('tira da venda (200) com o now do servidor; o item vira FORA_DE_VENDA, sem faixa de giro, e mantém os preços mínimos', async () => {
    const item = await create();
    const res = await offSale(item.id);
    expect(res.status).toBe(200);
    const view = res.body.data.item;
    expect(view).toMatchObject({
      saleState: 'OFF_SALE', offSaleAt: NOW.toISOString(), forSaleSince: null, soldWhileOffSale: false, status: 'EM_ESTOQUE',
      aging: { daysInInventory: 40, daysForSale: null, agingBucket: 'FORA_DE_VENDA' },
    });
    expect(view.minPrices.length).toBeGreaterThan(0);
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.updatedAt).toBe(NOW.toISOString());
  });

  test('é idempotente: repetir não muda offSaleAt; um item à venda em for-sale não reinicia o giro', async () => {
    const item = await create();
    await offSale(item.id);
    at(iso(3));
    const again = await offSale(item.id);
    expect(again.status).toBe(200);
    expect(again.body.data.item.offSaleAt).toBe(NOW.toISOString());
    const other = await create();
    const notOff = await forSale(other.id);
    expect(notOff.status).toBe(200);
    expect(notOff.body.data.item).toMatchObject({ saleState: 'FOR_SALE', forSaleSince: null, offSaleAt: null });
  });

  test('colocar à venda grava forSaleSince = now, limpa offSaleAt e o giro recomeça (RECENTE, 0 dias)', async () => {
    const item = await create();
    await offSale(item.id);
    at(iso(5));
    const res = await forSale(item.id);
    const view = res.body.data.item;
    expect(view).toMatchObject({ saleState: 'FOR_SALE', offSaleAt: null, forSaleSince: iso(5) });
    expect(view.aging).toMatchObject({ daysForSale: 0, agingBucket: 'RECENTE' });
    at(iso(35));
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.aging).toMatchObject({ daysForSale: 30, agingBucket: 'AGARRADO' });
  });

  test('item em trade lock pode sair da venda: FORA_DE_VENDA na view e o trade lock continua informado', async () => {
    const item = await create({ tradeUnlockAt: iso(5) });
    const view = (await offSale(item.id)).body.data.item;
    expect(view.aging.agingBucket).toBe('FORA_DE_VENDA');
    expect(view.tradeLock.isLocked).toBe(true);
    // voltar à venda ainda em trade lock: EM_TRADE_LOCK até liberar
    const back = (await forSale(item.id)).body.data.item;
    expect(back.aging.agingBucket).toBe('EM_TRADE_LOCK');
  });

  test('404 para item inexistente; 409 ITEM_ALREADY_SOLD para vendido; INVALID_ID', async () => {
    expectError(await offSale(9999), 404, 'ITEM_NOT_FOUND');
    expectError(await forSale(9999), 404, 'ITEM_NOT_FOUND');
    const item = await create();
    await sell(item.id);
    expectError(await offSale(item.id), 409, 'ITEM_ALREADY_SOLD');
    expectError(await forSale(item.id), 409, 'ITEM_ALREADY_SOLD');
    expectError(await request(app).post('/api/items/abc/off-sale').send({}), 400, 'INVALID_ID');
  });

  test('segurança: sem JSON -> 415, corpo com campo -> UNKNOWN_FIELD, Host estranho -> 403', async () => {
    const item = await create();
    expectError(await request(app).post(`/api/items/${item.id}/off-sale`).set('Content-Type', 'text/plain').send('x'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).post(`/api/items/${item.id}/for-sale`), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await offSale(item.id, { offSaleAt: iso(0) }), 400, 'UNKNOWN_FIELD', { field: 'offSaleAt' });
    expectError(await forSale(item.id, { x: 1 }), 400, 'UNKNOWN_FIELD', { field: 'x' });
    expectError(await request(app).post(`/api/items/${item.id}/off-sale`).set('Host', 'evil.example').send({}), 403, 'FORBIDDEN_HOST');
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.offSaleAt).toBeNull();
  });

  test('PATCH com offSaleAt ou forSaleSince -> UNKNOWN_FIELD', async () => {
    const item = await create();
    for (const field of ['offSaleAt', 'forSaleSince']) {
      expectError(await request(app).patch(`/api/items/${item.id}`).send({ [field]: iso(0) }), 400, 'UNKNOWN_FIELD', { field });
    }
  });

  test('editar um item fora de venda não mexe nas datas', async () => {
    const item = await create();
    await offSale(item.id);
    const res = await request(app).patch(`/api/items/${item.id}`).send({ originDetail: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ saleState: 'OFF_SALE', offSaleAt: NOW.toISOString() });
  });
});

describe('GET /api/items: saleState, saleStateCounts e stagnantOnly', () => {
  test('filtra por FOR_SALE e OFF_SALE; sem o parâmetro traz todos; meta.saleStateCounts não depende do filtro', async () => {
    const a = await create();
    const b = await create();
    await create();
    await offSale(b.id);
    const all = await list();
    expect(all.items).toHaveLength(3);
    expect(all.meta.saleStateCounts).toEqual({ forSale: 2, offSale: 1 });
    const forSaleList = await list('?saleState=FOR_SALE');
    expect(forSaleList.items.map((i) => i.id)).not.toContain(b.id);
    expect(forSaleList.items.map((i) => i.id)).toContain(a.id);
    expect(forSaleList.meta).toMatchObject({ count: 2, saleStateCounts: { forSale: 2, offSale: 1 } });
    const off = await list('?saleState=OFF_SALE');
    expect(off.items.map((i) => i.id)).toEqual([b.id]);
    expect(off.meta).toMatchObject({ count: 1, saleStateCounts: { forSale: 2, offSale: 1 } });
  });

  test('a contagem respeita a categoria e ignora stagnantOnly', async () => {
    const skin = await create();
    await offSale(skin.id);
    const other = await list('?category=SKIN&stagnantOnly=true');
    expect(other.meta.saleStateCounts).toEqual({ forSale: 0, offSale: 1 });
    const none = await list('?category=LUVA');
    expect(none.meta.saleStateCounts).toEqual({ forSale: 0, offSale: 0 });
  });

  test('saleState inválido ou com status=VENDIDO -> 400 INVALID_QUERY (field saleState)', async () => {
    expectError(await request(app).get('/api/items?saleState=XYZ'), 400, 'INVALID_QUERY', { field: 'saleState' });
    expectError(await request(app).get('/api/items?status=VENDIDO&saleState=OFF_SALE'), 400, 'INVALID_QUERY', { field: 'saleState' });
    expect((await request(app).get('/api/items?status=EM_ESTOQUE&saleState=OFF_SALE')).status).toBe(200);
  });

  test('stagnantOnly: o agarrado tirado da venda sai; OFF_SALE com stagnantOnly dá lista vazia; ao voltar, conta do zero', async () => {
    const item = await create();
    expect((await list('?stagnantOnly=true')).items.map((i) => i.id)).toEqual([item.id]);
    await offSale(item.id);
    expect((await list('?stagnantOnly=true')).items).toEqual([]);
    expect((await list('?stagnantOnly=true&saleState=OFF_SALE')).items).toEqual([]);
    await forSale(item.id);
    expect((await list('?stagnantOnly=true')).items).toEqual([]);
    at(iso(30));
    expect((await list('?stagnantOnly=true')).items.map((i) => i.id)).toEqual([item.id]);
  });

  test('ordenar por idade deixa os fora de venda por último', async () => {
    const off = await create({ acquiredAt: iso(-90) });
    const fresh = await create({ acquiredAt: iso(-1) });
    await offSale(off.id);
    const res = await list('?sortBy=age&order=desc');
    expect(res.items.map((i) => i.id)).toEqual([fresh.id, off.id]);
  });
});

describe('venda e desfazer venda de item fora de venda (E8-Q26)', () => {
  test('vender direto: 200, SEM_GIRO e fora do tempo médio do histórico; desfazer volta fora de venda', async () => {
    const item = await create();
    await offSale(item.id);
    const sold = await sell(item.id);
    expect(sold.status).toBe(200);
    expect(sold.body.data.item).toMatchObject({
      status: 'VENDIDO', saleState: null, soldWhileOffSale: true, offSaleAt: NOW.toISOString(),
      aging: { turnaroundDays: null, turnaroundBucket: 'SEM_GIRO' },
    });
    expect(sold.body.data.item.stats).toMatchObject({ soldCount: 1, soldOffSaleCount: 1, avgDaysToSell: null });
    const sales = (await request(app).get('/api/items/sales')).body.data;
    expect(sales.items[0].aging.turnaroundBucket).toBe('SEM_GIRO');
    expect(sales.summary.avgTurnaroundDays).toBeNull();
    expect(sales.summary.count).toBe(1);
    const back = await request(app).post(`/api/items/${item.id}/unsell`).send({});
    expect(back.body.data).toMatchObject({ status: 'EM_ESTOQUE', saleState: 'OFF_SALE', offSaleAt: NOW.toISOString(), soldWhileOffSale: false });
    expect(back.body.data.aging.agingBucket).toBe('FORA_DE_VENDA');
  });

  test('uma venda normal continua com giro e conta no tempo médio', async () => {
    const item = await create();
    const sold = await sell(item.id);
    expect(sold.body.data.item).toMatchObject({ soldWhileOffSale: false, aging: { turnaroundDays: 40 } });
    expect(sold.body.data.item.stats).toMatchObject({ soldOffSaleCount: 0, avgDaysToSell: 40 });
  });
});

describe('lucro real e saldos não mudam', () => {
  test('/profit/summary e /store-balances/current iguais antes e depois de tirar o item da venda', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    const item = await create({ purchasePriceCents: 500 });
    const strip = ({ computedAt, ...rest }) => rest;
    const before = {
      summary: strip((await request(app).get('/api/profit/summary')).body.data),
      balances: strip((await request(app).get('/api/store-balances/current')).body.data),
    };
    await offSale(item.id);
    const after = {
      summary: strip((await request(app).get('/api/profit/summary')).body.data),
      balances: strip((await request(app).get('/api/store-balances/current')).body.data),
    };
    expect(after).toEqual(before);
    expect(after.summary.stockUsdCents).toBe(500);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM items WHERE off_sale_at IS NOT NULL').get().n).toBe(1);
  });
});
