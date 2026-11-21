// API de saldos das lojas e da retenção (8.3: D204, D206, D211, D214, D215, D216). Banco :memory: novo a cada teste.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Item = require('../../src/models/Item');
const Withdrawal = require('../../src/models/Withdrawal');
const StoreBalance = require('../../src/models/StoreBalance');
const Setting = require('../../src/models/Setting');
const { freshDb, wonSkin, soldFields } = require('../helpers/fixtures');
const { makeApp, makeCatalogApp, storeId, expectError, purchaseBody, createItemViaApi, NOW } = require('../helpers/apiFixtures');

const D206_NOW = new Date('2026-11-21T12:00:00.000Z');
let app;

afterAll(() => closeDb());

const get = (url) => request(app).get(url);
const post = (body) => request(app).post('/api/store-balances').send(body);
const balanceBody = (overrides = {}) => ({ storeId: storeId('CSFloat'), balanceCents: 12346, recordedAt: '2026-11-18T12:00:00.000Z', ...overrides });
const current = async () => (await get('/api/store-balances/current')).body.data;
const row = (data, name) => data.stores.find((s) => s.storeName === name);

describe('POST /api/store-balances', () => {
  beforeEach(() => { freshDb(); app = makeApp(); });

  test('cria (201), devolve a view com loja e moeda; loja BRL grava fx_rate das configurações', async () => {
    Setting.update({ usdBrlRate: 5.4321 }, { now: NOW });
    const res = await post(balanceBody());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: expect.objectContaining({
        storeId: storeId('CSFloat'), storeName: 'CSFloat', currency: 'USD', balanceCents: 12346,
        recordedAt: '2026-11-18T12:00:00.000Z', createdAt: NOW.toISOString(),
      }),
    });
    expect(getDb().prepare('SELECT fx_rate FROM store_balances WHERE id = ?').get(res.body.data.id).fx_rate).toBeNull();
    const steam = await post(balanceBody({ storeId: storeId('Steam'), balanceCents: 4590 }));
    expect(getDb().prepare('SELECT fx_rate FROM store_balances WHERE id = ?').get(steam.body.data.id).fx_rate).toBe(5.4321);
  });

  test('saldo 0 é aceito; recordedAt é normalizado para UTC', async () => {
    const res = await post(balanceBody({ balanceCents: 0, recordedAt: '2026-11-18T09:00:00-03:00' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ balanceCents: 0, recordedAt: '2026-11-18T12:00:00.000Z' });
  });

  test('recordedAt no futuro -> 400 RECORDED_AT_IN_FUTURE (field recordedAt); até o fim de hoje em Brasília passa', async () => {
    expectError(await post(balanceBody({ recordedAt: '2026-11-25T12:00:00.000Z' })), 400, 'RECORDED_AT_IN_FUTURE', { field: 'recordedAt' });
    // NOW = 19/11 12:00 BRT; 20/11 02:00Z = 19/11 23:00 BRT (ainda hoje)
    expect((await post(balanceBody({ recordedAt: '2026-11-20T02:00:00.000Z' }))).status).toBe(201);
    expectError(await post(balanceBody({ recordedAt: '2026-11-20T03:00:00.000Z' })), 400, 'RECORDED_AT_IN_FUTURE', { field: 'recordedAt' });
  });

  test('storeId inexistente -> 400 STORE_NOT_FOUND (field storeId)', async () => {
    for (const id of [9999, 0, -1, 2 ** 40]) expectError(await post(balanceBody({ storeId: id })), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
  });

  test('saldo inválido -> INVALID_AMOUNT; ausentes -> REQUIRED_FIELD; tipos -> INVALID_FIELD; desconhecido -> UNKNOWN_FIELD', async () => {
    for (const v of [-1, 1.5]) expectError(await post(balanceBody({ balanceCents: v })), 400, 'INVALID_AMOUNT', { field: 'balanceCents' });
    expectError(await post(balanceBody({ balanceCents: 10 ** 15 })), 400, 'INVALID_AMOUNT', { field: 'balanceCents' });
    expectError(await post(balanceBody({ balanceCents: '100' })), 400, 'INVALID_FIELD', { field: 'balanceCents' });
    expectError(await post(balanceBody({ storeId: '1' })), 400, 'INVALID_FIELD', { field: 'storeId' });
    expectError(await post(balanceBody({ recordedAt: 5 })), 400, 'INVALID_FIELD', { field: 'recordedAt' });
    expectError(await post(balanceBody({ recordedAt: 'ontem' })), 400, 'INVALID_DATE', { field: 'recordedAt' });
    for (const key of ['storeId', 'balanceCents', 'recordedAt']) {
      const body = balanceBody();
      delete body[key];
      expectError(await post(body), 400, 'REQUIRED_FIELD', { field: key });
    }
    expectError(await post(balanceBody({ fxRate: 5 })), 400, 'UNKNOWN_FIELD', { field: 'fxRate' });
    expectError(await request(app).post('/api/store-balances').send([1]), 400, 'INVALID_BODY');
  });

  test('sem Content-Type JSON -> 415; Host estranho -> 403', async () => {
    expectError(await request(app).post('/api/store-balances').set('Content-Type', 'text/plain').send('x'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).post('/api/store-balances'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).post('/api/store-balances').set('Host', 'evil.example').send(balanceBody()), 403, 'FORBIDDEN_HOST');
    expectError(await request(app).get('/api/store-balances/current').set('Host', 'evil.example'), 403, 'FORBIDDEN_HOST');
    expect((await get('/api/store-balances')).body.data.balances).toEqual([]);
  });
});

describe('GET /api/store-balances (histórico) e DELETE', () => {
  beforeEach(() => { freshDb(); app = makeApp(); });

  test('histórico por loja: mais recente primeiro, desempate pelo maior id; sem filtro traz todas as lojas', async () => {
    const a = (await post(balanceBody({ balanceCents: 1, recordedAt: '2026-11-10T12:00:00.000Z' }))).body.data;
    const b = (await post(balanceBody({ balanceCents: 2, recordedAt: '2026-11-12T12:00:00.000Z' }))).body.data;
    const c = (await post(balanceBody({ balanceCents: 3, recordedAt: '2026-11-12T12:00:00.000Z' }))).body.data;
    await post(balanceBody({ storeId: storeId('Steam'), balanceCents: 9 }));
    const hist = (await get(`/api/store-balances?storeId=${storeId('CSFloat')}`)).body.data.balances;
    expect(hist.map((x) => x.id)).toEqual([c.id, b.id, a.id]);
    expect((await get('/api/store-balances')).body.data.balances).toHaveLength(4);
  });

  test('?storeId= inexistente -> 400 STORE_NOT_FOUND; inválido -> 400 INVALID_QUERY', async () => {
    expectError(await get('/api/store-balances?storeId=9999'), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    for (const v of ['abc', '0', '-1', '1.5', '1e2', '']) {
      expectError(await get(`/api/store-balances?storeId=${v}`), 400, 'INVALID_QUERY', { field: 'storeId' });
    }
  });

  test('DELETE: 200 { id }; inexistente -> 404 STORE_BALANCE_NOT_FOUND; id inválido -> 400 INVALID_ID; sem Content-Type ok', async () => {
    const { id } = (await post(balanceBody())).body.data;
    expect(await request(app).delete(`/api/store-balances/${id}`)).toMatchObject({ status: 200, body: { success: true, data: { id } } });
    expectError(await request(app).delete(`/api/store-balances/${id}`), 404, 'STORE_BALANCE_NOT_FOUND');
    for (const v of ['abc', '0', '-3', '1.5']) expectError(await request(app).delete(`/api/store-balances/${v}`), 400, 'INVALID_ID');
  });

  test('excluir o registro mais recente: o anterior volta a ser o atual (corte volta)', async () => {
    await post(balanceBody({ balanceCents: 100, recordedAt: '2026-11-10T12:00:00.000Z' }));
    const last = (await post(balanceBody({ balanceCents: 200, recordedAt: '2026-11-15T12:00:00.000Z' }))).body.data;
    expect(row(await current(), 'CSFloat').availableCents).toBe(200);
    await request(app).delete(`/api/store-balances/${last.id}`);
    expect(row(await current(), 'CSFloat')).toMatchObject({ availableCents: 100, balance: { balanceCents: 100 } });
  });

  test('rota inexistente de saldos -> 404 padrão', async () => {
    const res = await get('/api/store-balances/xyz');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

// ---- Exemplo de D206 / D216 (Revisão 20), banco montado direto pelos models ----
function seedD206() {
  const csf = storeId('CSFloat');
  const steam = storeId('Steam');
  const csm = storeId('CSMoney');
  Setting.update({ usdBrlRate: 5.4321 }, { now: D206_NOW });
  const mk = (name, storeIdOfSale, soldAt, net, days, currency = 'USD') =>
    Item.create(
      wonSkin({
        name,
        ...soldFields(storeIdOfSale, {
          soldAt, netReceivedCents: net, salePriceCents: net, saleCurrency: currency, saleHoldDaysApplied: days,
          fxRateAtSale: currency === 'BRL' ? 5.4321 : null,
        }),
        acquiredAt: '2026-10-01T12:00:00.000Z',
      }),
      { now: D206_NOW }
    );
  const sales = {
    B: mk('B', csf, '2026-11-20T18:00:00.000Z', 2500, 7),
    C: mk('C', csf, '2026-11-21T01:30:00.000Z', 2000, 7),
    G: mk('G', csf, '2026-11-18T09:00:00.000Z', 3000, 7),
    F: mk('F', csf, '2026-11-13T20:00:00.000Z', 1200, 7),
    D: mk('D', csf, '2026-11-12T10:00:00.000Z', 1500, 7),
    E: mk('E', csm, '2026-11-19T12:00:00.000Z', 1000, 7),
    I: mk('I', csm, '2026-11-10T12:00:00.000Z', 600, 7),
    H: mk('H', steam, '2026-11-21T10:00:00.000Z', 800, 0, 'BRL'),
  };
  Item.create(wonSkin({ name: 'estoque usd', acquisitionType: 'COMPRA', purchaseStoreId: csf, purchasePriceCents: 1000, purchaseCurrency: 'USD', acquiredAt: '2026-11-01T12:00:00.000Z', status: 'EM_ESTOQUE' }), { now: D206_NOW });
  Withdrawal.create({ storeId: csf, amountStoreCents: 10000, feeCents: 250, amountBrlCents: 52037, withdrawnAt: '2026-11-10T12:00:00.000Z' }, { now: D206_NOW });
  StoreBalance.create({ storeId: csf, balanceCents: 12346, fxRate: null, recordedAt: '2026-11-20T15:00:00.000Z' }, { now: D206_NOW });
  StoreBalance.create({ storeId: steam, balanceCents: 4590, fxRate: 5.4321, recordedAt: '2026-11-21T09:00:00.000Z' }, { now: D206_NOW });
  return { csf, steam, csm, sales };
}

describe('GET /api/store-balances/current: exemplo de D206 centavo a centavo', () => {
  let ids;
  beforeEach(() => { freshDb(); app = makeApp(D206_NOW); ids = seedD206(); });

  test('CSFloat, Steam e CSMoney', async () => {
    const data = await current();
    expect(row(data, 'CSFloat')).toMatchObject({
      saleHoldDays: 7, availableCents: 12346, availableEstimatedBrlCents: 67065, allowsWithdrawal: true, estimated: true,
      outdated: true, outdatedReasons: ['RELEASED_AFTER_BALANCE'], warningCode: 'BALANCE_MAYBE_OUTDATED',
      pending: { cents: 7500, count: 3, nextReleaseAt: '2026-11-25T09:00:00.000Z', estimatedBrlCents: 40741 },
      releasedAfterBalance: { cents: 1200, count: 1, earliestReleasedAt: '2026-11-20T20:00:00.000Z', estimatedBrlCents: 6519 },
    });
    expect(row(data, 'Steam')).toMatchObject({
      saleHoldDays: 0, availableCents: 4590, availableEstimatedBrlCents: 4590, allowsWithdrawal: false, estimated: false,
      outdated: true, outdatedReasons: ['ACTIVITY_AFTER_BALANCE'], warningCode: 'BALANCE_MAYBE_OUTDATED',
      pending: { cents: 0, count: 0, nextReleaseAt: null, estimatedBrlCents: 0 },
      releasedAfterBalance: { cents: 0, count: 0, earliestReleasedAt: null, estimatedBrlCents: 0 },
    });
    expect(row(data, 'CSMoney')).toMatchObject({
      balance: null, availableCents: 0, availableEstimatedBrlCents: 0, outdated: false, outdatedReasons: [], warningCode: null,
      pending: { cents: 1000, count: 1, nextReleaseAt: '2026-11-26T12:00:00.000Z', estimatedBrlCents: 5432 },
      releasedAfterBalance: { cents: 600, count: 1, earliestReleasedAt: '2026-11-17T12:00:00.000Z', estimatedBrlCents: 3259 },
    });
  });

  test('totais: disponível 71655, pendente 46173, liberado 9778, não sacável 4590, nextReleaseAt 2026-11-25T09:00Z', async () => {
    const data = await current();
    expect(data.totals).toEqual({
      availableEstimatedBrlCents: 71655,
      pendingEstimatedBrlCents: 46173,
      releasedAfterBalanceEstimatedBrlCents: 9778,
      nonWithdrawableEstimatedBrlCents: 4590,
      nextReleaseAt: '2026-11-25T09:00:00.000Z',
      estimated: true,
    });
    expect(data.usdBrlRate).toBe(5.4321);
    expect(data.computedAt).toBe('2026-11-21T12:00:00.000Z');
  });

  test('trocar allowsWithdrawal da Steam muda só a soma "não sacável"; os demais totais não mudam', async () => {
    getDb().prepare('UPDATE stores SET allows_withdrawal = 1 WHERE id = ?').run(ids.steam);
    getDb().prepare('UPDATE stores SET allows_withdrawal = 0 WHERE id = ?').run(ids.csf);
    const t = (await current()).totals;
    expect(t).toMatchObject({ availableEstimatedBrlCents: 71655, pendingEstimatedBrlCents: 46173, releasedAfterBalanceEstimatedBrlCents: 9778 });
    expect(t.nonWithdrawableEstimatedBrlCents).toBe(67065 + 40741 + 6519);
  });

  test('unsell de uma venda pendente (G) sai na hora; de uma liberada (F) também', async () => {
    const before = row(await current(), 'CSFloat');
    expect(before.pending.count).toBe(3);
    expect((await request(app).post(`/api/items/${ids.sales.G.id}/unsell`).send({})).status).toBe(200);
    const mid = row(await current(), 'CSFloat');
    expect(mid.pending).toMatchObject({ cents: 4500, count: 2, nextReleaseAt: '2026-11-27T18:00:00.000Z' });
    expect((await request(app).post(`/api/items/${ids.sales.F.id}/unsell`).send({})).status).toBe(200);
    const after = row(await current(), 'CSFloat');
    expect(after.releasedAfterBalance).toMatchObject({ cents: 0, count: 0, earliestReleasedAt: null });
    expect(after.outdated).toBe(false);
    expect(after.warningCode).toBeNull();
  });

  test('registrar saldo novo depois das liberações tira a venda F de releasedAfterBalance e o aviso some', async () => {
    const res = await post({ storeId: ids.csf, balanceCents: 13546, recordedAt: '2026-11-21T11:00:00.000Z' });
    expect(res.status).toBe(201);
    const csf = row(await current(), 'CSFloat');
    expect(csf.releasedAfterBalance.count).toBe(0);
    expect(csf.pending.count).toBe(3);
    expect(csf).toMatchObject({ outdated: false, warningCode: null });
  });

  test('excluir o último saldo da CSFloat: o corte volta ao anterior (vendas voltam a contar)', async () => {
    const older = StoreBalance.create({ storeId: ids.csf, balanceCents: 1, fxRate: null, recordedAt: '2026-11-10T00:00:00.000Z' }, { now: D206_NOW });
    expect(older.id).toBeDefined();
    const lastId = StoreBalance.findLatestByStore(ids.csf).id;
    expect((await request(app).delete(`/api/store-balances/${lastId}`)).status).toBe(200);
    const csf = row(await current(), 'CSFloat');
    // corte = 2026-11-10T00:00Z: D (libera 19/11 10:00) passa a contar como liberada
    expect(csf.availableCents).toBe(1);
    expect(csf.releasedAfterBalance).toMatchObject({ cents: 1500 + 1200, count: 2 });
  });

  test('loja inativa com venda retida ainda conta', async () => {
    getDb().prepare('UPDATE stores SET is_active = 0 WHERE id = ?').run(ids.csm);
    const csm = row(await current(), 'CSMoney');
    expect(csm).toMatchObject({ isActive: false });
    expect(csm.pending.cents).toBe(1000);
  });

  test('sem cotação: estimatedBrlCents null nas duas categorias + FX_NOT_CONFIGURED; cents preenchidos', async () => {
    getDb().prepare('UPDATE settings SET usd_brl_rate = NULL').run();
    const data = await current();
    const csf = row(data, 'CSFloat');
    expect(csf).toMatchObject({ availableEstimatedBrlCents: null, warningCode: 'FX_NOT_CONFIGURED', availableCents: 12346 });
    expect(csf.pending).toMatchObject({ cents: 7500, estimatedBrlCents: null });
    expect(csf.releasedAfterBalance).toMatchObject({ cents: 1200, estimatedBrlCents: null });
    expect(row(data, 'Steam').availableEstimatedBrlCents).toBe(4590);
    expect(data.totals.pendingEstimatedBrlCents).toBeNull();
    expect(data.totals.nonWithdrawableEstimatedBrlCents).toBe(4590);
    expect(data.usdBrlRate).toBeNull();
  });

  test('banco novo, sem nada: lojas com zeros, sem datas', async () => {
    freshDb();
    const data = await current();
    expect(data.stores).toHaveLength(3);
    for (const s of data.stores) {
      expect(s).toMatchObject({ balance: null, availableCents: 0, outdated: false });
      expect(s.pending).toMatchObject({ cents: 0, count: 0, nextReleaseAt: null });
    }
    expect(data.totals).toMatchObject({ availableEstimatedBrlCents: 0, pendingEstimatedBrlCents: 0, nextReleaseAt: null, estimated: false });
  });
});

describe('bordas de datas pela API', () => {
  const clock = (iso) => { freshDb(); app = makeApp(new Date(iso)); };
  const soldCsf = (soldAt, net, days) =>
    Item.create(wonSkin({ ...soldFields(storeId('CSFloat'), { soldAt, netReceivedCents: net, saleHoldDaysApplied: days }) }), { now: NOW });

  test('now == releasesAt: liberada (releasedAfterBalance); 1 ms antes: pendente', async () => {
    soldCsf('2026-11-10T12:00:00.000Z', 100, 7); // libera 2026-11-17T12:00:00.000Z
    clock('2026-11-17T12:00:00.000Z');
    soldCsf('2026-11-10T12:00:00.000Z', 100, 7);
    expect(row(await current(), 'CSFloat')).toMatchObject({ pending: { count: 0 }, releasedAfterBalance: { count: 1, cents: 100 } });
    clock('2026-11-17T11:59:59.999Z');
    soldCsf('2026-11-10T12:00:00.000Z', 100, 7);
    expect(row(await current(), 'CSFloat')).toMatchObject({ pending: { count: 1 }, releasedAfterBalance: { count: 0 } });
  });

  test('releasesAt == recordedAt: não conta; 1 ms depois do recordedAt: conta', async () => {
    clock('2026-11-20T12:00:00.000Z');
    soldCsf('2026-11-10T12:00:00.000Z', 100, 7);
    StoreBalance.create({ storeId: storeId('CSFloat'), balanceCents: 5, fxRate: null, recordedAt: '2026-11-17T12:00:00.000Z' }, { now: NOW });
    expect(row(await current(), 'CSFloat').releasedAfterBalance.count).toBe(0);
    getDb().prepare('UPDATE store_balances SET recorded_at = ?').run('2026-11-17T11:59:59.999Z');
    expect(row(await current(), 'CSFloat').releasedAfterBalance.count).toBe(1);
  });

  test('retenção 0 e snapshot nulo (venda antiga) nunca entram', async () => {
    clock('2026-11-21T12:00:00.000Z');
    soldCsf('2026-11-20T12:00:00.000Z', 100, 0);
    soldCsf('2026-11-20T12:00:00.000Z', 200, null);
    const csf = row(await current(), 'CSFloat');
    expect(csf.pending.count + csf.releasedAfterBalance.count).toBe(0);
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
