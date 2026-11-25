// API do saldo calculado das lojas (8.6: D239 a D246, D250; Revisão 23: sem saldo inicial) e da retenção (D214). Banco :memory: novo a cada teste.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Item = require('../../src/models/Item');
const Deposit = require('../../src/models/Deposit');
const Withdrawal = require('../../src/models/Withdrawal');
const StoreBalance = require('../../src/models/StoreBalance');
const Setting = require('../../src/models/Setting');
const { freshDb, wonSkin, soldFields } = require('../helpers/fixtures');
const { makeApp, makeCatalogApp, storeId, expectError, purchaseBody, createItemViaApi, NOW } = require('../helpers/apiFixtures');

const D239_NOW = new Date('2026-11-22T12:00:00.000Z');
let app;

afterAll(() => closeDb());

const get = (url) => request(app).get(url);
const post = (body) => request(app).post('/api/store-balances').send(body);
const checkBody = (overrides = {}) => ({ storeId: storeId('CSFloat'), balanceCents: 12346, recordedAt: '2026-11-18T12:00:00.000Z', ...overrides });
const initialBody = (overrides = {}) => ({ balanceCents: 10000, recordedAt: '2026-11-10T12:00:00.000Z', ...overrides });
const preview = (query) => get(`/api/store-balances/check-preview?${new URLSearchParams(query).toString()}`);
const current = async () => (await get('/api/store-balances/current')).body.data;
const row = (data, name) => data.stores.find((s) => s.storeName === name);
const rowCount = () => getDb().prepare('SELECT COUNT(*) AS n FROM store_balances').get().n;

// Exemplo de D239 sem saldo inicial (Revisão 23): o primeiro aporte de 10000 faz o papel dele. CSFloat, USD, retenção 7; now = 2026-11-22T12:00Z.
function seedD239() {
  const csf = storeId('CSFloat');
  Setting.update({ usdBrlRate: 5.4321 }, { now: D239_NOW });
  const sale = (name, soldAt, net) => Item.create(wonSkin({
    name, ...soldFields(csf, { soldAt, netReceivedCents: net, salePriceCents: net, saleHoldDaysApplied: 7 }), acquiredAt: '2026-10-01T12:00:00.000Z',
  }), { now: D239_NOW });
  const buy = (name, acquiredAt, cents) => Item.create(wonSkin({
    name, acquisitionType: 'COMPRA', purchaseStoreId: csf, purchasePriceCents: cents, purchaseCurrency: 'USD', acquiredAt, status: 'EM_ESTOQUE',
  }), { now: D239_NOW });
  Deposit.create({ storeId: csf, amountStoreCents: 10000, amountBrlCents: null, depositedAt: '2026-11-10T12:00:00.000Z', note: null }, { now: D239_NOW });
  const a = sale('A', '2026-11-11T09:00:00.000Z', 2500);
  Deposit.create({ storeId: csf, amountStoreCents: 5000, amountBrlCents: null, depositedAt: '2026-11-12T12:00:00.000Z', note: null }, { now: D239_NOW });
  const y = buy('Y', '2026-11-13T12:00:00.000Z', 3000);
  const w = Withdrawal.create({ storeId: csf, amountStoreCents: 4000, feeCents: 100, amountBrlCents: null, withdrawnAt: '2026-11-15T12:00:00.000Z' }, { now: D239_NOW });
  const check = StoreBalance.create({
    kind: 'CHECK', storeId: csf, balanceCents: 7900, computedCents: 8000, adjustmentCents: -100, fxRate: null, note: 'taxa não registrada', recordedAt: '2026-11-16T12:00:00.000Z',
  }, { now: D239_NOW });
  const b = sale('B', '2026-11-20T18:00:00.000Z', 1500);
  return { csf, a, y, w, b, check };
}

describe('GET /api/store-balances/current: exemplo de D239 (sem saldo inicial)', () => {
  let ids;
  beforeEach(() => { freshDb(); app = makeApp(D239_NOW); ids = seedD239(); });

  test('CSFloat: disponível 10400, decomposição, pendente 1500 e última conferência há 6 dias', async () => {
    const csf = row(await current(), 'CSFloat');
    expect(csf).toMatchObject({
      saleHoldDays: 7, availableCents: 10400, availableUsdCents: 10400, availableApproxCents: 56494, allowsWithdrawal: true,
      estimated: false, negative: false, warningCode: null, daysSinceLastCheck: 6,
      breakdown: { depositsCents: 15000, purchasesCents: 3000, withdrawalsCents: 4000, salesReleasedCents: 2500, adjustmentsCents: -100 },
      pending: { cents: 1500, count: 1, nextReleaseAt: '2026-11-27T18:00:00.000Z', usdCents: 1500, approxCents: 8148, estimated: false },
      ignored: { legacyDeposits: 0, currencyMismatch: 0 },
      lastCheck: { id: ids.check.id, kind: 'CHECK', balanceCents: 7900, computedCents: 8000, differenceCents: -100, adjustmentCents: -100, legacy: false },
    });
    for (const gone of ['balance', 'initialBalance', 'releasedAfterBalance', 'outdated', 'outdatedReasons']) expect(csf).not.toHaveProperty(gone);
    expect(csf.breakdown).not.toHaveProperty('initialCents');
  });

  test('lojas sem registro (Steam, CSMoney): "nunca conferida" é nulo, sem aviso', async () => {
    const data = await current();
    for (const name of ['Steam', 'CSMoney']) {
      expect(row(data, name)).toMatchObject({ lastCheck: null, daysSinceLastCheck: null, availableCents: 0, warningCode: null });
    }
  });

  test('totais em US$ sem as chaves do "liberado após o registro"', async () => {
    const data = await current();
    expect(data.totals).toEqual({
      availableUsdCents: 10400,
      pendingUsdCents: 1500,
      nonWithdrawableUsdCents: 0,
      availableEstimated: false,
      pendingEstimated: false,
      nonWithdrawableEstimated: false,
      approxCurrency: 'BRL',
      approx: { available: 56494, pending: 8148, nonWithdrawable: 0 },
      nextReleaseAt: '2026-11-27T18:00:00.000Z',
      estimated: false,
    });
    expect(data.usdBrlRate).toBe(5.4321);
    expect(data.computedAt).toBe('2026-11-22T12:00:00.000Z');
  });

  test('/summary: parcelas do exemplo, sem os campos removidos e sem avisos', async () => {
    const data = (await get('/api/profit/summary')).body.data;
    expect(data).toMatchObject({ platformBalanceUsdCents: 10400, pendingBalanceUsdCents: 1500, nextReleaseAt: '2026-11-27T18:00:00.000Z' });
    expect(data).not.toHaveProperty('releasedAfterBalanceUsdCents');
    expect(data.counts).not.toHaveProperty('releasedAfterBalanceSales');
    expect(data.warnings).toEqual([]);
    expect(data.balancesByStore).toEqual((await current()).stores);
  });

  test('editar ou excluir compra, aporte e saque muda o /current na hora', async () => {
    expect(row(await current(), 'CSFloat').availableCents).toBe(10400);
    expect((await request(app).patch(`/api/items/${ids.y.id}`).send({ purchasePriceCents: 2000 })).status).toBe(200);
    expect(row(await current(), 'CSFloat').availableCents).toBe(11400);
    expect((await request(app).delete(`/api/items/${ids.y.id}`)).status).toBe(200);
    expect(row(await current(), 'CSFloat').availableCents).toBe(13400);
    expect((await request(app).delete(`/api/withdrawals/${ids.w.id}`)).status).toBe(200);
    expect(row(await current(), 'CSFloat').availableCents).toBe(17400);
    const deposit = getDb().prepare('SELECT id FROM deposits ORDER BY id DESC').get().id; // o aporte de 5000
    expect((await request(app).patch(`/api/deposits/${deposit}`).send({ amountStoreCents: 1000 })).status).toBe(200);
    expect(row(await current(), 'CSFloat').availableCents).toBe(13400);
  });

  test('unsell de uma venda pendente (B) sai do pendente na hora; de uma liberada (A) sai do disponível', async () => {
    expect((await request(app).post(`/api/items/${ids.b.id}/unsell`).send({})).status).toBe(200);
    expect(row(await current(), 'CSFloat').pending).toMatchObject({ cents: 0, count: 0, nextReleaseAt: null });
    expect((await request(app).post(`/api/items/${ids.a.id}/unsell`).send({})).status).toBe(200);
    expect(row(await current(), 'CSFloat').availableCents).toBe(7900);
  });

  test('trocar allowsWithdrawal da CSFloat muda só a soma "não sacável" (disponível + pendente)', async () => {
    getDb().prepare('UPDATE stores SET allows_withdrawal = 0 WHERE id = ?').run(ids.csf);
    const t = (await current()).totals;
    expect(t).toMatchObject({ availableUsdCents: 10400, pendingUsdCents: 1500, nonWithdrawableUsdCents: 10400 + 1500 });
  });

  test('loja inativa continua calculada e somada', async () => {
    const money = storeId('CSMoney');
    Deposit.create({ storeId: money, amountStoreCents: 700, amountBrlCents: null, depositedAt: '2026-11-01T12:00:00.000Z', note: null }, { now: D239_NOW });
    getDb().prepare('UPDATE stores SET is_active = 0 WHERE id = ?').run(money);
    expect(row(await current(), 'CSMoney')).toMatchObject({ isActive: false, availableCents: 700 });
  });

  test('sem cotação: loja USD segue exata, sem "≈ R$"; Steam (BRL) com saldo fica sem US$ e com FX_NOT_CONFIGURED', async () => {
    getDb().prepare('UPDATE fx_rates SET rate = NULL').run();
    Item.create(wonSkin({ name: 'steam', ...soldFields(storeId('Steam'), { soldAt: '2026-11-21T09:00:00.000Z', netReceivedCents: 4590, salePriceCents: 4590, saleCurrency: 'BRL', fxRateAtSale: 5.4321, saleHoldDaysApplied: 0 }) }), { now: D239_NOW });
    const data = await current();
    expect(row(data, 'CSFloat')).toMatchObject({ availableUsdCents: 10400, availableApproxCents: null, warningCode: null });
    expect(row(data, 'Steam')).toMatchObject({ availableUsdCents: null, availableApproxCents: 4590, warningCode: 'FX_NOT_CONFIGURED' });
    expect(data.totals.availableUsdCents).toBeNull();
    expect(data.usdBrlRate).toBeNull();
  });
});

describe('saldo negativo, histórico completo e legado', () => {
  beforeEach(() => { freshDb(); app = makeCatalogApp(); Setting.update({ usdBrlRate: 5 }, { now: NOW }); });

  test('compra que deixa o saldo negativo é aceita (201) e vira aviso COMPUTED_BALANCE_NEGATIVE (E8-Q20)', async () => {
    const res = await request(app).post('/api/items').send(purchaseBody({ purchasePriceCents: 5000 }));
    expect(res.status).toBe(201);
    const csf = row(await current(), 'CSFloat');
    expect(csf).toMatchObject({ availableCents: -5000, availableUsdCents: -5000, negative: true, warningCode: 'COMPUTED_BALANCE_NEGATIVE' });
    const summary = (await get('/api/profit/summary')).body.data;
    expect(summary.warnings).toContainEqual({
      source: 'STORE', storeId: storeId('CSFloat'), storeName: 'CSFloat', code: 'COMPUTED_BALANCE_NEGATIVE', text: expect.any(String),
    });
  });

  test('GANHEI com loja informativa não afeta o saldo; COMPRA afeta', async () => {
    const csf = storeId('CSFloat');
    Item.create(wonSkin({ name: 'g', purchaseStoreId: csf, acquiredAt: '2026-11-18T12:00:00.000Z' }), { now: NOW });
    expect(row(await current(), 'CSFloat').availableCents).toBe(0);
    Item.create(wonSkin({ name: 'c', acquisitionType: 'COMPRA', purchaseStoreId: csf, purchasePriceCents: 300, acquiredAt: '2026-11-18T12:00:00.000Z' }), { now: NOW });
    expect(row(await current(), 'CSFloat').availableCents).toBe(-300);
  });

  test('histórico completo: disponível = aportes + vendas liberadas − compras − saques, sem ajustes', async () => {
    const csf = storeId('CSFloat');
    Deposit.create({ storeId: csf, amountStoreCents: 10000, amountBrlCents: null, depositedAt: '2026-10-01T12:00:00.000Z', note: null }, { now: NOW });
    Item.create(wonSkin({ name: 'c', acquisitionType: 'COMPRA', purchaseStoreId: csf, purchasePriceCents: 4000, acquiredAt: '2026-10-02T12:00:00.000Z' }), { now: NOW });
    Item.create(wonSkin({ name: 's', ...soldFields(csf, { soldAt: '2026-10-20T12:00:00.000Z', netReceivedCents: 1500, saleHoldDaysApplied: 7 }) }), { now: NOW });
    Withdrawal.create({ storeId: csf, amountStoreCents: 2000, feeCents: null, amountBrlCents: null, withdrawnAt: '2026-11-01T12:00:00.000Z' }, { now: NOW });
    const csfRow = row(await current(), 'CSFloat');
    expect(csfRow.availableCents).toBe(10000 + 1500 - 4000 - 2000);
    expect(csfRow.breakdown.adjustmentsCents).toBe(0);
    expect(csfRow).toMatchObject({ lastCheck: null, warningCode: null });
    expect((await get('/api/profit/summary')).body.data.warnings).toEqual([]);
  });

  test('aporte legado fica fora do saldo da loja, é contado em ignored.legacyDeposits e continua no lucro real', async () => {
    const csf = storeId('CSFloat');
    Deposit.create({ storeId: csf, amountStoreCents: null, amountBrlCents: 5000, depositedAt: '2026-10-01T12:00:00.000Z', note: null }, { now: NOW });
    const csfRow = row(await current(), 'CSFloat');
    expect(csfRow).toMatchObject({ availableCents: 0, ignored: { legacyDeposits: 1 } });
    expect((await get('/api/profit/summary')).body.data.depositsUsdCents).toBe(1000);
  });
});

describe('rota do saldo inicial removida e loja com conferência em uso', () => {
  beforeEach(() => { freshDb(); app = makeApp(D239_NOW); });

  test('PUT /initial/:storeId -> 404 padrão (a rota não existe mais)', async () => {
    const res = await request(app).put(`/api/store-balances/initial/${storeId('CSFloat')}`).send({ balanceCents: 1, recordedAt: '2026-11-01T12:00:00.000Z' });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(rowCount()).toBe(0);
  });

  test('loja com conferência conta como em uso: STORE_IN_USE ao excluir e STORE_CURRENCY_LOCKED ao trocar a moeda', async () => {
    const money = storeId('CSMoney');
    expect((await post(checkBody({ storeId: money, balanceCents: 1 }))).status).toBe(201);
    expectError(await request(app).delete(`/api/stores/${money}`), 409, 'STORE_IN_USE');
    expectError(await request(app).patch(`/api/stores/${money}`).send({ currency: 'BRL' }), 409, 'STORE_CURRENCY_LOCKED', { field: 'currency' });
  });
});

describe('GET /check-preview e POST (conferência)', () => {
  let csf;
  beforeEach(() => {
    freshDb();
    app = makeApp(D239_NOW);
    ({ csf } = seedD239());
  });

  const previewQuery = (overrides = {}) => ({ storeId: csf, balanceCents: 7900, recordedAt: '2026-11-17T12:00:00.000Z', ...overrides });

  test('prévia: calculado e diferença na data, sem gravar nada', async () => {
    const before = rowCount();
    // em 11-17T12:00: aportes 15000 − compra 3000 − saque 4000 + ajuste −100 = 7900 (a venda A só libera em 11-18)
    const res = await preview(previewQuery());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      storeId: csf, currency: 'USD', recordedAt: '2026-11-17T12:00:00.000Z', balanceCents: 7900,
      computedCents: 7900, differenceCents: 0, differenceUsdCents: 0, differenceApproxCents: 0, approxCurrency: 'BRL', estimated: false,
    });
    expect(rowCount()).toBe(before);
    const diff = (await preview(previewQuery({ balanceCents: 7000 }))).body.data;
    expect(diff).toMatchObject({ computedCents: 7900, differenceCents: -900, differenceUsdCents: -900 });
  });

  test('prévia valida como o POST (sem a nota) e query inválida -> INVALID_QUERY / REQUIRED_FIELD', async () => {
    expectError(await preview(previewQuery({ recordedAt: '2026-11-25T12:00:00.000Z' })), 400, 'RECORDED_AT_IN_FUTURE', { field: 'recordedAt' });
    expectError(await preview(previewQuery({ recordedAt: '2026-11-15T12:00:00.000Z' })), 400, 'BALANCE_CHECK_BEFORE_LAST', { field: 'recordedAt' });
    expectError(await preview(previewQuery({ balanceCents: -5 })), 400, 'INVALID_AMOUNT', { field: 'balanceCents' });
    expectError(await preview(previewQuery({ storeId: 9999 })), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    expectError(await preview(previewQuery({ storeId: 'x' })), 400, 'INVALID_QUERY', { field: 'storeId' });
    expectError(await preview(previewQuery({ balanceCents: '1.5' })), 400, 'INVALID_QUERY', { field: 'balanceCents' });
    expectError(await preview({ storeId: csf, balanceCents: 1 }), 400, 'REQUIRED_FIELD', { field: 'recordedAt' });
    expectError(await preview(previewQuery({ extra: 1 })), 400, 'INVALID_QUERY', { field: 'extra' });
  });

  test('POST sem ajuste: grava o calculado (snapshot) e a diferença, sem mexer no disponível', async () => {
    const res = await post(checkBody({ storeId: csf, balanceCents: 7000, recordedAt: '2026-11-17T12:00:00.000Z' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      kind: 'CHECK', balanceCents: 7000, computedCents: 7900, differenceCents: -900, adjustmentCents: null, legacy: false, storeName: 'CSFloat',
    });
    expect(row(await current(), 'CSFloat')).toMatchObject({ availableCents: 10400, daysSinceLastCheck: 5 });
  });

  test('POST com ajuste: ajuste = real − calculado entra no disponível; a nota é obrigatória (só espaços não vale)', async () => {
    const body = checkBody({ storeId: csf, balanceCents: 7000, recordedAt: '2026-11-17T12:00:00.000Z', adjust: true });
    expectError(await post(body), 400, 'ADJUSTMENT_NOTE_REQUIRED', { field: 'note' });
    expectError(await post({ ...body, note: '   ' }), 400, 'ADJUSTMENT_NOTE_REQUIRED', { field: 'note' });
    expect(rowCount()).toBe(1);
    const ok = await post({ ...body, note: ' taxa ' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ adjustmentCents: -900, note: 'taxa' });
    expect(row(await current(), 'CSFloat').availableCents).toBe(10400 - 900);
  });

  test('diferença 0 com adjust: true e sem nota -> 201 sem ajuste', async () => {
    const res = await post(checkBody({ storeId: csf, balanceCents: 7900, recordedAt: '2026-11-17T12:00:00.000Z', adjust: true }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ differenceCents: 0, adjustmentCents: null, note: null });
  });

  test('o POST recalcula mesmo que a prévia esteja velha (um aporte novo entra entre as chamadas)', async () => {
    const q = previewQuery({ balanceCents: 7900 });
    expect((await preview(q)).body.data.computedCents).toBe(7900);
    Deposit.create({ storeId: csf, amountStoreCents: 100, amountBrlCents: null, depositedAt: '2026-11-16T18:00:00.000Z', note: null }, { now: D239_NOW });
    const res = await post(checkBody({ ...q, storeId: csf, adjust: true, note: 'x' }));
    expect(res.body.data).toMatchObject({ computedCents: 8000, differenceCents: -100, adjustmentCents: -100 });
  });

  test('datas: antes da última conferência com cálculo recusada; igual à última aceita', async () => {
    expectError(await post(checkBody({ storeId: csf, recordedAt: '2026-11-15T12:00:00.000Z' })), 400, 'BALANCE_CHECK_BEFORE_LAST', { field: 'recordedAt' });
    expect((await post(checkBody({ storeId: csf, recordedAt: '2026-11-16T12:00:00.000Z' }))).status).toBe(201);
  });

  test('DELETE de conferência: o ajuste some do disponível; excluir a mais recente libera a data anterior', async () => {
    const adj = (await post(checkBody({ storeId: csf, balanceCents: 7000, recordedAt: '2026-11-17T12:00:00.000Z', adjust: true, note: 'n' }))).body.data;
    expect(row(await current(), 'CSFloat').availableCents).toBe(9500);
    await request(app).delete(`/api/store-balances/${adj.id}`).expect(200);
    expect(row(await current(), 'CSFloat').availableCents).toBe(10400);
    expect((await post(checkBody({ storeId: csf, recordedAt: '2026-11-16T13:00:00.000Z' }))).status).toBe(201);
  });
});

describe('POST /api/store-balances (forma e segurança)', () => {
  beforeEach(() => { freshDb(); app = makeApp(); });

  test('cria (201); loja BRL grava fx_rate das configurações; saldo 0 aceito; recordedAt normalizado para UTC', async () => {
    Setting.update({ usdBrlRate: 5.4321 }, { now: NOW });
    const res = await post(checkBody());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      kind: 'CHECK', storeId: storeId('CSFloat'), storeName: 'CSFloat', currency: 'USD', balanceCents: 12346, computedCents: 0,
      recordedAt: '2026-11-18T12:00:00.000Z', createdAt: NOW.toISOString(),
    });
    const steam = await post(checkBody({ storeId: storeId('Steam'), balanceCents: 0, recordedAt: '2026-11-18T09:00:00-03:00' }));
    expect(steam.body.data).toMatchObject({ balanceCents: 0, recordedAt: '2026-11-18T12:00:00.000Z' });
    expect(getDb().prepare('SELECT fx_rate FROM store_balances WHERE id = ?').get(steam.body.data.id).fx_rate).toBe(5.4321);
  });

  test('recordedAt no futuro -> RECORDED_AT_IN_FUTURE; até o fim de hoje em Brasília passa', async () => {
    expectError(await post(checkBody({ recordedAt: '2026-11-25T12:00:00.000Z' })), 400, 'RECORDED_AT_IN_FUTURE', { field: 'recordedAt' });
    // NOW = 19/11 12:00 BRT; 20/11 02:00Z = 19/11 23:00 BRT (ainda hoje)
    expect((await post(checkBody({ recordedAt: '2026-11-20T02:00:00.000Z' }))).status).toBe(201);
    expectError(await post(checkBody({ recordedAt: '2026-11-20T03:00:00.000Z' })), 400, 'RECORDED_AT_IN_FUTURE', { field: 'recordedAt' });
  });

  test('storeId inexistente -> STORE_NOT_FOUND; valores e tipos inválidos; campos ausentes e desconhecidos', async () => {
    for (const id of [9999, 0, -1, 2 ** 40]) expectError(await post(checkBody({ storeId: id })), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    expectError(await post(checkBody({ balanceCents: -1 })), 400, 'INVALID_AMOUNT', { field: 'balanceCents' });
    expectError(await post(checkBody({ balanceCents: 10 ** 15 })), 400, 'INVALID_AMOUNT', { field: 'balanceCents' });
    for (const v of [1.5, '100']) expectError(await post(checkBody({ balanceCents: v })), 400, 'INVALID_FIELD', { field: 'balanceCents' });
    expectError(await post(checkBody({ storeId: '1' })), 400, 'INVALID_FIELD', { field: 'storeId' });
    expectError(await post(checkBody({ adjust: 'sim' })), 400, 'INVALID_FIELD', { field: 'adjust' });
    expectError(await post(checkBody({ note: 5 })), 400, 'INVALID_FIELD', { field: 'note' });
    expectError(await post(checkBody({ recordedAt: 5 })), 400, 'INVALID_FIELD', { field: 'recordedAt' });
    expectError(await post(checkBody({ recordedAt: 'ontem' })), 400, 'INVALID_DATE', { field: 'recordedAt' });
    expectError(await post(checkBody({ note: 'a'.repeat(501) })), 400, 'FIELD_TOO_LONG', { field: 'note' });
    for (const key of ['storeId', 'balanceCents', 'recordedAt']) {
      const body = checkBody();
      delete body[key];
      expectError(await post(body), 400, 'REQUIRED_FIELD', { field: key });
    }
    expectError(await post(checkBody({ fxRate: 5 })), 400, 'UNKNOWN_FIELD', { field: 'fxRate' });
    expectError(await post(checkBody({ kind: 'INITIAL' })), 400, 'UNKNOWN_FIELD', { field: 'kind' });
    expectError(await request(app).post('/api/store-balances').send([1]), 400, 'INVALID_BODY');
    expect(rowCount()).toBe(0);
  });

  test('sem Content-Type JSON -> 415; Host estranho -> 403', async () => {
    expectError(await request(app).post('/api/store-balances').set('Content-Type', 'text/plain').send('x'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).post('/api/store-balances'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).post('/api/store-balances').set('Host', 'evil.example').send(checkBody()), 403, 'FORBIDDEN_HOST');
    expectError(await get('/api/store-balances/current').set('Host', 'evil.example'), 403, 'FORBIDDEN_HOST');
    expectError(await get('/api/store-balances/check-preview?storeId=1&balanceCents=1&recordedAt=x').set('Host', 'evil.example'), 403, 'FORBIDDEN_HOST');
    expect((await get('/api/store-balances')).body.data.balances).toEqual([]);
  });
});

describe('GET /api/store-balances (histórico) e DELETE', () => {
  beforeEach(() => { freshDb(); app = makeApp(); });

  test('histórico por loja: mais recente primeiro, desempate pelo maior id; sem filtro traz todas as lojas', async () => {
    const csf = storeId('CSFloat');
    const a = (await post(checkBody({ balanceCents: 1, recordedAt: '2026-11-10T12:00:00.000Z' }))).body.data;
    const b = (await post(checkBody({ balanceCents: 2, recordedAt: '2026-11-12T12:00:00.000Z' }))).body.data;
    const c = (await post(checkBody({ balanceCents: 3, recordedAt: '2026-11-12T12:00:00.000Z' }))).body.data;
    await post(checkBody({ storeId: storeId('Steam'), balanceCents: 9 }));
    const hist = (await get(`/api/store-balances?storeId=${csf}`)).body.data.balances;
    expect(hist.map((x) => x.id)).toEqual([c.id, b.id, a.id]);
    expect((await get('/api/store-balances')).body.data.balances).toHaveLength(4);
  });

  test('registro antigo (migrado) vem com legacy true e sem diferença', async () => {
    getDb().prepare("INSERT INTO store_balances (store_id, kind, balance_cents, recorded_at, created_at) VALUES (?, 'CHECK', 50, '2026-11-01T00:00:00.000Z', 'x')").run(storeId('CSFloat'));
    const [entry] = (await get('/api/store-balances')).body.data.balances;
    expect(entry).toMatchObject({ kind: 'CHECK', legacy: true, computedCents: null, differenceCents: null, adjustmentCents: null });
  });

  test('?storeId= inexistente -> STORE_NOT_FOUND; inválido -> INVALID_QUERY', async () => {
    expectError(await get('/api/store-balances?storeId=9999'), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    for (const v of ['abc', '0', '-1', '1.5', '1e2', '']) {
      expectError(await get(`/api/store-balances?storeId=${v}`), 400, 'INVALID_QUERY', { field: 'storeId' });
    }
  });

  test('DELETE: 200 { id }; inexistente -> 404 STORE_BALANCE_NOT_FOUND; id inválido -> 400 INVALID_ID; sem Content-Type ok', async () => {
    const { id } = (await post(checkBody())).body.data;
    expect(await request(app).delete(`/api/store-balances/${id}`)).toMatchObject({ status: 200, body: { success: true, data: { id } } });
    expectError(await request(app).delete(`/api/store-balances/${id}`), 404, 'STORE_BALANCE_NOT_FOUND');
    for (const v of ['abc', '0', '-3', '1.5']) expectError(await request(app).delete(`/api/store-balances/${v}`), 400, 'INVALID_ID');
  });

  test('rota inexistente de saldos -> 404 padrão', async () => {
    const res = await get('/api/store-balances/xyz');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('bordas de datas pela API', () => {
  const clock = (iso) => { freshDb(); app = makeApp(new Date(iso)); };
  const soldCsf = (soldAt, net, days) =>
    Item.create(wonSkin({ ...soldFields(storeId('CSFloat'), { soldAt, netReceivedCents: net, saleHoldDaysApplied: days }) }), { now: NOW });

  test('now == liberação: a venda já está no disponível; 1 ms antes: pendente', async () => {
    clock('2026-11-17T12:00:00.000Z');
    soldCsf('2026-11-10T12:00:00.000Z', 100, 7); // libera 2026-11-17T12:00:00.000Z
    expect(row(await current(), 'CSFloat')).toMatchObject({ availableCents: 100, pending: { count: 0 } });
    clock('2026-11-17T11:59:59.999Z');
    soldCsf('2026-11-10T12:00:00.000Z', 100, 7);
    expect(row(await current(), 'CSFloat')).toMatchObject({ availableCents: 0, pending: { count: 1, cents: 100 } });
  });

  test('uma venda feita há muito tempo conta no saldo (sem corte por data)', async () => {
    clock('2026-11-20T12:00:00.000Z');
    soldCsf('2020-11-10T12:00:00.000Z', 100, 7);
    expect(row(await current(), 'CSFloat').availableCents).toBe(100);
  });

  test('retenção 0 e snapshot nulo (venda antiga) são liberados na hora da venda', async () => {
    clock('2026-11-21T12:00:00.000Z');
    soldCsf('2026-11-20T12:00:00.000Z', 100, 0);
    soldCsf('2026-11-20T12:00:00.000Z', 200, null);
    expect(row(await current(), 'CSFloat')).toMatchObject({ availableCents: 300, pending: { count: 0 } });
  });
});

describe('saleRelease no item (D214, D216) e snapshot da loja', () => {
  beforeEach(() => { freshDb(); app = makeCatalogApp(); });

  const sell = (id, body) => request(app).post(`/api/items/${id}/sell`).send(body);

  test('item em estoque: saleRelease null', async () => {
    const item = await createItemViaApi(app);
    expect(item.saleRelease).toBeNull();
    expect((await get(`/api/items/${item.id}`)).body.data.saleRelease).toBeNull();
  });

  test('CSFloat (7 dias): releasesAt = soldAt + 7 dias, isHeld; sale traz saleHoldDaysApplied', async () => {
    const item = await createItemViaApi(app);
    const res = await sell(item.id, { saleStoreId: storeId('CSFloat'), salePriceCents: 2552, soldAt: '2026-11-18T18:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.data.item).toMatchObject({ saleHoldDaysApplied: 7, saleRelease: { releasesAt: '2026-11-25T18:00:00.000Z', isHeld: true } });
    expect(res.body.data.sale.saleHoldDaysApplied).toBe(7);
  });

  test('venda já liberada (soldAt há mais de 7 dias): isHeld false, releasesAt calculado', async () => {
    const item = await createItemViaApi(app);
    const res = await sell(item.id, { saleStoreId: storeId('CSFloat'), salePriceCents: 2000, soldAt: '2026-11-10T12:00:00.000Z' });
    expect(res.body.data.item.saleRelease).toEqual({ releasesAt: '2026-11-17T12:00:00.000Z', isHeld: false });
  });

  test('Steam (retenção 0): releasesAt = soldAt e liberada, snapshot 0 (não nulo)', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    const item = await createItemViaApi(app, purchaseBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 500 }));
    const res = await sell(item.id, { saleStoreId: storeId('Steam'), salePriceCents: 1000, soldAt: '2026-11-18T18:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.data.item).toMatchObject({ saleHoldDaysApplied: 0, saleRelease: { releasesAt: '2026-11-18T18:00:00.000Z', isHeld: false } });
  });

  test('mudar a retenção da loja depois não altera vendas já gravadas; a nova venda usa o valor novo', async () => {
    const a = await createItemViaApi(app);
    await sell(a.id, { saleStoreId: storeId('CSFloat'), salePriceCents: 2000, soldAt: '2026-11-18T18:00:00.000Z' });
    expect((await request(app).patch(`/api/stores/${storeId('CSFloat')}`).send({ saleHoldDays: 3 })).status).toBe(200);
    const old = (await get(`/api/items/${a.id}`)).body.data;
    expect(old).toMatchObject({ saleHoldDaysApplied: 7, saleRelease: { releasesAt: '2026-11-25T18:00:00.000Z' } });
    const b = await createItemViaApi(app);
    const res = await sell(b.id, { saleStoreId: storeId('CSFloat'), salePriceCents: 2000, soldAt: '2026-11-18T18:00:00.000Z' });
    expect(res.body.data.item).toMatchObject({ saleHoldDaysApplied: 3, saleRelease: { releasesAt: '2026-11-21T18:00:00.000Z' } });
  });

  test('venda anterior à v6 (snapshot nulo): saleRelease { releasesAt: null, isHeld: false }', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id, { saleStoreId: storeId('CSFloat'), salePriceCents: 2000, soldAt: '2026-11-18T18:00:00.000Z' });
    getDb().prepare('UPDATE items SET sale_hold_days_applied = NULL WHERE id = ?').run(item.id);
    expect((await get(`/api/items/${item.id}`)).body.data).toMatchObject({ saleHoldDaysApplied: null, saleRelease: { releasesAt: null, isHeld: false } });
  });

  test('unsell: snapshot nulo e saleRelease null; vender de novo grava a retenção atual', async () => {
    const item = await createItemViaApi(app);
    await sell(item.id, { saleStoreId: storeId('CSFloat'), salePriceCents: 2000, soldAt: '2026-11-18T18:00:00.000Z' });
    const un = await request(app).post(`/api/items/${item.id}/unsell`).send({});
    expect(un.body.data).toMatchObject({ saleHoldDaysApplied: null, saleRelease: null });
    await request(app).patch(`/api/stores/${storeId('CSFloat')}`).send({ saleHoldDays: 1 });
    const again = await sell(item.id, { saleStoreId: storeId('CSFloat'), salePriceCents: 2000, soldAt: '2026-11-15T18:00:00.000Z' });
    expect(again.body.data.item).toMatchObject({ saleHoldDaysApplied: 1, saleRelease: { releasesAt: '2026-11-16T18:00:00.000Z', isHeld: false } });
  });

  test('a listagem de itens traz saleRelease (null no estoque, objeto na venda)', async () => {
    const stock = await createItemViaApi(app);
    const sold = await createItemViaApi(app);
    await sell(sold.id, { saleStoreId: storeId('CSFloat'), salePriceCents: 2000, soldAt: '2026-11-18T18:00:00.000Z' });
    const items = (await get('/api/items')).body.data.items;
    expect(items.find((i) => i.id === stock.id).saleRelease).toBeNull();
    expect(items.find((i) => i.id === sold.id).saleRelease).toMatchObject({ isHeld: true });
  });
});
