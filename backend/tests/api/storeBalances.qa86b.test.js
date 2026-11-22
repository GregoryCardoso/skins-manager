// QA Revisão 23 (D252, D256): saldo sempre a partir de 0, aporte é sempre aporte, rota do saldo inicial removida.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const StoreBalance = require('../../src/models/StoreBalance');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, expectError, purchaseBody, NOW } = require('../helpers/apiFixtures');

let app;
afterAll(() => closeDb());

const get = (url) => request(app).get(url);
const post = (body) => request(app).post('/api/store-balances').send(body);
const current = async () => (await get('/api/store-balances/current')).body.data;
const row = (data, name) => data.stores.find((s) => s.storeName === name);
const summary = async () => (await get('/api/profit/summary')).body.data;
const rowCount = () => getDb().prepare('SELECT COUNT(*) AS n FROM store_balances').get().n;
const csf = () => storeId('CSFloat');
const legacy = (store, balanceCents, recordedAt) => StoreBalance.create(
  { storeId: store, kind: 'CHECK', balanceCents, computedCents: null, adjustmentCents: null, fxRate: null, note: null, recordedAt }, { now: NOW }
);

beforeEach(() => { freshDb(); app = makeCatalogApp(NOW); Setting.update({ usdBrlRate: 5 }, { now: NOW }); });

describe('exemplo obrigatório (D252) pela API real', () => {
  test('aporte 10,20 + compra 5,20: saldo 500, total colocado 1020, estoque 520, lucro 0, sem estimativa e sem avisos', async () => {
    expect((await request(app).post('/api/deposits').send({ storeId: csf(), amountStoreCents: 1020, depositedAt: '2026-11-18T12:00:00.000Z' })).status).toBe(201);
    expect((await request(app).post('/api/items').send(purchaseBody({ purchasePriceCents: 520, acquiredAt: '2026-11-18T13:00:00.000Z' }))).status).toBe(201);
    expect(row(await current(), 'CSFloat')).toMatchObject({ availableCents: 500, breakdown: { depositsCents: 1020, purchasesCents: 520 } });
    const s = await summary();
    expect(s).toMatchObject({ depositsUsdCents: 1020, platformBalanceUsdCents: 500, stockUsdCents: 520, realProfitUsdCents: 0, estimated: false });
    expect(s.warnings).toEqual([]);
    expect(rowCount()).toBe(0);
  });

  test('a ordem não importa: compra antes do aporte dá o mesmo resultado final', async () => {
    await request(app).post('/api/items').send(purchaseBody({ purchasePriceCents: 520, acquiredAt: '2026-11-18T13:00:00.000Z' }));
    expect(row(await current(), 'CSFloat').availableCents).toBe(-520); // negativo até o aporte
    await request(app).post('/api/deposits').send({ storeId: csf(), amountStoreCents: 1020, depositedAt: '2026-11-18T12:00:00.000Z' });
    expect((await summary())).toMatchObject({ platformBalanceUsdCents: 500, realProfitUsdCents: 0 });
  });

  test('aporte como PRIMEIRO registro da loja (nenhum store_balance): aparece em GET /api/deposits e nunca cria registro de saldo', async () => {
    expect(rowCount()).toBe(0);
    const res = await request(app).post('/api/deposits').send({ storeId: csf(), amountStoreCents: 1020, depositedAt: '2026-11-18T12:00:00.000Z' });
    expect(res.status).toBe(201);
    const list = (await get('/api/deposits')).body.data;
    expect(list.deposits).toHaveLength(1);
    expect(list.deposits[0]).toMatchObject({ storeName: 'CSFloat', amountStoreCents: 1020, legacy: false });
    expect(list.totals.amountUsdCents).toBe(1020);
    expect(rowCount()).toBe(0);
    expect((await get('/api/store-balances')).body.data.balances).toEqual([]);
    const csfRow = row(await current(), 'CSFloat');
    expect(csfRow).toMatchObject({ availableCents: 1020, lastCheck: null, daysSinceLastCheck: null, warningCode: null });
    expect((await summary())).toMatchObject({ depositsUsdCents: 1020, platformBalanceUsdCents: 1020, realProfitUsdCents: 0 });
    // outras lojas continuam sem nada
    expect(row(await current(), 'Steam')).toMatchObject({ availableCents: 0, lastCheck: null });
  });

  test('com a venda: líquido 600 -> disponível 1100, estoque 0, lucro 80', async () => {
    await request(app).post('/api/deposits').send({ storeId: csf(), amountStoreCents: 1020, depositedAt: '2026-11-01T12:00:00.000Z' });
    const item = await request(app).post('/api/items').send(purchaseBody({ purchasePriceCents: 520, acquiredAt: '2026-11-02T12:00:00.000Z' }));
    getDb().prepare('UPDATE stores SET sale_hold_days = 0 WHERE id = ?').run(csf());
    const sell = await request(app).post(`/api/items/${item.body.data.id}/sell`).send({
      saleStoreId: csf(), salePriceCents: 612, netReceivedCents: 600, soldAt: '2026-11-03T12:00:00.000Z',
    });
    expect(sell.status).toBe(200);
    expect(sell.body.data.sale.netReceivedCents).toBe(600);
    expect(row(await current(), 'CSFloat').availableCents).toBe(1100);
    expect(await summary()).toMatchObject({ stockUsdCents: 0, realProfitUsdCents: 80, estimated: false });
  });
});

describe('conferência: BEFORE_LAST ignora registros antigos; lastCheck conta todos (D252, D243)', () => {
  test('conferência anterior a um registro antigo é aceita; anterior a uma com cálculo recusada; igual aceita', async () => {
    const store = csf();
    legacy(store, 1000, '2026-11-15T12:00:00.000Z');
    const a = await post({ storeId: store, balanceCents: 0, recordedAt: '2026-11-10T12:00:00.000Z' });
    expect(a.status).toBe(201);
    expectError(await post({ storeId: store, balanceCents: 0, recordedAt: '2026-11-09T12:00:00.000Z' }), 400, 'BALANCE_CHECK_BEFORE_LAST', { field: 'recordedAt' });
    expect((await post({ storeId: store, balanceCents: 0, recordedAt: '2026-11-10T12:00:00.000Z' })).status).toBe(201);
    expect((await post({ storeId: store, balanceCents: 0, recordedAt: '2026-11-11T12:00:00.000Z' })).status).toBe(201);
  });

  test('a prévia segue a mesma regra do POST', async () => {
    const store = csf();
    legacy(store, 1000, '2026-11-15T12:00:00.000Z');
    const q = (recordedAt) => get(`/api/store-balances/check-preview?storeId=${store}&balanceCents=0&recordedAt=${recordedAt}`);
    expect((await q('2026-11-05T12:00:00.000Z')).status).toBe(200);
    await post({ storeId: store, balanceCents: 0, recordedAt: '2026-11-10T12:00:00.000Z' });
    expectError(await q('2026-11-05T12:00:00.000Z'), 400, 'BALANCE_CHECK_BEFORE_LAST', { field: 'recordedAt' });
  });

  test('lastCheck e daysSinceLastCheck contam o registro antigo (maior data) mesmo com conferência calculada mais antiga', async () => {
    const store = csf();
    legacy(store, 1000, '2026-11-15T12:00:00.000Z'); // 7 dias antes de NOW (11-19)? NOW = 2026-11-19T15:00Z
    await post({ storeId: store, balanceCents: 0, recordedAt: '2026-11-10T12:00:00.000Z' });
    const csfRow = row(await current(), 'CSFloat');
    expect(csfRow.lastCheck).toMatchObject({ recordedAt: '2026-11-15T12:00:00.000Z', legacy: true, balanceCents: 1000 });
    expect(csfRow.daysSinceLastCheck).toBe(4);
  });

  test('só registros antigos: a loja tem lastCheck e disponível calculado sem eles (não somam nada)', async () => {
    const store = csf();
    legacy(store, 99999, '2026-11-15T12:00:00.000Z');
    const csfRow = row(await current(), 'CSFloat');
    expect(csfRow.availableCents).toBe(0);
    expect(csfRow.breakdown.adjustmentsCents).toBe(0);
    expect(csfRow.lastCheck.legacy).toBe(true);
    expect((await summary()).platformBalanceUsdCents).toBe(0);
  });

  test('o ajuste de uma conferência com cálculo entra no disponível, o de registro antigo (inexistente) não', async () => {
    const store = csf();
    await request(app).post('/api/deposits').send({ storeId: store, amountStoreCents: 1000, depositedAt: '2026-11-01T12:00:00.000Z' });
    legacy(store, 5, '2026-11-02T12:00:00.000Z');
    const c = await post({ storeId: store, balanceCents: 950, recordedAt: '2026-11-10T12:00:00.000Z', adjust: true, note: 'taxa' });
    expect(c.body.data).toMatchObject({ computedCents: 1000, adjustmentCents: -50 });
    expect(row(await current(), 'CSFloat').availableCents).toBe(950);
  });
});

describe('a rota do saldo inicial não existe mais', () => {
  const body = { balanceCents: 1000, recordedAt: '2026-11-10T12:00:00.000Z' };

  test.each(['put', 'post', 'patch', 'delete', 'get'])('%s /api/store-balances/initial/:id -> sem gravar e sem sucesso', async (method) => {
    const res = await request(app)[method](`/api/store-balances/initial/${csf()}`).send(method === 'get' ? undefined : body);
    expect(res.body.success).toBe(false);
    expect([400, 404]).toContain(res.status);
    expect(rowCount()).toBe(0);
  });

  test('PUT /initial/1 com JSON válido -> 404 padrão NOT_FOUND', async () => {
    const res = await request(app).put('/api/store-balances/initial/1').send(body);
    expectError(res, 404, 'NOT_FOUND');
  });

  test('kind e campos do saldo inicial no POST são recusados (UNKNOWN_FIELD) e nada é gravado', async () => {
    const base = { storeId: csf(), balanceCents: 1, recordedAt: '2026-11-10T12:00:00.000Z' };
    expectError(await post({ ...base, kind: 'INITIAL' }), 400, 'UNKNOWN_FIELD', { field: 'kind' });
    expectError(await post({ ...base, initial: true }), 400, 'UNKNOWN_FIELD', { field: 'initial' });
    expect(rowCount()).toBe(0);
  });

  test('o model grava sempre kind CHECK, mesmo que se peça INITIAL (D254)', () => {
    const created = StoreBalance.create({ storeId: csf(), kind: 'INITIAL', balanceCents: 1, computedCents: null, adjustmentCents: null, fxRate: null, note: null, recordedAt: '2026-11-10T12:00:00.000Z' }, { now: NOW });
    expect(created.kind).toBe('CHECK');
    expect(typeof StoreBalance.upsertInitial).toBe('undefined');
    expect(typeof StoreBalance.findInitial).toBe('undefined');
  });

  test('/current e o histórico não trazem initialBalance, breakdown.initialCents nem kind diferente de CHECK', async () => {
    legacy(csf(), 1, '2026-11-10T12:00:00.000Z');
    const data = await current();
    for (const s of data.stores) {
      expect(s).not.toHaveProperty('initialBalance');
      expect(s.breakdown).toEqual({ depositsCents: 0, purchasesCents: 0, withdrawalsCents: 0, salesReleasedCents: 0, adjustmentsCents: 0 });
    }
    expect((await get('/api/store-balances')).body.data.balances.every((b) => b.kind === 'CHECK')).toBe(true);
    expect(JSON.stringify((await summary()).balancesByStore)).not.toMatch(/initial/i);
  });
});

describe('segurança nas rotas restantes (415 e Host)', () => {
  const okBody = { storeId: 1, balanceCents: 1, recordedAt: '2026-11-10T12:00:00.000Z' };

  test.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x'])('POST com %s -> 415 e nada gravado', async (type) => {
    expectError(await request(app).post('/api/store-balances').set('Content-Type', type).send('x=1'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(rowCount()).toBe(0);
  });

  test('POST sem Content-Type -> 415; JSON com charset passa', async () => {
    expectError(await request(app).post('/api/store-balances'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    const res = await request(app).post('/api/store-balances').set('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(okBody));
    expect(res.status).toBe(201);
  });

  test.each(['evil.example', 'localhost.evil.com', '127.0.0.1.evil.com', 'evil.com:3001', '[::1]:3001'])('Host %s -> 403 em todas as rotas de saldo', async (host) => {
    const id = (await post(okBody)).body.data.id;
    const results = [
      await get('/api/store-balances').set('Host', host),
      await get('/api/store-balances/current').set('Host', host),
      await get('/api/store-balances/check-preview?storeId=1&balanceCents=1&recordedAt=2026-11-10T00:00:00.000Z').set('Host', host),
      await request(app).post('/api/store-balances').set('Host', host).send(okBody),
      await request(app).delete(`/api/store-balances/${id}`).set('Host', host),
      await request(app).put('/api/store-balances/initial/1').set('Host', host).send(okBody),
    ];
    for (const res of results) expectError(res, 403, 'FORBIDDEN_HOST');
    expect(rowCount()).toBe(1);
  });

  test('DELETE sem corpo e sem Content-Type funciona; id inválido -> INVALID_ID; "initial" não vira id', async () => {
    const id = (await post(okBody)).body.data.id;
    expect((await request(app).delete(`/api/store-balances/${id}`)).status).toBe(200);
    expectError(await request(app).delete('/api/store-balances/initial'), 400, 'INVALID_ID');
    expectError(await request(app).delete('/api/store-balances/abc'), 400, 'INVALID_ID');
  });
});
