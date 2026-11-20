const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { CAT, makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const sell = (id, body) => request(app).post(`/api/items/${id}/sell`).send(body);
const sales = (q) => request(app).get('/api/items/sales').query(q);

async function sellItem(overrides = {}, saleOverrides = {}) {
  const item = await createItemViaApi(app, purchaseBody(overrides));
  const res = await sell(item.id, {
    saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...saleOverrides,
  });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return item.id;
}

describe('GET /api/items/sales', () => {
  test('só vendidos, ordem padrão por data desc, resumo coerente', async () => {
    const a = await sellItem({}, { soldAt: '2026-11-15T12:00:00.000Z' });
    const b = await sellItem({}, { soldAt: '2026-11-18T12:00:00.000Z' });
    await createItemViaApi(app);
    const res = await sales({});
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((i) => i.id)).toEqual([b, a]);
    expect(res.body.data.summary).toMatchObject({
      count: 2, totalNetReceivedUsdCents: 244, totalPurchaseCostUsdCents: 200, totalProfitUsdCents: 44,
    });
    expect(res.body.data.meta).toMatchObject({ count: 2, soldFrom: null, soldTo: null });
    expect(res.body.data.items[0].saleInfo).toMatchObject({ netReceivedUsdCents: 122, usesRecordedFx: false });
  });

  test('sortBy turnaround: padrão asc; order desc; soldAt asc', async () => {
    const slow = await sellItem({ acquiredAt: '2026-11-01T12:00:00.000Z' }, { soldAt: '2026-11-18T12:00:00.000Z' });
    const fast = await sellItem({ acquiredAt: '2026-11-10T12:00:00.000Z' }, { soldAt: '2026-11-12T12:00:00.000Z' });
    expect((await sales({ sortBy: 'turnaround' })).body.data.items.map((i) => i.id)).toEqual([fast, slow]);
    expect((await sales({ sortBy: 'turnaround', order: 'desc' })).body.data.items.map((i) => i.id)).toEqual([slow, fast]);
    expect((await sales({ sortBy: 'soldAt', order: 'asc' })).body.data.items.map((i) => i.id)).toEqual([fast, slow]);
  });

  test('filtro por loja; loja inexistente -> lista vazia', async () => {
    Setting.update({ usdBrlRate: 5 });
    await sellItem();
    const steam = await sellItem({}, { saleStoreId: storeId('Steam'), salePriceCents: 115 });
    const r = await sales({ saleStoreId: storeId('Steam') });
    expect(r.body.data.items.map((i) => i.id)).toEqual([steam]);
    expect(r.body.data.summary.soldWithFxCount).toBe(1);
    const none = await sales({ saleStoreId: 999 });
    expect(none.status).toBe(200);
    expect(none.body.data.items).toEqual([]);
    expect(none.body.data.summary.count).toBe(0);
  });

  test('período inclusivo em dias de Brasília; from = to é um dia', async () => {
    const a = await sellItem({}, { soldAt: '2026-11-17T12:00:00.000Z' });
    await sellItem({}, { soldAt: '2026-11-18T12:00:00.000Z' });
    const r = await sales({ soldFrom: '2026-11-17', soldTo: '2026-11-17' });
    expect(r.body.data.items.map((i) => i.id)).toEqual([a]);
    expect(r.body.data.meta).toMatchObject({ soldFrom: '2026-11-17', soldTo: '2026-11-17' });
    expect(r.body.data.summary.count).toBe(1);
  });

  test('validação de query', async () => {
    for (const v of ['abc', '0', '-1', '1.5']) {
      expectError(await sales({ saleStoreId: v }), 400, 'INVALID_QUERY', { field: 'saleStoreId' });
    }
    for (const v of ['2026-02-30', '2026-1-5', '2026-11-17T10:00:00Z']) {
      expectError(await sales({ soldFrom: v }), 400, 'INVALID_QUERY', { field: 'soldFrom' });
      expectError(await sales({ soldTo: v }), 400, 'INVALID_QUERY', { field: 'soldTo' });
    }
    expectError(await sales({ soldFrom: '2026-11-18', soldTo: '2026-11-17' }), 400, 'INVALID_QUERY', { field: 'soldTo' });
    expectError(await sales({ sortBy: 'age' }), 400, 'INVALID_QUERY', { field: 'sortBy' });
    expectError(await sales({ order: 'asc' }), 400, 'INVALID_QUERY', { field: 'order' });
  });

  test('unsell tira da lista e do resumo; stats não mudam com o período', async () => {
    const a = await sellItem({}, { soldAt: '2026-11-15T12:00:00.000Z' });
    await sellItem({}, { soldAt: '2026-11-18T12:00:00.000Z' });
    const filtered = await sales({ soldFrom: '2026-11-18' });
    expect(filtered.body.data.items[0].stats).toMatchObject({ soldCount: 2, unitCount: 2 });
    await request(app).post(`/api/items/${a}/unsell`).send({});
    const all = await sales({});
    expect(all.body.data.summary.count).toBe(1);
    expect(all.body.data.items).toHaveLength(1);
  });

  test('/sales não cai em /:id; saleInfo em GET /:id; sem chaves de saque', async () => {
    const id = await sellItem();
    const stock = await createItemViaApi(app);
    expect((await request(app).get(`/api/items/${id}`)).body.data.saleInfo).not.toBeNull();
    expect((await request(app).get(`/api/items/${stock.id}`)).body.data.saleInfo).toBeNull();
    const res = await sales({});
    expect(JSON.stringify(res.body)).not.toMatch(/sac|withdraw/i);
  });

  test('GET /stats aceita phase e a usa na chave', async () => {
    await createItemViaApi(app, purchaseBody({ catalogId: CAT.AK_REDLINE }));
    const res = await request(app).get('/api/items/stats').query({ name: 'AK-47 | Redline', category: 'SKIN', phase: 'Ruby' });
    expect(res.status).toBe(200);
    expect(res.body.data.unitCount).toBe(0);
    const plain = await request(app).get('/api/items/stats').query({ name: 'AK-47 | Redline', category: 'SKIN' });
    expect(plain.body.data.unitCount).toBe(1);
  });
});
