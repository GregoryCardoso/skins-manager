'use strict';

// 9.6 (D306, D310, D311, E9-Q26) com a Revisão 28 (D341): aportes e saques importados do extrato do CSFloat obedecem à MESMA data
// de corte das compras e vendas e entram na mesma importação; taxa do aporte. Banco em memória, fetchFn falso roteado e dados
// INVENTADOS. Nenhuma chamada real ao CSFloat.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture } = require('../helpers/catalog');
const { storeId, expectError } = require('../helpers/apiFixtures');
const importService = require('../../src/services/imports/importService');
const { KEY, meBody, fakeTransaction, routedFetch } = require('../helpers/csfloatFixtures');

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
const changeCutoff = (cutoffAt) => post('/api/imports/csfloat/change-cutoff', { cutoffAt, confirm: true });
const preview = (cutoffAt) => request(app).get(`/api/imports/csfloat/cutoff-preview?cutoffAt=${encodeURIComponent(cutoffAt)}`);
const integration = async () => (await request(app).get('/api/integrations/csfloat')).body.data;
const deposits = async () => (await request(app).get('/api/deposits')).body.data;
const withdrawals = async () => (await request(app).get('/api/withdrawals')).body.data;
const balance = async () => (await request(app).get('/api/store-balances/current')).body.data.stores.find((s) => s.storeName === 'CSFloat');
const tracking = (id) => getDb().prepare("SELECT tracking FROM external_records WHERE kind = 'TRANSACTION' AND external_id = ?").get(id).tracking;

// Formato real (valores inventados): aporte com balance + creditado e details.fee; saque com balance − total e as duas taxas.
const deposit = (id, createdAt, credited = 1976, fee = '20') =>
  fakeTransaction({ id, type: 'deposit', balanceOffset: credited, createdAt, details: { fee, exchange_rate: '1', payment_method: 'crypto' } });
const withdrawal = (id, createdAt, total = 1270, floatFee = '32', processorFee = '0') =>
  fakeTransaction({ id, type: 'withdrawal', balanceOffset: -total, createdAt, details: { float_fee: floatFee, processor_fee: processorFee } });

beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  importService.resetAutoForTests();
  useApp();
  const res = await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY });
  expect(res.status).toBe(200);
});
afterAll(() => closeDb());

// Extrato: um aporte antigo (09-01), um aporte e um saque depois do corte. (O servidor falso devolve o extrato inteiro numa página.)
function history() {
  state.transactions = [
    withdrawal('tx-w1', '2026-11-12T10:00:00.000Z'),
    deposit('tx-d2', '2026-11-05T10:00:00.000Z', 5000, '50'),
    deposit('tx-d1', '2026-09-01T10:00:00.000Z'),
  ];
}

describe('uma só data de corte (Revisão 28)', () => {
  test('a primeira importação já traz os aportes e saques a partir do corte (com as taxas); os de antes ficam de fora', async () => {
    history();
    const batch = (await run({ cutoffAt: CUTOFF })).body.data.batch;
    expect(batch.counts).toMatchObject({ depositsCreated: 1, withdrawalsCreated: 1 });
    expect(batch.entries.map((e) => [e.outcome, e.entityType, e.display.txKind])).toEqual(expect.arrayContaining([
      ['CREATED', 'DEPOSIT', 'DEPOSIT'], ['CREATED', 'WITHDRAWAL', 'WITHDRAWAL'],
    ]));
    const view = await integration();
    expect(view.tradesCutoffAt).toBe(CUTOFF);
    expect(view).not.toHaveProperty('transactionsCutoffAt');
    const d = await deposits();
    expect(d.deposits).toEqual([expect.objectContaining({ amountStoreCents: 5000, feeCents: 50, depositedAt: '2026-11-05T10:00:00.000Z', amountBrlCents: null })]);
    expect(d.totals).toMatchObject({ amountUsdCents: 5050, feeCents: 50 }); // total colocado = creditado + taxa (D311)
    const w = await withdrawals();
    expect(w.withdrawals).toEqual([expect.objectContaining({ amountStoreCents: 1270, feeCents: 32, amountBrlCents: null })]);
    expect(tracking('tx-d1')).toBe('BEFORE_CUTOFF');
    // o saldo calculado bate com o extrato: +5000 (aporte creditado) − 1270 (saque)
    expect((await balance()).availableCents).toBe(5000 - 1270);

    // a próxima importação não duplica nada
    const again = (await run({})).body.data.batch;
    expect(again === null || (again.counts.depositsCreated === 0 && again.counts.withdrawalsCreated === 0)).toBe(true);
    expect(tracking('tx-d2')).toBe('SETTLED');
  });

  test('aporte manual igual (mesmo valor, dia vizinho) é ligado, não duplicado; dois iguais ficam para conferir', async () => {
    history();
    const manual = (await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 5000, depositedAt: '2026-11-05T20:00:00.000Z' })).body.data;
    const batch = (await run({ cutoffAt: CUTOFF })).body.data.batch;
    expect(batch.counts).toMatchObject({ matched: 1, depositsCreated: 0 });
    expect((await deposits()).deposits.map((x) => x.id)).toEqual([manual.id]);

    state.transactions = [deposit('tx-d3', '2026-11-15T10:00:00.000Z', 3000, '0'), ...state.transactions];
    const a = (await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 3000, depositedAt: '2026-11-15T09:00:00.000Z' })).body.data;
    const b = (await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 3000, depositedAt: '2026-11-15T11:00:00.000Z' })).body.data;
    const review = (await run({})).body.data.batch;
    const entry = review.entries.find((e) => e.outcome === 'POSSIBLE_DUPLICATE');
    expect(entry.candidateIds.sort()).toEqual([a.id, b.id].sort());
    const linked = await post(`/api/imports/entries/${entry.id}/resolve`, { action: 'LINK', targetId: b.id });
    expect(linked.body.data.resolution).toBe('LINKED');
    expect((await deposits()).deposits).toHaveLength(3);
  });

  test('saque com taxa maior que o valor: não importa (WITHDRAWAL_FEE_ABOVE_AMOUNT)', async () => {
    state.transactions = [withdrawal('tx-w9', '2026-11-12T10:00:00.000Z', 100, '150')];
    const batch = (await run({ cutoffAt: CUTOFF })).body.data.batch;
    expect(batch.entries.find((e) => e.outcome === 'FAILED').reasonCode).toBe('WITHDRAWAL_FEE_ABOVE_AMOUNT');
    expect((await withdrawals()).withdrawals).toEqual([]);
  });

  test('dados antigos: aporte que ficou "antes do corte" pelo corte próprio antigo entra na próxima importação', async () => {
    history();
    await run({ cutoffAt: CUTOFF });
    // simula o estado da v1.2.0 com o corte dos aportes mais recente que o principal: o aporte de 11-05 ficou de fora
    const d2 = (await deposits()).deposits[0];
    getDb().prepare("DELETE FROM external_links WHERE entity_type = 'DEPOSIT'").run();
    getDb().prepare('DELETE FROM deposits WHERE id = ?').run(d2.id);
    getDb().prepare("UPDATE external_records SET tracking = 'BEFORE_CUTOFF' WHERE external_id = 'tx-d2'").run();
    getDb().prepare("UPDATE integrations SET transactions_cutoff_at = '2026-11-20T00:00:00.000Z'").run();
    const batch = (await run({})).body.data.batch;
    expect(batch.counts.depositsCreated).toBe(1);
    expect(tracking('tx-d2')).toBe('SETTLED');
  });
});

describe('mudar a data de corte vale para tudo', () => {
  test('pré-visualização para trás: compras e vendas e, junto, os aportes e saques do intervalo', async () => {
    history();
    await run({ cutoffAt: CUTOFF });
    await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 7000, depositedAt: '2026-10-20T12:00:00.000Z' });
    const res = await preview('2026-08-01T00:00:00.000Z');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      currentCutoffAt: CUTOFF, direction: 'BACKWARD',
      transfers: {
        deposits: { count: 1, amountCents: 1976 }, withdrawals: { count: 0, amountCents: 0 }, mayHaveUnseen: true,
        manualDeposits: [{ amountStoreCents: 7000, depositedAt: '2026-10-20T12:00:00.000Z' }], manualWithdrawals: 0,
      },
    });
    expect(res.body.data.backward).toBeTruthy();
  });

  test('para trás: o aporte antigo entra; desfazer devolve o corte anterior e o tira de novo', async () => {
    history();
    await run({ cutoffAt: CUTOFF });
    await post('/api/items', { name: 'Caixa', category: 'CAIXA', acquisitionType: 'GANHEI', acquiredAt: '2026-11-02T00:00:00.000Z' });
    const batch = (await changeCutoff('2026-08-01T00:00:00.000Z')).body.data.batch;
    expect(batch).toMatchObject({ fullScan: true, counts: { depositsCreated: 1 } });
    expect((await integration()).tradesCutoffAt).toBe('2026-08-01T00:00:00.000Z');
    expect((await deposits()).deposits).toHaveLength(2);
    const undoPreview = (await request(app).get(`/api/imports/batches/${batch.id}/undo-preview`)).body.data;
    expect(undoPreview.counts).toMatchObject({ transfersToDelete: 1 });
    expect((await post(`/api/imports/batches/${batch.id}/undo`, { confirmWarnings: true })).status).toBe(200);
    expect((await integration()).tradesCutoffAt).toBe(CUTOFF);
    expect((await deposits()).deposits).toHaveLength(1);
    expect(tracking('tx-d1')).toBe('BEFORE_CUTOFF');
  });

  test('para a frente: os ainda não importados antes dela ficam de fora; o importado continua', async () => {
    state.transactions = [withdrawal('tx-w9', '2026-11-12T10:00:00.000Z', 100, '150'), deposit('tx-d2', '2026-11-05T10:00:00.000Z', 5000, '50')];
    await run({ cutoffAt: CUTOFF });
    expect((await preview('2026-11-20T00:00:00.000Z')).body.data).toMatchObject({ direction: 'FORWARD', transfers: { openToClose: 1 } });
    await changeCutoff('2026-11-20T00:00:00.000Z');
    expect(tracking('tx-w9')).toBe('BEFORE_CUTOFF');
    expect((await deposits()).deposits).toHaveLength(1);
    expect((await request(app).get('/api/imports/entries?open=true')).body.data.entries).toEqual([]);
  });

  test('desfazer a primeira importação: aportes e saques criados saem e o corte volta a ser perguntado', async () => {
    history();
    const batch = (await run({ cutoffAt: CUTOFF })).body.data.batch;
    expect((await post(`/api/imports/batches/${batch.id}/undo`, { confirmWarnings: true })).status).toBe(200);
    expect((await deposits()).deposits).toEqual([]);
    expect((await withdrawals()).withdrawals).toEqual([]);
    expect((await integration()).tradesCutoffAt).toBeNull();
  });

  test('o corte antigo "target" não existe mais; a mudança exige a primeira importação', async () => {
    expectError(await changeCutoff('2026-10-01T00:00:00.000Z'), 409, 'IMPORT_CUTOFF_NOT_SET');
    await run({ cutoffAt: CUTOFF });
    expectError(await changeCutoff('2026-12-01T00:00:00.000Z'), 400, 'DATE_IN_FUTURE');
    expectError(await changeCutoff(CUTOFF), 400, 'IMPORT_CUTOFF_UNCHANGED');
    expectError(await post('/api/imports/csfloat/change-cutoff', { cutoffAt: '2026-10-01T00:00:00.000Z', confirm: true, target: 'TRANSACTIONS' }), 400, 'UNKNOWN_FIELD', { field: 'target' });
    expect((await request(app).get('/api/imports/csfloat/cutoff-preview?cutoffAt=2026-10-01T00:00:00.000Z&target=TRANSACTIONS')).status).toBe(400);
  });
});

describe('outros', () => {
  test('excluir um aporte importado: o registro vira REMOVED_IN_APP e não volta', async () => {
    history();
    await run({ cutoffAt: CUTOFF });
    const [d] = (await deposits()).deposits;
    expect((await request(app).delete(`/api/deposits/${d.id}`)).status).toBe(200);
    expect(tracking('tx-d2')).toBe('REMOVED_IN_APP');
    const again = (await run({ fullScan: true })).body.data.batch;
    expect(again === null || again.counts.depositsCreated === 0).toBe(true);
  });

  test('multa (fine) não vira lançamento: só é contada', async () => {
    state.transactions = [fakeTransaction({ id: 'tx-f1', type: 'fine', balanceOffset: -50, createdAt: '2026-11-10T00:00:00.000Z' })];
    const batch = (await run({ cutoffAt: CUTOFF })).body.data.batch;
    expect(batch.counts.finesNotImported).toBe(1);
  });

  test('a importação automática também traz os aportes', async () => {
    history();
    await run({ cutoffAt: CUTOFF });
    await request(app).patch('/api/integrations/csfloat').set('Content-Type', JSON_TYPE).send({ autoImportOnOpen: true });
    state.transactions = [deposit('tx-d4', '2026-11-21T10:00:00.000Z', 2500, '25'), ...state.transactions];
    const auto = (await run({ trigger: 'AUTO' })).body.data.batch;
    expect(auto).toMatchObject({ trigger: 'AUTO', counts: { depositsCreated: 1 } });
  });
});

describe('taxa do aporte manual (D311)', () => {
  test('entra no total colocado e no lucro real, não no saldo; inválida é recusada', async () => {
    const created = await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 1976, feeCents: 20, depositedAt: '2026-11-10T12:00:00.000Z' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ amountStoreCents: 1976, feeCents: 20, amountUsdCents: 1996 });
    expect((await balance()).availableCents).toBe(1976);
    const profit = (await request(app).get('/api/profit/summary')).body.data;
    expect(JSON.stringify(profit)).toContain('1996');
    expectError(await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 100, feeCents: -1, depositedAt: '2026-11-10T12:00:00.000Z' }), 400, 'INVALID_FEE', { field: 'feeCents' });
    const patched = await request(app).patch(`/api/deposits/${created.body.data.id}`).set('Content-Type', JSON_TYPE).send({ feeCents: null });
    expect(patched.body.data).toMatchObject({ feeCents: null, amountUsdCents: 1976 });
  });
});
