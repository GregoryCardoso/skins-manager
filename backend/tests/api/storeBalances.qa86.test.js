// QA 8.6 (D250, Revisão 23): lacunas de API do saldo calculado das lojas (sem saldo inicial). Banco :memory: novo a cada teste, relógio fixo.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Item = require('../../src/models/Item');
const Deposit = require('../../src/models/Deposit');
const Withdrawal = require('../../src/models/Withdrawal');
const Setting = require('../../src/models/Setting');
const { freshDb, wonSkin, soldFields } = require('../helpers/fixtures');
const { makeApp, makeCatalogApp, storeId, expectError, purchaseBody, NOW } = require('../helpers/apiFixtures');

let app;
afterAll(() => closeDb());

const get = (url) => request(app).get(url);
const post = (body) => request(app).post('/api/store-balances').send(body);
const del = (id) => request(app).delete(`/api/store-balances/${id}`);
const preview = (query) => get(`/api/store-balances/check-preview?${new URLSearchParams(query).toString()}`);
const current = async () => (await get('/api/store-balances/current')).body.data;
const row = (data, name) => data.stores.find((s) => s.storeName === name);
const summary = async () => (await get('/api/profit/summary')).body.data;
const rowCount = () => getDb().prepare('SELECT COUNT(*) AS n FROM store_balances').get().n;
const csf = () => storeId('CSFloat');

const dep = (storeIdValue, cents, depositedAt) => Deposit.create({ storeId: storeIdValue, amountStoreCents: cents, amountBrlCents: null, depositedAt, note: null }, { now: NOW });
const wd = (storeIdValue, cents, fee, withdrawnAt) => Withdrawal.create({ storeId: storeIdValue, amountStoreCents: cents, feeCents: fee, amountBrlCents: null, withdrawnAt }, { now: NOW });
const buy = (name, store, cents, acquiredAt, extra = {}) => Item.create(wonSkin({
  name, acquisitionType: 'COMPRA', purchaseStoreId: store, purchasePriceCents: cents, purchaseCurrency: 'USD', acquiredAt, status: 'EM_ESTOQUE', ...extra,
}), { now: NOW });
const sold = (name, store, soldAt, net, days, extra = {}) => Item.create(wonSkin({
  name, ...soldFields(store, { soldAt, netReceivedCents: net, salePriceCents: net, saleHoldDaysApplied: days }), ...extra,
}), { now: NOW });

describe('sem corte por data: aporte é sempre aporte (D252, D245)', () => {
  beforeEach(() => { freshDb(); app = makeApp(NOW); Setting.update({ usdBrlRate: 5 }, { now: NOW }); });

  test('todo aporte e todo saque, de qualquer data, contam no saldo da loja e no lucro real', async () => {
    const store = csf();
    dep(store, 20000, '2026-11-01T12:00:00.000Z');
    dep(store, 3000, '2026-11-12T12:00:00.000Z');
    wd(store, 5000, 100, '2026-11-02T12:00:00.000Z'); // líquido 4900
    wd(store, 2000, 0, '2026-11-14T12:00:00.000Z');
    const csfRow = row(await current(), 'CSFloat');
    expect(csfRow.breakdown).toEqual({ depositsCents: 23000, purchasesCents: 0, withdrawalsCents: 7000, salesReleasedCents: 0, adjustmentsCents: 0 });
    expect(csfRow.availableCents).toBe(16000);
    const s = await summary();
    expect(s.depositsUsdCents).toBe(23000);
    expect(s.withdrawalsNetUsdCents).toBe(6900);
    expect(s.platformBalanceUsdCents).toBe(16000);
    expect(s.realProfitUsdCents).toBe(6900 + 16000 - 23000);
  });

  test('a rota do saldo inicial não existe mais (404 padrão) e nada é gravado', async () => {
    const res = await request(app).put(`/api/store-balances/initial/${csf()}`).send({ balanceCents: 1, recordedAt: '2026-11-01T12:00:00.000Z' });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(rowCount()).toBe(0);
    const data = await current();
    for (const store of data.stores) {
      expect(store).not.toHaveProperty('initialBalance');
      expect(store.breakdown).not.toHaveProperty('initialCents');
    }
  });

  test('aporte de US$ 10,20 e compra de US$ 5,20: saldo 500, total colocado 1020, estoque 520 e lucro real 0 (API)', async () => {
    app = makeCatalogApp(NOW);
    const store = csf();
    const dep1 = await request(app).post('/api/deposits').send({ storeId: store, amountStoreCents: 1020, depositedAt: '2026-11-18T12:00:00.000Z' });
    expect(dep1.status).toBe(201);
    const item = await request(app).post('/api/items').send(purchaseBody({ purchasePriceCents: 520, acquiredAt: '2026-11-18T13:00:00.000Z' }));
    expect(item.status).toBe(201);
    const csfRow = row(await current(), 'CSFloat');
    expect(csfRow).toMatchObject({ availableCents: 500, breakdown: { depositsCents: 1020, purchasesCents: 520 }, warningCode: null });
    const s = await summary();
    expect(s).toMatchObject({ depositsUsdCents: 1020, platformBalanceUsdCents: 500, stockUsdCents: 520, realProfitUsdCents: 0, estimated: false });
    expect(s.warnings).toEqual([]);
  });

  test('a primeira POST /api/deposits numa loja sem registros aparece só em aportes (nunca como outro registro)', async () => {
    app = makeCatalogApp(NOW);
    expect(rowCount()).toBe(0);
    const res = await request(app).post('/api/deposits').send({ storeId: csf(), amountStoreCents: 1000, depositedAt: '2026-11-18T12:00:00.000Z' });
    expect(res.status).toBe(201);
    const list = (await get('/api/deposits')).body.data;
    expect(list.deposits).toHaveLength(1);
    expect(list.totals.amountUsdCents).toBe(1000);
    expect((await summary()).depositsUsdCents).toBe(1000);
    expect(rowCount()).toBe(0);
    expect((await get('/api/store-balances')).body.data.balances).toEqual([]);
  });
});

describe('vendas antigas e pendentes; lojas de compra e venda diferentes', () => {
  beforeEach(() => { freshDb(); });

  test('a venda fica pendente e passa ao disponível quando libera, uma vez só (mesmo banco, relógios diferentes)', async () => {
    const store = csf();
    sold('v', store, '2026-11-08T12:00:00.000Z', 700, 7); // libera 11-15T12:00Z
    app = makeApp(new Date('2026-11-14T12:00:00.000Z'));
    expect(row(await current(), 'CSFloat')).toMatchObject({ availableCents: 0, pending: { cents: 700, count: 1, nextReleaseAt: '2026-11-15T12:00:00.000Z' } });
    app = makeApp(new Date('2026-11-15T12:00:00.000Z'));
    expect(row(await current(), 'CSFloat')).toMatchObject({ availableCents: 700, pending: { cents: 0, count: 0, nextReleaseAt: null } });
    app = makeApp(new Date('2026-12-30T12:00:00.000Z'));
    expect(row(await current(), 'CSFloat').availableCents).toBe(700);
  });

  test('no lucro real a venda pendente conta no pendente e depois no saldo, sem duplicar', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: NOW });
    sold('v', csf(), '2026-11-08T12:00:00.000Z', 700, 7);
    app = makeApp(new Date('2026-11-14T12:00:00.000Z'));
    let s = await summary();
    expect([s.platformBalanceUsdCents, s.pendingBalanceUsdCents, s.realProfitUsdCents]).toEqual([0, 700, 700]);
    app = makeApp(new Date('2026-11-16T12:00:00.000Z'));
    s = await summary();
    expect([s.platformBalanceUsdCents, s.pendingBalanceUsdCents, s.realProfitUsdCents]).toEqual([700, 0, 700]);
  });

  test('compra no CSMoney e venda na CSFloat: cada loja vê só o seu lado; o item em estoque só desconta a de compra', async () => {
    app = makeApp(NOW);
    const money = storeId('CSMoney');
    buy('x', money, 4000, '2026-11-02T12:00:00.000Z', {
      ...soldFields(csf(), { soldAt: '2026-11-03T12:00:00.000Z', netReceivedCents: 6000, salePriceCents: 6000, saleHoldDaysApplied: 7 }),
    });
    buy('y', money, 500, '2026-11-04T12:00:00.000Z');
    const data = await current();
    expect(row(data, 'CSMoney')).toMatchObject({ availableCents: -4500, breakdown: { purchasesCents: 4500, salesReleasedCents: 0 }, warningCode: 'COMPUTED_BALANCE_NEGATIVE' });
    expect(row(data, 'CSFloat')).toMatchObject({ availableCents: 6000, breakdown: { purchasesCents: 0, salesReleasedCents: 6000 } });
  });

  test('item vendido (desfeito depois): a compra continua descontando e o líquido sai da venda', async () => {
    app = makeCatalogApp(NOW);
    const create = await request(app).post('/api/items').send(purchaseBody({ purchasePriceCents: 1000, acquiredAt: '2026-11-01T12:00:00.000Z' }));
    expect(create.status).toBe(201);
    const id = create.body.data.id;
    const sell = await request(app).post(`/api/items/${id}/sell`).send({ saleStoreId: csf(), salePriceCents: 2000, soldAt: '2026-11-02T12:00:00.000Z' });
    expect(sell.status).toBe(200);
    const net = sell.body.data.sale.netReceivedCents;
    expect(row(await current(), 'CSFloat').availableCents).toBe(net - 1000);
    expect((await request(app).post(`/api/items/${id}/unsell`).send({})).status).toBe(200);
    expect(row(await current(), 'CSFloat').availableCents).toBe(-1000);
  });

  test('GANHEI vendido: o líquido entra, nada sai por ele', async () => {
    app = makeApp(NOW);
    sold('g', csf(), '2026-11-01T12:00:00.000Z', 900, 0, { purchaseStoreId: csf(), purchasePriceCents: 0 });
    expect(row(await current(), 'CSFloat')).toMatchObject({ availableCents: 900, breakdown: { purchasesCents: 0 } });
  });
});

describe('saldo negativo: nada é recusado (E8-Q20)', () => {
  beforeEach(() => { freshDb(); app = makeCatalogApp(NOW); Setting.update({ usdBrlRate: 5 }, { now: NOW }); });

  test('saque maior que o saldo e compra maior que o saldo são aceitos (201) e o saldo fica negativo', async () => {
    const res = await request(app).post('/api/withdrawals').send({
      storeId: csf(), amountStoreCents: 9000, feeCents: 0, amountBrlCents: 40000, withdrawnAt: '2026-11-10T12:00:00.000Z',
    });
    expect(res.status).toBe(201);
    const item = await request(app).post('/api/items').send(purchaseBody({ purchasePriceCents: 1000 }));
    expect(item.status).toBe(201);
    const csfRow = row(await current(), 'CSFloat');
    expect(csfRow).toMatchObject({ availableCents: -10000, negative: true, availableUsdCents: -10000, warningCode: 'COMPUTED_BALANCE_NEGATIVE' });
    const s = await summary();
    expect(s.platformBalanceUsdCents).toBe(-10000);
    expect(s.warnings.filter((w) => w.code === 'COMPUTED_BALANCE_NEGATIVE')).toHaveLength(1);
  });

  test('o lucro real com saldo negativo soma o negativo (saque + saldo + estoque − aportes)', async () => {
    dep(csf(), 5000, '2026-11-01T12:00:00.000Z');
    wd(csf(), 9000, 0, '2026-11-10T12:00:00.000Z');
    const s = await summary();
    expect(s.platformBalanceUsdCents).toBe(-4000);
    expect(s.realProfitUsdCents).toBe(9000 - 4000 - 5000);
  });

  test('conferência com calculado negativo: prévia e POST aceitam e a diferença usa o negativo', async () => {
    buy('x', csf(), 3000, '2026-11-10T12:00:00.000Z');
    const q = { storeId: csf(), balanceCents: 0, recordedAt: '2026-11-15T12:00:00.000Z' };
    expect((await preview(q)).body.data).toMatchObject({ computedCents: -3000, differenceCents: 3000 });
    const res = await post({ ...q, adjust: true, note: 'zerar' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ computedCents: -3000, adjustmentCents: 3000 });
    expect(row(await current(), 'CSFloat').availableCents).toBe(0);
  });
});

describe('conferência: datas passadas, ordem dos erros e nota só com espaços', () => {
  beforeEach(() => { freshDb(); app = makeApp(NOW); Setting.update({ usdBrlRate: 5 }, { now: NOW }); });

  test('o calculado vale na data da conferência: movimentações posteriores a ela não entram', async () => {
    const store = csf();
    dep(store, 5000, '2026-11-05T12:00:00.000Z');
    dep(store, 7000, '2026-11-12T12:00:00.000Z');
    const res = await post({ storeId: store, balanceCents: 5000, recordedAt: '2026-11-10T12:00:00.000Z' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ computedCents: 5000, differenceCents: 0, adjustmentCents: null });
    expect(row(await current(), 'CSFloat').availableCents).toBe(12000);
  });

  test('várias violações juntas: vale a primeira da ordem (valor, data futura, antes da última, nota)', async () => {
    const store = csf();
    await post({ storeId: store, balanceCents: 0, recordedAt: '2026-11-15T12:00:00.000Z' });
    const body = (over) => ({ storeId: store, balanceCents: 5000, recordedAt: '2026-11-16T12:00:00.000Z', adjust: true, note: '   ', ...over });
    expectError(await post(body({ balanceCents: -1, recordedAt: '2030-01-01T00:00:00.000Z' })), 400, 'INVALID_AMOUNT', { field: 'balanceCents' });
    expectError(await post(body({ recordedAt: '2030-01-01T00:00:00.000Z' })), 400, 'RECORDED_AT_IN_FUTURE', { field: 'recordedAt' });
    expectError(await post(body({ recordedAt: '2026-11-12T00:00:00.000Z' })), 400, 'BALANCE_CHECK_BEFORE_LAST', { field: 'recordedAt' });
    expectError(await post(body({})), 400, 'ADJUSTMENT_NOTE_REQUIRED', { field: 'note' });
    expectError(await post(body({ note: 'a'.repeat(3000) })), 400, 'FIELD_TOO_LONG', { field: 'note' });
    expectError(await post(body({ storeId: 999 })), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    expect(rowCount()).toBe(1); // nada foi gravado pelas recusas
  });

  test('nota só com espaços: sem ajuste grava nota nula', async () => {
    const store = csf();
    const check = await post({ storeId: store, balanceCents: 50, recordedAt: '2026-11-05T12:00:00.000Z', note: '   \t ' });
    expect(check.status).toBe(201);
    expect(check.body.data).toMatchObject({ note: null, adjustmentCents: null, differenceCents: 50 });
  });

  test('a nota com ajuste é gravada aparada', async () => {
    const res = await post({ storeId: csf(), balanceCents: 50, recordedAt: '2026-11-05T12:00:00.000Z', adjust: true, note: '  taxa  ' });
    expect(res.body.data).toMatchObject({ note: 'taxa', adjustmentCents: 50 });
  });

  test('adjust com tipo errado -> INVALID_FIELD; note não texto -> INVALID_FIELD; nada gravado', async () => {
    const base = { storeId: csf(), balanceCents: 1, recordedAt: '2026-11-05T12:00:00.000Z' };
    expectError(await post({ ...base, adjust: 'true' }), 400, 'INVALID_FIELD', { field: 'adjust' });
    expectError(await post({ ...base, adjust: 1 }), 400, 'INVALID_FIELD', { field: 'adjust' });
    expectError(await post({ ...base, note: 5 }), 400, 'INVALID_FIELD', { field: 'note' });
    expect(rowCount()).toBe(0);
  });

  test('a prévia ignora a nota e o adjust: nunca grava e devolve a mesma diferença', async () => {
    const q = { storeId: csf(), balanceCents: 700, recordedAt: '2026-11-05T12:00:00.000Z' };
    const a = await preview(q);
    expect(a.body.data).toMatchObject({ computedCents: 0, differenceCents: 700, currency: 'USD', differenceUsdCents: 700 });
    expect(rowCount()).toBe(0);
    expectError(await preview({ ...q, note: 'x' }), 400, 'INVALID_QUERY', { field: 'note' });
  });

  test('prévia: ordem dos erros igual à do POST (sem nota) e parâmetros duplicados -> INVALID_QUERY', async () => {
    const store = csf();
    await post({ storeId: store, balanceCents: 0, recordedAt: '2026-11-10T12:00:00.000Z' });
    expectError(await preview({ storeId: store, balanceCents: 1, recordedAt: '2026-11-01T00:00:00.000Z' }), 400, 'BALANCE_CHECK_BEFORE_LAST', { field: 'recordedAt' });
    expectError(await preview({ storeId: store, balanceCents: -5, recordedAt: '2026-11-01T00:00:00.000Z' }), 400, 'INVALID_AMOUNT', { field: 'balanceCents' });
    expectError(await preview({ storeId: store, balanceCents: 1, recordedAt: '2030-01-01T00:00:00.000Z' }), 400, 'RECORDED_AT_IN_FUTURE', { field: 'recordedAt' });
    expectError(await preview({ storeId: 999, balanceCents: 1, recordedAt: '2026-11-15T00:00:00.000Z' }), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    expectError(await get(`/api/store-balances/check-preview?storeId=${store}&storeId=2&balanceCents=1&recordedAt=2026-11-15T00:00:00.000Z`), 400, 'INVALID_QUERY');
    expectError(await get('/api/store-balances/check-preview'), 400, 'REQUIRED_FIELD', { field: 'storeId' });
    expectError(await get(`/api/store-balances/check-preview?storeId=${store}&balanceCents=1`), 400, 'REQUIRED_FIELD', { field: 'recordedAt' });
    expectError(await preview({ storeId: store, balanceCents: '1.5', recordedAt: '2026-11-15T00:00:00.000Z' }), 400, 'INVALID_QUERY', { field: 'balanceCents' });
    expectError(await preview({ storeId: 0, balanceCents: 1, recordedAt: '2026-11-15T00:00:00.000Z' }), 400, 'INVALID_QUERY', { field: 'storeId' });
  });

  test('loja BRL: POST grava fx_rate; sem cotação, grava nulo e a prévia fica sem US$', async () => {
    const steam = storeId('Steam');
    const q = { storeId: steam, balanceCents: 1000, recordedAt: '2026-11-05T12:00:00.000Z' };
    const withRate = await preview(q);
    expect(withRate.body.data).toMatchObject({ currency: 'BRL', differenceCents: 1000, differenceUsdCents: 200, estimated: true });
    await post(q);
    expect(getDb().prepare('SELECT fx_rate FROM store_balances WHERE store_id = ?').get(steam).fx_rate).toBe(5);
    getDb().prepare('UPDATE fx_rates SET rate = NULL').run();
    const noRate = await preview({ ...q, recordedAt: '2026-11-06T12:00:00.000Z' });
    expect(noRate.status).toBe(200);
    expect(noRate.body.data).toMatchObject({ differenceUsdCents: null, differenceApproxCents: 1000 });
    await post({ ...q, recordedAt: '2026-11-06T12:00:00.000Z' });
    expect(getDb().prepare('SELECT fx_rate FROM store_balances WHERE store_id = ? ORDER BY id DESC').get(steam).fx_rate).toBeNull();
  });
});

describe('histórico e conferências antigas', () => {
  beforeEach(() => { freshDb(); app = makeApp(NOW); });

  test('um registro antigo (sem cálculo) não bloqueia uma conferência anterior a ele; uma conferência com cálculo bloqueia (D252)', async () => {
    const store = csf();
    getDb().prepare("INSERT INTO store_balances (store_id, kind, balance_cents, recorded_at, created_at) VALUES (?, 'CHECK', 50, '2026-11-15T12:00:00.000Z', 'x')").run(store);
    const first = await post({ storeId: store, balanceCents: 0, recordedAt: '2026-11-10T12:00:00.000Z' });
    expect(first.status).toBe(201);
    expectError(await post({ storeId: store, balanceCents: 0, recordedAt: '2026-11-09T12:00:00.000Z' }), 400, 'BALANCE_CHECK_BEFORE_LAST', { field: 'recordedAt' });
    expect(row(await current(), 'CSFloat').lastCheck).toMatchObject({ balanceCents: 50, legacy: true }); // a última conferência é a mais recente, antiga ou não
  });

  test('o histórico de uma conferência fica com o calculado congelado mesmo se um item for editado depois', async () => {
    const store = csf();
    const item = buy('x', store, 1000, '2026-11-02T12:00:00.000Z');
    const check = (await post({ storeId: store, balanceCents: -0, recordedAt: '2026-11-05T12:00:00.000Z' })).body.data;
    expect(check.computedCents).toBe(-1000);
    Item.update(item.id, { purchasePriceCents: 10 }, { now: NOW });
    const hist = (await get(`/api/store-balances?storeId=${store}`)).body.data.balances[0];
    expect(hist).toMatchObject({ computedCents: -1000, differenceCents: 1000 });
  });
});

describe('segurança nas rotas novas (415 e Host)', () => {
  beforeEach(() => { freshDb(); app = makeApp(NOW); });
  const store = () => csf();
  const okPost = () => ({ storeId: store(), balanceCents: 1, recordedAt: '2026-11-01T12:00:00.000Z' });

  test.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/octet-stream'])(
    'POST com Content-Type %s -> 415 e nada gravado',
    async (type) => {
      expectError(await request(app).post('/api/store-balances').set('Content-Type', type).send('x=1'), 415, 'UNSUPPORTED_MEDIA_TYPE');
      expect(rowCount()).toBe(0);
    }
  );

  test('POST sem corpo nem Content-Type -> 415; JSON com charset é aceito', async () => {
    expectError(await request(app).post('/api/store-balances'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    const res = await request(app).post('/api/store-balances').set('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(okPost()));
    expect(res.status).toBe(201);
  });

  test.each(['evil.example', 'localhost.evil.com', '127.0.0.1.evil.com', 'evil.com:3001', '192.168.0.10:3001', '[::1]:3001'])(
    'Host %s -> 403 em todas as rotas de saldo (inclusive GET, preview, PUT e DELETE)',
    async (host) => {
      const id = (await post(okPost())).body.data.id;
      const q = `storeId=${store()}&balanceCents=1&recordedAt=2026-11-02T00:00:00.000Z`;
      for (const res of [
        await get('/api/store-balances').set('Host', host),
        await get('/api/store-balances/current').set('Host', host),
        await get(`/api/store-balances/check-preview?${q}`).set('Host', host),
        await request(app).post('/api/store-balances').set('Host', host).send(okPost()),
        await request(app).delete(`/api/store-balances/${id}`).set('Host', host),
      ]) expectError(res, 403, 'FORBIDDEN_HOST');
      expect(rowCount()).toBe(1);
    }
  );

  test('Host localhost e 127.0.0.1 com porta funcionam nas rotas novas', async () => {
    for (const host of ['localhost:3001', '127.0.0.1:3001']) {
      expect((await get('/api/store-balances/current').set('Host', host)).status).toBe(200);
      expect((await request(app).post('/api/store-balances').set('Host', host).send(okPost())).status).toBe(201);
    }
  });

  test('rotas antigas e métodos não declarados: PATCH, PUT e POST em /initial/:id -> 404 padrão, sem gravar', async () => {
    const res = await request(app).patch(`/api/store-balances/${store()}`).send({ balanceCents: 1 });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    for (const method of ['put', 'post', 'patch']) {
      const out = await request(app)[method](`/api/store-balances/initial/${store()}`).send({ balanceCents: 1, recordedAt: '2026-11-01T12:00:00.000Z' });
      expect(out.status).toBe(404);
    }
    expect(rowCount()).toBe(0);
  });

  test('/check-preview não é tratada como :id', async () => {
    expect((await request(app).delete('/api/store-balances/current')).status).toBeGreaterThanOrEqual(400);
    expectError(await request(app).delete('/api/store-balances/abc'), 400, 'INVALID_ID');
  });
});
