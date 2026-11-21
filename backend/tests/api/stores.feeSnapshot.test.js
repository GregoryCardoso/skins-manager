// D144: mudar as taxas de uma loja nunca altera vendas registradas; só o preço mínimo do estoque muda.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const get = async (url) => (await request(app).get(url)).body;
const sell = (id, body) => request(app).post(`/api/items/${id}/sell`).send(body);
const patchStore = (id, body) => request(app).patch(`/api/stores/${id}`).send(body);
const minOf = (item, name) => item.minPrices.find((m) => m.storeName === name);

async function snapshot(ids) {
  const items = [];
  for (const id of ids) items.push(await get(`/api/items/${id}`));
  return { items, sales: await get('/api/items/sales'), stats: await get('/api/items/stats') };
}

describe('D144 snapshot de taxa', () => {
  test('vender, mudar todas as taxas da loja: item, vendas (lista e resumo) e stats idênticos', async () => {
    Setting.update({ usdBrlRate: 5 });
    const usd = await createItemViaApi(app, purchaseBody());
    const brl = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 200 }));
    expect((await sell(usd.id, {
      saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z',
    })).status).toBe(200);
    expect((await sell(brl.id, {
      saleStoreId: storeId('Steam'), salePriceCents: 115, soldAt: '2026-11-18T12:00:00.000Z',
    })).status).toBe(200);
    const stock = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 1000 }));

    const before = await snapshot([usd.id, brl.id]);
    const stockBefore = await get(`/api/items/${stock.id}`);

    for (const name of ['CSFloat', 'Steam']) {
      const res = await patchStore(storeId(name), {
        saleFeeType: 'ADDED', saleFeeRate: 0.3, saleFeeRounding: 'FLOOR', saleMinFeeCents: 77, saleFixedFeeCents: 9,
      });
      expect(res.status).toBe(200);
    }
    // A cotação global não muda aqui: approxBrl é só exibição pela cotação atual (fora do escopo da D144).

    const after = await snapshot([usd.id, brl.id]);
    expect(after.items).toEqual(before.items);
    expect(after.sales).toEqual(before.sales);
    expect(after.stats.data).toEqual(before.stats.data);
    expect(after.sales.data.summary.count).toBe(2);

    // o item em estoque usa as taxas novas
    const stockAfter = await get(`/api/items/${stock.id}`);
    expect(minOf(stockAfter.data, 'CSFloat').minPriceCents).not.toBe(minOf(stockBefore.data, 'CSFloat').minPriceCents);
    // ADDED 30%, FLOOR, fixa 9, mínimo 77: ao menos o custo de 1000 + algo
    expect(minOf(stockAfter.data, 'CSFloat').minPriceCents).toBeGreaterThan(1000);
  });

  test('o snapshot aplicado guarda as taxas da hora da venda', async () => {
    const item = await createItemViaApi(app, purchaseBody());
    await sell(item.id, { saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z' });
    await patchStore(storeId('CSFloat'), { saleFeeRate: 0.5, saleMinFeeCents: 99, saleFixedFeeCents: 7 });
    const view = (await get(`/api/items/${item.id}`)).data;
    expect(view).toMatchObject({
      saleFeeTypeApplied: 'DEDUCTED', saleFeeRateApplied: 0.02, saleFeeRoundingApplied: 'CEIL',
      saleMinFeeCentsApplied: null, saleFixedFeeCentsApplied: 0, netReceivedCents: 122, saleProfitUsdCents: 22, minPrices: null,
    });
  });

  test('desfazer a venda e vender de novo usa as taxas novas (D61)', async () => {
    const item = await createItemViaApi(app, purchaseBody());
    const body = { saleStoreId: storeId('CSFloat'), salePriceCents: 1000, soldAt: '2026-11-18T12:00:00.000Z' };
    const first = (await sell(item.id, body)).body.data;
    expect(first.sale.netReceivedCents).toBe(980);
    await patchStore(storeId('CSFloat'), { saleFeeRate: 0.1 });
    expect((await request(app).post(`/api/items/${item.id}/unsell`).send({})).status).toBe(200);
    const again = (await sell(item.id, body)).body.data;
    expect(again.sale.netReceivedCents).toBe(900);
  });

  test('loja desativada some do minPrices e volta ao reativar; mínimo do estoque acompanha a taxa', async () => {
    const item = await createItemViaApi(app, purchaseBody());
    const base = minOf((await get(`/api/items/${item.id}`)).data, 'CSFloat').minPriceCents;
    expect(base).toBe(103);
    await patchStore(storeId('CSFloat'), { saleFeeRate: 0.1 });
    expect(minOf((await get(`/api/items/${item.id}`)).data, 'CSFloat').minPriceCents).toBe(112);
    await patchStore(storeId('CSMoney'), { isActive: false });
    const names = (await get(`/api/items/${item.id}`)).data.minPrices.map((m) => m.storeName);
    expect(names).toEqual(['CSFloat', 'Steam']);
    await patchStore(storeId('CSMoney'), { isActive: true });
    expect((await get(`/api/items/${item.id}`)).data.minPrices.map((m) => m.storeName)).toContain('CSMoney');
  });

  test('configurar taxas de CSMoney (antes nulas) habilita o mínimo; limpar volta a FEES_NOT_CONFIGURED', async () => {
    const item = await createItemViaApi(app, purchaseBody());
    await patchStore(storeId('CSMoney'), { saleFeeType: 'DEDUCTED', saleFeeRate: 0.05 });
    expect(minOf((await get(`/api/items/${item.id}`)).data, 'CSMoney').minPriceCents).toBeGreaterThan(100);
    await patchStore(storeId('CSMoney'), { saleFeeType: null, saleFeeRate: null });
    expect(minOf((await get(`/api/items/${item.id}`)).data, 'CSMoney'))
      .toMatchObject({ minPriceCents: null, warningCode: 'FEES_NOT_CONFIGURED' });
  });

});
