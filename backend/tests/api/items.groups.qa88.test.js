// QA 8.8: bordas de GET /api/items/groups (D271 a D275, D280). Banco :memory: novo a cada teste, relógio fixo.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError, NOW, CAT } = require('../helpers/apiFixtures');

let app;
beforeEach(() => { freshDb(); app = makeCatalogApp(); });
afterAll(() => closeDb());

const DAY = 86400000;
const iso = (days) => new Date(NOW.getTime() + days * DAY).toISOString();
const get = (query = '') => request(app).get(`/api/items/groups${query}`);
const groups = async (query = '') => (await get(query)).body.data;
const list = async (query = '') => (await request(app).get(`/api/items${query}`)).body.data;
const create = (overrides = {}) => createItemViaApi(app, purchaseBody({ acquiredAt: iso(-40), ...overrides }));
const offSale = (id) => request(app).post(`/api/items/${id}/off-sale`).send({});
const unitIds = (data) => data.groups.flatMap((g) => g.units.map((u) => u.id));

describe('chave do itemStats na API', () => {
  test('fases diferentes (Doppler P1 x P2) formam grupos separados; sem fase é outro grupo', async () => {
    await create({ catalogId: CAT.KARAMBIT_DOPPLER_P1 });
    await create({ catalogId: CAT.KARAMBIT_DOPPLER_P2 });
    await create({ catalogId: CAT.KARAMBIT_DOPPLER_P1 });
    await create({ catalogId: CAT.KARAMBIT_FADE });
    const data = await groups();
    expect(data.meta.groupCount).toBe(3);
    const byPhase = Object.fromEntries(data.groups.map((g) => [g.phase ?? g.name, g.quantity]));
    expect(byPhase['Phase 1']).toBe(2);
    expect(byPhase['Phase 2']).toBe(1);
  });

  test('exterior diferente forma outro grupo', async () => {
    await create({ exterior: 'FT' });
    await create({ exterior: 'FN' });
    await create({ exterior: 'FT' });
    const data = await groups();
    expect(data.groups.map((g) => [g.exterior, g.quantity]).sort()).toEqual([['FN', 1], ['FT', 2]]);
  });

  test('variante diferente (StatTrak x normal) forma outro grupo', async () => {
    await create({ variant: 'STATTRAK' });
    await create({ variant: 'NORMAL' });
    expect((await groups()).meta.groupCount).toBe(2);
  });

  test('facas duplicadas no catálogo (mesmo nome) caem num grupo só', async () => {
    await create({ catalogId: CAT.BAYONET_BLUE_STEEL_A });
    await create({ catalogId: CAT.BAYONET_BLUE_STEEL_B });
    const data = await groups();
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0].quantity).toBe(2);
  });

  test('a chave devolvida é estável entre chamadas', async () => {
    await create();
    const a = (await groups()).groups[0].key;
    const b = (await groups()).groups[0].key;
    expect(a).toBe(b);
    expect(a).toEqual(expect.any(String));
  });

  test('editar o exterior de uma unidade move a unidade para outro grupo', async () => {
    await create({ exterior: 'FT' });
    const b = await create({ exterior: 'FT' });
    const res = await request(app).patch(`/api/items/${b.id}`).send({ exterior: 'FN' });
    expect(res.status).toBe(200);
    expect((await groups()).groups.map((g) => g.quantity).sort()).toEqual([1, 1]);
  });
});

describe('custos e moedas', () => {
  test('mistura USD + BRL: total em USD pela cotação gravada, costUsesRecordedFx e approxBrl', async () => {
    await create({ purchasePriceCents: 1000 });
    await create({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 1080, fxRateAtPurchase: 5.4 });
    const g = (await groups()).groups[0];
    expect(g).toMatchObject({ quantity: 2, totalCostUsdCents: 1200, avgCostUsdCents: 600, costUsesRecordedFx: true });
    if (g.approxBrl !== null) {
      expect(g.approxBrl.totalCostCents).toBeGreaterThan(0);
      expect(Number.isInteger(g.approxBrl.totalCostCents)).toBe(true);
      expect(Number.isInteger(g.approxBrl.avgCostCents)).toBe(true);
    }
  });

  test('GANHEI junto de compra: custo 0 entra na média', async () => {
    await create({ purchasePriceCents: 1000 });
    const res = await request(app).post('/api/items').send({
      catalogId: CAT.AK_REDLINE, acquisitionType: 'GANHEI', acquiredAt: iso(-40),
    });
    expect(res.status).toBe(201);
    const g = (await groups()).groups[0];
    expect(g).toMatchObject({ quantity: 2, totalCostUsdCents: 1000, avgCostUsdCents: 500 });
  });

  test('arredondamento da média em centavos (3 unidades, 1000 -> 333)', async () => {
    await create({ purchasePriceCents: 500 });
    await create({ purchasePriceCents: 250 });
    await create({ purchasePriceCents: 250 });
    const g = (await groups()).groups[0];
    expect(g).toMatchObject({ totalCostUsdCents: 1000, avgCostUsdCents: 333 });
    expect(Number.isInteger(g.avgCostUsdCents)).toBe(true);
  });

  test('grupo de 1 unidade: quantidade 1, média = total', async () => {
    await create({ purchasePriceCents: 777 });
    expect((await groups()).groups[0]).toMatchObject({ quantity: 1, totalCostUsdCents: 777, avgCostUsdCents: 777 });
  });

  test('o custo da aba é só das unidades listadas; o stock cobre as duas abas', async () => {
    const a = await create({ purchasePriceCents: 1000 });
    await create({ purchasePriceCents: 300 });
    await offSale(a.id);
    const forSale = (await groups('?saleState=FOR_SALE')).groups[0];
    expect(forSale).toMatchObject({ quantity: 1, totalCostUsdCents: 300, stock: { forSale: 1, offSale: 1, tradeLocked: 0 } });
    const off = (await groups('?saleState=OFF_SALE')).groups[0];
    expect(off).toMatchObject({ quantity: 1, totalCostUsdCents: 1000, stock: { forSale: 1, offSale: 1 } });
  });
});

describe('stock (D273) independe de aba e de stagnantOnly', () => {
  test('stagnantOnly não altera o stock; stagnantCount conta só agarradas à venda', async () => {
    await create({ acquiredAt: iso(-60) });
    await create({ acquiredAt: iso(-2) });
    await create({ acquiredAt: iso(-90), tradeUnlockAt: iso(2) }); // trade lock: nunca agarrado
    const off = await create({ acquiredAt: iso(-90) });
    await offSale(off.id);
    const g = (await groups('?stagnantOnly=true&saleState=FOR_SALE')).groups[0];
    expect(g).toMatchObject({ quantity: 1, stagnantCount: 1, stock: { forSale: 2, tradeLocked: 1, offSale: 1, nextUnlockAt: iso(2) } });
    const all = (await groups()).groups[0];
    expect(all.stock).toEqual(g.stock);
    expect(all.stagnantCount).toBe(1);
  });

  test('as três contagens somam o estoque da chave; nextUnlockAt é a menor data futura', async () => {
    await create({ tradeUnlockAt: iso(5) });
    await create({ tradeUnlockAt: iso(1) });
    await create({ tradeUnlockAt: iso(-1) }); // já liberado
    const o = await create({ tradeUnlockAt: iso(0.5) });
    await offSale(o.id); // holding: não entra em tradeLocked nem em nextUnlockAt
    const { stock } = (await groups()).groups[0];
    expect(stock).toEqual({ forSale: 1, tradeLocked: 2, offSale: 1, nextUnlockAt: iso(1) });
    expect(stock.forSale + stock.tradeLocked + stock.offSale).toBe(4);
  });

  test('item vendido não entra no stock', async () => {
    const a = await create();
    await create();
    await request(app).post(`/api/items/${a.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 200, soldAt: NOW.toISOString() });
    expect((await groups()).groups[0].stock).toMatchObject({ forSale: 1, tradeLocked: 0, offSale: 0 });
  });

  test('grupo só em trade lock aparece na aba À venda com stagnantCount 0', async () => {
    await create({ tradeUnlockAt: iso(3) });
    const g = (await groups('?saleState=FOR_SALE')).groups[0];
    expect(g).toMatchObject({ quantity: 1, stagnantCount: 0, stock: { forSale: 0, tradeLocked: 1, nextUnlockAt: iso(3) } });
  });

  test('holding em trade lock: stock.offSale, nunca tradeLocked', async () => {
    const a = await create({ tradeUnlockAt: iso(3) });
    await offSale(a.id);
    const g = (await groups('?saleState=OFF_SALE')).groups[0];
    expect(g.stock).toEqual({ forSale: 0, tradeLocked: 0, offSale: 1, nextUnlockAt: null });
    expect((await groups('?saleState=FOR_SALE')).groups).toEqual([]);
  });
});

describe('filtros e ordenação', () => {
  test('category filtra os grupos; sem unidades -> lista vazia', async () => {
    await create();
    await create({ catalogId: CAT.CASE_REVOLVER, acquisitionType: 'COMPRA' });
    const skin = await groups('?category=SKIN');
    expect(skin.groups.map((g) => g.category)).toEqual(['SKIN']);
    expect((await groups('?category=CAIXA')).groups.map((g) => g.category)).toEqual(['CAIXA']);
    expect((await groups('?category=STICKER')).groups).toEqual([]);
  });

  test('sortBy=age: order=desc (padrão) e asc invertem a ordem dos grupos pela primeira aparição', async () => {
    await create({ catalogId: CAT.AWP_DLORE, acquiredAt: iso(-10) });
    await create({ catalogId: CAT.AK_REDLINE, acquiredAt: iso(-60) });
    await create({ catalogId: CAT.M4A1S_PRINTSTREAM, acquiredAt: iso(-30) });
    const desc = await groups('?sortBy=age');
    const explicitDesc = await groups('?sortBy=age&order=desc');
    const asc = await groups('?sortBy=age&order=asc');
    expect(desc.groups.map((g) => g.name)).toEqual(explicitDesc.groups.map((g) => g.name));
    expect(desc.groups.map((g) => g.name)).toEqual(['AK-47 | Redline', 'M4A1-S | Printstream', 'AWP | Dragon Lore']);
    expect(asc.groups.map((g) => g.name)).toEqual(['AWP | Dragon Lore', 'M4A1-S | Printstream', 'AK-47 | Redline']);
  });

  test('o grupo herda a posição da primeira unidade; ordem interna igual à lista individual', async () => {
    const old = await create({ acquiredAt: iso(-60) });
    const mid = await create({ catalogId: CAT.AWP_DLORE, acquiredAt: iso(-30) });
    const young = await create({ acquiredAt: iso(-1) });
    for (const order of ['asc', 'desc']) {
      const g = await groups(`?sortBy=age&order=${order}`);
      const flat = (await list(`?status=EM_ESTOQUE&sortBy=age&order=${order}`)).items.map((i) => i.id);
      const ak = g.groups.find((x) => x.units.some((u) => u.id === old.id));
      expect(ak.units.map((u) => u.id)).toEqual(flat.filter((id) => id === old.id || id === young.id));
      expect(g.groups[0].units[0].id).toBe(flat[0]);
      expect(unitIds(g).sort((a, b) => a - b)).toEqual([old.id, mid.id, young.id].sort((a, b) => a - b));
    }
  });

  test('sem sortBy: devolve todas as unidades mesmo assim (mesmo conjunto da lista individual)', async () => {
    await create();
    await create({ catalogId: CAT.AWP_DLORE });
    const flat = (await list('?status=EM_ESTOQUE')).items.map((i) => i.id);
    expect(unitIds(await groups()).sort()).toEqual([...flat].sort());
  });

  test('conjunto de unidades igual ao do GET /api/items com a mesma query (matriz de filtros)', async () => {
    await create({ acquiredAt: iso(-60) });
    await create({ catalogId: CAT.AWP_DLORE, acquiredAt: iso(-3), tradeUnlockAt: iso(2) });
    await create({ catalogId: CAT.CASE_REVOLVER, acquiredAt: iso(-50) });
    const off = await create({ acquiredAt: iso(-70) });
    await offSale(off.id);
    const sold = await create();
    await request(app).post(`/api/items/${sold.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 200, soldAt: NOW.toISOString() });
    const queries = [
      '', 'category=SKIN', 'category=CAIXA', 'stagnantOnly=true', 'stagnantOnly=false', 'saleState=FOR_SALE', 'saleState=OFF_SALE',
      'stagnantOnly=true&saleState=OFF_SALE', 'category=SKIN&stagnantOnly=true&saleState=FOR_SALE',
    ];
    for (const q of queries) {
      for (const sort of ['', 'sortBy=age&order=asc', 'sortBy=age&order=desc']) {
        const qs = [q, sort].filter(Boolean).join('&');
        const grouped = await groups(qs ? `?${qs}` : '');
        const flat = await list(`?status=EM_ESTOQUE${qs ? `&${qs}` : ''}`);
        expect(unitIds(grouped).sort((a, b) => a - b)).toEqual(flat.items.map((i) => i.id).sort((a, b) => a - b));
        expect(grouped.meta.count).toBe(flat.items.length);
        expect(grouped.meta.groupCount).toBe(grouped.groups.length);
      }
    }
  });

  test('meta.saleStateCounts igual ao do GET /api/items e não depende de stagnantOnly nem saleState', async () => {
    await create({ acquiredAt: iso(-60) });
    await create({ catalogId: CAT.CASE_REVOLVER });
    const off = await create();
    await offSale(off.id);
    const flat = await list('?status=EM_ESTOQUE&sortBy=age');
    // a categoria entra na contagem (adendo 1); stagnantOnly e saleState não
    for (const q of ['', '?stagnantOnly=true', '?saleState=OFF_SALE']) {
      expect((await groups(q)).meta.saleStateCounts).toEqual(flat.meta.saleStateCounts);
    }
    expect(flat.meta.saleStateCounts).toEqual({ forSale: 2, offSale: 1 });
    const caixa = await list('?status=EM_ESTOQUE&category=CAIXA');
    expect((await groups('?category=CAIXA')).meta.saleStateCounts).toEqual(caixa.meta.saleStateCounts);
    expect(caixa.meta.saleStateCounts).toEqual({ forSale: 1, offSale: 0 });
  });

  test('meta traz os limites de giro, cotação e generatedAt', async () => {
    await create();
    const { meta } = await groups();
    expect(meta).toMatchObject({ fastTurnoverDays: 7, slowItemDays: 21 });
    expect(meta).toHaveProperty('usdBrlRate');
    expect(new Date(meta.generatedAt).toISOString()).toBe(NOW.toISOString());
  });

  test('limites de giro personalizados mudam stagnantCount', async () => {
    await create({ acquiredAt: iso(-10) });
    expect((await groups()).groups[0].stagnantCount).toBe(0);
    const patch = await request(app).patch('/api/settings').send({ fastTurnoverDays: 2, slowItemDays: 5 });
    expect(patch.status).toBe(200);
    const data = await groups();
    expect(data.groups[0].stagnantCount).toBe(1);
    expect(data.meta).toMatchObject({ fastTurnoverDays: 2, slowItemDays: 5 });
  });
});

describe('validação de query (400 INVALID_QUERY)', () => {
  test.each([
    ['?status=', 'status'],
    ['?status=VENDIDO', 'status'],
    ['?status=ALL', 'status'],
    ['?sortBy=turnaround', 'sortBy'],
    ['?sortBy=price', 'sortBy'],
    ['?sortBy=age&order=up', 'order'],
    ['?order=desc', 'order'],
    ['?category=ARMA', 'category'],
    ['?stagnantOnly=maybe', 'stagnantOnly'],
    ['?stagnantOnly=1', 'stagnantOnly'],
    ['?saleState=ALL', 'saleState'],
    ['?saleState=for_sale', 'saleState'],
  ])('%s', async (q, field) => {
    expectError(await get(q), 400, 'INVALID_QUERY', { field });
  });

  test('parâmetro repetido (array) é recusado ou tratado sem 500', async () => {
    const res = await get('?saleState=FOR_SALE&saleState=OFF_SALE');
    expect([200, 400]).toContain(res.status);
    if (res.status === 400) expectError(res, 400, 'INVALID_QUERY');
  });

  test('parâmetros desconhecidos não derrubam a rota', async () => {
    expect((await get('?foo=bar')).status).toBe(200);
  });
});

describe('formato, rota e segurança', () => {
  test('resposta padronizada { success, data } com os campos do contrato D274', async () => {
    await create();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
    expect(res.body.success).toBe(true);
    const g = res.body.data.groups[0];
    for (const field of [
      'key', 'name', 'category', 'variant', 'exterior', 'phase', 'catalog', 'quantity', 'totalCostUsdCents', 'avgCostUsdCents',
      'costUsesRecordedFx', 'approxBrl', 'stagnantCount', 'stock', 'units',
    ]) expect(g).toHaveProperty(field);
    expect(Object.keys(g.stock).sort()).toEqual(['forSale', 'nextUnlockAt', 'offSale', 'tradeLocked']);
    expect(g.units[0]).toHaveProperty('saleState');
    expect(g.units[0]).toHaveProperty('id');
  });

  test('/groups não colide com /:id e /:id/stats continua funcionando', async () => {
    const item = await create();
    const res = await get();
    expect(res.body.data).toHaveProperty('groups');
    const byId = await request(app).get(`/api/items/${item.id}`);
    expect(byId.status).toBe(200);
    expect(byId.body.data.id).toBe(item.id);
    expectError(await request(app).get('/api/items/9999'), 404, 'ITEM_NOT_FOUND');
  });

  test('GET não exige Content-Type; Host localhost e 127.0.0.1 passam', async () => {
    await create();
    for (const host of ['localhost:3001', '127.0.0.1:3001']) {
      expect((await get().set('Host', host)).status).toBe(200);
    }
  });

  test.each(['evil.example.com', 'localhost.evil.com', '192.168.0.10:3001'])('Host %s -> 403', async (host) => {
    expect((await get().set('Host', host)).status).toBe(403);
  });

  test('POST /api/items/groups não é uma rota de escrita (nem cria item)', async () => {
    const res = await request(app).post('/api/items/groups').send(purchaseBody());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect((await list('?status=EM_ESTOQUE')).items).toHaveLength(0);
  });

  test('ações refletem na hora: vender e excluir mudam quantidade; grupo vazio some', async () => {
    const a = await create();
    const b = await create();
    expect((await groups()).groups[0].quantity).toBe(2);
    await request(app).delete(`/api/items/${a.id}`);
    expect((await groups()).groups[0].quantity).toBe(1);
    await request(app).delete(`/api/items/${b.id}`);
    expect((await groups()).groups).toEqual([]);
  });

  test('holding e volta à venda: a unidade muda de aba mas o grupo da outra aba continua com stock coerente', async () => {
    const a = await create();
    await offSale(a.id);
    expect((await groups('?saleState=FOR_SALE')).groups).toEqual([]);
    await request(app).post(`/api/items/${a.id}/for-sale`).send({});
    const g = (await groups('?saleState=FOR_SALE')).groups[0];
    expect(g.stock).toMatchObject({ forSale: 1, offSale: 0 });
    expect((await groups('?saleState=OFF_SALE')).groups).toEqual([]);
  });
});
