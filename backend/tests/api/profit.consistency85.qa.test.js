// QA 8.5 (API): consistência entre /api/profit/summary, /api/store-balances/current e os totais de /api/deposits e
// /api/withdrawals; saques sem valor em R$ (POST e PATCH com null); ROUND por parcela pela API; contagens do resumo.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const StoreBalance = require('../../src/models/StoreBalance');
const Deposit = require('../../src/models/Deposit');
const Withdrawal = require('../../src/models/Withdrawal');
const Item = require('../../src/models/Item');
const { freshDb, wonSkin, soldFields } = require('../helpers/fixtures');
const { makeApp, storeId } = require('../helpers/apiFixtures');

const NOW = new Date('2026-11-21T12:00:00.000Z');
const RATE = 5.4321;
let app;
let csf;
let steam;
let csm;
beforeEach(() => {
  freshDb();
  app = makeApp(NOW);
  csf = storeId('CSFloat');
  steam = storeId('Steam');
  csm = storeId('CSMoney');
  Setting.update({ usdBrlRate: RATE }, { now: NOW });
});
afterAll(() => closeDb());

const get = async (url) => (await request(app).get(url)).body.data;
const legacyDeposit = (brl, at = '2026-10-05T12:00:00.000Z') => Deposit.create({ storeId: null, amountStoreCents: null, amountBrlCents: brl, depositedAt: at, note: null }, { now: NOW });
const legacyWithdrawal = (brl, at = '2026-11-02T12:00:00.000Z') => Withdrawal.create({ storeId: null, amountStoreCents: null, feeCents: null, amountBrlCents: brl, withdrawnAt: at }, { now: NOW });

function seed() {
  Deposit.create({ storeId: csf, amountStoreCents: 9200, amountBrlCents: null, depositedAt: '2026-10-01T12:00:00.000Z', note: null }, { now: NOW });
  Deposit.create({ storeId: csm, amountStoreCents: 3333, amountBrlCents: 1, depositedAt: '2026-10-02T12:00:00.000Z', note: null }, { now: NOW });
  legacyDeposit(30001);
  legacyDeposit(777);
  Withdrawal.create({ storeId: csf, amountStoreCents: 10000, feeCents: 250, amountBrlCents: null, withdrawnAt: '2026-11-10T12:00:00.000Z' }, { now: NOW });
  Withdrawal.create({ storeId: csm, amountStoreCents: 2000, feeCents: null, amountBrlCents: 11000, withdrawnAt: '2026-11-11T12:00:00.000Z' }, { now: NOW });
  legacyWithdrawal(10001);
  legacyWithdrawal(555);
  StoreBalance.create({ storeId: csf, balanceCents: 12346, fxRate: null, recordedAt: '2026-11-20T15:00:00.000Z' }, { now: NOW });
  StoreBalance.create({ storeId: steam, balanceCents: 4591, fxRate: RATE, recordedAt: '2026-11-21T09:00:00.000Z' }, { now: NOW });
  Item.create(wonSkin({
    name: 'pendente', ...soldFields(csf, { soldAt: '2026-11-20T18:00:00.000Z', netReceivedCents: 2500, salePriceCents: 2500, saleHoldDaysApplied: 7 }),
    acquiredAt: '2026-10-01T12:00:00.000Z',
  }), { now: NOW });
  Item.create(wonSkin({
    name: 'estoque brl', acquisitionType: 'COMPRA', purchaseStoreId: steam, purchasePriceCents: 2501, purchaseCurrency: 'BRL',
    fxRateAtPurchase: 5.0, acquiredAt: '2026-11-01T12:00:00.000Z', status: 'EM_ESTOQUE',
  }), { now: NOW });
}

describe('consistência entre /summary, /current e as listas', () => {
  test('os totais das listas batem com as parcelas do resumo (inclusive "≈ R$")', async () => {
    seed();
    const summary = await get('/api/profit/summary');
    const deposits = await get('/api/deposits');
    const withdrawals = await get('/api/withdrawals');
    expect(deposits.totals.amountUsdCents).toBe(summary.depositsUsdCents);
    expect(deposits.totals.approxBrlCents).toBe(summary.approxBrl.deposits);
    expect(deposits.totals.estimated).toBe(summary.estimatedParts.deposits);
    expect(withdrawals.totals.netUsdCents).toBe(summary.withdrawalsNetUsdCents);
    expect(withdrawals.totals.approxBrlCents).toBe(summary.approxBrl.withdrawals);
    expect(withdrawals.totals.estimated).toBe(summary.estimatedParts.withdrawals);
    expect(deposits.totals.legacyCount).toBe(summary.counts.legacyDeposits);
    expect(deposits.totals.count).toBe(summary.counts.deposits);
    expect(withdrawals.totals.count).toBe(summary.counts.withdrawals);
    expect(withdrawals.totals.legacyCount).toBe(summary.counts.legacyWithdrawals);
    expect(withdrawals.totals.withoutFeeCount).toBe(summary.counts.withdrawalsWithoutFee);
  });

  test('o total da lista é a soma das linhas (cada uma já arredondada), e o "≈ R$" é o ROUND do total', async () => {
    seed();
    const deposits = await get('/api/deposits');
    const sum = deposits.deposits.reduce((acc, d) => acc + d.amountUsdCents, 0);
    expect(deposits.totals.amountUsdCents).toBe(sum);
    // legados: ROUND(30001 / 5,4321) = 5523 e ROUND(777 / 5,4321) = 143
    expect(deposits.deposits.filter((d) => d.legacy).map((d) => d.amountUsdCents).sort()).toEqual([143, 5523]);
    expect(sum).toBe(9200 + 3333 + 5523 + 143);
    expect(deposits.totals.approxBrlCents).toBe(Math.round(sum * RATE));
    const withdrawals = await get('/api/withdrawals');
    const net = withdrawals.withdrawals.reduce((acc, w) => acc + w.amountUsdCents, 0);
    expect(withdrawals.totals.netUsdCents).toBe(net);
    expect(net).toBe(9750 + 2000 + 1841 + 102); // ROUND(10001 / 5,4321) = 1841; ROUND(555 / 5,4321) = 102
  });

  test('balancesByStore e as parcelas de saldo do resumo batem com /current', async () => {
    seed();
    const summary = await get('/api/profit/summary');
    const current = await get('/api/store-balances/current');
    expect(summary.balancesByStore).toEqual(current.stores);
    expect(summary.platformBalanceUsdCents).toBe(current.totals.availableUsdCents);
    expect(summary.pendingBalanceUsdCents).toBe(current.totals.pendingUsdCents);
    expect(summary.releasedAfterBalanceUsdCents).toBe(current.totals.releasedAfterBalanceUsdCents);
    expect(summary.nextReleaseAt).toBe(current.totals.nextReleaseAt);
    expect(summary.approxBrl.platformBalance).toBe(current.totals.approxBrl.available);
    expect(summary.approxBrl.pendingBalance).toBe(current.totals.approxBrl.pending);
    expect(summary.approxBrl.releasedAfterBalance).toBe(current.totals.approxBrl.releasedAfterBalance);
    expect(current.totals.availableUsdCents).toBe(12346 + Math.round(4591 / RATE));
    expect(current.totals.nonWithdrawableUsdCents).toBe(Math.round(4591 / RATE));
  });

  test('o lucro do resumo fecha com as próprias parcelas', async () => {
    seed();
    const s = await get('/api/profit/summary');
    expect(s.realProfitUsdCents).toBe(
      s.withdrawalsNetUsdCents + s.platformBalanceUsdCents + s.pendingBalanceUsdCents + s.releasedAfterBalanceUsdCents + s.stockUsdCents - s.depositsUsdCents
    );
    expect(s.stockUsdCents).toBe(Math.round(2501 / 5.0)); // cotação gravada, não a das configurações
    expect(s.approxBrl.realProfit).toBe(Math.round(s.realProfitUsdCents * RATE));
    expect(s.estimated).toBe(true);
    expect(s.counts).toMatchObject({ legacyDeposits: 2, legacyWithdrawals: 2, withdrawalsWithoutFee: 1, deposits: 4, withdrawals: 4, stockItems: 1, pendingSales: 1 });
  });

  test('sem cotação: lista e resumo ficam nulos juntos e os avisos DEPOSITS e WITHDRAWALS saem uma vez cada', async () => {
    seed();
    Setting.update({ usdBrlRate: null }, { now: NOW });
    const summary = await get('/api/profit/summary');
    const deposits = await get('/api/deposits');
    const withdrawals = await get('/api/withdrawals');
    expect(deposits.totals.amountUsdCents).toBeNull();
    expect(withdrawals.totals.netUsdCents).toBeNull();
    expect(summary.depositsUsdCents).toBeNull();
    expect(summary.withdrawalsNetUsdCents).toBeNull();
    expect(summary.platformBalanceUsdCents).toBeNull(); // Steam
    expect(summary.pendingBalanceUsdCents).toBe(2500);
    expect(summary.stockUsdCents).toBe(500); // cotação gravada
    expect(summary.realProfitUsdCents).toBeNull();
    const fx = summary.warnings.filter((w) => w.code === 'FX_NOT_CONFIGURED').map((w) => w.source === 'STORE' ? `STORE:${w.storeName}` : w.source);
    expect(fx.sort()).toEqual(['DEPOSITS', 'STORE:Steam', 'WITHDRAWALS']);
    expect(summary.warnings.some((w) => w.source === 'STOCK')).toBe(false);
    // linhas USD continuam exatas; legados nulos
    expect(deposits.deposits.filter((d) => !d.legacy).every((d) => d.amountUsdCents !== null && d.approxBrlCents === null)).toBe(true);
    expect(deposits.deposits.filter((d) => d.legacy).every((d) => d.amountUsdCents === null && d.approxBrlCents === d.amountBrlCents)).toBe(true);
    expect(summary.fx.usdBrlRate).toBeNull();
  });

  test('só linhas em USD: lucro exato, estimated false, ratio coerente e nenhum aviso de cotação', async () => {
    Deposit.create({ storeId: csf, amountStoreCents: 10000, amountBrlCents: null, depositedAt: '2026-10-01T12:00:00.000Z', note: null }, { now: NOW });
    Withdrawal.create({ storeId: csf, amountStoreCents: 5000, feeCents: 100, amountBrlCents: null, withdrawnAt: '2026-11-10T12:00:00.000Z' }, { now: NOW });
    Setting.update({ usdBrlRate: null }, { now: NOW });
    const s = await get('/api/profit/summary');
    expect(s).toMatchObject({ depositsUsdCents: 10000, withdrawalsNetUsdCents: 4900, realProfitUsdCents: -5100, estimated: false });
    expect(s.withdrawnVsDeposited.ratio).toBe(0.49);
    expect(s.warnings).toEqual([]);
    expect(s.approxBrl.realProfit).toBeNull();
  });

  test('o R$ informativo de aportes e saques não altera o resumo: PATCH do valor pago deixa o lucro igual', async () => {
    seed();
    const before = await get('/api/profit/summary');
    const list = await get('/api/deposits');
    const normal = list.deposits.find((d) => !d.legacy && d.amountBrlCents === 1);
    await request(app).patch(`/api/deposits/${normal.id}`).send({ amountBrlCents: 99999999 }).expect(200);
    await request(app).patch(`/api/deposits/${normal.id}`).send({ amountBrlCents: null }).expect(200);
    const wList = await get('/api/withdrawals');
    const w = wList.withdrawals.find((x) => x.amountBrlCents === 11000);
    await request(app).patch(`/api/withdrawals/${w.id}`).send({ amountBrlCents: null }).expect(200);
    const after = await get('/api/profit/summary');
    const strip = ({ computedAt, ...rest }) => rest;
    expect(strip(after)).toEqual(strip(before));
  });
});

describe('saques sem valor recebido em R$ pela API', () => {
  const post = (body) => request(app).post('/api/withdrawals').send(body);
  const patch = (id, body) => request(app).patch(`/api/withdrawals/${id}`).send(body);
  const body = (overrides = {}) => ({ storeId: csf, amountStoreCents: 10000, withdrawnAt: '2026-11-10T12:00:00.000Z', ...overrides });

  test('POST sem R$ e com null: 201, amountBrlCents null e líquido na moeda da loja', async () => {
    const a = await post(body({ feeCents: 250 }));
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ amountBrlCents: null, netStoreCents: 9750, amountUsdCents: 9750, approxBrlCents: 52963, estimated: false, legacyWithoutStore: false });
    const b = await post(body({ amountBrlCents: null }));
    expect(b.status).toBe(201);
    expect(b.body.data).toMatchObject({ amountBrlCents: null, feeCents: null, netStoreCents: 10000, amountUsdCents: 10000 });
  });

  test('PATCH com null limpa o valor recebido e não muda o líquido; sem a chave mantém', async () => {
    const created = (await post(body({ feeCents: 250, amountBrlCents: 52037 }))).body.data;
    const kept = await patch(created.id, { note: 'x' });
    expect(kept.body.data.amountBrlCents).toBe(52037);
    const cleared = await patch(created.id, { amountBrlCents: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ amountBrlCents: null, netStoreCents: 9750, amountUsdCents: 9750 });
    const zero = await patch(created.id, { amountBrlCents: 0 });
    expect(zero.status).toBe(400);
    expect(zero.body.error).toMatchObject({ code: 'INVALID_AMOUNT', field: 'amountBrlCents' });
  });

  test('saque antigo sem loja editado com loja e valor, sem R$ no corpo: aceito e o R$ antigo é mantido como informativo', async () => {
    const old = legacyWithdrawal(10001);
    const res = await patch(old.id, { storeId: csf, amountStoreCents: 2000 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ legacyWithoutStore: false, amountBrlCents: 10001, netStoreCents: 2000, amountUsdCents: 2000 });
    const cleared = await patch(old.id, { amountBrlCents: null });
    expect(cleared.body.data.amountBrlCents).toBeNull();
  });

  test('taxa igual ao valor: líquido 0, parcela 0 e não nula, mesmo sem cotação', async () => {
    Setting.update({ usdBrlRate: null }, { now: NOW });
    const res = await post(body({ amountStoreCents: 500, feeCents: 500 }));
    expect(res.body.data).toMatchObject({ netStoreCents: 0, amountUsdCents: 0, approxBrlCents: 0, estimated: false });
    expect((await get('/api/withdrawals')).totals.netUsdCents).toBe(0);
  });

  test('saque com loja em BRL com permissão: líquido convertido (≈) e estimado; sem cotação, nulo', async () => {
    await request(app).patch(`/api/stores/${steam}`).send({ allowsWithdrawal: true }).expect(200);
    const res = await post(body({ storeId: steam, amountStoreCents: 10000, feeCents: 1000 }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ currency: 'BRL', netStoreCents: 9000, amountUsdCents: Math.round(9000 / RATE), approxBrlCents: 9000, estimated: true });
    Setting.update({ usdBrlRate: null }, { now: NOW });
    const list = await get('/api/withdrawals');
    expect(list.withdrawals[0]).toMatchObject({ amountUsdCents: null, approxBrlCents: 9000, estimated: true });
    expect(list.totals.netUsdCents).toBeNull();
  });

  test('withoutFeeCount conta só saques com loja e taxa nula (o antigo sem loja não entra)', async () => {
    await post(body({ feeCents: null }));
    await post(body({ feeCents: 0 }));
    legacyWithdrawal(100);
    const t = (await get('/api/withdrawals')).totals;
    expect(t).toMatchObject({ count: 3, legacyCount: 1, withoutFeeCount: 1 });
    expect((await get('/api/profit/summary')).counts.withdrawalsWithoutFee).toBe(1);
  });
});

describe('o banco aceita o que a API grava (CHECKs da v7)', () => {
  test('saque com loja e R$ nulo, aporte só com valor na loja: linhas gravadas com NULL', async () => {
    await request(app).post('/api/deposits').send({ storeId: csf, amountStoreCents: 100, depositedAt: '2026-11-10T12:00:00.000Z' }).expect(201);
    await request(app).post('/api/withdrawals').send({ storeId: csf, amountStoreCents: 100, withdrawnAt: '2026-11-10T12:00:00.000Z' }).expect(201);
    const d = getDb().prepare('SELECT amount_store_cents AS s, amount_brl_cents AS b FROM deposits').get();
    const w = getDb().prepare('SELECT amount_store_cents AS s, amount_brl_cents AS b FROM withdrawals').get();
    expect(d).toEqual({ s: 100, b: null });
    expect(w).toEqual({ s: 100, b: null });
  });
});
