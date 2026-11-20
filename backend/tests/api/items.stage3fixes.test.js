// Correções pós-revisão da Etapa 3: I1, I2, limites de texto, stats e log de constraint.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const Store = require('../../src/models/Store');
const { MAX_AMOUNT_CENTS } = require('../../src/config/constants');
const { errorHandler } = require('../../src/middlewares/errorHandler');
const { WARNING_PRICE_OVERFLOW } = require('../../src/services/warnings');
const { freshDb } = require('../helpers/fixtures');
const { CAT, makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => closeDb());

const patch = (id, body) => request(app).patch(`/api/items/${id}`).send(body);
const rowCount = () => getDb().prepare('SELECT COUNT(*) AS n FROM items').get().n;
const sellBody = (o = {}) => ({ saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...o });

describe('I1: trocar de moeda no PATCH exige preço', () => {
  test('CSFloat -> Steam sem preço -> PURCHASE_PRICE_REQUIRED, nada muda', async () => {
    Setting.update({ usdBrlRate: 5 });
    const item = await createItemViaApi(app);
    const res = await patch(item.id, { purchaseStoreId: storeId('Steam') });
    expectError(res, 400, 'PURCHASE_PRICE_REQUIRED');
    expect(res.body.error.message).toBe('Ao trocar para uma loja de outra moeda, informe o preço na nova moeda.');
    expect((await request(app).get(`/api/items/${item.id}`)).body.data).toMatchObject({ purchaseCurrency: 'USD', purchasePriceCents: 100 });
  });

  test('com preço e sem cotação alguma -> FX_RATE_REQUIRED; com cotação informada passa', async () => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { purchaseStoreId: storeId('Steam'), purchasePriceCents: 500 }), 400, 'FX_RATE_REQUIRED');
    const ok = await patch(item.id, { purchaseStoreId: storeId('Steam'), purchasePriceCents: 500, fxRateAtPurchase: 5.5 });
    expect(ok.body.data).toMatchObject({ purchaseCurrency: 'BRL', purchasePriceCents: 500, fxRateAtPurchase: 5.5 });
  });

  test('Steam -> CSFloat sem preço recusa; mesma moeda sem preço aceita', async () => {
    Setting.update({ usdBrlRate: 5 });
    const brl = await createItemViaApi(app, purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 500 }));
    expectError(await patch(brl.id, { purchaseStoreId: storeId('CSFloat') }), 400, 'PURCHASE_PRICE_REQUIRED');
    const usd = await createItemViaApi(app);
    const other = Store.findAll().find((s) => s.currency === 'USD' && s.id !== storeId('CSFloat'));
    expect((await patch(usd.id, { purchaseStoreId: other.id })).status).toBe(200);
  });

  test('COMPRA BRL -> GANHEI (sem loja, USD) sem preço: custo 0, sem PURCHASE_PRICE_REQUIRED', async () => {
    Setting.update({ usdBrlRate: 5 });
    const brl = await createItemViaApi(app, purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 500 }));
    const auto = await patch(brl.id, { acquisitionType: 'GANHEI', purchaseStoreId: null });
    expect(auto.status).toBe(200);
    expect(auto.body.data).toMatchObject({ purchaseCurrency: 'USD', purchasePriceCents: 0, acquisitionType: 'GANHEI' });
    const brl2 = await createItemViaApi(app, purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 500 }));
    const refused = await patch(brl2.id, { acquisitionType: 'GANHEI', purchaseStoreId: null, purchasePriceCents: 0 });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('GANHEI_COST_NOT_ALLOWED');
  });
});

describe('I2: teto de centavos e leitura resiliente', () => {
  test('purchasePriceCents e salePriceCents acima do teto -> INVALID_AMOUNT', async () => {
    expectError(await request(app).post('/api/items').send(purchaseBody({ purchasePriceCents: MAX_AMOUNT_CENTS + 1 })), 400, 'INVALID_AMOUNT');
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { purchasePriceCents: 1e12 }), 400, 'INVALID_AMOUNT');
    const sell = await request(app).post(`/api/items/${item.id}/sell`).send(sellBody({ salePriceCents: MAX_AMOUNT_CENTS + 1 }));
    expectError(sell, 400, 'INVALID_AMOUNT');
    expect(rowCount()).toBe(1);
  });

  test('item gravado direto no banco com valor gigante: GET lista e por id respondem 200 com aviso', async () => {
    const item = await createItemViaApi(app);
    getDb().prepare('UPDATE items SET purchase_price_cents = ? WHERE id = ?').run(9e15, item.id);
    expect((await request(app).get('/api/items')).status).toBe(200);
    const one = await request(app).get(`/api/items/${item.id}`);
    expect(one.status).toBe(200);
    const overflow = one.body.data.minPrices.filter((p) => p.warning === WARNING_PRICE_OVERFLOW);
    expect(overflow.length).toBeGreaterThan(0);
    for (const p of overflow) expect(p.minPriceCents).toBeNull();
  });

  describe('nunca grava e responde erro (transação)', () => {
    const failView = () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      return jest.spyOn(Store, 'findAll').mockImplementation(() => { throw new Error('falha ao montar'); });
    };

    test('POST: erro na montagem não deixa linha nova', async () => {
      const spy = failView();
      expect((await request(app).post('/api/items').send(purchaseBody())).status).toBe(500);
      spy.mockRestore();
      expect(rowCount()).toBe(0);
    });

    test('PATCH: erro na montagem não altera o item', async () => {
      const item = await createItemViaApi(app);
      const spy = failView();
      expect((await patch(item.id, { originDetail: 'Outro' })).status).toBe(500);
      spy.mockRestore();
      expect((await request(app).get(`/api/items/${item.id}`)).body.data.name).toBe('AK-47 | Redline');
    });

    test('sell e unsell: erro na montagem mantém o estado anterior', async () => {
      const item = await createItemViaApi(app);
      let spy = failView();
      expect((await request(app).post(`/api/items/${item.id}/sell`).send(sellBody())).status).toBe(500);
      spy.mockRestore();
      expect((await request(app).get(`/api/items/${item.id}`)).body.data).toMatchObject({ status: 'EM_ESTOQUE', soldAt: null });
      expect((await request(app).post(`/api/items/${item.id}/sell`).send(sellBody())).status).toBe(200);
      spy = failView();
      expect((await request(app).post(`/api/items/${item.id}/unsell`)).status).toBe(500);
      spy.mockRestore();
      expect((await request(app).get(`/api/items/${item.id}`)).body.data.status).toBe('VENDIDO');
    });
  });
});

describe('limites de texto (FIELD_TOO_LONG)', () => {
  test('name e originDetail: 200 passa, 201 recusa (após trim)', async () => {
    const ok = await request(app).post('/api/items').send(purchaseBody({ catalogId: undefined, category: 'OUTRO', name: `  ${'a'.repeat(200)}  `, originDetail: 'b'.repeat(200) }));
    expect(ok.status).toBe(201);
    const longName = await request(app).post('/api/items').send(purchaseBody({ name: 'a'.repeat(201) }));
    expectError(longName, 400, 'FIELD_TOO_LONG');
    expect(longName.body.error.message).toContain('name');
    expect(longName.body.error.message).toContain('200');
    expectError(await request(app).post('/api/items').send(purchaseBody({ originDetail: 'b'.repeat(201) })), 400, 'FIELD_TOO_LONG');
    expectError(await patch(ok.body.data.id, { name: 'c'.repeat(201) }), 400, 'FIELD_TOO_LONG');
    expectError(await patch(ok.body.data.id, { originDetail: 'c'.repeat(201) }), 400, 'FIELD_TOO_LONG');
  });
});

describe('GET /api/items/stats: variant padrão', () => {
  test.each(['SKIN', 'FACA', 'LUVA'])('%s sem variant equivale a NORMAL', async (category) => {
    const res = await request(app).get('/api/items/stats').query({ name: 'X', category });
    expect(res.status).toBe(200);
    const explicit = await request(app).get('/api/items/stats').query({ name: 'X', category, variant: 'NORMAL' });
    expect(res.body.data.key).toEqual(explicit.body.data.key);
  });

  test('CAIXA sem variant continua sem variant na chave', async () => {
    const res = await request(app).get('/api/items/stats').query({ name: 'X', category: 'CAIXA' });
    const explicit = await request(app).get('/api/items/stats').query({ name: 'X', category: 'CAIXA', variant: 'NORMAL' });
    expect(res.status).toBe(200);
    expect(res.body.data.key).not.toContain('NORMAL');
    expectError(explicit, 400, 'ATTRIBUTES_NOT_ALLOWED');
  });
});

describe('errorHandler: log da violação de constraint', () => {
  test('console.error recebe o erro original antes do 409', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('UNIQUE failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
    const res = { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn() };
    errorHandler(err, {}, res, jest.fn());
    expect(spy).toHaveBeenCalledWith(err);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});
