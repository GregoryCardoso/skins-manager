'use strict';

// 9.5 (D295, D300, D303, D304): importação ao abrir o app (trigger AUTO). Banco em memória, fetchFn falso roteado e dados
// INVENTADOS. Nenhuma chamada real ao CSFloat.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture } = require('../helpers/catalog');
const { expectError } = require('../helpers/apiFixtures');
const importService = require('../../src/services/imports/importService');
const {
  KEY, PII, TRADE_PII, meBody, fakeTrade, fakeTransaction, purchaseTx, routedFetch,
} = require('../helpers/csfloatFixtures');

jest.setTimeout(60000);

const JSON_TYPE = 'application/json';
const NOW = new Date('2026-11-22T15:00:00.000Z');
const CUTOFF = '2026-11-01T00:00:00.000Z';

let app;
let fetchFn;
let state;
const responses = [];
const consoleSpies = [];

function useApp(overrides = {}) {
  state = { me: meBody(), trades: [], transactions: [], ...overrides };
  fetchFn = routedFetch(state);
  app = createApp({ now: () => new Date(NOW.getTime()), fetchFn, sleepFn: async () => {} });
}

const call = async (req) => {
  const res = await req;
  responses.push(JSON.stringify(res.body));
  return res;
};
const post = (url, body = {}) => call(request(app).post(url).set('Content-Type', JSON_TYPE).send(body));
const patch = (body) => call(request(app).patch('/api/integrations/csfloat').set('Content-Type', JSON_TYPE).send(body));
const run = (body = {}) => post('/api/imports/csfloat/run', body);
const auto = () => run({ trigger: 'AUTO' });
const integration = async () => (await call(request(app).get('/api/integrations/csfloat'))).body.data;
const count = (table) => getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const calls = (path) => fetchFn.calls.filter((c) => c.path === path);

// Primeira importação manual (define o corte) e liga a opção.
async function setup({ enable = true } = {}) {
  state.trades = [fakeTrade({ id: '1001' })];
  state.transactions = [purchaseTx('91001', 1250)];
  expect((await run({ cutoffAt: CUTOFF })).status).toBe(200);
  if (enable) expect((await patch({ autoImportOnOpen: true })).status).toBe(200);
  fetchFn.calls.length = 0;
}
// Uma compra nova no topo, com a transação dela.
function addPurchase(id = '1002', createdAt = '2026-11-21T10:00:00.000Z') {
  state.trades = [fakeTrade({ id, createdAt, item: { float_value: 0.31, paint_seed: 2 } }), ...state.trades];
  state.transactions = [purchaseTx(`9${id}`, 1250, { id: `tx-${id}`, createdAt: createdAt.replace(':00.000Z', ':01.000Z') }), ...state.transactions];
}

beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  importService.resetAutoForTests();
  responses.length = 0;
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) consoleSpies.push(jest.spyOn(console, method).mockImplementation(() => {}));
  useApp();
  const res = await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY });
  expect(res.status).toBe(200);
});
afterEach(() => {
  const consoleOutput = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls));
  while (consoleSpies.length) consoleSpies.pop().mockRestore();
  const dump = JSON.stringify(getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => getDb().prepare(`SELECT * FROM "${t.name}"`).all().map((row) => {
    const copy = { ...row };
    if (t.name === 'integrations') delete copy.api_key;
    return copy;
  })));
  const all = responses.join('\n');
  for (const secret of [KEY, ...Object.values(PII), ...TRADE_PII]) {
    expect(all).not.toContain(secret);
    expect(consoleOutput).not.toContain(secret);
    expect(dump).not.toContain(secret);
  }
});
afterAll(() => closeDb());

describe('quando não roda', () => {
  test('a opção começa desligada: AUTO_NOT_CONFIGURED sem nenhuma chamada ao CSFloat', async () => {
    await setup({ enable: false });
    expect((await integration()).autoImportOnOpen).toBe(false);
    const res = await auto();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ batch: null, skipped: 'AUTO_NOT_CONFIGURED' });
    expect(fetchFn.calls).toHaveLength(0);
  });

  test('sem a primeira importação (sem corte): não roda, mesmo ligada', async () => {
    await patch({ autoImportOnOpen: true });
    expect((await auto()).body.data).toEqual({ batch: null, skipped: 'AUTO_NOT_CONFIGURED' });
    expect(fetchFn.calls).toHaveLength(0);
  });
});

describe('rodando', () => {
  test('só o que é novo; no máximo uma vez por processo (um F5 não repete)', async () => {
    await setup();
    addPurchase();
    const first = (await auto()).body.data;
    expect(first.batch).toMatchObject({ trigger: 'AUTO', status: 'DONE', counts: { purchasesCreated: 1, known: 1 } });
    expect(count('items')).toBe(2);
    fetchFn.calls.length = 0;
    addPurchase('1003', '2026-11-22T10:00:00.000Z');
    expect((await auto()).body.data).toEqual({ batch: null, skipped: 'AUTO_ALREADY_RAN' });
    expect(fetchFn.calls).toHaveLength(0);
    // o botão manual usa a mesma lógica e a mesma deduplicação
    const manual = (await run({})).body.data.batch;
    expect(manual.counts).toMatchObject({ purchasesCreated: 1 });
    expect(count('items')).toBe(3);
  });

  test('sem transação nova no extrato: nem busca os trades e não grava lote', async () => {
    await setup();
    const batchesBefore = count('import_batches');
    const res = (await auto()).body.data;
    expect(res).toEqual({ batch: null });
    expect(calls('/me/transactions')).toHaveLength(1);
    expect(calls('/me/trades')).toHaveLength(0);
    expect(count('import_batches')).toBe(batchesBefore);
    // a data da última importação é atualizada
    expect((await integration())).toMatchObject({ lastImportAt: NOW.toISOString(), lastImportStatus: 'OK' });
  });

  test('transação nova sem nada para mostrar: lê os trades mas não guarda o lote', async () => {
    await setup();
    state.transactions = [fakeTransaction({ id: 'tx-bid', type: 'bid_posted', balanceOffset: -100, createdAt: '2026-11-22T10:00:00.000Z' }), ...state.transactions];
    const batchesBefore = count('import_batches');
    expect((await auto()).body.data).toEqual({ batch: null });
    expect(calls('/me/trades').length).toBeGreaterThan(0);
    expect(count('import_batches')).toBe(batchesBefore);
    // e o cursor avançou: a manual seguinte não relê essa transação como nova
    expect(getDb().prepare('SELECT last_transaction_id AS c FROM integrations').get().c).toBe('tx-bid');
  });

  test('pendência repetida não é novidade (não grava lote); pendência nova grava', async () => {
    state.trades = [fakeTrade({ id: '2001', direction: 'SELL', price: 1500 })];
    state.transactions = [fakeTransaction({ id: 'tx-sold', type: 'contract_sold', pendingOffset: 1470, details: { contract_id: '92001', fee_amount: '30' } })];
    await run({ cutoffAt: CUTOFF }); // "venda sem compra no app"
    await patch({ autoImportOnOpen: true });
    state.transactions = [fakeTransaction({ id: 'tx-bid', type: 'bid_posted', createdAt: '2026-11-22T10:00:00.000Z' }), ...state.transactions];
    const before = count('import_batches');
    expect((await auto()).body.data).toEqual({ batch: null });
    expect(count('import_batches')).toBe(before);
    expect((await call(request(app).get('/api/imports/entries?open=true'))).body.data.entries).toHaveLength(1);

    importService.resetAutoForTests();
    state.trades = [fakeTrade({ id: '2002', state: 'weird', createdAt: '2026-11-22T11:00:00.000Z', item: { float_value: 0.5 } }), ...state.trades];
    state.transactions = [fakeTransaction({ id: 'tx-bid2', type: 'bid_posted', createdAt: '2026-11-22T11:00:00.000Z' }), ...state.transactions];
    const res = (await auto()).body.data;
    expect(res.batch).toMatchObject({ trigger: 'AUTO', counts: { unknownState: 1 } });
  });
});

describe('erros', () => {
  test.each([
    [401, 'CSFLOAT_AUTH_FAILED'],
    [429, 'IMPORT_RATE_LIMITED'],
  ])('HTTP %s -> %s; não grava lote FAILED, o card mostra a falha e a automática não tenta de novo no mesmo processo', async (status, code) => {
    await setup();
    const batchesBefore = count('import_batches');
    state.failAt = { path: '/me/transactions', status };
    const res = await auto();
    expectError(res, 502, code);
    expect(count('import_batches')).toBe(batchesBefore);
    expect(await integration()).toMatchObject({ lastImportStatus: 'FAILED', lastImportErrorCode: code, importInProgress: false });
    expect((await auto()).body.data.skipped).toBe('AUTO_ALREADY_RAN');
    // o app segue normal
    expect((await call(request(app).get('/api/items'))).status).toBe(200);
  });

  test('sem internet -> IMPORT_SOURCE_UNREACHABLE', async () => {
    await setup();
    fetchFn.mockImplementation(async () => { throw new TypeError('fetch failed'); });
    expectError(await auto(), 502, 'IMPORT_SOURCE_UNREACHABLE');
  });
});

describe('concorrência com o botão manual', () => {
  // Trava a rede até `release()`.
  function gate() {
    let release;
    const wait = new Promise((resolve) => { release = resolve; });
    const inner = fetchFn;
    fetchFn = jest.fn(async (url, init) => { await wait; return inner(url, init); });
    fetchFn.calls = inner.calls;
    app = createApp({ now: () => new Date(NOW.getTime()), fetchFn, sleepFn: async () => {} });
    return release;
  }
  const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

  test('clicar no botão durante a automática -> 409 IMPORT_IN_PROGRESS; nada duplicado', async () => {
    await setup();
    addPurchase();
    const release = gate();
    const pending = auto();
    await tick();
    expect((await integration()).importInProgress).toBe(true);
    expectError(await run({}), 409, 'IMPORT_IN_PROGRESS');
    release();
    expect((await pending).body.data.batch.counts.purchasesCreated).toBe(1);
    expect((await run({})).body.data.batch.counts).toMatchObject({ purchasesCreated: 0 });
    expect(count('items')).toBe(2);
  });

  test('automática durante uma manual: pula em silêncio (BUSY) e pode rodar depois', async () => {
    await setup();
    addPurchase();
    const release = gate();
    const manual = run({});
    await tick();
    expect((await auto()).body.data).toEqual({ batch: null, skipped: 'BUSY' });
    release();
    await manual;
    expect(count('items')).toBe(2);
  });
});

describe('pausa depois de desfazer', () => {
  test('desfazer pausa; a importação manual não reativa; "Reativar" (ou religar a opção) sim', async () => {
    await setup();
    addPurchase();
    const batch = (await run({})).body.data.batch;
    expect((await post(`/api/imports/batches/${batch.id}/undo`, {})).status).toBe(200);
    const paused = await integration();
    expect(paused).toMatchObject({ autoImportPaused: true, autoImportOnOpen: true });
    expect(paused.lastUndoneAt).toBe(NOW.toISOString());
    expect((await auto()).body.data).toEqual({ batch: null, skipped: 'AUTO_PAUSED' });

    await run({}); // manual: reimporta, mas a pausa continua
    expect((await integration()).autoImportPaused).toBe(true);

    expect((await patch({ autoImportPaused: false })).body.data).toMatchObject({ autoImportPaused: false, lastUndoneAt: null });
    expect((await auto()).body.data.skipped).toBeUndefined();
  });

  test('desligar e ligar a opção também reativa', async () => {
    await setup();
    addPurchase();
    const batch = (await run({})).body.data.batch;
    await post(`/api/imports/batches/${batch.id}/undo`, {});
    await patch({ autoImportOnOpen: false });
    expect((await integration()).autoImportPaused).toBe(true);
    expect((await patch({ autoImportOnOpen: true })).body.data.autoImportPaused).toBe(false);
  });
});
