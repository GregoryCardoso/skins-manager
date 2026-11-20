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

const patch = (id, body) => request(app).patch(`/api/items/${id}`).send(body);
const sellItem = (id, body = {}) =>
  request(app).post(`/api/items/${id}/sell`).send({
    saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...body,
  });

describe('PATCH /api/items/:id', () => {
  test('parcial altera só o enviado e null limpa opcionais', async () => {
    const item = await createItemViaApi(app, purchaseBody({ originDetail: 'drop' }));
    const res = await patch(item.id, { acquiredAt: '2026-11-11T12:00:00.000Z', originDetail: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'AK-47 | Redline', acquiredAt: '2026-11-11T12:00:00.000Z', originDetail: null, purchasePriceCents: 100,
    });
  });

  test('trocar CSFloat -> Steam recalcula moeda e cotação; Steam -> CSFloat zera a cotação', async () => {
    Setting.update({ usdBrlRate: 5 });
    const item = await createItemViaApi(app);
    const toSteam = await patch(item.id, { purchaseStoreId: storeId('Steam'), purchasePriceCents: 500 });
    expect(toSteam.body.data).toMatchObject({ purchaseCurrency: 'BRL', fxRateAtPurchase: 5, purchasePriceCents: 500 });
    Setting.update({ usdBrlRate: 6 });
    const same = await patch(item.id, { purchasePriceCents: 200 });
    expect(same.body.data.fxRateAtPurchase).toBe(5); // mesma loja mantém a cotação gravada
    const back = await patch(item.id, { purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 100 });
    expect(back.body.data).toMatchObject({ purchaseCurrency: 'USD', fxRateAtPurchase: null });
  });

  test('T35 (a): SKIN -> CAIXA pelo catálogo limpa os atributos de arma ausentes do corpo', async () => {
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.2, paintSeed: 5, variant: 'STATTRAK' }));
    expect(item).toMatchObject({ variant: 'STATTRAK', exterior: 'FT' });
    const ok = await patch(item.id, { catalogId: CAT.CASE_REVOLVER });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      catalogId: CAT.CASE_REVOLVER, name: 'Revolver Case', category: 'CAIXA',
      variant: null, floatValue: null, exterior: null, paintSeed: null, phase: null,
    });
  });

  test('T35 (a): atributo de arma não nulo enviado com categoria sem atributos -> ATTRIBUTES_NOT_ALLOWED', async () => {
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.2 }));
    expectError(await patch(item.id, { catalogId: CAT.CASE_REVOLVER, floatValue: 0.1 }), 400, 'ATTRIBUTES_NOT_ALLOWED');
    expectError(await patch(item.id, { catalogId: CAT.CASE_REVOLVER, variant: 'NORMAL' }), 400, 'ATTRIBUTES_NOT_ALLOWED');
    const ok = await patch(item.id, { catalogId: CAT.CASE_REVOLVER, variant: null, floatValue: null });
    expect(ok.status).toBe(200);
  });

  test('T35 (a): CAIXA -> SKIN usa variant NORMAL por padrão; troca entre armas não limpa nada', async () => {
    const box = await createItemViaApi(app, purchaseBody({ catalogId: CAT.CASE_REVOLVER }));
    const skin = await patch(box.id, { catalogId: CAT.AK_REDLINE });
    expect(skin.body.data).toMatchObject({ category: 'SKIN', variant: 'NORMAL', floatValue: null });
    const withFloat = await createItemViaApi(app, purchaseBody({ variant: 'STATTRAK', floatValue: 0.2 }));
    const other = await patch(withFloat.id, { catalogId: CAT.M4A1S_PRINTSTREAM });
    expect(other.body.data).toMatchObject({ name: 'M4A1-S | Printstream', variant: 'STATTRAK', floatValue: 0.2, exterior: 'FT' });
  });

  test('T35 (a): SKIN STATTRAK -> LUVA -> INVALID_VARIANT', async () => {
    const item = await createItemViaApi(app, purchaseBody({ variant: 'STATTRAK' }));
    expectError(await patch(item.id, { catalogId: CAT.SPORT_GLOVES_PANDORA }), 400, 'INVALID_VARIANT');
  });

  test('T33: GANHEI com loja gravada -> COMPRA só com preço; sem loja -> PURCHASE_STORE_REQUIRED; sem preço -> PURCHASE_PRICE_REQUIRED', async () => {
    const won = await createItemViaApi(app, { catalogId: CAT.AK_REDLINE, acquisitionType: 'GANHEI', purchaseStoreId: storeId('CSFloat') });
    expectError(await patch(won.id, { acquisitionType: 'COMPRA' }), 400, 'PURCHASE_PRICE_REQUIRED');
    const res = await patch(won.id, { acquisitionType: 'COMPRA', purchasePriceCents: 100 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 100, purchaseCurrency: 'USD', fxRateAtPurchase: null,
    });
    const noStore = await createItemViaApi(app, { catalogId: CAT.AK_REDLINE, acquisitionType: 'GANHEI' });
    expectError(await patch(noStore.id, { acquisitionType: 'COMPRA', purchasePriceCents: 100 }), 400, 'PURCHASE_STORE_REQUIRED');
  });

  test('T33: GANHEI com Steam gravada -> COMPRA em BRL exige cotação (informada ou salva); loja nova no corpo prevalece', async () => {
    const won = await createItemViaApi(app, { catalogId: CAT.AK_REDLINE, acquisitionType: 'GANHEI', purchaseStoreId: storeId('Steam') });
    expectError(await patch(won.id, { acquisitionType: 'COMPRA', purchasePriceCents: 500 }), 400, 'FX_RATE_REQUIRED');
    Setting.update({ usdBrlRate: 5 });
    const brl = await patch(won.id, { acquisitionType: 'COMPRA', purchasePriceCents: 500 });
    expect(brl.body.data).toMatchObject({ purchaseStoreId: storeId('Steam'), purchaseCurrency: 'BRL', fxRateAtPurchase: 5 });

    const other = await createItemViaApi(app, { catalogId: CAT.AK_REDLINE, acquisitionType: 'GANHEI', purchaseStoreId: storeId('Steam') });
    const usd = await patch(other.id, { acquisitionType: 'COMPRA', purchasePriceCents: 100, purchaseStoreId: storeId('CSFloat') });
    expect(usd.body.data).toMatchObject({ purchaseStoreId: storeId('CSFloat'), purchaseCurrency: 'USD', fxRateAtPurchase: null });
  });

  test('T35 (b): fxRateAtPurchase null em GANHEI é aceito (POST, PATCH e COMPRA -> GANHEI); valor não nulo é recusado', async () => {
    const created = await createItemViaApi(app, { catalogId: CAT.AK_REDLINE, acquisitionType: 'GANHEI', fxRateAtPurchase: null });
    expect(created).toMatchObject({ fxRateAtPurchase: null, purchaseCurrency: 'USD' });
    expect((await patch(created.id, { fxRateAtPurchase: null })).status).toBe(200);
    expectError(await patch(created.id, { fxRateAtPurchase: 5 }), 400, 'FX_RATE_NOT_ALLOWED');
    const bought = await createItemViaApi(app);
    const toWon = await patch(bought.id, { acquisitionType: 'GANHEI', fxRateAtPurchase: null });
    expect(toWon.status).toBe(200);
    expect(toWon.body.data).toMatchObject({ acquisitionType: 'GANHEI', purchasePriceCents: 0, purchaseCurrency: 'USD', fxRateAtPurchase: null });
    expectError(await request(app).post('/api/items').send({ catalogId: CAT.AK_REDLINE, acquisitionType: 'GANHEI', fxRateAtPurchase: 5 }), 400, 'FX_RATE_NOT_ALLOWED');
  });

  test('GANHEI: purchasePriceCents null continua GANHEI_COST_NOT_ALLOWED', async () => {
    const won = await createItemViaApi(app, { catalogId: CAT.AK_REDLINE, acquisitionType: 'GANHEI' });
    expectError(await patch(won.id, { purchasePriceCents: null }), 400, 'GANHEI_COST_NOT_ALLOWED');
  });

  test('COMPRA com purchaseStoreId null; acquiredAt null; corpo vazio', async () => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { purchaseStoreId: null }), 400, 'PURCHASE_STORE_REQUIRED');
    expectError(await patch(item.id, { acquiredAt: null }), 400, 'REQUIRED_FIELD');
    expectError(await patch(item.id, {}), 400, 'INVALID_BODY');
    expectError(await patch(item.id, [1]), 400, 'INVALID_BODY');
    expectError(await patch(999, { name: 'x' }), 404, 'ITEM_NOT_FOUND');
    expectError(await patch(item.id, { acquiredAt: '2026-11-20T03:00:00.000Z' }), 400, 'ACQUIRED_AT_IN_FUTURE');
  });

  describe('item vendido (Q5, D60)', () => {
    test('editar preço de compra recalcula o lucro e mantém o snapshot', async () => {
      const item = await createItemViaApi(app);
      await sellItem(item.id);
      const res = await patch(item.id, { purchasePriceCents: 50 });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ saleProfitUsdCents: 72, netReceivedCents: 122, saleFeeRateApplied: 0.02 });
    });

    test('acquiredAt depois de soldAt -> SOLD_BEFORE_ACQUIRED', async () => {
      const item = await createItemViaApi(app);
      await sellItem(item.id);
      expectError(await patch(item.id, { acquiredAt: '2026-11-19T12:00:00.000Z' }), 400, 'SOLD_BEFORE_ACQUIRED');
    });

    test('PATCH de tradeUnlockAt posterior ao soldAt -> 409 ITEM_TRADE_LOCKED; igual ao soldAt é aceito', async () => {
      const item = await createItemViaApi(app);
      await sellItem(item.id); // soldAt 2026-11-18T12:00Z = 09:00 em Brasília
      const res = await patch(item.id, { tradeUnlockAt: '2026-11-19T14:00:00.000Z' });
      expectError(res, 409, 'ITEM_TRADE_LOCKED');
      expect(res.body.error.message).toBe('Item em trade lock até 19/11/2026 11:00');
      expect((await request(app).get(`/api/items/${item.id}`)).body.data.tradeUnlockAt).toBeNull();
      const equal = await patch(item.id, { tradeUnlockAt: '2026-11-18T12:00:00.000Z' });
      expect(equal.status).toBe(200);
    });

    const LOCKED = ['salePriceCents', 'soldAt', 'saleStoreId', 'netReceivedCents', 'status', 'saleCurrency', 'fxRateAtSale'];
    test.each(LOCKED)('%s -> SALE_FIELDS_LOCKED em item vendido e em estoque', async (field) => {
      const sold = await createItemViaApi(app);
      await sellItem(sold.id);
      const stock = await createItemViaApi(app);
      for (const id of [sold.id, stock.id]) {
        expectError(await patch(id, { [field]: 1, foo: 1 }), 400, 'SALE_FIELDS_LOCKED');
      }
    });

    test('campo inexistente -> UNKNOWN_FIELD', async () => {
      const item = await createItemViaApi(app);
      expectError(await patch(item.id, { foo: 1 }), 400, 'UNKNOWN_FIELD');
    });
  });
});

describe('DELETE /api/items/:id', () => {
  test('em estoque: 200 { id }, depois 404', async () => {
    const item = await createItemViaApi(app);
    const res = await request(app).delete(`/api/items/${item.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: item.id } });
    expectError(await request(app).get(`/api/items/${item.id}`), 404, 'ITEM_NOT_FOUND');
    expectError(await request(app).delete(`/api/items/${item.id}`), 404, 'ITEM_NOT_FOUND');
  });

  test('vendido pode ser excluído (Q9); id inválido', async () => {
    const item = await createItemViaApi(app);
    await sellItem(item.id);
    expect((await request(app).delete(`/api/items/${item.id}`)).status).toBe(200);
    expectError(await request(app).delete('/api/items/abc'), 400, 'INVALID_ID');
  });
});
