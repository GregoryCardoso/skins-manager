// QA 8.7.2 (D263 a D270): lacunas da API dos itens "fora de venda". Banco :memory: novo a cada teste, relógio controlado.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError, NOW, CAT } = require('../helpers/apiFixtures');

let app;
const at = (iso) => { app = makeCatalogApp(new Date(iso)); };
beforeEach(() => { freshDb(); app = makeCatalogApp(); });
afterAll(() => closeDb());

const DAY = 86400000;
const iso = (days, minutes = 0) => new Date(NOW.getTime() + days * DAY + minutes * 60000).toISOString();
const offSale = (id, body) => request(app).post(`/api/items/${id}/off-sale`).send(body ?? {});
const forSale = (id, body) => request(app).post(`/api/items/${id}/for-sale`).send(body ?? {});
const sellBody = (soldAt = NOW.toISOString()) => ({ saleStoreId: storeId('CSFloat'), salePriceCents: 200, soldAt });
const sell = (id, soldAt) => request(app).post(`/api/items/${id}/sell`).send(sellBody(soldAt));
const list = async (query = '') => (await request(app).get(`/api/items${query}`)).body.data;
const one = async (id) => (await request(app).get(`/api/items/${id}`)).body.data;
const create = (overrides = {}) => createItemViaApi(app, purchaseBody({ acquiredAt: iso(-40), ...overrides }));
const ids = (data) => data.items.map((i) => i.id);

describe('o giro recomeça da volta à venda (E8-Q29)', () => {
  test('mesmo minutos depois: volta com 0 dias (RECENTE) e a contagem parte do instante da volta', async () => {
    const item = await create({ acquiredAt: iso(-100) });
    expect((await one(item.id)).aging.agingBucket).toBe('AGARRADO');
    expect(ids(await list('?stagnantOnly=true'))).toEqual([item.id]);
    await offSale(item.id);
    at(iso(0, 5)); // 5 minutos depois
    const back = (await forSale(item.id)).body.data.item;
    expect(back).toMatchObject({ saleState: 'FOR_SALE', offSaleAt: null, forSaleSince: iso(0, 5) });
    expect(back.aging).toMatchObject({ daysForSale: 0, agingBucket: 'RECENTE', daysInInventory: 100 });
    expect(ids(await list('?stagnantOnly=true'))).toEqual([]);
    // limites padrão 7 e 21 dias: agarrado é acima de 21
    at(iso(21, 5));
    expect((await one(item.id)).aging).toMatchObject({ daysForSale: 21, agingBucket: 'EM_GIRO' });
    expect(ids(await list('?stagnantOnly=true'))).toEqual([]);
    at(iso(22, 5));
    expect((await one(item.id)).aging).toMatchObject({ daysForSale: 22, agingBucket: 'AGARRADO' });
    expect(ids(await list('?stagnantOnly=true'))).toEqual([item.id]);
    at(iso(21, 4)); // 1 minuto antes de completar 21 dias: ainda são 20 dias
    expect((await one(item.id)).aging.daysForSale).toBe(20);
  });

  test('sai e volta várias vezes: vale sempre a última volta; offSaleAt só o último "saiu"', async () => {
    const item = await create();
    await offSale(item.id);
    at(iso(2));
    await forSale(item.id);
    at(iso(10));
    await offSale(item.id);
    expect((await one(item.id))).toMatchObject({ offSaleAt: iso(10), forSaleSince: iso(2) });
    at(iso(12));
    const back = (await forSale(item.id)).body.data.item;
    expect(back).toMatchObject({ offSaleAt: null, forSaleSince: iso(12), aging: { daysForSale: 0 } });
    at(iso(15));
    expect((await one(item.id)).aging.daysForSale).toBe(3);
  });

  test('item em trade lock tirado e devolvido ainda bloqueado: giro só na liberação', async () => {
    const item = await create({ tradeUnlockAt: iso(5), acquiredAt: iso(-1) });
    await offSale(item.id);
    expect((await one(item.id)).aging.agingBucket).toBe('FORA_DE_VENDA');
    at(iso(1));
    const back = (await forSale(item.id)).body.data.item;
    expect(back.aging).toMatchObject({ agingBucket: 'EM_TRADE_LOCK', daysForSale: null });
    expect(back.tradeLock.isLocked).toBe(true);
    expect(ids(await list('?stagnantOnly=true'))).toEqual([]);
    at(iso(5)); // liberação exata: o giro começa em 0
    expect((await one(item.id)).aging).toMatchObject({ daysForSale: 0, agingBucket: 'RECENTE' });
    at(iso(27));
    expect((await one(item.id)).aging).toMatchObject({ daysForSale: 22, agingBucket: 'AGARRADO' });
  });

  test('item devolvido depois da liberação: o giro parte da volta, não da liberação', async () => {
    const item = await create({ tradeUnlockAt: iso(-30), acquiredAt: iso(-40) });
    await offSale(item.id);
    at(iso(3));
    const back = (await forSale(item.id)).body.data.item;
    expect(back.aging.daysForSale).toBe(0);
    expect(back.tradeLock.isLocked).toBe(false);
  });

  test('um item vendido normalmente depois da volta tem giro contado da volta', async () => {
    const item = await create({ acquiredAt: iso(-60) });
    await offSale(item.id);
    at(iso(2));
    await forSale(item.id);
    at(iso(6));
    const sold = (await sell(item.id, iso(6))).body.data.item;
    expect(sold).toMatchObject({ soldWhileOffSale: false, aging: { turnaroundDays: 4 } });
    expect(sold.stats).toMatchObject({ avgDaysToSell: 4, soldOffSaleCount: 0 });
  });
});

describe('fora de venda nunca é "agarrado", nunca entra no stagnantOnly e mantém o preço mínimo', () => {
  test('item muito antigo fora de venda: FORA_DE_VENDA, fora do stagnantOnly e da faixa AGARRADO; preços mínimos presentes', async () => {
    const stale = await create({ acquiredAt: iso(-200) });
    const other = await create({ acquiredAt: iso(-200) });
    await offSale(stale.id);
    const view = await one(stale.id);
    expect(view.aging.agingBucket).toBe('FORA_DE_VENDA');
    expect(view.aging.daysForSale).toBeNull();
    expect(view.minPrices.length).toBeGreaterThan(0);
    expect(view.minPrices).toEqual((await one(other.id)).minPrices); // mesmo custo e loja: mesmos preços mínimos
    expect(ids(await list('?stagnantOnly=true'))).toEqual([other.id]);
    expect(ids(await list('?stagnantOnly=true&saleState=OFF_SALE'))).toEqual([]);
    expect(ids(await list('?stagnantOnly=true&saleState=FOR_SALE'))).toEqual([other.id]);
  });

  test('fora de venda por muito tempo continua fora de venda (o tempo parado não vira agarrado)', async () => {
    const item = await create({ acquiredAt: iso(-1) });
    await offSale(item.id);
    at(iso(400));
    expect((await one(item.id)).aging.agingBucket).toBe('FORA_DE_VENDA');
    expect(ids(await list('?stagnantOnly=true'))).toEqual([]);
  });
});

describe('venda direta de item fora de venda (E8-Q26)', () => {
  test('SEM_GIRO, fora das médias e com lucro normal (igual ao de uma venda idêntica à venda)', async () => {
    const normal = await create({ acquiredAt: iso(-10) });
    const direct = await create({ acquiredAt: iso(-10) });
    await offSale(direct.id);
    const a = (await sell(normal.id)).body.data.item;
    const b = (await sell(direct.id)).body.data.item;
    expect(a.aging).toMatchObject({ turnaroundDays: 10 });
    expect(b.aging).toMatchObject({ turnaroundDays: null, turnaroundBucket: 'SEM_GIRO' });
    expect(b.soldWhileOffSale).toBe(true);
    expect(b.sale).toEqual(a.sale); // fee, líquido, lucro e retenção idênticos
    // o histórico (mesma chave) tem 2 vendas, média só da normal e 1 fora de venda
    expect(b.stats).toMatchObject({ soldCount: 2, avgDaysToSell: 10, soldOffSaleCount: 1 });
    const sales = (await request(app).get('/api/items/sales')).body.data;
    expect(sales.summary.count).toBe(2);
    expect(sales.summary.avgTurnaroundDays).toBe(10);
    const bySale = Object.fromEntries(sales.items.map((i) => [i.id, i.aging.turnaroundBucket]));
    expect(bySale[direct.id]).toBe('SEM_GIRO');
    expect(bySale[normal.id]).not.toBe('SEM_GIRO');
  });

  test('ordenar vendas por giro: SEM_GIRO depois das vendas com giro, nas duas direções', async () => {
    const direct = await create({ acquiredAt: iso(-30) });
    const slow = await create({ acquiredAt: iso(-30) });
    const fast = await create({ acquiredAt: iso(-3) });
    await offSale(direct.id);
    for (const item of [direct, slow, fast]) await sell(item.id);
    for (const order of ['asc', 'desc']) {
      const res = (await request(app).get(`/api/items/sales?sortBy=turnaround&order=${order}`)).body.data.items.map((i) => i.id);
      expect(res[res.length - 1]).toBe(direct.id);
    }
  });

  test('item em trade lock fora de venda continua sem poder ser vendido (ITEM_TRADE_LOCKED)', async () => {
    const item = await create({ tradeUnlockAt: iso(5) });
    await offSale(item.id);
    const res = await sell(item.id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.error.code).toBe('ITEM_TRADE_LOCKED');
    expect((await one(item.id)).status).toBe('EM_ESTOQUE');
  });

  test('desfazer a venda devolve fora de venda e preserva offSaleAt e forSaleSince; vender de novo segue SEM_GIRO', async () => {
    const item = await create();
    await offSale(item.id);
    at(iso(1));
    await sell(item.id, iso(1));
    const back = (await request(app).post(`/api/items/${item.id}/unsell`).send({})).body.data;
    expect(back).toMatchObject({ saleState: 'OFF_SALE', offSaleAt: iso(0), forSaleSince: null });
    const again = (await sell(item.id, iso(1))).body.data.item;
    expect(again.aging.turnaroundBucket).toBe('SEM_GIRO');
  });

  test('item que voltou à venda e foi vendido, depois desfeito: volta à venda com forSaleSince preservado', async () => {
    const item = await create();
    await offSale(item.id);
    at(iso(2));
    await forSale(item.id);
    await sell(item.id, iso(2));
    const back = (await request(app).post(`/api/items/${item.id}/unsell`).send({})).body.data;
    expect(back).toMatchObject({ saleState: 'FOR_SALE', offSaleAt: null, forSaleSince: iso(2), aging: { daysForSale: 0 } });
  });

  test('vendido: off-sale e for-sale dão 409 ITEM_ALREADY_SOLD e nada muda', async () => {
    const item = await create();
    await sell(item.id);
    const before = await one(item.id);
    expectError(await offSale(item.id), 409, 'ITEM_ALREADY_SOLD');
    expectError(await forSale(item.id), 409, 'ITEM_ALREADY_SOLD');
    expect(await one(item.id)).toEqual(before);
  });
});

describe('contagens das abas com filtros', () => {
  test('saleStateCounts respeita a categoria e ignora status, saleState e stagnantOnly; só conta itens em estoque', async () => {
    const skinA = await create();
    const skinB = await create({ catalogId: CAT.AK_REDLINE });
    const box = await createItemViaApi(app, purchaseBody({ catalogId: CAT.CASE ?? CAT.AK_REDLINE, acquiredAt: iso(-5) }));
    const soldOne = await create();
    await offSale(skinA.id);
    await offSale(soldOne.id);
    await sell(soldOne.id);
    const all = (await list()).meta.saleStateCounts;
    expect(all.forSale + all.offSale).toBe(3); // skinA fora; skinB e box à venda; o vendido não conta
    expect(all.offSale).toBe(1);
    for (const q of ['?saleState=OFF_SALE', '?saleState=FOR_SALE', '?stagnantOnly=true', '?status=EM_ESTOQUE&saleState=OFF_SALE']) {
      expect((await list(q)).meta.saleStateCounts).toEqual(all);
    }
    // Adendo 1 da revisão 8.6/8.7: a contagem independe do filtro de `status`.
    expect((await list('?status=VENDIDO')).meta.saleStateCounts).toEqual(all);
    expect((await list('?status=VENDIDO&category=SKIN')).meta.saleStateCounts).toEqual((await list('?category=SKIN')).meta.saleStateCounts);
    expect(ids(await list('?saleState=OFF_SALE'))).toEqual([skinA.id]);
    expect(ids(await list('?saleState=FOR_SALE')).sort()).toEqual([skinB.id, box.id].sort());
    expect([skinB.id, box.id]).toBeDefined();
  });

  test('a contagem acompanha as ações na hora: tirar, voltar, vender e excluir', async () => {
    const a = await create();
    const b = await create();
    const counts = async () => (await list()).meta.saleStateCounts;
    expect(await counts()).toEqual({ forSale: 2, offSale: 0 });
    await offSale(a.id);
    expect(await counts()).toEqual({ forSale: 1, offSale: 1 });
    await offSale(a.id); // idempotente
    expect(await counts()).toEqual({ forSale: 1, offSale: 1 });
    await forSale(a.id);
    expect(await counts()).toEqual({ forSale: 2, offSale: 0 });
    await offSale(b.id);
    await request(app).delete(`/api/items/${b.id}`);
    expect(await counts()).toEqual({ forSale: 1, offSale: 0 });
  });

  test('saleState: valores minúsculos, vazios e repetidos -> INVALID_QUERY; sem status explícito vale; com status=EM_ESTOQUE vale', async () => {
    for (const q of ['?saleState=off_sale', '?saleState=', '?saleState=ALL', '?saleState=OFF_SALE&saleState=FOR_SALE']) {
      expectError(await request(app).get(`/api/items${q}`), 400, 'INVALID_QUERY', { field: 'saleState' });
    }
    expect((await request(app).get('/api/items?status=EM_ESTOQUE&saleState=OFF_SALE')).status).toBe(200);
    expectError(await request(app).get('/api/items?status=VENDIDO&saleState=FOR_SALE'), 400, 'INVALID_QUERY', { field: 'saleState' });
    expect((await request(app).get('/api/items/sales?saleState=OFF_SALE')).status).toBeGreaterThanOrEqual(200);
  });
});

describe('estoque, lucro real e saldo iguais antes e depois; edição preserva as datas', () => {
  test('ida e volta (tirar e colocar à venda) não muda nenhum valor do lucro real nem dos saldos', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    const item = await create({ purchasePriceCents: 777 });
    await request(app).post('/api/deposits').send({ storeId: storeId('CSFloat'), amountStoreCents: 2000, depositedAt: iso(-30) });
    // stockBreakdown (8.9, D283) muda de propósito; o resto do resumo e os saldos ficam iguais.
    const strip = ({ computedAt, stockBreakdown, ...rest }) => rest;
    const breakdown = async () => (await request(app).get('/api/profit/summary')).body.data.stockBreakdown;
    const snap = async () => ({
      summary: strip((await request(app).get('/api/profit/summary')).body.data),
      balances: strip((await request(app).get('/api/store-balances/current')).body.data),
    });
    const before = await snap();
    const start = await breakdown();
    await offSale(item.id);
    expect(await snap()).toEqual(before);
    expect(await breakdown()).toMatchObject({ forSale: { usdCents: 0, count: 0 }, offSale: { usdCents: 777, count: 1 } });
    await forSale(item.id);
    expect(await snap()).toEqual(before);
    expect(await breakdown()).toEqual(start);
    expect(start).toMatchObject({ forSale: { usdCents: 777, count: 1 }, offSale: { usdCents: 0, count: 0 } });
    expect(before.summary).toMatchObject({ stockUsdCents: 777, depositsUsdCents: 2000, platformBalanceUsdCents: 2000 - 777 });
  });

  test('o histórico do item (unitCount, avgPurchaseCost) conta os fora de venda', async () => {
    const a = await create({ purchasePriceCents: 100 });
    const b = await create({ purchasePriceCents: 300 });
    await offSale(b.id);
    expect((await one(a.id)).stats).toMatchObject({ unitCount: 2, avgPurchaseCostUsdCents: 200 });
  });

  test('PATCH preserva offSaleAt e forSaleSince (nos dois estados) e atualiza só o pedido', async () => {
    const item = await create();
    await offSale(item.id);
    const edited = await request(app).patch(`/api/items/${item.id}`).send({ purchasePriceCents: 250 });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ purchasePriceCents: 250, offSaleAt: NOW.toISOString(), forSaleSince: null, saleState: 'OFF_SALE' });
    at(iso(4));
    await forSale(item.id);
    const edited2 = await request(app).patch(`/api/items/${item.id}`).send({ purchasePriceCents: 260 });
    expect(edited2.body.data).toMatchObject({ purchasePriceCents: 260, offSaleAt: null, forSaleSince: iso(4), saleState: 'FOR_SALE' });
    expect(edited2.body.data.aging.daysForSale).toBe(0);
    expect(getDb().prepare('SELECT off_sale_at, for_sale_since FROM items WHERE id = ?').get(item.id)).toEqual({ off_sale_at: null, for_sale_since: iso(4) });
  });

  test('PATCH e POST de criação não aceitam offSaleAt, forSaleSince nem saleState (UNKNOWN_FIELD)', async () => {
    const item = await create();
    for (const field of ['offSaleAt', 'forSaleSince', 'saleState', 'soldWhileOffSale']) {
      expectError(await request(app).patch(`/api/items/${item.id}`).send({ [field]: '2026-01-01T00:00:00.000Z' }), 400, 'UNKNOWN_FIELD', { field });
      expectError(await request(app).post('/api/items').send(purchaseBody({ [field]: '2026-01-01T00:00:00.000Z' })), 400, 'UNKNOWN_FIELD', { field });
    }
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM items WHERE off_sale_at IS NOT NULL OR for_sale_since IS NOT NULL').get().n).toBe(0);
  });

  test('excluir um item fora de venda funciona e sai da contagem', async () => {
    const item = await create();
    await offSale(item.id);
    expect((await request(app).delete(`/api/items/${item.id}`)).status).toBe(200);
    expect((await list()).meta.saleStateCounts).toEqual({ forSale: 0, offSale: 0 });
  });
});

describe('segurança e forma dos dois POSTs', () => {
  test.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x'])('Content-Type %s -> 415 e nada muda', async (type) => {
    const item = await create();
    for (const route of ['off-sale', 'for-sale']) {
      expectError(await request(app).post(`/api/items/${item.id}/${route}`).set('Content-Type', type).send('x=1'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    expect(await one(item.id)).toMatchObject({ offSaleAt: null, forSaleSince: null });
  });

  test('sem corpo e sem Content-Type -> 415; JSON com charset passa', async () => {
    const item = await create();
    expectError(await request(app).post(`/api/items/${item.id}/off-sale`), 415, 'UNSUPPORTED_MEDIA_TYPE');
    const res = await request(app).post(`/api/items/${item.id}/off-sale`).set('Content-Type', 'application/json; charset=utf-8').send('{}');
    expect(res.status).toBe(200);
  });

  test.each(['evil.example', 'localhost.evil.com', '127.0.0.1.evil.com', 'evil.com:3001', '[::1]:3001'])('Host %s -> 403 nas duas rotas e nada muda', async (host) => {
    const item = await create();
    for (const route of ['off-sale', 'for-sale']) {
      expectError(await request(app).post(`/api/items/${item.id}/${route}`).set('Host', host).send({}), 403, 'FORBIDDEN_HOST');
    }
    expect((await one(item.id)).offSaleAt).toBeNull();
  });

  test('corpo com campo, array ou valor não objeto -> erro e nada muda', async () => {
    const item = await create();
    expectError(await offSale(item.id, { offSaleAt: '2026-01-01T00:00:00.000Z' }), 400, 'UNKNOWN_FIELD', { field: 'offSaleAt' });
    expectError(await forSale(item.id, { now: 'x' }), 400, 'UNKNOWN_FIELD', { field: 'now' });
    const arr = await request(app).post(`/api/items/${item.id}/off-sale`).send([1]);
    expect(arr.status).toBe(400);
    expect((await one(item.id)).offSaleAt).toBeNull();
  });

  test('ids inválidos -> INVALID_ID; inexistente -> 404 ITEM_NOT_FOUND; GET nas rotas -> 404 padrão', async () => {
    for (const id of ['abc', '0', '-1', '1.5']) {
      expectError(await offSale(id), 400, 'INVALID_ID');
      expectError(await forSale(id), 400, 'INVALID_ID');
    }
    expectError(await offSale(99999), 404, 'ITEM_NOT_FOUND');
    const get = await request(app).get('/api/items/1/off-sale');
    expect(get.status).toBe(404);
    expect(get.body.success).toBe(false);
  });
});
