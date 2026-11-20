// QA independente dos ajustes finais da Etapa 3 (D64) pela API. Banco :memory: (tests/setup.js).
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const { MAX_AMOUNT_CENTS } = require('../../src/config/constants');
const { freshDb } = require('../helpers/fixtures');
const { CAT, makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp(); // 2026-11-19T15:00:00Z = 12:00 BRT
});
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/items').send(body);
const patch = (id, body) => request(app).patch(`/api/items/${id}`).send(body);
const rawRow = (id) => getDb().prepare('SELECT * FROM items WHERE id = ?').get(id);
const sell = (id, o = {}) =>
  request(app)
    .post(`/api/items/${id}/sell`)
    .send({ saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...o });
const minPriceOf = (view, store) => view.minPrices.find((p) => p.storeName === store).minPriceCents;

// ------------------------------------------------------------------ 1. MAX_AMOUNT_CENTS
describe('D64.1 teto de valor com item legado', () => {
  const LEGACY = MAX_AMOUNT_CENTS * 5;
  let id;
  beforeEach(async () => {
    id = (await createItemViaApi(app)).id;
    getDb().prepare('UPDATE items SET purchase_price_cents = ? WHERE id = ?').run(LEGACY, id);
  });

  test('PATCH só de originDetail: 200 e preserva o valor legado', async () => {
    const res = await patch(id, { originDetail: 'detalhe' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ originDetail: 'detalhe', purchasePriceCents: LEGACY });
    expect(rawRow(id).purchase_price_cents).toBe(LEGACY);
  });

  test('PATCH que reenvia o mesmo preço legado acima do teto: 400 INVALID_AMOUNT e nada muda', async () => {
    expectError(await patch(id, { originDetail: 'Outro', purchasePriceCents: LEGACY }), 400, 'INVALID_AMOUNT');
    expect(rawRow(id)).toMatchObject({ name: 'AK-47 | Redline', purchase_price_cents: LEGACY });
  });

  test('PATCH que baixa o preço para o teto: 200', async () => {
    const res = await patch(id, { purchasePriceCents: MAX_AMOUNT_CENTS });
    expect(res.status).toBe(200);
    expect(rawRow(id).purchase_price_cents).toBe(MAX_AMOUNT_CENTS);
  });

  test('item legado pode ser vendido com preço normal (o teto vale só para o valor de venda informado)', async () => {
    expect((await sell(id)).status).toBe(200);
  });
});

// ------------------------------------------------------------------ 2. Datas
describe('D64.2 datas com ano < 1000 pela API', () => {
  test.each(['0999-06-01T12:00:00Z', '0100-01-01T12:00:00Z', '0050-03-15T12:00:00Z', '0000-02-29T12:00:00Z'])(
    'POST acquiredAt %s -> 201 com ISO de 4 dígitos',
    async (acquiredAt) => {
      const res = await post(purchaseBody({ acquiredAt }));
      expect(res.status).toBe(201);
      expect(res.body.data.acquiredAt).toBe(new Date(acquiredAt).toISOString());
      expect(res.body.data.acquiredAt.slice(0, 4)).toBe(acquiredAt.slice(0, 4));
    }
  );

  test('POST 0050-02-29 -> 400 INVALID_DATE', async () => {
    expectError(await post(purchaseBody({ acquiredAt: '0050-02-29T12:00:00Z' })), 400, 'INVALID_DATE');
  });

  test('PATCH acquiredAt para 0999 -> 200; GET e listagem continuam 200 (aging calculado)', async () => {
    const item = await createItemViaApi(app);
    const res = await patch(item.id, { acquiredAt: '0999-06-01T12:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body.data.aging.agingBucket).toBe('AGARRADO');
    expect((await request(app).get('/api/items').query({ sortBy: 'age' })).status).toBe(200);
  });

  test('venda de item adquirido em 0100: soldAt de hoje aceito; soldAt em 0050 recusado (antes da compra)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ acquiredAt: '0100-01-01T12:00:00Z' }));
    expectError(await sell(item.id, { soldAt: '0050-01-01T12:00:00Z' }), 400, 'SOLD_BEFORE_ACQUIRED');
    const res = await sell(item.id);
    expect(res.status).toBe(200);
    expect(res.body.data.item.aging.turnaroundBucket).toBe('DEMOROU_VENDER');
  });

  test('soldAt em ano < 1000 é passado (não vira SOLD_AT_IN_FUTURE)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ acquiredAt: '0050-01-01T12:00:00Z' }));
    const res = await sell(item.id, { soldAt: '0999-01-01T12:00:00Z' });
    expect(res.status).toBe(200);
  });
});

describe('D64.2 fronteira do dia civil BRT pela API', () => {
  test('acquiredAt 23:59:59.999 BRT de hoje -> 201; 00:00 BRT de amanhã -> 400', async () => {
    expect((await post(purchaseBody({ acquiredAt: '2026-11-20T02:59:59.999Z' }))).status).toBe(201);
    expect((await post(purchaseBody({ acquiredAt: '2026-11-19T23:59:59.999-03:00' }))).status).toBe(201);
    expectError(await post(purchaseBody({ acquiredAt: '2026-11-20T03:00:00Z' })), 400, 'ACQUIRED_AT_IN_FUTURE');
    expectError(await post(purchaseBody({ acquiredAt: '2026-11-20T00:00:00-03:00' })), 400, 'ACQUIRED_AT_IN_FUTURE');
  });

  test('relógio às 23:30 BRT (UTC já no dia 20): mesmas fronteiras no acquiredAt e no soldAt', async () => {
    app = makeCatalogApp(new Date('2026-11-20T02:30:00Z'));
    expect((await post(purchaseBody({ acquiredAt: '2026-11-20T02:59:59.999Z' }))).status).toBe(201);
    expectError(await post(purchaseBody({ acquiredAt: '2026-11-20T03:00:00Z' })), 400, 'ACQUIRED_AT_IN_FUTURE');
    const item = await createItemViaApi(app);
    expectError(await sell(item.id, { soldAt: '2026-11-20T03:00:00Z' }), 400, 'SOLD_AT_IN_FUTURE');
    expect((await sell(item.id, { soldAt: '2026-11-20T02:59:59.999Z' })).status).toBe(200);
  });
});

// ------------------------------------------------------------------ 3. GANHEI no PATCH
describe('D64.3 item que vira GANHEI no PATCH', () => {
  test('COMPRA -> GANHEI sem preço (mesma loja): custo 0; minPrices e lucro recalculados', async () => {
    const item = await createItemViaApi(app); // CSFloat, custo 100 -> mínimo 103
    expect(minPriceOf(item, 'CSFloat')).toBe(103);
    const res = await patch(item.id, { acquisitionType: 'GANHEI' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ acquisitionType: 'GANHEI', purchasePriceCents: 0, purchaseCurrency: 'USD' });
    expect(minPriceOf(res.body.data, 'CSFloat')).toBe(1);
    expect(res.body.data.stats.avgPurchaseCostUsdCents).toBe(0);
    const sold = await sell(item.id);
    expect(sold.status).toBe(200);
    expect(sold.body.data.sale).toMatchObject({ netReceivedCents: 122, saleProfitUsdCents: 122 });
  });

  test('COMPRA -> GANHEI sem loja (sem preço): custo 0 em USD e loja nula', async () => {
    Setting.update({ usdBrlRate: 5 });
    const item = await createItemViaApi(app, purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 500 }));
    const res = await patch(item.id, { acquisitionType: 'GANHEI', purchaseStoreId: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ purchaseStoreId: null, purchaseCurrency: 'USD', purchasePriceCents: 0, fxRateAtPurchase: null });
  });

  test('COMPRA -> GANHEI com preço no corpo: GANHEI_COST_NOT_ALLOWED (D65)', async () => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { acquisitionType: 'GANHEI', purchasePriceCents: 300 }), 400, 'GANHEI_COST_NOT_ALLOWED');
    expectError(
      await patch(item.id, { acquisitionType: 'GANHEI', purchaseStoreId: storeId('Steam'), purchasePriceCents: 400 }),
      400,
      'GANHEI_COST_NOT_ALLOWED'
    );
  });

  test('GANHEI já existente: PATCH comum mantém custo 0 e reenviar GANHEI também', async () => {
    const won = await createItemViaApi(app, { catalogId: CAT.CASE_REVOLVER, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00Z' });
    const res = await patch(won.id, { originDetail: 'drop' });
    expect(res.status).toBe(200);
    expect(res.body.data.purchasePriceCents).toBe(0);
    const again = await patch(won.id, { acquisitionType: 'GANHEI' });
    expect(again.status).toBe(200);
    expect(again.body.data.purchasePriceCents).toBe(0);
  });

  test('GANHEI com loja BRL: loja só informativa, USD, sem cotação e sem FX_RATE_REQUIRED (POST e PATCH)', async () => {
    const body = { catalogId: CAT.CASE_REVOLVER, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00Z' };
    const created = await post({ ...body, purchaseStoreId: storeId('Steam') });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      purchaseStoreId: storeId('Steam'), purchaseCurrency: 'USD', purchasePriceCents: 0, fxRateAtPurchase: null,
    });
    const won = await createItemViaApi(app, body);
    const ok = await patch(won.id, { purchaseStoreId: storeId('Steam') });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ purchaseCurrency: 'USD', purchasePriceCents: 0, fxRateAtPurchase: null });
  });

  test('COMPRA que muda de moeda sem preço: PURCHASE_PRICE_REQUIRED (com cotação disponível)', async () => {
    Setting.update({ usdBrlRate: 5 });
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { purchaseStoreId: storeId('Steam') }), 400, 'PURCHASE_PRICE_REQUIRED');
    expectError(await patch(item.id, { acquisitionType: 'COMPRA', purchaseStoreId: storeId('Steam') }), 400, 'PURCHASE_PRICE_REQUIRED');
    expect(rawRow(item.id)).toMatchObject({ purchase_currency: 'USD', purchase_price_cents: 100 });
  });

  test('item vendido que vira GANHEI: lucro da venda recalculado com custo 0', async () => {
    const item = await createItemViaApi(app);
    expect((await sell(item.id)).body.data.item.saleProfitUsdCents).toBe(22);
    const res = await patch(item.id, { acquisitionType: 'GANHEI' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ purchasePriceCents: 0, saleProfitUsdCents: 122, minPrices: null });
  });

  test('GANHEI trocando para loja BRL: custo continua 0 USD (D65)', async () => {
    const won = await createItemViaApi(app, { catalogId: CAT.CASE_REVOLVER, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00Z' });
    const res = await patch(won.id, { purchaseStoreId: storeId('Steam') });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ purchaseCurrency: 'USD', purchasePriceCents: 0 });
  });
});

// ------------------------------------------------------------------ 5. /stats
describe('D64.6 GET /api/items/stats', () => {
  const stats = (q) => request(app).get('/api/items/stats').query(q);

  test.each(['CAIXA', 'CAPSULA', 'STICKER', 'PINGENTE', 'PERSONAGEM', 'PASSE_BATALHA', 'OUTRO'])(
    'variant STATTRAK em %s -> 400 ATTRIBUTES_NOT_ALLOWED',
    async (category) => {
      expectError(await stats({ name: 'X', category, variant: 'STATTRAK' }), 400, 'ATTRIBUTES_NOT_ALLOWED');
    }
  );

  test.each(['FACA', 'LUVA'])('variant NORMAL em %s -> 200', async (category) => {
    expect((await stats({ name: 'X', category, variant: 'NORMAL' })).status).toBe(200);
  });

  test('variant em CAIXA -> exatamente ATTRIBUTES_NOT_ALLOWED', async () => {
    expectError(await stats({ name: 'X', category: 'CAIXA', variant: 'SOUVENIR' }), 400, 'ATTRIBUTES_NOT_ALLOWED');
  });

  test('SKIN com STATTRAK -> 200 com a variant na chave', async () => {
    const res = await stats({ name: '  AK-47  |  Redline ', category: 'SKIN', variant: 'STATTRAK' });
    expect(res.status).toBe(200);
    expect(res.body.data.key).toBe('ak-47 | redline|SKIN|STATTRAK|');
  });

  test.each([
    [{ name: 'X', category: 'SKIN', variant: 'FOO' }],
    [{ name: 'X', category: 'SKIN', variant: 'stattrak' }],
    [{ name: 'X', category: 'NAO_EXISTE' }],
    [{ name: 'X', category: 'SKIN', exterior: 'XX' }],
    [{ name: 'X', category: 'CAIXA', variant: 'FOO' }],
    [{ category: 'SKIN' }],
    [{ name: '   ', category: 'SKIN' }],
    [{ name: 'X' }],
  ])('%j -> 400 INVALID_QUERY', async (q) => {
    expectError(await stats(q), 400, 'INVALID_QUERY');
  });

  test('CAIXA sem variant: chave sem NORMAL', async () => {
    const res = await stats({ name: 'Caixa Kilowatt', category: 'CAIXA' });
    expect(res.status).toBe(200);
    expect(res.body.data.key).toBe('caixa kilowatt|CAIXA||');
  });

  test('SKIN sem variant: chave com NORMAL', async () => {
    const res = await stats({ name: 'X', category: 'SKIN' });
    expect(res.body.data.key).toBe('x|SKIN|NORMAL|');
  });
});
