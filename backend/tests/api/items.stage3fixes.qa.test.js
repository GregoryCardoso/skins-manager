// QA independente das correções pós-revisão da Etapa 3 (D63): lacunas não cobertas por items.stage3fixes.test.js.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
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
const getItem = async (id) => (await request(app).get(`/api/items/${id}`)).body.data;
const rawRow = (id) => getDb().prepare('SELECT * FROM items WHERE id = ?').get(id);
const rowCount = () => getDb().prepare('SELECT COUNT(*) AS n FROM items').get().n;
const sell = (id, o = {}) =>
  request(app)
    .post(`/api/items/${id}/sell`)
    .send({ saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...o });

// ---------------------------------------------------------------- I1
describe('I1 (QA): troca de moeda no PATCH', () => {
  test('sem preço e sem cotação alguma: PURCHASE_PRICE_REQUIRED vem antes de FX_RATE_REQUIRED', async () => {
    expect(Setting.get().usdBrlRate ?? null).toBeNull();
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { purchaseStoreId: storeId('Steam') }), 400, 'PURCHASE_PRICE_REQUIRED');
    expect(rawRow(item.id)).toMatchObject({ purchase_currency: 'USD', purchase_price_cents: 100 });
  });

  test('BRL com cotação vinda de settings (sem informar) passa e grava a cotação de settings', async () => {
    Setting.update({ usdBrlRate: 5.25 });
    const item = await createItemViaApi(app);
    const res = await patch(item.id, { purchaseStoreId: storeId('Steam'), purchasePriceCents: 700 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ purchaseCurrency: 'BRL', purchasePriceCents: 700, fxRateAtPurchase: 5.25 });
  });

  test('preço 0 informado conta como informado na troca de moeda', async () => {
    Setting.update({ usdBrlRate: 5 });
    const item = await createItemViaApi(app);
    const res = await patch(item.id, { purchaseStoreId: storeId('Steam'), purchasePriceCents: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ purchaseCurrency: 'BRL', purchasePriceCents: 0 });
  });

  test('purchasePriceCents: null explícito na troca de moeda é tratado como não informado', async () => {
    Setting.update({ usdBrlRate: 5 });
    const item = await createItemViaApi(app);
    const res = await patch(item.id, { purchaseStoreId: storeId('Steam'), purchasePriceCents: null });
    expect(res.status).toBe(400);
    expect(['PURCHASE_PRICE_REQUIRED', 'REQUIRED_FIELD']).toContain(res.body.error.code);
    expect(rawRow(item.id).purchase_currency).toBe('USD');
  });

  test('COMPRA em USD -> GANHEI com loja BRL: custo 0 USD, sem cotação e sem exigir cotação salva (D65)', async () => {
    const item = await createItemViaApi(app);
    const res = await patch(item.id, { acquisitionType: 'GANHEI', purchaseStoreId: storeId('Steam') });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ purchaseCurrency: 'USD', purchasePriceCents: 0, fxRateAtPurchase: null, acquisitionType: 'GANHEI' });
  });

  test('GANHEI sem loja (USD) -> COMPRA na Steam sem preço: PURCHASE_PRICE_REQUIRED', async () => {
    Setting.update({ usdBrlRate: 5 });
    const won = await createItemViaApi(app, { catalogId: CAT.CASE_REVOLVER, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00Z' });
    expect(won.purchasePriceCents).toBe(0);
    const res = await patch(won.id, { acquisitionType: 'COMPRA', purchaseStoreId: storeId('Steam') });
    expectError(res, 400, 'PURCHASE_PRICE_REQUIRED');
  });

  test('PATCH sem mexer em loja num item BRL não exige preço', async () => {
    Setting.update({ usdBrlRate: 5 });
    const brl = await createItemViaApi(app, purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 500 }));
    const res = await patch(brl.id, { originDetail: 'Renomeado' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ originDetail: 'Renomeado', purchaseCurrency: 'BRL', purchasePriceCents: 500 });
  });
});

// ---------------------------------------------------------------- I2
describe('I2 (QA): fronteira de MAX_AMOUNT_CENTS', () => {
  test('constante vale 1e10', () => {
    expect(MAX_AMOUNT_CENTS).toBe(1e10);
  });

  test('POST: 1e10 aceito (resposta 201, sem quebrar o cálculo de preço mínimo); 1e10+1 recusado', async () => {
    Setting.update({ usdBrlRate: 5 });
    const ok = await request(app).post('/api/items').send(purchaseBody({ purchasePriceCents: 1e10 }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.purchasePriceCents).toBe(1e10);
    for (const p of ok.body.data.minPrices) {
      if (p.minPriceCents === null) expect(typeof p.warning).toBe('string');
    }
    expectError(await request(app).post('/api/items').send(purchaseBody({ purchasePriceCents: 1e10 + 1 })), 400, 'INVALID_AMOUNT');
    expect(rowCount()).toBe(1);
  });

  test('PATCH: 1e10 aceito; 1e10+1 recusado sem alterar o item', async () => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { purchasePriceCents: 1e10 + 1 }), 400, 'INVALID_AMOUNT');
    expect(rawRow(item.id).purchase_price_cents).toBe(100);
    const ok = await patch(item.id, { purchasePriceCents: 1e10 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.purchasePriceCents).toBe(1e10);
  });

  test('sell: 1e10 aceito; 1e10+1 recusado sem vender', async () => {
    const item = await createItemViaApi(app);
    expectError(await sell(item.id, { salePriceCents: 1e10 + 1 }), 400, 'INVALID_AMOUNT');
    expect(rawRow(item.id).status).toBe('EM_ESTOQUE');
    const ok = await sell(item.id, { salePriceCents: 1e10 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.item).toMatchObject({ status: 'VENDIDO', salePriceCents: 1e10 });
  });

  test('valores negativos e não inteiros continuam recusados', async () => {
    expectError(await request(app).post('/api/items').send(purchaseBody({ purchasePriceCents: -1 })), 400, 'INVALID_AMOUNT');
    expectError(await request(app).post('/api/items').send(purchaseBody({ purchasePriceCents: 10.5 })), 400, 'INVALID_AMOUNT');
    expect(rowCount()).toBe(0);
  });
});

describe('I2 (QA): leitura resiliente com valores gigantes gravados direto no banco', () => {
  test('GET /api/items/stats responde 200 com item gigante (em estoque e vendido)', async () => {
    const a = await createItemViaApi(app);
    const b = await createItemViaApi(app);
    expect((await sell(b.id)).status).toBe(200);
    getDb().prepare('UPDATE items SET purchase_price_cents = ? WHERE id = ?').run(9e15, a.id);
    getDb().prepare('UPDATE items SET purchase_price_cents = ?, sale_price_cents = ?, net_received_cents = ? WHERE id = ?').run(9e15, 9e15, 9e15, b.id);
    const stats = await request(app).get('/api/items/stats').query({ name: 'AK-47 | Redline', category: 'SKIN' });
    expect(stats.status).toBe(200);
    expect(stats.body.success).toBe(true);
    expect((await request(app).get('/api/items')).status).toBe(200);
    expect((await request(app).get('/api/items').query({ status: 'VENDIDO' })).status).toBe(200);
    expect((await request(app).get(`/api/items/${b.id}`)).status).toBe(200);
  });

  test('GET /api/items: o item gigante tem minPriceCents null + aviso e os demais itens seguem normais', async () => {
    Setting.update({ usdBrlRate: 5 });
    const big = await createItemViaApi(app);
    const normal = await createItemViaApi(app, purchaseBody({ catalogId: CAT.M4A1S_PRINTSTREAM }));
    getDb().prepare('UPDATE items SET purchase_price_cents = ? WHERE id = ?').run(9e15, big.id);
    const res = await request(app).get('/api/items');
    expect(res.status).toBe(200);
    const list = res.body.data.items ?? res.body.data;
    const bigView = list.find((i) => i.id === big.id);
    const normalView = list.find((i) => i.id === normal.id);
    expect(bigView.minPrices.some((p) => p.minPriceCents === null && p.warning === WARNING_PRICE_OVERFLOW)).toBe(true);
    expect(normalView.minPrices.every((p) => p.warning !== WARNING_PRICE_OVERFLOW)).toBe(true);
  });

  test('PATCH de outro campo num item gigante responde 200 (resposta de escrita também é resiliente)', async () => {
    const big = await createItemViaApi(app);
    getDb().prepare('UPDATE items SET purchase_price_cents = ? WHERE id = ?').run(9e15, big.id);
    const res = await patch(big.id, { originDetail: 'Renomeado' });
    expect(res.status).toBe(200);
    expect(rawRow(big.id).purchase_price_cents).toBe(9e15);
  });
});

describe('I2 (QA): erros de regra não gravam nada', () => {
  test('sell recusado por trade lock mantém o item intacto', async () => {
    const item = await createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-18T12:00:01Z' }));
    const before = rawRow(item.id);
    expectError(await sell(item.id), 409, 'ITEM_TRADE_LOCKED');
    expect(rawRow(item.id)).toEqual(before);
  });

  test('PATCH recusado (I3, SOLD_BEFORE_ACQUIRED, I1) mantém o item intacto', async () => {
    const item = await createItemViaApi(app);
    expect((await sell(item.id)).status).toBe(200);
    const before = rawRow(item.id);
    expectError(await patch(item.id, { tradeUnlockAt: '2026-11-19T00:00:00Z', originDetail: 'X' }), 409, 'ITEM_TRADE_LOCKED');
    expectError(await patch(item.id, { acquiredAt: '2026-11-19T00:00:00Z' }), 400, 'SOLD_BEFORE_ACQUIRED');
    expectError(await patch(item.id, { purchaseStoreId: storeId('Steam') }), 400, 'PURCHASE_PRICE_REQUIRED');
    expect(rawRow(item.id)).toEqual(before);
  });

  test('unsell de item não vendido (409) não altera nada', async () => {
    const item = await createItemViaApi(app);
    const before = rawRow(item.id);
    expectError(await request(app).post(`/api/items/${item.id}/unsell`), 409, 'ITEM_NOT_SOLD');
    expect(rawRow(item.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------- B1
describe('B1 (QA): formato de data', () => {
  const post = (acquiredAt) => request(app).post('/api/items').send(purchaseBody({ acquiredAt }));

  test.each([
    ['2028-02-29T10:00:00Z', null], // bissexto futuro: formato válido, mas cai em ACQUIRED_AT_IN_FUTURE no acquiredAt
  ])('tradeUnlockAt %s aceito (bissexto válido)', async (value) => {
    const res = await request(app).post('/api/items').send(purchaseBody({ tradeUnlockAt: value }));
    expect(res.status).toBe(201);
    expect(res.body.data.tradeUnlockAt).toBe('2028-02-29T10:00:00.000Z');
  });

  test.each([
    '2025-02-29T10:00:00Z', // 2025 não é bissexto
    '1900-02-29T10:00:00Z', // secular não bissexto
    '2026-04-31T10:00:00Z',
    '2026-11-10T23:59:60Z', // segundo bissexto
    '2026-11-10T24:00:00Z',
    '2026-11-10T15:60:00Z',
    '2026-11-10T15:00:00+0300', // offset sem dois-pontos (D7 exige ±hh:mm)
    '2026-11-10T15:00:00+03',
    '2026-11-10T15:00:00+24:00',
    '2026-11-10T15:00:00+03:60',
    '2026-11-10t15:00:00z',
    '2026-11-10 15:00:00Z',
    ' 2026-11-10T15:00:00Z',
    '2026-11-10T15:00:00Z ',
    '2026-11-10T15:00.5Z', // fração sem segundos
    '+002026-11-10T15:00:00Z', // ano expandido
    '20261110T150000Z', // ISO básico
    '2026-W46-2T15:00:00Z',
    '2026-314T15:00:00Z', // ordinal
    'Tue, 10 Nov 2026 15:00:00 GMT',
    '2026-11-10T15:00:00 Z',
  ])('acquiredAt %p -> 400 INVALID_DATE', async (value) => {
    expectError(await post(value), 400, 'INVALID_DATE');
  });

  test('2025-02-29 recusado também em tradeUnlockAt e soldAt', async () => {
    expectError(await request(app).post('/api/items').send(purchaseBody({ tradeUnlockAt: '2025-02-29T00:00:00Z' })), 400, 'INVALID_DATE');
    const item = await createItemViaApi(app, purchaseBody({ acquiredAt: '2024-01-01T00:00:00Z' }));
    expectError(await sell(item.id, { soldAt: '2025-02-29T12:00:00Z' }), 400, 'INVALID_DATE');
    expect(rawRow(item.id).status).toBe('EM_ESTOQUE');
  });

  test('data não-string (número/timestamp) é recusada com 400', async () => {
    const res = await post(1731250800000);
    expect(res.status).toBe(400);
    expect(['INVALID_DATE', 'INVALID_FIELD']).toContain(res.body.error.code);
  });

  test.each([
    ['2026-11-10T15:00:00+14:00', '2026-11-10T01:00:00.000Z'],
    ['2026-11-10T15:00:00-12:00', '2026-11-11T03:00:00.000Z'],
    ['2026-11-10T15:00:00-00:00', '2026-11-10T15:00:00.000Z'],
    ['2026-11-10T15:00+05:30', '2026-11-10T09:30:00.000Z'], // sem segundos, offset com minutos
    ['2026-11-10T15:00:00.5Z', '2026-11-10T15:00:00.500Z'],
    ['2026-11-10T15:00:00.123456789Z', '2026-11-10T15:00:00.123Z'],
    ['2000-02-29T10:00:00Z', '2000-02-29T10:00:00.000Z'], // secular bissexto
  ])('acquiredAt %s aceito e normalizado para %s', async (input, expected) => {
    const res = await post(input);
    expect(res.status).toBe(201);
    expect(res.body.data.acquiredAt).toBe(expected);
  });

  test('2028-02-29 é formato válido: no acquiredAt cai na regra de data futura, não em INVALID_DATE', async () => {
    const res = await post('2028-02-29T10:00:00Z');
    expect(res.status).toBe(400);
    expect(res.body.error.code).not.toBe('INVALID_DATE');
  });

  test.each(['0999-06-01T00:00:00Z', '0100-01-01T00:00:00Z', '0050-03-01T00:00:00Z'])(
    'acquiredAt %s (passado distante) é aceito com 201',
    async (acquiredAt) => {
      const res = await request(app)
        .post('/api/items')
        .send({ catalogId: CAT.CASE_REVOLVER, acquisitionType: 'GANHEI', acquiredAt });
      expect(res.status).toBe(201);
      expect(res.body.data.acquiredAt).toBe(new Date(acquiredAt).toISOString());
    }
  );

  test('PATCH com acquiredAt igual ao gravado mas em outro fuso não é tratado como mudança', async () => {
    const item = await createItemViaApi(app);
    const res = await patch(item.id, { acquiredAt: '2026-11-10T09:00:00-03:00' });
    expect(res.status).toBe(200);
    expect(res.body.data.acquiredAt).toBe('2026-11-10T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------- I3
describe('I3 (QA): PATCH de item vendido x trade lock', () => {
  const SOLD_AT = '2026-11-18T12:00:00.000Z';
  async function soldItem(body = purchaseBody()) {
    const item = await createItemViaApi(app, body);
    expect((await sell(item.id, { soldAt: SOLD_AT })).status).toBe(200);
    return item;
  }

  test('tradeUnlockAt 1 ms após soldAt -> 409 com a mesma mensagem da venda', async () => {
    const item = await soldItem();
    const res = await patch(item.id, { tradeUnlockAt: '2026-11-18T12:00:00.001Z' });
    expectError(res, 409, 'ITEM_TRADE_LOCKED');

    const other = await createItemViaApi(app, purchaseBody({ tradeUnlockAt: '2026-11-18T12:00:00.001Z' }));
    const saleRes = await sell(other.id, { soldAt: SOLD_AT });
    expectError(saleRes, 409, 'ITEM_TRADE_LOCKED');
    expect(res.body.error.message).toBe(saleRes.body.error.message);
    expect(rawRow(item.id).trade_unlock_at).toBeNull();
  });

  test('igualdade aceita, inclusive expressa em outro fuso', async () => {
    const item = await soldItem();
    const eq = await patch(item.id, { tradeUnlockAt: SOLD_AT });
    expect(eq.status).toBe(200);
    const eqOffset = await patch(item.id, { tradeUnlockAt: '2026-11-18T09:00:00-03:00' });
    expect(eqOffset.status).toBe(200);
    expect(eqOffset.body.data.tradeUnlockAt).toBe(SOLD_AT);
  });

  test('tradeUnlockAt anterior a soldAt e null aceitos', async () => {
    const item = await soldItem();
    expect((await patch(item.id, { tradeUnlockAt: '2026-11-17T00:00:00Z' })).status).toBe(200);
    const cleared = await patch(item.id, { tradeUnlockAt: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.tradeUnlockAt).toBeNull();
  });

  test('PATCH que não mexe em tradeUnlockAt num item vendido funciona (com tradeUnlockAt == soldAt gravado)', async () => {
    const item = await soldItem(purchaseBody({ tradeUnlockAt: SOLD_AT }));
    const res = await patch(item.id, { originDetail: 'detalhe' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ originDetail: 'detalhe', status: 'VENDIDO', tradeUnlockAt: SOLD_AT, soldAt: SOLD_AT });
  });

  test('item em estoque aceita tradeUnlockAt no futuro (regra só vale para vendido)', async () => {
    const item = await createItemViaApi(app);
    const res = await patch(item.id, { tradeUnlockAt: '2026-12-01T00:00:00Z' });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------- FIELD_TOO_LONG
describe('FIELD_TOO_LONG (QA)', () => {
  // Nome livre só existe em OUTRO/PASSE_BATALHA (D78); com catálogo o nome é derivado.
  const post = (o) => request(app).post('/api/items').send(purchaseBody({ catalogId: undefined, category: 'OUTRO', name: 'Livre', ...o }));

  test('201 caracteres com espaços nas pontas que somem no trim: aceito; gravado sem espaços', async () => {
    const res = await post({ name: ` ${'a'.repeat(200)}   `, originDetail: `\t${'b'.repeat(200)}\n` });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('a'.repeat(200));
    expect(res.body.data.originDetail).toBe('b'.repeat(200));
  });

  test('espaços internos contam', async () => {
    expectError(await post({ name: `${'a'.repeat(100)} ${'a'.repeat(100)}` }), 400, 'FIELD_TOO_LONG');
  });

  test('PATCH: name e originDetail com exatamente 200 aceitos', async () => {
    const item = await createItemViaApi(app, purchaseBody({ catalogId: undefined, category: 'OUTRO', name: 'Livre' }));
    const res = await patch(item.id, { name: 'n'.repeat(200), originDetail: 'o'.repeat(200) });
    expect(res.status).toBe(200);
  });

  test('mensagem de originDetail cita o campo e o limite', async () => {
    const res = await post({ originDetail: 'x'.repeat(201) });
    expectError(res, 400, 'FIELD_TOO_LONG');
    expect(res.body.error.message).toContain('originDetail');
    expect(res.body.error.message).toContain('200');
  });

  test('acentos pré-compostos contam 1 por caractere (200 "é" aceito, 201 recusado)', async () => {
    expect((await post({ name: 'é'.repeat(200) })).status).toBe(201);
    expectError(await post({ name: 'é'.repeat(201) }), 400, 'FIELD_TOO_LONG');
  });

  // Comprimento medido em unidades UTF-16 (String#length): cada emoji fora do BMP conta 2.
  test('emoji conta 2 (UTF-16): 100 emojis aceitos, 101 emojis recusados', async () => {
    expect((await post({ name: '😀'.repeat(100) })).status).toBe(201);
    expectError(await post({ name: '😀'.repeat(101) }), 400, 'FIELD_TOO_LONG');
    expectError(await post({ name: `${'a'.repeat(199)}😀` }), 400, 'FIELD_TOO_LONG');
  });

  test('nome só com espaços continua REQUIRED_FIELD (não FIELD_TOO_LONG)', async () => {
    expectError(await post({ name: ' '.repeat(300) }), 400, 'REQUIRED_FIELD');
  });
});

// ---------------------------------------------------------------- stats
describe('GET /api/items/stats (QA): variant padrão com dados reais', () => {
  test('SKIN sem variant conta os itens NORMAL e ignora STATTRAK', async () => {
    const normal = await createItemViaApi(app); // sem variant -> NORMAL
    await createItemViaApi(app, purchaseBody({ variant: 'STATTRAK' }));
    expect((await sell(normal.id)).status).toBe(200);
    const res = await request(app).get('/api/items/stats').query({ name: 'ak-47 | redline', category: 'SKIN' });
    expect(res.status).toBe(200);
    expect(res.body.data.soldCount).toBe(1);
    expect(res.body.data.avgPurchaseCostUsdCents).toBe(100);
    const st = await request(app).get('/api/items/stats').query({ name: 'AK-47 | Redline', category: 'SKIN', variant: 'STATTRAK' });
    expect(st.body.data.soldCount).toBe(0);
    expect(st.body.data.avgPurchaseCostUsdCents).toBe(100);
  });

  test.each([['FACA', CAT.KARAMBIT_FADE, '★ Karambit | Fade'], ['LUVA', CAT.SPORT_GLOVES_PANDORA, "★ Sport Gloves | Pandora's Box"]])(
    '%s sem variant encontra item cadastrado sem variant',
    async (category, catalogId, name) => {
    const item = await createItemViaApi(app, purchaseBody({ catalogId }));
    expect((await sell(item.id)).status).toBe(200);
    const res = await request(app).get('/api/items/stats').query({ name, category });
    expect(res.body.data.soldCount).toBe(1);
    }
  );

  test('CAIXA sem variant encontra item CAIXA (chave sem variant)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ catalogId: CAT.CASE_REVOLVER }));
    expect((await sell(item.id)).status).toBe(200);
    const res = await request(app).get('/api/items/stats').query({ name: 'Revolver Case', category: 'CAIXA' });
    expect(res.status).toBe(200);
    expect(res.body.data.soldCount).toBe(1);
    expect(res.body.data.key).not.toContain('NORMAL');
  });

  test.each(['CAIXA', 'STICKER', 'OUTRO'])('variant informada em categoria %s -> 400 ATTRIBUTES_NOT_ALLOWED', async (category) => {
    const res = await request(app).get('/api/items/stats').query({ name: 'X', category, variant: 'NORMAL' });
    expectError(res, 400, 'ATTRIBUTES_NOT_ALLOWED');
  });

  test('variant informada em SKIN continua aceita', async () => {
    const res = await request(app).get('/api/items/stats').query({ name: 'X', category: 'SKIN', variant: 'STATTRAK' });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------- errorHandler
describe('errorHandler (QA): log de SQLITE_CONSTRAINT', () => {
  const mockRes = () => ({ headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn() });

  test.each(['SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_FOREIGNKEY', 'SQLITE_CONSTRAINT_CHECK'])(
    '%s: loga e responde 409 CONSTRAINT_VIOLATION sem vazar detalhes',
    (code) => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const err = Object.assign(new Error('detalhe interno'), { code });
      const res = mockRes();
      errorHandler(err, {}, res, jest.fn());
      expect(spy).toHaveBeenCalledWith(err);
      expect(res.status).toHaveBeenCalledWith(409);
      const body = res.json.mock.calls[0][0];
      expect(body.error.code).toBe('CONSTRAINT_VIOLATION');
      expect(JSON.stringify(body)).not.toContain('detalhe interno');
    }
  );

  test('erro de validação conhecido não é logado como constraint', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expectError(await request(app).post('/api/items').send(purchaseBody({ name: 'a'.repeat(201) })), 400, 'FIELD_TOO_LONG');
    expect(spy).not.toHaveBeenCalled();
  });
});
