const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { CAT, makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
  Setting.update({ usdBrlRate: 5 });
});
afterAll(() => closeDb());

const sales = (q) => request(app).get('/api/items/sales').query(q);
const sell = (id, body) => request(app).post(`/api/items/${id}/sell`).send(body);

async function sellItem(overrides = {}, saleOverrides = {}) {
  const item = await createItemViaApi(app, purchaseBody(overrides));
  const res = await sell(item.id, {
    saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...saleOverrides,
  });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return item.id;
}

describe('GET /api/items/sales: lacunas da D132', () => {
  test('resumo bate com a soma das linhas (moedas misturadas, GANHEI)', async () => {
    await sellItem();
    await sellItem({}, { saleStoreId: storeId('Steam'), salePriceCents: 540 });
    await sellItem({ acquisitionType: 'GANHEI', purchaseStoreId: undefined, purchasePriceCents: undefined });
    const { items, summary, meta } = (await sales({})).body.data;
    expect(items).toHaveLength(3);
    const sum = (f) => items.reduce((a, i) => a + f(i.saleInfo), 0);
    expect(summary.count).toBe(meta.count);
    expect(summary.totalSalePriceUsdCents).toBe(sum((s) => s.salePriceUsdCents));
    expect(summary.totalNetReceivedUsdCents).toBe(sum((s) => s.netReceivedUsdCents));
    expect(summary.totalPurchaseCostUsdCents).toBe(sum((s) => s.purchaseCostUsdCents));
    expect(summary.totalProfitUsdCents).toBe(items.reduce((a, i) => a + i.saleProfitUsdCents, 0));
    expect(summary.totalProfitUsdCents).toBe(summary.totalNetReceivedUsdCents - summary.totalPurchaseCostUsdCents);
    expect(summary.soldWithFxCount).toBe(items.filter((i) => i.saleInfo.usesRecordedFx).length);
    expect(summary.soldWithFxCount).toBe(1);
  });

  test('resumo respeita o filtro (loja e período) e a lista filtrada', async () => {
    await sellItem({}, { soldAt: '2026-11-10T12:00:00.000Z' });
    await sellItem({}, { soldAt: '2026-11-15T12:00:00.000Z', saleStoreId: storeId('Steam'), salePriceCents: 540 });
    await sellItem({}, { soldAt: '2026-11-17T12:00:00.000Z' });
    const r = (await sales({ soldFrom: '2026-11-12', saleStoreId: storeId('CSFloat') })).body.data;
    expect(r.items).toHaveLength(1);
    expect(r.summary.count).toBe(1);
    expect(r.summary.totalSalePriceUsdCents).toBe(125);
  });

  test('só soldFrom; só soldTo; pontas 00:00 e 23:59:59.999 BRT', async () => {
    const a = await sellItem({}, { soldAt: '2026-11-17T02:59:59.999Z' }); // dia 16 BRT
    const b = await sellItem({}, { soldAt: '2026-11-17T03:00:00.000Z' }); // dia 17 BRT 00:00
    const c = await sellItem({}, { soldAt: '2026-11-18T02:59:59.999Z' }); // dia 17 BRT 23:59:59.999
    const d = await sellItem({}, { soldAt: '2026-11-18T03:00:00.000Z' }); // dia 18 BRT
    const ids = async (q) => (await sales({ ...q, sortBy: 'soldAt', order: 'asc' })).body.data.items.map((i) => i.id);
    expect(await ids({ soldFrom: '2026-11-17', soldTo: '2026-11-17' })).toEqual([b, c]);
    expect(await ids({ soldFrom: '2026-11-17' })).toEqual([b, c, d]);
    expect(await ids({ soldTo: '2026-11-16' })).toEqual([a]);
  });

  test('2026-11-20T02:30Z conta como dia 19 (via API)', async () => {
    freshDb();
    const { makeApp } = require('../helpers/apiFixtures');
    app = makeApp(new Date('2026-11-21T12:00:00.000Z'), { catalog: true });
    const id = await sellItem({}, { soldAt: '2026-11-20T02:30:00.000Z' });
    expect((await sales({ soldFrom: '2026-11-19', soldTo: '2026-11-19' })).body.data.items.map((i) => i.id)).toEqual([id]);
    expect((await sales({ soldFrom: '2026-11-20' })).body.data.items).toEqual([]);
  });

  test('validação extra: valores repetidos, vazios e datas impossíveis', async () => {
    expectError(await request(app).get('/api/items/sales?saleStoreId=1&saleStoreId=2'), 400, 'INVALID_QUERY', { field: 'saleStoreId' });
    expectError(await sales({ saleStoreId: '' }), 400, 'INVALID_QUERY', { field: 'saleStoreId' });
    expectError(await sales({ saleStoreId: '01' }), 400, 'INVALID_QUERY', { field: 'saleStoreId' });
    expectError(await sales({ saleStoreId: '1e3' }), 400, 'INVALID_QUERY', { field: 'saleStoreId' });
    expectError(await sales({ soldFrom: '2026-13-01' }), 400, 'INVALID_QUERY', { field: 'soldFrom' });
    expectError(await sales({ soldTo: '2026-00-10' }), 400, 'INVALID_QUERY', { field: 'soldTo' });
    expectError(await sales({ soldTo: '2025-02-29' }), 400, 'INVALID_QUERY', { field: 'soldTo' });
    expectError(await sales({ sortBy: 'age', order: 'asc' }), 400, 'INVALID_QUERY', { field: 'sortBy' });
    expectError(await sales({ sortBy: 'soldAt', order: 'up' }), 400, 'INVALID_QUERY', { field: 'order' });
    expect((await sales({ soldTo: '2024-02-29' })).status).toBe(200);
  });

  test('sortBy=soldAt sem order é desc; empate de soldAt desempata por id ASC', async () => {
    const a = await sellItem({}, { soldAt: '2026-11-18T12:00:00.000Z' });
    const b = await sellItem({}, { soldAt: '2026-11-18T12:00:00.000Z' });
    const c = await sellItem({}, { soldAt: '2026-11-19T12:00:00.000Z' });
    expect((await sales({ sortBy: 'soldAt' })).body.data.items.map((i) => i.id)).toEqual([c, a, b]);
    expect((await sales({})).body.data.items.map((i) => i.id)).toEqual([c, a, b]);
    expect((await sales({ sortBy: 'soldAt', order: 'asc' })).body.data.items.map((i) => i.id)).toEqual([a, b, c]);
  });

  test('chaves desconhecidas na query são ignoradas', async () => {
    await sellItem();
    const r = await sales({ foo: 'bar', status: 'EM_ESTOQUE' });
    expect(r.status).toBe(200);
    expect(r.body.data.items).toHaveLength(1);
  });

  test('desfazer venda: sai da lista e do resumo e reaparece no estoque', async () => {
    const a = await sellItem();
    const b = await sellItem();
    expect((await request(app).post(`/api/items/${a}/unsell`).send({})).status).toBe(200);
    const r = (await sales({})).body.data;
    expect(r.items.map((i) => i.id)).toEqual([b]);
    expect(r.summary).toMatchObject({ count: 1, totalSalePriceUsdCents: 125 });
    expect(r.items[0].stats).toMatchObject({ soldCount: 1, unitCount: 2 });
    const inv = (await request(app).get('/api/items').query({ status: 'EM_ESTOQUE' })).body.data.items.map((i) => i.id);
    expect(inv).toContain(a);
  });

  test('stats não depende do período; saleInfo coerente com saleProfitUsdCents', async () => {
    await sellItem({ acquiredAt: '2026-10-20T12:00:00.000Z' }, { soldAt: '2026-11-01T12:00:00.000Z' });
    await sellItem({}, { soldAt: '2026-11-18T12:00:00.000Z' });
    const all = (await sales({})).body.data.items;
    const narrow = (await sales({ soldFrom: '2026-11-18' })).body.data.items;
    expect(narrow).toHaveLength(1);
    expect(narrow[0].stats).toEqual(all.find((i) => i.id === narrow[0].id).stats);
    for (const i of all) expect(i.saleInfo.netReceivedUsdCents - i.saleInfo.purchaseCostUsdCents).toBe(i.saleProfitUsdCents);
  });

  test('mudar a cotação atual só altera approxBrl e meta.usdBrlRate', async () => {
    await sellItem({}, { saleStoreId: storeId('Steam'), salePriceCents: 540 });
    const a = (await sales({})).body.data;
    Setting.update({ usdBrlRate: 6 });
    const b = (await sales({})).body.data;
    const strip = ({ approxBrl, ...rest }) => rest;
    expect(strip(b.items[0].saleInfo)).toEqual(strip(a.items[0].saleInfo));
    expect(b.items[0].saleInfo.approxBrl).not.toEqual(a.items[0].saleInfo.approxBrl);
    expect(b.summary.totalProfitUsdCents).toBe(a.summary.totalProfitUsdCents);
    expect(a.meta.usdBrlRate).toBe(5);
    expect(b.meta.usdBrlRate).toBe(6);
  });

  test('lista vazia: resumo zerado e avgTurnaroundDays nulo', async () => {
    const r = (await sales({})).body.data;
    expect(r.items).toEqual([]);
    expect(r.summary).toMatchObject({ count: 0, totalProfitUsdCents: 0, avgTurnaroundDays: null, soldWithFxCount: 0 });
  });

  test('faca com fases diferentes: histórico (stats) separado por fase, também em /stats', async () => {
    const p1 = await sellItem({ catalogId: CAT.KARAMBIT_DOPPLER_P1 });
    await sellItem({ catalogId: CAT.KARAMBIT_DOPPLER_P1 });
    const p2 = await sellItem({ catalogId: CAT.KARAMBIT_DOPPLER_P2 });
    const items = (await sales({})).body.data.items;
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId[p1].stats).toMatchObject({ unitCount: 2, soldCount: 2 });
    expect(byId[p2].stats).toMatchObject({ unitCount: 1, soldCount: 1 });
    expect(byId[p1].phase).not.toBe(byId[p2].phase);
    const name = byId[p1].name;
    const s1 = await request(app).get('/api/items/stats').query({ name, category: 'FACA', phase: byId[p1].phase });
    expect(s1.body.data.unitCount).toBe(2);
    expect(s1.body.data.key.endsWith(`|${byId[p1].phase.toLowerCase()}`)).toBe(true);
    const none = await request(app).get('/api/items/stats').query({ name, category: 'FACA' });
    expect(none.body.data.unitCount).toBe(0);
  });

  test('nenhum dado de saque/aporte e nenhuma chave extra de erro em /sales', async () => {
    await sellItem();
    const body = JSON.stringify((await sales({})).body);
    expect(body).not.toMatch(/sac|withdraw|deposit|aporte/i);
  });

  test('POST/DELETE em /api/items/sales não cai em /:id', async () => {
    const r = await request(app).delete('/api/items/sales');
    expectError(r, 400, 'INVALID_ID');
  });
});
