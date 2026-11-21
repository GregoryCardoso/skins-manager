const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, createItemViaApi, expectError } = require('../helpers/apiFixtures');
const Setting = require('../../src/models/Setting');

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

describe('POST /sell com netReceivedCents (D122)', () => {
  test('líquido informado prevalece sobre o calculado e grava o snapshot da loja', async () => {
    const item = await createItemViaApi(app);
    const res = await sell(item.id, { netReceivedCents: 120 });
    expect(res.status).toBe(200);
    expect(res.body.data.sale).toEqual({ netReceivedCents: 120, feeCents: 5, saleProfitUsdCents: 20, netReceivedManual: true });
    expect(res.body.data.item).toMatchObject({
      netReceivedCents: 120, netReceivedManual: true, saleFeeTypeApplied: 'DEDUCTED', saleFeeRateApplied: 0.02,
    });
  });

  test('líquido igual ao calculado é aceito e marcado como manual; sem líquido, calculado e não manual', async () => {
    const a = await createItemViaApi(app);
    const manual = await sell(a.id, { netReceivedCents: 122 });
    expect(manual.body.data.sale).toMatchObject({ netReceivedCents: 122, netReceivedManual: true });
    const b = await createItemViaApi(app);
    const auto = await sell(b.id);
    expect(auto.body.data.sale).toMatchObject({ netReceivedCents: 122, netReceivedManual: false });
  });

  test('teto: líquido > preço é recusado (DEDUCTED e ADDED); líquido = preço é aceito', async () => {
    const item = await createItemViaApi(app);
    expectError(await sell(item.id, { netReceivedCents: 126 }), 400, 'NET_RECEIVED_ABOVE_PRICE', { field: 'netReceivedCents' });
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.status).toBe('EM_ESTOQUE');
    expect((await sell(item.id, { netReceivedCents: 125 })).status).toBe(200);

    Setting.update({ usdBrlRate: 5 });
    const other = await createItemViaApi(app);
    const steam = { saleStoreId: storeId('Steam'), salePriceCents: 115 };
    expectError(await sell(other.id, { ...steam, netReceivedCents: 116 }), 400, 'NET_RECEIVED_ABOVE_PRICE', { field: 'netReceivedCents' });
    const ok = await sell(other.id, { ...steam, netReceivedCents: 100 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.item).toMatchObject({ saleCurrency: 'BRL', fxRateAtSale: 5, netReceivedCents: 100 });
  });

  test('validação de forma e valor', async () => {
    const item = await createItemViaApi(app);
    for (const v of [0, -1]) {
      expectError(await sell(item.id, { netReceivedCents: v }), 400, 'INVALID_AMOUNT', { field: 'netReceivedCents' });
    }
    for (const v of [1.5, '120']) {
      expectError(await sell(item.id, { netReceivedCents: v }), 400, 'INVALID_FIELD', { field: 'netReceivedCents' });
    }
    expectError(
      await sell(item.id, { netReceivedCents: 1e10 + 1 }), 400, 'INVALID_AMOUNT',
      { field: 'netReceivedCents', params: { maxCents: 1e10 } }
    );
    expect((await sell(item.id, { netReceivedCents: null })).body.data.sale.netReceivedManual).toBe(false);
  });

  test('loja sem taxa: sem líquido -> FEES_NOT_CONFIGURED no campo; com líquido -> snapshot nulo e manual', async () => {
    const item = await createItemViaApi(app);
    const csmoney = { saleStoreId: storeId('CSMoney'), salePriceCents: 200 };
    expectError(await sell(item.id, csmoney), 400, 'FEES_NOT_CONFIGURED', { field: 'netReceivedCents' });
    const res = await sell(item.id, { ...csmoney, netReceivedCents: 180 });
    expect(res.status).toBe(200);
    expect(res.body.data.sale).toEqual({ netReceivedCents: 180, feeCents: 20, saleProfitUsdCents: 80, netReceivedManual: true });
    const row = getDb().prepare('SELECT * FROM items WHERE id = ?').get(item.id);
    expect(row).toMatchObject({
      sale_fee_type_applied: null, sale_fee_rate_applied: null, sale_fee_rounding_applied: null,
      sale_min_fee_cents_applied: null, sale_fixed_fee_cents_applied: null, net_received_manual: 1,
    });
    const got = (await request(app).get(`/api/items/${item.id}`)).body.data;
    expect(got).toMatchObject({ netReceivedManual: true, netReceivedCents: 180, status: 'VENDIDO' });
    expect(got.stats.avgProfitUsdCents).toBe(80);
  });

  test('unsell limpa o líquido manual; nova venda sem líquido calcula', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id, { netReceivedCents: 120 });
    const un = await request(app).post(`/api/items/${item.id}/unsell`).set('Content-Type', 'application/json').send();
    expect(un.body.data).toMatchObject({ netReceivedCents: null, netReceivedManual: false, saleFeeTypeApplied: null });
    const again = await sell(item.id);
    expect(again.body.data.sale).toMatchObject({ netReceivedCents: 122, netReceivedManual: false });
  });

  test('PATCH com campos de líquido -> SALE_FIELDS_LOCKED; sell com netReceivedManual -> UNKNOWN_FIELD', async () => {
    const item = await createItemViaApi(app);
    for (const body of [{ netReceivedCents: 1 }, { netReceivedManual: true }]) {
      expectError(await request(app).patch(`/api/items/${item.id}`).send(body), 400, 'SALE_FIELDS_LOCKED');
    }
    expectError(await sell(item.id, { netReceivedManual: true }), 400, 'UNKNOWN_FIELD', { field: 'netReceivedManual' });
  });
});

describe('GET /api/stores/:id/sale-quote', () => {
  const quote = (id, q) => request(app).get(`/api/stores/${id}/sale-quote${q}`);

  test('calcula a prévia sem gravar', async () => {
    const res = await quote(storeId('CSFloat'), '?salePriceCents=125');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      storeId: storeId('CSFloat'), currency: 'USD', salePriceCents: 125, feeCents: 3, netReceivedCents: 122,
    });
    expect((await quote(storeId('Steam'), '?salePriceCents=115')).body.data.netReceivedCents).toBe(100);
  });

  test('erros', async () => {
    expectError(await quote(storeId('CSMoney'), '?salePriceCents=125'), 400, 'FEES_NOT_CONFIGURED');
    for (const q of ['', '?salePriceCents=0', '?salePriceCents=abc', '?salePriceCents=1.5']) {
      expectError(await quote(storeId('CSFloat'), q), 400, 'INVALID_QUERY', { field: 'salePriceCents' });
    }
    expectError(await quote(9999, '?salePriceCents=100'), 404, 'STORE_NOT_FOUND');
    expectError(await quote('abc', '?salePriceCents=100'), 400, 'INVALID_ID');
  });
});
