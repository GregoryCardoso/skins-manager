// Lacunas da D56 para POST /api/items/:id/sell (testador, revisão independente da Etapa 3).
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const Store = require('../../src/models/Store');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { CAT, makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const SALE_KEYS = [
  'saleStoreId', 'salePriceCents', 'saleCurrency', 'fxRateAtSale', 'saleFeeTypeApplied', 'saleFeeRateApplied',
  'saleFeeRoundingApplied', 'saleMinFeeCentsApplied', 'saleFixedFeeCentsApplied', 'netReceivedCents', 'soldAt',
];
const sellBody = (overrides = {}) => ({
  saleStoreId: storeId('CSFloat'),
  salePriceCents: 125,
  soldAt: '2026-11-18T12:00:00.000Z',
  ...overrides,
});
const sell = (id, body, theApp = app) => request(theApp).post(`/api/items/${id}/sell`).send(body);
const getItem = async (id) => (await request(app).get(`/api/items/${id}`)).body.data;

describe('trade lock na venda (D59 revisada, exemplos da D56)', () => {
  test('(a) exemplo da D56: unlock 20:30Z, soldAt 15:00Z -> 409 com a mensagem exata e nada é gravado', async () => {
    const item = await createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-19T20:30:00.000Z' }));
    const res = await sell(item.id, sellBody({ soldAt: '2026-11-19T15:00:00.000Z' }));
    expectError(res, 409, 'ITEM_TRADE_LOCKED');
    expect(res.body.error.message).toBe('Item em trade lock até 19/11/2026 17:30');
    const view = await getItem(item.id);
    expect(view.status).toBe('EM_ESTOQUE');
    for (const key of SALE_KEYS) expect(view[key]).toBeNull();
    expect(view.updatedAt).toBe(item.updatedAt);
    expect(Array.isArray(view.minPrices)).toBe(true);
    expect(view.saleProfitUsdCents).toBeNull();
  });

  test('(e) venda passada: unlock 10/11 (já liberado em now), soldAt 09/11 -> 409 "... até 10/11/2026 09:00"', async () => {
    const item = await createItemViaApi(
      app,
      purchaseBody({ acquiredAt: '2026-11-01T12:00:00.000Z', tradeUnlockAt: '2026-11-10T12:00:00.000Z' })
    );
    // Em now o item aparece liberado, mas a venda é avaliada em soldAt.
    expect(item.tradeLock).toMatchObject({ isLocked: false, formatted: 'Liberado' });
    const res = await sell(item.id, sellBody({ soldAt: '2026-11-09T12:00:00.000Z' }));
    expectError(res, 409, 'ITEM_TRADE_LOCKED');
    expect(res.body.error.message).toBe('Item em trade lock até 10/11/2026 09:00');
    expect((await getItem(item.id)).status).toBe('EM_ESTOQUE');
  });

  test('1 ms antes do unlock -> 409; unlock informado com fuso -03:00 é o mesmo instante -> 200', async () => {
    const item = await createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-15T09:00:00-03:00' }));
    expectError(await sell(item.id, sellBody({ soldAt: '2026-11-15T11:59:59.999Z' })), 409, 'ITEM_TRADE_LOCKED');
    const ok = await sell(item.id, sellBody({ soldAt: '2026-11-15T09:00:00-03:00' }));
    expect(ok.status).toBe(200);
    expect(ok.body.data.item.soldAt).toBe('2026-11-15T12:00:00.000Z');
  });

  test('mensagem descarta segundos (minutos truncados)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-15T12:00:59.000Z' }));
    const res = await sell(item.id, sellBody({ soldAt: '2026-11-15T12:00:30.000Z' }));
    expectError(res, 409, 'ITEM_TRADE_LOCKED');
    expect(res.body.error.message).toBe('Item em trade lock até 15/11/2026 09:00');
  });

  test('item com trade lock futuro em now (bloqueado na leitura) não pode ser vendido hoje', async () => {
    const item = await createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-25T12:00:00.000Z' }));
    expect(item.tradeLock.isLocked).toBe(true);
    const res = await sell(item.id, sellBody({ soldAt: '2026-11-19T15:00:00.000Z' }));
    expectError(res, 409, 'ITEM_TRADE_LOCKED');
    expect(res.body.error.message).toBe('Item em trade lock até 25/11/2026 09:00');
  });

  test('ordem: datas inválidas/futuras/anteriores à compra vêm antes do trade lock', async () => {
    const item = await createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-25T12:00:00.000Z' }));
    expectError(await sell(item.id, sellBody({ soldAt: 'xx' })), 400, 'INVALID_DATE');
    expectError(await sell(item.id, sellBody({ soldAt: '2026-11-21T12:00:00.000Z' })), 400, 'SOLD_AT_IN_FUTURE');
    expectError(await sell(item.id, sellBody({ soldAt: '2026-11-01T12:00:00.000Z' })), 400, 'SOLD_BEFORE_ACQUIRED');
  });

  test('ordem: loja inexistente (400) antes do trade lock; trade lock (409) antes de taxas/preço', async () => {
    const item = await createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-25T12:00:00.000Z' }));
    expectError(await sell(item.id, sellBody({ saleStoreId: 999 })), 400, 'STORE_NOT_FOUND');
    expectError(await sell(item.id, sellBody({ saleStoreId: storeId('CSMoney') })), 409, 'ITEM_TRADE_LOCKED');
    expectError(await sell(item.id, sellBody({ salePriceCents: 0 })), 409, 'ITEM_TRADE_LOCKED');
  });

  test('desfazer e vender de novo passa pela regra (PATCH de tradeUnlockAt em vendido revalida)', async () => {
    const item = await createItemViaApi(app);
    expect((await sell(item.id, sellBody())).status).toBe(200);
    const refused = await request(app).patch(`/api/items/${item.id}`).send({ tradeUnlockAt: '2026-11-18T13:00:00.000Z' });
    expectError(refused, 409, 'ITEM_TRADE_LOCKED');
    expect((await request(app).post(`/api/items/${item.id}/unsell`)).status).toBe(200);
    const patched = await request(app).patch(`/api/items/${item.id}`).send({ tradeUnlockAt: '2026-11-18T13:00:00.000Z' });
    expect(patched.status).toBe(200);
    const res = await sell(item.id, sellBody());
    expectError(res, 409, 'ITEM_TRADE_LOCKED');
    expect(res.body.error.message).toBe('Item em trade lock até 18/11/2026 10:00');
    expect((await sell(item.id, sellBody({ soldAt: '2026-11-18T13:00:00.000Z' }))).status).toBe(200);
  });
});

describe('soldAt no futuro: o "hoje" é o dia de São Paulo, não o dia UTC (D53)', () => {
  // now = 2026-11-20T01:00Z = 19/11 22:00 em Brasília (dia UTC já é 20).
  const lateApp = () => makeCatalogApp(new Date('2026-11-20T01:00:00.000Z'));

  test('23:59 BRT do dia 19 aceito; 00:00 BRT do dia 20 recusado mesmo sendo o mesmo dia UTC de now', async () => {
    const theApp = lateApp();
    const a = await createItemViaApi(theApp);
    const b = await createItemViaApi(theApp);
    expectError(await sell(a.id, sellBody({ soldAt: '2026-11-20T03:00:00.000Z' }), theApp), 400, 'SOLD_AT_IN_FUTURE');
    expectError(await sell(a.id, sellBody({ soldAt: '2026-11-20T12:00:00.000Z' }), theApp), 400, 'SOLD_AT_IN_FUTURE');
    expect((await sell(b.id, sellBody({ soldAt: '2026-11-20T02:59:59.999Z' }), theApp)).status).toBe(200);
  });

  test('mensagem do SOLD_AT_IN_FUTURE', async () => {
    const item = await createItemViaApi(app);
    const res = await sell(item.id, sellBody({ soldAt: '2026-11-20T03:00:00.000Z' }));
    expect(res.body.error.message).toBe('A data de venda não pode ser futura.');
  });

  test('mensagem do SOLD_BEFORE_ACQUIRED', async () => {
    const item = await createItemViaApi(app);
    const res = await sell(item.id, sellBody({ soldAt: '2026-11-09T12:00:00.000Z' }));
    expect(res.body.error.message).toBe('A data de venda não pode ser anterior à data de compra.');
  });
});

describe('snapshot das taxas, netReceived e lucro (D18, D31)', () => {
  test('taxa mínima + fixa + ROUND entram no snapshot e no líquido', async () => {
    Store.update(storeId('CSFloat'), { saleMinFeeCents: 30, saleFixedFeeCents: 5, saleFeeRounding: 'ROUND' });
    const item = await createItemViaApi(app);
    const res = await sell(item.id, sellBody({ salePriceCents: 1000 }));
    expect(res.status).toBe(200);
    // max(round(1000 × 0.02) = 20, 30) + 5 = 35 -> líquido 965; lucro 965 − 100.
    expect(res.body.data.sale).toEqual({ netReceivedCents: 965, feeCents: 35, saleProfitUsdCents: 865, netReceivedManual: false });
    expect(res.body.data.item).toMatchObject({
      saleFeeTypeApplied: 'DEDUCTED', saleFeeRateApplied: 0.02, saleFeeRoundingApplied: 'ROUND',
      saleMinFeeCentsApplied: 30, saleFixedFeeCentsApplied: 5, netReceivedCents: 965,
    });
    Store.update(storeId('CSFloat'), { saleMinFeeCents: null, saleFixedFeeCents: 0, saleFeeRounding: 'CEIL' });
    expect(await getItem(item.id)).toMatchObject({
      saleFeeRoundingApplied: 'ROUND', saleMinFeeCentsApplied: 30, saleFixedFeeCentsApplied: 5,
      netReceivedCents: 965, saleProfitUsdCents: 865,
    });
  });

  test('loja com tipo configurado e taxa nula -> FEES_NOT_CONFIGURED e nada gravado (D31)', async () => {
    Store.update(storeId('CSMoney'), { saleFeeType: 'DEDUCTED' });
    const item = await createItemViaApi(app);
    expectError(await sell(item.id, sellBody({ saleStoreId: storeId('CSMoney') })), 400, 'FEES_NOT_CONFIGURED');
    expect((await getItem(item.id)).status).toBe('EM_ESTOQUE');
  });

  test('Steam ADDED: compra BRL com cotação 5, venda 1150 com cotação 5.5 informada', async () => {
    Setting.update({ usdBrlRate: 5 });
    const item = await createItemViaApi(app, purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 1000 }));
    const res = await sell(item.id, sellBody({ saleStoreId: storeId('Steam'), salePriceCents: 1150, fxRateAtSale: 5.5 }));
    expect(res.status).toBe(200);
    // recebido 1000 BRL (taxa 150); 1000/5.5 = 181,8 -> 182 USD¢; custo 1000/5 = 200 USD¢.
    expect(res.body.data.sale).toEqual({ netReceivedCents: 1000, feeCents: 150, saleProfitUsdCents: -18, netReceivedManual: false });
    expect(res.body.data.item).toMatchObject({
      saleCurrency: 'BRL', fxRateAtSale: 5.5, saleFeeTypeApplied: 'ADDED', saleFeeRateApplied: 0.15,
    });
  });

  test('Steam usa a cotação salva; alterar a cotação depois não muda fxRateAtSale nem o lucro (2.9)', async () => {
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5 });
    const item = await createItemViaApi(app);
    const res = await sell(item.id, sellBody({ saleStoreId: storeId('Steam'), salePriceCents: 1150 }));
    expect(res.body.data.item.fxRateAtSale).toBe(5);
    const profit = res.body.data.sale.saleProfitUsdCents;
    expect(profit).toBe(100); // 1000 BRL / 5 = 200 USD¢ − 100
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 7 });
    expect(await getItem(item.id)).toMatchObject({ fxRateAtSale: 5, saleProfitUsdCents: 100 });
  });

  test('GANHEI sem preço (custo 0): lucro = líquido', async () => {
    const item = await createItemViaApi(app, { catalogId: CAT.CASE_REVOLVER, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' });
    const res = await sell(item.id, sellBody());
    expect(res.body.data.sale).toEqual({ netReceivedCents: 122, feeCents: 3, saleProfitUsdCents: 122, netReceivedManual: false });
  });

  test('cotação de venda inválida em BRL -> INVALID_FX_RATE; null em USD é aceito', async () => {
    Setting.update({ usdBrlRate: 5 });
    const item = await createItemViaApi(app);
    const steam = (fx) => sellBody({ saleStoreId: storeId('Steam'), salePriceCents: 115, fxRateAtSale: fx });
    expectError(await sell(item.id, steam(0)), 400, 'INVALID_FX_RATE');
    expectError(await sell(item.id, steam(-2)), 400, 'INVALID_FX_RATE');
    expectError(await sell(item.id, steam('5')), 400, 'INVALID_FIELD');
    expect((await sell(item.id, sellBody({ fxRateAtSale: null }))).status).toBe(200);
  });
});

describe('validação de forma da venda', () => {
  test('preço 2^53 e negativo -> INVALID_AMOUNT', async () => {
    const item = await createItemViaApi(app);
    expectError(await sell(item.id, sellBody({ salePriceCents: 2 ** 53 })), 400, 'INVALID_AMOUNT');
    expectError(await sell(item.id, sellBody({ salePriceCents: -5 })), 400, 'INVALID_AMOUNT');
  });

  test('saleStoreId não inteiro -> INVALID_FIELD; nulo -> REQUIRED_FIELD; soldAt número -> INVALID_FIELD', async () => {
    const item = await createItemViaApi(app);
    expectError(await sell(item.id, sellBody({ saleStoreId: 1.5 })), 400, 'INVALID_FIELD');
    expectError(await sell(item.id, sellBody({ saleStoreId: '1' })), 400, 'INVALID_FIELD');
    expectError(await sell(item.id, sellBody({ saleStoreId: null })), 400, 'REQUIRED_FIELD');
    expectError(await sell(item.id, sellBody({ soldAt: 1763000000000 })), 400, 'INVALID_FIELD');
  });

  test('corpo ausente, array ou status no corpo', async () => {
    const item = await createItemViaApi(app);
    expectError(await request(app).post(`/api/items/${item.id}/sell`), 400, 'INVALID_BODY');
    expectError(await sell(item.id, [sellBody()]), 400, 'INVALID_BODY');
    expectError(await sell(item.id, sellBody({ status: 'VENDIDO' })), 400, 'UNKNOWN_FIELD');
    expectError(await sell(item.id, sellBody({ saleCurrency: 'BRL' })), 400, 'UNKNOWN_FIELD');
  });

  test('id inválido na venda', async () => {
    for (const id of ['abc', '0', '-1', '1.5']) expectError(await sell(id, sellBody()), 400, 'INVALID_ID');
  });
});
