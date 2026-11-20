const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const minOf = (item, name) => item.minPrices.find((m) => m.storeName === name);
const setRate = (rate) => request(app).put('/api/settings/fx-rate').send({ usdBrlRate: rate });

describe('GET /api/items: minPrices[].approx', () => {
  test('sem cotação: toda entrada tem a chave approx, null', async () => {
    await createItemViaApi(app, purchaseBody());
    const res = await request(app).get('/api/items');
    expect(res.status).toBe(200);
    for (const m of res.body.data.items[0].minPrices) expect(m).toHaveProperty('approx', null);
    expect(minOf(res.body.data.items[0], 'CSFloat').minPriceCents).toBe(103);
  });

  test('com cotação 5,40: CSFloat 103 -> 556 BRL; Steam com preço -> approx em USD; CSMoney null', async () => {
    await createItemViaApi(app, purchaseBody());
    expect((await setRate(5.4)).status).toBe(200);
    const { items } = (await request(app).get('/api/items')).body.data;
    const csf = minOf(items[0], 'CSFloat');
    expect(csf).toMatchObject({ minPriceCents: 103, approx: { currency: 'BRL', cents: 556 } });
    const steamEntry = minOf(items[0], 'Steam');
    expect(steamEntry.minPriceCents).toEqual(expect.any(Number));
    expect(steamEntry.approx).toEqual({ currency: 'USD', cents: expect.any(Number) });
    const money = minOf(items[0], 'CSMoney');
    expect(money).toMatchObject({ minPriceCents: null, approx: null, warningCode: 'FEES_NOT_CONFIGURED' });
  });

  test('GET /api/items/:id também traz approx', async () => {
    const created = await createItemViaApi(app, purchaseBody());
    await setRate(5.4);
    const item = (await request(app).get(`/api/items/${created.id}`)).body.data;
    expect(minOf(item, 'CSFloat').approx).toEqual({ currency: 'BRL', cents: 556 });
  });

  test('mudar a cotação muda approx e não muda minPriceCents da CSFloat; nada é gravado no item', async () => {
    const created = await createItemViaApi(app, purchaseBody());
    await setRate(5.0);
    const a = minOf((await request(app).get('/api/items')).body.data.items[0], 'CSFloat');
    await setRate(6.0);
    const after = (await request(app).get('/api/items')).body.data.items[0];
    const b = minOf(after, 'CSFloat');
    expect(a.minPriceCents).toBe(103);
    expect(b.minPriceCents).toBe(103);
    expect(a.approx).toEqual({ currency: 'BRL', cents: 515 });
    expect(b.approx).toEqual({ currency: 'BRL', cents: 618 });
    expect(after.purchasePriceCents).toBe(created.purchasePriceCents);
    expect(JSON.stringify(after)).not.toMatch(/sac|withdraw/i);
  });

  test('loja inativa não aparece em minPrices (nem seu approx)', async () => {
    await createItemViaApi(app, purchaseBody());
    await setRate(5.4);
    const { getDb } = require('../../src/config/database');
    getDb().prepare('UPDATE stores SET is_active = 0 WHERE id = ?').run(storeId('Steam'));
    const item = (await request(app).get('/api/items')).body.data.items[0];
    expect(minOf(item, 'Steam')).toBeUndefined();
  });
});
