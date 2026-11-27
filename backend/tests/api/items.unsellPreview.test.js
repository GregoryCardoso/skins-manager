'use strict';

// 12.6b (D370): GET /api/items/:id/unsell-preview. Só leitura; o efeito vem do mesmo cálculo do saldo (paridade com o unsell real).
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, NOW, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');
const FxRate = require('../../src/models/FxRate');

afterAll(() => closeDb());

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp(NOW);
});

const JSON_TYPE = 'application/json';
const preview = (id, a = app) => request(a).get(`/api/items/${id}/unsell-preview`);
const sellVia = (id, body, a = app) => request(a).post(`/api/items/${id}/sell`).set('Content-Type', JSON_TYPE).send(body);
const unsellVia = (id, a = app) => request(a).post(`/api/items/${id}/unsell`).set('Content-Type', JSON_TYPE).send({});
const balanceOf = async (name, a = app) => {
  const res = await request(a).get('/api/store-balances/current');
  return res.body.data.stores.find((row) => row.storeName === name);
};
const csfloatSale = (extra = {}) => ({ saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...extra });
const rowOf = (id) => getDb().prepare('SELECT * FROM items WHERE id = ?').get(id);

async function soldItem(body = csfloatSale(), purchase = {}) {
  const item = await createItemViaApi(app, purchaseBody({ acquiredAt: '2026-11-01T12:00:00.000Z', ...purchase }));
  const res = await sellVia(item.id, body);
  expect(res.status).toBe(200);
  return item;
}

describe('GET /api/items/:id/unsell-preview', () => {
  test('venda retida: sai do pendente; formato completo e valores', async () => {
    const item = await soldItem(); // vendida em 18/11, retenção 7 dias, líquido 122
    const res = await preview(item.id);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      itemId: item.id,
      storeId: storeId('CSFloat'),
      storeName: 'CSFloat',
      storeCurrency: 'USD',
      balanceEffectCents: -122,
      wasReleased: false,
      releasesAt: '2026-11-25T12:00:00.000Z',
      availableBeforeCents: expect.any(Number),
      availableAfterCents: expect.any(Number),
      pendingBeforeCents: 122,
      pendingAfterCents: 0,
      effectUsdCents: -122,
      approxCents: null,
      approxCurrency: 'BRL',
      estimated: false,
      currencyMismatch: false,
      returnsTo: 'FOR_SALE',
    });
    expect(res.body.data.availableAfterCents).toBe(res.body.data.availableBeforeCents);
  });

  test('venda liberada: sai do disponível', async () => {
    const item = await soldItem(csfloatSale({ soldAt: '2026-11-05T12:00:00.000Z' }));
    const { data } = (await preview(item.id)).body;
    expect(data).toMatchObject({
      balanceEffectCents: -122, wasReleased: true, releasesAt: '2026-11-12T12:00:00.000Z', pendingBeforeCents: 0, pendingAfterCents: 0,
    });
    expect(data.availableAfterCents - data.availableBeforeCents).toBe(-122);
  });

  test('igualdade now = liberação conta como liberada', async () => {
    const item = await soldItem(csfloatSale({ soldAt: '2026-11-12T15:00:00.000Z' })); // + 7 dias = NOW
    const { data } = (await preview(item.id)).body;
    expect(data.wasReleased).toBe(true);
    expect(data.releasesAt).toBe(NOW.toISOString());
    expect(data.pendingBeforeCents).toBe(0);
  });

  test('o now vem do relógio injetado: a mesma venda vira liberada num app mais tarde', async () => {
    const item = await soldItem();
    expect((await preview(item.id)).body.data.wasReleased).toBe(false);
    const later = makeCatalogApp(new Date('2026-11-26T00:00:00.000Z'));
    const { data } = (await preview(item.id, later)).body;
    expect(data.wasReleased).toBe(true);
    expect(data.pendingBeforeCents).toBe(0);
    expect(data.availableAfterCents - data.availableBeforeCents).toBe(-122);
  });

  test('venda sem retenção registrada (venda antiga) vale como liberada', async () => {
    const item = await soldItem();
    getDb().prepare('UPDATE items SET sale_hold_days_applied = NULL WHERE id = ?').run(item.id);
    const { data } = (await preview(item.id)).body;
    expect(data).toMatchObject({ wasReleased: true, releasesAt: null, balanceEffectCents: -122 });
  });

  test('venda importada com a liberação real (saleReleaseAt) usa essa data', async () => {
    const item = await soldItem(csfloatSale({ soldAt: '2026-11-05T12:00:00.000Z' }));
    getDb().prepare('UPDATE items SET sale_release_at = ? WHERE id = ?').run('2026-11-30T00:00:00.000Z', item.id);
    const { data } = (await preview(item.id)).body;
    expect(data).toMatchObject({ wasReleased: false, releasesAt: '2026-11-30T00:00:00.000Z', pendingBeforeCents: 122 });
  });

  test('o saldo da loja pode ficar negativo: sem erro', async () => {
    const item = await soldItem(csfloatSale({ soldAt: '2026-11-05T12:00:00.000Z' }));
    const { data } = (await preview(item.id)).body;
    expect(data.availableBeforeCents).toBe(22); // venda liberada 122 menos a compra de 100
    expect(data.availableAfterCents).toBe(-100);
  });

  test('item do holding volta ao holding', async () => {
    const item = await createItemViaApi(app, purchaseBody({ acquiredAt: '2026-11-01T12:00:00.000Z' }));
    await request(app).post(`/api/items/${item.id}/off-sale`).set('Content-Type', JSON_TYPE).send({}).expect(200);
    expect((await sellVia(item.id, csfloatSale())).status).toBe(200);
    expect((await preview(item.id)).body.data.returnsTo).toBe('OFF_SALE');
  });

  test('com cotação: o "≈" do efeito na moeda de conversão (arredondado)', async () => {
    await request(app).put('/api/settings/fx-rate').set('Content-Type', JSON_TYPE).send({ usdBrlRate: 5.4 }).expect(200);
    const item = await soldItem();
    const { data } = (await preview(item.id)).body;
    expect(data).toMatchObject({ storeCurrency: 'USD', effectUsdCents: -122, approxCents: -659, approxCurrency: 'BRL', estimated: false });
  });

  test('loja em BRL (Steam): efeito na moeda da loja, estimado em USD', async () => {
    await request(app).put('/api/settings/fx-rate').set('Content-Type', JSON_TYPE).send({ usdBrlRate: 5 }).expect(200);
    const steam = storeId('Steam');
    const item = await createItemViaApi(app, purchaseBody({
      purchaseStoreId: steam, purchasePriceCents: 1000, fxRateAtPurchase: 5, acquiredAt: '2026-11-01T12:00:00.000Z',
    }));
    const sold = await sellVia(item.id, { saleStoreId: steam, salePriceCents: 1150, fxRateAtSale: 5, soldAt: '2026-11-18T12:00:00.000Z' });
    expect(sold.status).toBe(200);
    const net = sold.body.data.item.netReceivedCents;
    const { data } = (await preview(item.id)).body;
    expect(data).toMatchObject({ storeCurrency: 'BRL', balanceEffectCents: -net, wasReleased: true, estimated: true });
    expect(data.effectUsdCents).toBe(-Math.round(net / 5));
    expect(data.approxCents).toBe(-net); // a moeda de conversão é a da loja: o "≈" é o próprio valor
  });

  test('loja em JPY (sem casas decimais): efeito em centavos de iene', async () => {
    const created = await request(app).post('/api/stores').set('Content-Type', JSON_TYPE).send({
      name: 'Loja JPY', currency: 'JPY', saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeeRounding: 'CEIL', allowsWithdrawal: true,
    });
    expect(created.status).toBe(201);
    const jpy = created.body.data;
    FxRate.upsert('JPY', { rate: 150, source: 'MANUAL' }, { now: NOW });
    const item = await createItemViaApi(app, purchaseBody({
      purchaseStoreId: jpy.id, purchasePriceCents: 100000, fxRateAtPurchase: 150, acquiredAt: '2026-11-01T12:00:00.000Z',
    }));
    const sold = await sellVia(item.id, { saleStoreId: jpy.id, salePriceCents: 105000, fxRateAtSale: 150, soldAt: '2026-11-18T12:00:00.000Z' });
    expect(sold.body.data.item.netReceivedCents).toBe(102900);
    const { data } = (await preview(item.id)).body;
    expect(data).toMatchObject({ storeCurrency: 'JPY', balanceEffectCents: -102900, estimated: true });
    expect(Math.abs(data.balanceEffectCents) % 100).toBe(0);
    expect(Number.isInteger(data.effectUsdCents)).toBe(true);
    expect(data.effectUsdCents).toBe(-686);
  });

  test('sem "≈" quando a moeda de conversão é USD e a loja é USD', async () => {
    freshDb({ displayCurrency: null });
    app = makeCatalogApp(NOW);
    const item = await soldItem(csfloatSale({ soldAt: '2026-11-05T12:00:00.000Z' }));
    const { data } = (await preview(item.id)).body;
    expect(data).toMatchObject({ effectUsdCents: -122, approxCents: null, approxCurrency: 'USD' });
  });

  test('venda em moeda diferente da loja é ignorada no saldo: efeito 0', async () => {
    const item = await soldItem(csfloatSale({ soldAt: '2026-11-05T12:00:00.000Z' }));
    getDb().prepare("UPDATE items SET sale_currency = 'EUR', fx_rate_at_sale = 0.9 WHERE id = ?").run(item.id);
    const { data } = (await preview(item.id)).body;
    expect(data).toMatchObject({ balanceEffectCents: 0, currencyMismatch: true });
    expect(Object.is(data.balanceEffectCents, -0)).toBe(false);
  });

  test('venda com data depois do relógio (soldAt > now) não está no saldo: efeito 0 e não liberada', async () => {
    const item = await soldItem(csfloatSale({ soldAt: '2026-11-19T10:00:00.000Z' }));
    getDb().prepare('UPDATE items SET sold_at = ? WHERE id = ?').run('2026-11-19T20:00:00.000Z', item.id);
    const { data } = (await preview(item.id)).body;
    expect(data).toMatchObject({ balanceEffectCents: 0, wasReleased: false });
  });

  test('paridade: o "depois" da prévia é o saldo real após o unsell', async () => {
    const item = await soldItem(csfloatSale({ soldAt: '2026-11-05T12:00:00.000Z' }));
    await soldItem(csfloatSale({ soldAt: '2026-11-18T12:00:00.000Z' }));
    const { data } = (await preview(item.id)).body;
    expect((await unsellVia(item.id)).status).toBe(200);
    const row = await balanceOf('CSFloat');
    expect(row.availableCents).toBe(data.availableAfterCents);
    expect(row.pending.cents).toBe(data.pendingAfterCents);
  });

  test('não grava nada: o item e o saldo ficam iguais antes e depois', async () => {
    const item = await soldItem();
    const before = { row: rowOf(item.id), balance: await balanceOf('CSFloat'), count: getDb().prepare('SELECT COUNT(*) AS n FROM items').get().n };
    await preview(item.id);
    await preview(item.id);
    expect(rowOf(item.id)).toEqual(before.row);
    expect(await balanceOf('CSFloat')).toEqual(before.balance);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM items').get().n).toBe(before.count);
  });

  test('erros: 404, 409 em estoque, 409 consumido, 400 id inválido', async () => {
    expectError(await preview(99999), 404, 'ITEM_NOT_FOUND');
    const stock = await createItemViaApi(app, purchaseBody());
    expectError(await preview(stock.id), 409, 'ITEM_NOT_SOLD');
    const consumed = await createItemViaApi(app, purchaseBody());
    getDb().prepare("UPDATE items SET status = 'CONSUMIDO', consumed_at = '2026-11-10T00:00:00.000Z' WHERE id = ?").run(consumed.id);
    expectError(await preview(consumed.id), 409, 'ITEM_CONSUMED');
    const bad = await request(app).get('/api/items/abc/unsell-preview');
    expect(bad.status).toBe(400);
    expect(bad.body.success).toBe(false);
  });

  test('Host estranho é recusado (a verificação global continua valendo)', async () => {
    const item = await soldItem();
    const res = await request(app).get(`/api/items/${item.id}/unsell-preview`).set('Host', 'evil.example.com');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });
});
