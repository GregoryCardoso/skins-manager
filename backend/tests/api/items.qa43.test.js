// QA da etapa 4B.3: bordas de D113, D114, D115 e D122 (complementa os testes do implementador).
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');
const Setting = require('../../src/models/Setting');
const CatalogItem = require('../../src/models/CatalogItem');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const sell = (id, body = {}) =>
  request(app).post(`/api/items/${id}/sell`).send({
    saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...body,
  });
const patch = (id, body) => request(app).patch(`/api/items/${id}`).send(body);
const post = (body) => request(app).post('/api/items').send(body);

describe('POST /sell com netReceivedCents: bordas (D122)', () => {
  test('ADDED: líquido = preço aceito; líquido = 1 aceito (mínimo)', async () => {
    Setting.update({ usdBrlRate: 5 });
    const a = await createItemViaApi(app);
    const steam = { saleStoreId: storeId('Steam'), salePriceCents: 115 };
    const ok = await sell(a.id, { ...steam, netReceivedCents: 115 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.sale).toMatchObject({ netReceivedCents: 115, feeCents: 0, netReceivedManual: true });
    const b = await createItemViaApi(app);
    expect((await sell(b.id, { ...steam, netReceivedCents: 1 })).status).toBe(200);
  });

  test('loja BRL com líquido manual: lucro em USD usa a cotação da venda; snapshot da Steam preservado', async () => {
    Setting.update({ usdBrlRate: 5 });
    const item = await createItemViaApi(app); // custo 100 centavos USD
    const res = await sell(item.id, { saleStoreId: storeId('Steam'), salePriceCents: 1150, netReceivedCents: 1000, fxRateAtSale: 5 });
    expect(res.status).toBe(200);
    // 1000 centavos BRL / 5 = 200 centavos USD; lucro = 200 - 100
    expect(res.body.data.sale).toMatchObject({ netReceivedCents: 1000, netReceivedManual: true, saleProfitUsdCents: 100 });
    expect(res.body.data.item).toMatchObject({ saleCurrency: 'BRL', fxRateAtSale: 5 });
    expect(res.body.data.item.saleFeeTypeApplied).not.toBeNull();
    expect(res.body.data.item.saleFeeRateApplied).not.toBeNull();
  });

  test('loja BRL sem cotação e com líquido manual -> FX_RATE_REQUIRED no campo', async () => {
    const item = await createItemViaApi(app);
    expectError(
      await sell(item.id, { saleStoreId: storeId('Steam'), salePriceCents: 115, netReceivedCents: 100 }),
      400, 'FX_RATE_REQUIRED', { field: 'fxRateAtSale' }
    );
  });

  test('loja sem taxa: líquido = preço (taxa 0) aceito; líquido > preço recusado; item continua em estoque', async () => {
    const item = await createItemViaApi(app);
    const cs = { saleStoreId: storeId('CSMoney'), salePriceCents: 200 };
    expectError(await sell(item.id, { ...cs, netReceivedCents: 201 }), 400, 'NET_RECEIVED_ABOVE_PRICE', { field: 'netReceivedCents' });
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.status).toBe('EM_ESTOQUE');
    const ok = await sell(item.id, { ...cs, netReceivedCents: 200 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.sale).toMatchObject({ feeCents: 0, netReceivedManual: true });
  });

  test('loja sem taxa com líquido 0 ou negativo -> INVALID_AMOUNT; null -> FEES_NOT_CONFIGURED', async () => {
    const item = await createItemViaApi(app);
    const cs = { saleStoreId: storeId('CSMoney'), salePriceCents: 200 };
    for (const v of [0, -5]) expectError(await sell(item.id, { ...cs, netReceivedCents: v }), 400, 'INVALID_AMOUNT', { field: 'netReceivedCents' });
    expectError(await sell(item.id, { ...cs, netReceivedCents: null }), 400, 'FEES_NOT_CONFIGURED', { field: 'netReceivedCents' });
  });

  test('valores não numéricos: booleano, objeto, array, texto', async () => {
    const item = await createItemViaApi(app);
    for (const v of [true, {}, [], 'abc']) {
      expectError(await sell(item.id, { netReceivedCents: v }), 400, 'INVALID_FIELD', { field: 'netReceivedCents' });
    }
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.status).toBe('EM_ESTOQUE');
  });

  test('snapshot da loja continua quando o líquido é corrigido; vendas manual e automática entram na mesma média', async () => {
    const a = await createItemViaApi(app);
    const b = await createItemViaApi(app);
    await sell(a.id, { netReceivedCents: 100 }); // lucro 0
    await sell(b.id); // líquido 122, lucro 22
    const got = (await request(app).get(`/api/items/${a.id}`)).body.data;
    expect(got).toMatchObject({ saleFeeTypeApplied: 'DEDUCTED', saleFeeRateApplied: 0.02, netReceivedManual: true });
    expect(got.stats.avgSalePriceUsdCents).toBe(125);
    expect(got.stats.avgProfitUsdCents).toBe(11);
  });

  test('unsell de venda sem taxa (snapshot nulo) funciona e permite revenda calculada', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id, { saleStoreId: storeId('CSMoney'), salePriceCents: 200, netReceivedCents: 180 });
    const un = await request(app).post(`/api/items/${item.id}/unsell`).set('Content-Type', 'application/json').send();
    expect(un.status).toBe(200);
    expect(un.body.data).toMatchObject({ status: 'EM_ESTOQUE', netReceivedManual: false, netReceivedCents: null, saleStoreId: null });
    expect((await sell(item.id)).body.data.sale.netReceivedManual).toBe(false);
  });

  test('coluna net_received_manual = 0 em venda automática e em item não vendido', async () => {
    const item = await createItemViaApi(app);
    const read = () => getDb().prepare('SELECT net_received_manual m FROM items WHERE id=?').get(item.id).m;
    expect(read()).toBe(0);
    await sell(item.id);
    expect(read()).toBe(0);
  });
});

describe('GET /api/stores/:id/sale-quote: query inválida e bordas', () => {
  const quote = (id, q) => request(app).get(`/api/stores/${id}/sale-quote${q}`);

  test('queries inválidas', async () => {
    const qs = ['?salePriceCents=-5', '?salePriceCents=1e3', '?salePriceCents=%2012', '?salePriceCents=10000000001', '?salePriceCents=', '?salePriceCents=1&salePriceCents=2', '?salePriceCents[]=1'];
    for (const q of qs) expectError(await quote(storeId('CSFloat'), q), 400, 'INVALID_QUERY', { field: 'salePriceCents' });
  });

  test('teto exato aceito', async () => {
    expect((await quote(storeId('CSFloat'), '?salePriceCents=10000000000')).status).toBe(200);
  });

  test('1 centavo: resposta padronizada, nunca 500', async () => {
    const res = await quote(storeId('CSFloat'), '?salePriceCents=1');
    expect([200, 400]).toContain(res.status);
    if (res.status === 400) expect(res.body.error.code).toBe('NET_RECEIVED_NEGATIVE');
  });

  test('sem taxa, id inválido e loja inexistente; nada é gravado', async () => {
    expectError(await quote(storeId('CSMoney'), '?salePriceCents=100'), 400, 'FEES_NOT_CONFIGURED');
    expectError(await quote(0, '?salePriceCents=100'), 400, 'INVALID_ID');
    expectError(await quote(99999, '?salePriceCents=100'), 404, 'STORE_NOT_FOUND');
    expect(getDb().prepare('SELECT count(*) c FROM items').get().c).toBe(0);
  });
});

describe('inspectLink (D114): bordas', () => {
  test('maiúsculas no esquema e no começo', async () => {
    for (const v of ['HTTPS://x.y/z', 'Steam://abc', 'sTeAm://abc']) expect((await post(purchaseBody({ inspectLink: v }))).status).toBe(201);
  });

  test('recusados: esquemas perigosos, sem host, vazio de conteúdo', async () => {
    const bad = ['steam://', 'STEAM://', 'steam:// x', 'https://', 'HTTP://x.y', 'JavaScript:alert(1)', ' javascript:alert(1)', '//x.y', 'https:x.y', 'file:///c:/x', 'vbscript:x'];
    for (const v of bad) expectError(await post(purchaseBody({ inspectLink: v })), 400, 'INVALID_FIELD', { field: 'inspectLink' });
  });

  test('só espaços vira null', async () => {
    expect((await post(purchaseBody({ inspectLink: '   ' }))).body.data.inspectLink).toBeNull();
  });

  test('tamanho: 2048 aceito, 2049 recusado (POST e PATCH); espaços nas pontas não contam', async () => {
    const link = (n) => `steam://${'a'.repeat(n - 8)}`;
    expect(link(2048)).toHaveLength(2048);
    expect((await post(purchaseBody({ inspectLink: link(2048) }))).status).toBe(201);
    expectError(await post(purchaseBody({ inspectLink: link(2049) })), 400, 'FIELD_TOO_LONG', { field: 'inspectLink', params: { maxLength: 2048 } });
    expect((await post(purchaseBody({ inspectLink: `  ${link(2048)}  ` }))).status).toBe(201);
    const item = await createItemViaApi(app);
    expect((await patch(item.id, { inspectLink: link(2048) })).status).toBe(200);
    expectError(await patch(item.id, { inspectLink: link(2049) }), 400, 'FIELD_TOO_LONG', { field: 'inspectLink' });
  });

  test('PATCH valida o link novo; vazio e null limpam', async () => {
    const item = await createItemViaApi(app, purchaseBody({ inspectLink: 'steam://abc' }));
    expectError(await patch(item.id, { inspectLink: 'http://x.y' }), 400, 'INVALID_FIELD', { field: 'inspectLink' });
    expect((await patch(item.id, { inspectLink: '' })).body.data.inspectLink).toBeNull();
    expect((await patch(item.id, { inspectLink: 'https://a.b' })).body.data.inspectLink).toBe('https://a.b');
    expect((await patch(item.id, { inspectLink: null })).body.data.inspectLink).toBeNull();
  });

  test('item antigo com link inválido continua editável em outros campos e vendável', async () => {
    const item = await createItemViaApi(app);
    getDb().prepare("UPDATE items SET inspect_link = 'javascript:alert(1)' WHERE id = ?").run(item.id);
    const res = await patch(item.id, { purchasePriceCents: 150, originDetail: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.data.inspectLink).toBe('javascript:alert(1)');
    expect((await sell(item.id)).status).toBe(200);
  });

  test('não-string -> INVALID_FIELD', async () => {
    for (const v of [123, true, {}]) expectError(await post(purchaseBody({ inspectLink: v })), 400, 'INVALID_FIELD', { field: 'inspectLink' });
  });
});

describe('field/params nos erros (D113): PATCH, venda e erros sem campo', () => {
  test('PATCH: campos', async () => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { foo: 1 }), 400, 'UNKNOWN_FIELD', { field: 'foo' });
    expectError(await patch(item.id, { purchasePriceCents: 'x' }), 400, 'INVALID_FIELD', { field: 'purchasePriceCents' });
    expectError(await patch(item.id, { floatValue: 0.01 }), 400, 'FLOAT_OUT_OF_RANGE', { field: 'floatValue', params: { minFloat: 0.1, maxFloat: 0.7 } });
    expectError(await patch(item.id, { acquiredAt: 'x' }), 400, 'INVALID_DATE', { field: 'acquiredAt' });
    expectError(await patch(item.id, { originDetail: 'x'.repeat(201) }), 400, 'FIELD_TOO_LONG', { field: 'originDetail', params: { maxLength: 200 } });
  });

  test('sem field/params: ITEM_NOT_FOUND, ITEM_ALREADY_SOLD, ITEM_NOT_SOLD', async () => {
    const item = await createItemViaApi(app);
    expectError(await sell(9999), 404, 'ITEM_NOT_FOUND', { field: null, params: null });
    expectError(await request(app).post('/api/items/9999/unsell').set('Content-Type', 'application/json').send(), 404, 'ITEM_NOT_FOUND', { field: null });
    expectError(await request(app).delete('/api/items/9999'), 404, 'ITEM_NOT_FOUND', { field: null });
    expectError(await patch(9999, { originDetail: 'a' }), 404, 'ITEM_NOT_FOUND', { field: null });
    expectError(await request(app).post(`/api/items/${item.id}/unsell`).set('Content-Type', 'application/json').send(), 409, 'ITEM_NOT_SOLD', { field: null, params: null });
    await sell(item.id);
    expectError(await sell(item.id), 409, 'ITEM_ALREADY_SOLD', { field: null, params: null });
  });

  test('rota inexistente e JSON inválido: sem a chave field', async () => {
    const r = await request(app).get('/api/nao-existe');
    expect(r.body.success).toBe(false);
    expect(r.body.error).not.toHaveProperty('field');
    const bad = await request(app).post('/api/items').set('Content-Type', 'application/json').send('{x');
    expect(bad.status).toBe(400);
    expect(bad.body.error).not.toHaveProperty('field');
    expect(bad.body.error).not.toHaveProperty('params');
  });

  test('ITEM_TRADE_LOCKED no PATCH de vendido: params.tradeUnlockAt ISO', async () => {
    const item = await createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-15T12:00:00.000Z' }));
    await sell(item.id, { soldAt: '2026-11-16T12:00:00.000Z' });
    expectError(
      await patch(item.id, { tradeUnlockAt: '2026-11-18T12:00:00.000Z' }), 409, 'ITEM_TRADE_LOCKED',
      { field: 'tradeUnlockAt', params: { tradeUnlockAt: '2026-11-18T12:00:00.000Z' } }
    );
  });
});

describe('T51 (D115): bordas da deduplicação', () => {
  const row = (id, o = {}) => ({
    id, source: 'SKINS', category: 'FACA', name: 'Zzdup | Test', namePtBr: null, nameKey: 'zzdup | test',
    searchText: 'zzdup | test', imageUrl: null, minFloat: 0, maxFloat: 1, hasStattrak: false, hasSouvenir: false,
    phase: null, rarity: null, ...o,
  });
  const search = (q) => request(app).get(`/api/catalog/search?${q}`);

  test('empate de imagem: menor id; sem imagem em nenhum: menor id', async () => {
    CatalogItem.upsertMany([
      row('z3', { imageUrl: 'https://i/3' }), row('z1', { imageUrl: 'https://i/1' }), row('z2', { imageUrl: 'https://i/2' }),
      row('y9', { name: 'Zzdup | Other', nameKey: 'zzdup | other', searchText: 'zzdup | other' }),
      row('y2', { name: 'Zzdup | Other', nameKey: 'zzdup | other', searchText: 'zzdup | other' }),
    ]);
    const res = await search('q=zzdup');
    expect(res.body.data.items.map((i) => i.id).sort()).toEqual(['y2', 'z1']);
    expect(res.body.data.meta.total).toBe(2);
  });

  test('StatTrak/Souvenir ou categoria diferentes não colapsam', async () => {
    CatalogItem.upsertMany([row('s1'), row('s2', { hasStattrak: true }), row('s3', { hasSouvenir: true }), row('s4', { category: 'SKIN' })]);
    expect((await search('q=zzdup')).body.data.items).toHaveLength(4);
  });

  test('limit conta grupos (não linhas): total = grupos, itens ≤ limit', async () => {
    const rows = [];
    for (let i = 0; i < 5; i += 1) {
      const nk = `zzpag item ${i}`;
      rows.push(row(`p${i}a`, { name: nk, nameKey: nk, searchText: nk }), row(`p${i}b`, { name: nk, nameKey: nk, searchText: nk }));
    }
    CatalogItem.upsertMany(rows);
    const small = (await search('q=zzpag&limit=3')).body.data;
    expect(small.items).toHaveLength(3);
    expect(small.meta.total).toBe(5);
    const all = (await search('q=zzpag&limit=20')).body.data;
    expect(all.items).toHaveLength(5);
    expect(new Set(all.items.map((i) => i.id.slice(0, 2))).size).toBe(5);
  });

  test('item vinculado ao id escondido: GET, PATCH, venda e unsell funcionam', async () => {
    CatalogItem.upsertMany([row('h-a', { imageUrl: 'https://i/a' }), row('h-b')]);
    expect((await search('q=zzdup')).body.data.items.map((i) => i.id)).toEqual(['h-a']);
    const item = await createItemViaApi(app, purchaseBody({ catalogId: 'h-b' }));
    expect((await patch(item.id, { purchasePriceCents: 99 })).status).toBe(200);
    expect((await sell(item.id)).status).toBe(200);
    expect((await request(app).post(`/api/items/${item.id}/unsell`).set('Content-Type', 'application/json').send()).status).toBe(200);
  });
});
