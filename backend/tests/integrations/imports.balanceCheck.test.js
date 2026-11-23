'use strict';

// 9.7 (D313, D314): conferência do saldo com o CSFloat (só leitura) e aviso de taxa da conta. Banco em memória, fetchFn falso
// roteado e dados INVENTADOS. Nenhuma chamada real ao CSFloat.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture } = require('../helpers/catalog');
const { expectError } = require('../helpers/apiFixtures');
const importService = require('../../src/services/imports/importService');
const { computeInTransit, compareBalances, unmatchedReason } = require('../../src/services/imports/balanceCheckService');
const { KEY, PII, meBody, fakeTrade, fakeTransaction, purchaseTx, routedFetch } = require('../helpers/csfloatFixtures');

jest.setTimeout(60000);

const JSON_TYPE = 'application/json';
const NOW = new Date('2026-11-22T15:00:00.000Z');
const CUTOFF = '2026-11-01T00:00:00.000Z';

let app;
let state;
function useApp() {
  state = { me: meBody(), trades: [], transactions: [] };
  app = createApp({ now: () => new Date(NOW.getTime()), fetchFn: routedFetch(state), sleepFn: async () => {} });
}
const post = (url, body = {}) => request(app).post(url).set('Content-Type', JSON_TYPE).send(body);
const run = (body = {}) => post('/api/imports/csfloat/run', body);
const check = () => request(app).get('/api/integrations/csfloat/balance-check');
const explain = () => request(app).get('/api/integrations/csfloat/balance-check/explain');
const setMe = (balance, pending) => { state.me = meBody({ user: { balance, pending_balance: pending } }); };
const count = (table) => getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  importService.resetAutoForTests();
  useApp();
  const res = await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY });
  expect(res.status).toBe(200);
});
afterAll(() => closeDb());

// Aporte de 100,00 (sem taxa) e compra de 12,50 importados: o saldo do CSFloat é 87,50.
async function imported() {
  state.trades = [fakeTrade({ id: '1001', createdAt: '2026-11-10T10:00:00.000Z' })];
  state.transactions = [
    purchaseTx('91001', 1250, { createdAt: '2026-11-10T10:00:01.000Z' }),
    fakeTransaction({ id: 'tx-dep', type: 'deposit', balanceOffset: 10000, createdAt: '2026-11-05T10:00:00.000Z', details: { fee: '0' } }),
  ];
  await run({ cutoffAt: CUTOFF });
  await post('/api/imports/csfloat/change-cutoff', { cutoffAt: '2026-11-01T00:00:00.000Z', confirm: true, target: 'TRANSACTIONS' });
}

describe('Conferir com o CSFloat (D313)', () => {
  test('tudo importado: bate centavo a centavo e não grava nada', async () => {
    await imported();
    setMe(8750, 0);
    const before = count('store_balances');
    const res = await check();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      store: { availableCents: 8750, pendingCents: 0 }, csfloat: { balanceCents: 8750, pendingBalanceCents: 0 },
      inTransit: { purchasesCents: 0, salesPendingCents: 0, openBidsCents: 0 }, difference: { availableCents: 0, pendingCents: 0 },
      explained: true, feeCheck: { saleFeeMatches: true },
    });
    expect(count('store_balances')).toBe(before);
    expect(JSON.stringify(res.body)).not.toContain(PII.steamId);
  });

  test('compra paga e ainda não transferida é "em trânsito", não diferença', async () => {
    await imported();
    state.trades = [fakeTrade({ id: '1002', state: 'pending', offerState: 2, acceptedAt: null, createdAt: '2026-11-21T10:00:00.000Z' }), ...state.trades];
    state.transactions = [purchaseTx('91002', 500, { createdAt: '2026-11-21T10:00:01.000Z' }), ...state.transactions];
    await run({});
    setMe(8250, 0);
    const data = (await check()).body.data;
    expect(data).toMatchObject({ inTransit: { purchasesCents: 500, count: 1 }, expected: { availableCents: 8250 }, explained: true });
  });

  test('diferença não explicada aparece (ex.: dinheiro antes do corte)', async () => {
    await imported();
    setMe(8850, 30);
    const data = (await check()).body.data;
    expect(data).toMatchObject({ difference: { availableCents: 100, pendingCents: 30 }, explained: false });
  });

  test('sem chave, sem loja ou com outra conta: erros claros', async () => {
    await imported();
    state.me = meBody({ user: { steam_id: PII.steamId2 } });
    expectError(await check(), 409, 'CSFLOAT_ACCOUNT_CHANGED');
    await request(app).delete('/api/integrations/csfloat/api-key');
    expectError(await check(), 409, 'CSFLOAT_API_KEY_REQUIRED');
  });
});

describe('Explicar diferença', () => {
  test('lê o extrato inteiro e lista só o que não tem lançamento no app, com o motivo', async () => {
    state.trades = [
      fakeTrade({ id: '1001', createdAt: '2026-11-10T10:00:00.000Z' }),
      fakeTrade({ id: '1003', createdAt: '2026-10-10T10:00:00.000Z', soldAt: '2026-10-10T10:00:00.000Z' }), // antes do corte
    ];
    state.transactions = [
      fakeTransaction({ id: 'tx-fine', type: 'fine', balanceOffset: -50, createdAt: '2026-11-15T00:00:00.000Z' }),
      purchaseTx('91001', 1250, { createdAt: '2026-11-10T10:00:01.000Z' }),
      fakeTransaction({ id: 'tx-dep', type: 'deposit', balanceOffset: 10000, createdAt: '2026-11-05T10:00:00.000Z', details: { fee: '0' } }),
      purchaseTx('91003', 700, { createdAt: '2026-10-10T10:00:01.000Z' }),
      fakeTransaction({ id: 'tx-bid', type: 'bid_posted', balanceOffset: -300, createdAt: '2026-11-20T00:00:00.000Z' }),
    ];
    await run({ cutoffAt: CUTOFF }); // aportes ainda sem data de corte
    const res = await explain();
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.totals).toEqual({ balanceCents: -50 - 1250 + 10000 - 700 - 300, pendingCents: 0 });
    expect(data.openBidsCents).toBe(300);
    const reasons = Object.fromEntries(data.groups.map((g) => [`${g.reason}|${g.type}`, g.balanceCents]));
    expect(reasons).toEqual({ 'NOT_IMPORTED|deposit': 10000, 'BEFORE_CUTOFF|contract_purchased': -700, 'FINE|fine': -50 });
    expect(data.sumBalanceCents).toBe(10000 - 700 - 50);
    expect(data.unmatched).toHaveLength(3);
    expect(JSON.stringify(data)).not.toMatch(/tx-dep|SESSION-FICTICIO/);
  });

  test('recusa durante uma importação', async () => {
    const lock = require('../../src/services/imports/importLock');
    await run({ cutoffAt: CUTOFF });
    const release = lock.acquire();
    try {
      expectError(await explain(), 409, 'IMPORT_IN_PROGRESS');
    } finally {
      release();
    }
  });
});

describe('aviso de taxa da conta diferente da loja (D314)', () => {
  test('a importação manual avisa; a automática não; a loja nunca muda sozinha', async () => {
    state.me = meBody({ user: { fee: '0.015' } });
    const batch = (await run({ cutoffAt: CUTOFF })).body.data.batch;
    expect(batch.warnings).toContain('ACCOUNT_SALE_FEE_DIFFERS');
    expect(batch.warnings).not.toContain('ACCOUNT_WITHDRAWAL_FEE_DIFFERS');
    expect(getDb().prepare("SELECT sale_fee_rate AS r FROM stores WHERE name = 'CSFloat'").get().r).toBe(0.02);
  });
});

describe('funções puras', () => {
  test('em trânsito: compra/venda sem trade ou esperando transferência; lances abertos pelo saldo líquido dos bids', () => {
    const trades = new Map([['c1', { tracking: 'WAITING_TRANSFER' }], ['c2', { tracking: 'OPEN' }], ['c3', { tracking: 'WAITING_TRANSFER' }]]);
    const txs = [
      { txType: 'contract_purchased', contractId: 'c1', balanceOffsetCents: -500 },
      { txType: 'contract_purchased', contractId: 'c2', balanceOffsetCents: -900 }, // já importada
      { txType: 'contract_sold', contractId: 'c3', pendingOffsetCents: 1470 },
      { txType: 'bid_posted', balanceOffsetCents: -300 },
      { txType: 'bid_posted', balanceOffsetCents: -200 },
      { txType: 'bid_accepted', balanceOffsetCents: 200 },
    ];
    expect(computeInTransit(txs, trades)).toEqual({ purchasesCents: 500, salesPendingCents: 1470, openBidsCents: 300, count: 2 });
  });
  test('comparação e motivos', () => {
    expect(compareBalances({
      app: { availableCents: 1000, pendingCents: 0 }, csfloat: { balanceCents: 500, pendingBalanceCents: 1470 },
      inTransit: { purchasesCents: 500, salesPendingCents: 1470, openBidsCents: 0 },
    })).toEqual({ expected: { availableCents: 500, pendingCents: 1470 }, difference: { availableCents: 0, pendingCents: 0 }, explained: true });
    expect(unmatchedReason({ type: 'deposit' }, { record: { tracking: 'BEFORE_CUTOFF' }, txLinked: false })).toBe('BEFORE_CUTOFF');
    expect(unmatchedReason({ type: 'deposit' }, { record: { tracking: 'SETTLED' }, txLinked: true })).toBeNull();
    expect(unmatchedReason({ type: 'contract_sold' }, { trade: { tracking: 'OPEN' }, tradeLink: { entityType: 'ITEM_SALE' } })).toBeNull();
    expect(unmatchedReason({ type: 'contract_purchased' }, { trade: null, tradeLink: null })).toBe('NOT_READ');
    expect(unmatchedReason({ type: 'novo_tipo' }, {})).toBe('UNKNOWN_TYPE');
    expect(unmatchedReason({ type: 'bid_posted' }, {})).toBeNull();
  });
});
