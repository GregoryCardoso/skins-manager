'use strict';

// QA 9.2 (D294 a D303, D318): lacunas da importação de compras do CSFloat. Complementa imports.api.test.js sem repeti-lo.
// Banco em memória, fetchFn falso roteado e dados INVENTADOS. Nenhuma chamada real ao CSFloat.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, CAT } = require('../helpers/catalog');
const { storeId, expectError } = require('../helpers/apiFixtures');
const {
  KEY, PII, OTHER, TRADE_PII, meBody, fakeResponse, fakeTrade, fakeTransaction, purchaseTx, routedFetch,
} = require('../helpers/csfloatFixtures');

jest.setTimeout(60000);

const JSON_TYPE = 'application/json';
const NOW = new Date('2026-11-22T15:00:00.000Z');
const CUTOFF = '2026-11-01T00:00:00.000Z';

let app;
let fetchFn;
let state;
let clock = NOW;
const responses = [];
const consoleSpies = [];

function useApp(overrides = {}) {
  state = { me: meBody(), trades: [], transactions: [], ...overrides };
  fetchFn = routedFetch(state);
  app = createApp({ now: () => new Date(clock.getTime()), fetchFn, sleepFn: async () => {} });
}

const call = async (req) => {
  const res = await req;
  responses.push(JSON.stringify(res.body));
  return res;
};
const run = (body = {}) => call(request(app).post('/api/imports/csfloat/run').set('Content-Type', JSON_TYPE).send(body));
const firstRun = (extra = {}) => run({ cutoffAt: CUTOFF, ...extra });
const getItems = async () => (await call(request(app).get('/api/items'))).body.data.items;
const dbRows = (sql, ...params) => getDb().prepare(sql).all(...params);
const count = (table) => dbRows(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
const calls = (path) => fetchFn.calls.filter((c) => c.path === path);
const trackings = () => dbRows('SELECT external_id, tracking FROM external_records WHERE kind = ? ORDER BY external_id', 'TRADE');
const openEntries = async () => (await call(request(app).get('/api/imports/entries?open=true'))).body.data.entries;
const undoPreview = async (id) => (await call(request(app).get(`/api/imports/batches/${id}/undo-preview`))).body.data;
const undo = (id, body = {}) => call(request(app).post(`/api/imports/batches/${id}/undo`).set('Content-Type', JSON_TYPE).send(body));
const createManual = async (body) => {
  const res = await request(app).post('/api/items').send(body);
  if (res.status !== 201) throw new Error(`criação manual falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
};
const manual = (extra = {}) => ({
  catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 1250,
  acquiredAt: '2026-11-20T09:00:00.000Z', floatValue: 0.2534, paintSeed: 661, ...extra,
});
const sticker = (id, createdAt, extra = {}) => fakeTrade({
  id, createdAt, price: 5, item: { market_hash_name: 'Sticker | Titan | Katowice 2014', type: 'sticker', is_commodity: true, float_value: null, paint_seed: null }, ...extra,
});
const stickerManual = (extra = {}) => manual({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 5, floatValue: undefined, paintSeed: undefined, ...extra });

// Trava a rede até `release()`: permite observar o estado "importando".
function gatedApp() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const slow = routedFetch(state);
  fetchFn = jest.fn(async (url, init) => { await gate; return slow(url, init); });
  fetchFn.calls = slow.calls;
  app = createApp({ now: () => new Date(clock.getTime()), fetchFn, sleepFn: async () => {} });
  return release;
}
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

async function saveKey() {
  const res = await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY });
  expect(res.status).toBe(200);
}

beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  clock = NOW;
  responses.length = 0;
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) consoleSpies.push(jest.spyOn(console, method).mockImplementation(() => {}));
  useApp();
  await saveKey();
});
afterEach(() => {
  const consoleOutput = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls.map((args) => args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : a)))));
  while (consoleSpies.length) consoleSpies.pop().mockRestore();
  jest.restoreAllMocks();
  const tables = getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  const dump = {};
  for (const name of tables) {
    dump[name] = getDb().prepare(`SELECT * FROM "${name}"`).all().map((row) => {
      const copy = { ...row };
      if (name === 'integrations') delete copy.api_key;
      return copy;
    });
  }
  const dumpText = JSON.stringify(dump);
  const all = responses.join('\n');
  for (const secret of [KEY, ...Object.values(PII), ...TRADE_PII, 'UNKNOWN-FIELD-PII-QA']) {
    expect(all).not.toContain(secret);
    expect(consoleOutput).not.toContain(secret);
    expect(dumpText).not.toContain(secret);
  }
});
afterAll(() => closeDb());

// --- Deduplicação ----------------------------------------------------------------------------------------------------------

describe('deduplicação: importar de novo não duplica itens, vínculos, registros nem entradas', () => {
  test('três importações seguidas deixam as tabelas idênticas; a segunda e a terceira são "sem novidades"', async () => {
    await createManual(manual({ floatValue: 0.31, paintSeed: 1 }));
    state.trades = [
      fakeTrade({ id: '1001', createdAt: '2026-11-20T10:00:00.000Z', item: { float_value: 0.31, paint_seed: 1 } }), // liga ao manual
      fakeTrade({ id: '1002', createdAt: '2026-11-19T10:00:00.000Z', item: { float_value: 0.32, paint_seed: 2 } }), // cria
      fakeTrade({ id: '1003', createdAt: '2026-11-18T10:00:00.000Z', state: 'queued', offerState: null, acceptedAt: null }), // espera
      fakeTrade({ id: '1004', createdAt: '2026-11-17T10:00:00.000Z', state: 'weird', item: { float_value: 0.33, paint_seed: 3 } }), // desconhecido
    ];
    state.transactions = [purchaseTx('91002', 1250)];
    const first = (await firstRun()).body.data.batch;
    expect(first.counts).toMatchObject({ purchasesCreated: 1, matched: 1, notTransferred: 1, unknownState: 1 });
    const snapshot = () => ({
      items: count('items'), links: count('external_links'), records: count('external_records'),
      entries: dbRows('SELECT outcome, COUNT(*) AS n FROM import_batch_entries GROUP BY outcome ORDER BY outcome'),
    });
    const afterFirst = snapshot();
    const second = (await run({})).body.data.batch;
    const third = (await run({})).body.data.batch;
    for (const batch of [second, third]) {
      expect(batch.counts).toMatchObject({ purchasesCreated: 0, matched: 0, review: 0 });
      expect(batch.entries.filter((e) => ['CREATED', 'MATCHED'].includes(e.outcome))).toEqual([]);
      expect(batch.undoable).toBe(false);
    }
    const afterThird = snapshot();
    // a entrada de "estado desconhecido" volta a cada leitura (ainda não decidido), as demais não se repetem
    expect(afterThird.items).toBe(afterFirst.items);
    expect(afterThird.links).toBe(afterFirst.links);
    expect(afterThird.records).toBe(afterFirst.records);
    expect(afterThird.entries.filter((e) => ['CREATED', 'MATCHED'].includes(e.outcome))).toEqual(afterFirst.entries.filter((e) => ['CREATED', 'MATCHED'].includes(e.outcome)));
    expect(count('external_links')).toBe(2);
    expect(count('items')).toBe(2);
    // o lote seguinte não vira "último desfazível": o primeiro continua sendo
    expect((await undoPreview(first.id)).undoable).toBe(true);
  });

  test('o mesmo trade em duas páginas da lista entra uma vez só; id numérico e id em texto são o mesmo trade', async () => {
    const trades = [];
    for (let i = 0; i < 55; i += 1) {
      trades.push(fakeTrade({ id: String(3000 + i), createdAt: `2026-11-20T10:${String(59 - i).padStart(2, '0')}:00.000Z`, state: 'queued', offerState: null, acceptedAt: null }));
    }
    const dup = { ...trades[2], id: trades[2].id };
    trades[54] = dup; // a página 1 repete um trade da página 0
    state.trades = trades;
    const res = await firstRun();
    expect(res.status).toBe(200);
    expect(count('external_records')).toBe(54);

    state.trades = [fakeTrade({ id: '7777', state: 'pending' })];
    await run({});
    state.trades = [{ ...fakeTrade({ id: '7777', state: 'pending' }), id: 7777 }]; // o mesmo, agora como número
    const again = await run({});
    expect(again.body.data.batch.counts).toMatchObject({ purchasesCreated: 0 });
    expect(count('items')).toBe(1);
  });

  test('matched e possível duplicado não se repetem nem mudam de resposta nas importações seguintes', async () => {
    await createManual(stickerManual());
    state.trades = [sticker('3101', '2026-11-20T12:00:00.000Z'), sticker('3102', '2026-11-20T10:00:00.000Z')];
    const first = (await firstRun()).body.data.batch;
    expect(first.counts.review).toBe(2);
    const entriesBefore = count('import_batch_entries');
    for (let i = 0; i < 3; i += 1) await run({});
    expect(count('import_batch_entries')).toBe(entriesBefore);
    expect(count('items')).toBe(1);
    expect(count('external_links')).toBe(0);
  });
});

// --- Data de corte ---------------------------------------------------------------------------------------------------------

describe('data de corte', () => {
  test('o corte vale pelo contract.sold_at: sold_at depois do corte entra mesmo com created_at antes; o inverso é ignorado', async () => {
    state.trades = [
      fakeTrade({ id: '2001', createdAt: '2026-10-30T10:00:00.000Z', soldAt: '2026-11-02T10:00:00.000Z', item: { float_value: 0.31, paint_seed: 1 } }),
      fakeTrade({ id: '2002', createdAt: '2026-11-03T10:00:00.000Z', soldAt: '2026-10-31T10:00:00.000Z', item: { float_value: 0.32, paint_seed: 2 } }),
    ];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, beforeCutoff: 1 });
    const items = await getItems();
    expect(items).toHaveLength(1);
    expect(items[0].acquiredAt).toBe('2026-11-02T10:00:00.000Z');
  });

  test('trade exatamente no instante do corte é importado; um milissegundo antes, não', async () => {
    state.trades = [
      fakeTrade({ id: '2101', createdAt: '2026-11-01T00:00:00.000Z', soldAt: '2026-11-01T00:00:00.000Z', item: { float_value: 0.31, paint_seed: 1 } }),
      fakeTrade({ id: '2102', createdAt: '2026-10-31T23:59:59.999Z', soldAt: '2026-10-31T23:59:59.999Z', item: { float_value: 0.32, paint_seed: 2 } }),
    ];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, beforeCutoff: 1 });
  });

  test('corte igual a "agora" é aceito; um milissegundo no futuro, não; corte com fuso vira UTC; sem gravar nada na recusa', async () => {
    expectError(await run({ cutoffAt: '2026-11-22T15:00:00.001Z' }), 400, 'DATE_IN_FUTURE', { field: 'cutoffAt' });
    expect(count('import_batches')).toBe(0);
    expect(dbRows('SELECT trades_cutoff_at FROM integrations')[0].trades_cutoff_at).toBeNull();
    const ok = await run({ cutoffAt: '2026-11-01T00:00:00-03:00' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.batch.cutoffAt).toBe('2026-11-01T03:00:00.000Z');
    expect(dbRows('SELECT trades_cutoff_at FROM integrations')[0].trades_cutoff_at).toBe('2026-11-01T03:00:00.000Z');
  });

  test('a sugestão é só o valor inicial: o usuário informa outra data (mais antiga) e é ela que vale', async () => {
    await createManual(manual({ acquiredAt: '2026-11-08T10:00:00.000Z' }));
    const suggested = (await call(request(app).get('/api/integrations/csfloat'))).body.data.suggestedCutoffAt;
    expect(suggested).toBe('2026-11-08T10:00:00.000Z');
    state.trades = [fakeTrade({ id: '2201', createdAt: '2026-10-05T10:00:00.000Z', item: { float_value: 0.4, paint_seed: 4 } })];
    const res = await run({ cutoffAt: '2026-10-01T00:00:00.000Z' });
    expect(res.body.data.batch.cutoffAt).toBe('2026-10-01T00:00:00.000Z');
    expect(res.body.data.batch.counts.purchasesCreated).toBe(1);
    expect((await call(request(app).get('/api/integrations/csfloat'))).body.data.tradesCutoffAt).toBe('2026-10-01T00:00:00.000Z');
  });

  test('corte vazio, nulo, número e lixo: erro de campo, nada lido e nada gravado', async () => {
    expectError(await run({ cutoffAt: '' }), 400, 'IMPORT_CUTOFF_REQUIRED', { field: 'cutoffAt' });
    expectError(await run({ cutoffAt: null }), 400, 'IMPORT_CUTOFF_REQUIRED', { field: 'cutoffAt' });
    expectError(await run({ cutoffAt: 20261101 }), 400, 'INVALID_DATE', { field: 'cutoffAt' });
    expectError(await run({ cutoffAt: '2026-13-45' }), 400, 'INVALID_DATE', { field: 'cutoffAt' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(count('import_batches')).toBe(0);
  });

  test('cutoffAt na importação seguinte é recusado mesmo igual ao gravado; a data gravada não muda', async () => {
    await firstRun();
    expectError(await run({ cutoffAt: CUTOFF }), 400, 'IMPORT_CUTOFF_ALREADY_SET', { field: 'cutoffAt' });
    expectError(await run({ cutoffAt: '2026-01-01T00:00:00.000Z' }), 400, 'IMPORT_CUTOFF_ALREADY_SET');
    expect((await call(request(app).get('/api/integrations/csfloat'))).body.data.tradesCutoffAt).toBe(CUTOFF);
  });

  test('importação que falha na rede não grava o corte: a data continua sendo perguntada', async () => {
    state.failAt = { path: '/me/trades', page: 0, status: 500 };
    expectError(await firstRun(), 502, 'IMPORT_SOURCE_UNAVAILABLE');
    expect(dbRows('SELECT trades_cutoff_at FROM integrations')[0].trades_cutoff_at).toBeNull();
    expectError(await run({}), 400, 'IMPORT_CUTOFF_REQUIRED');
  });

  test('o corte vale para trades de venda e os antes do corte nunca viram entrada nem item, em nenhuma importação', async () => {
    state.trades = [
      fakeTrade({ id: '2301', direction: 'SELL', createdAt: '2026-10-10T10:00:00.000Z' }),
      fakeTrade({ id: '2302', createdAt: '2026-10-11T10:00:00.000Z', state: 'verified' }),
    ];
    const first = (await firstRun()).body.data.batch;
    expect(first.counts).toMatchObject({ beforeCutoff: 2, deferredSales: 0, purchasesCreated: 0 });
    const second = (await run({})).body.data.batch;
    expect(second.counts).toMatchObject({ beforeCutoff: 2, known: 0 }); // 9.5.1c (D324): relidos, continuam "antes do corte"
    expect(second.entries).toEqual([]);
    expect(count('items')).toBe(0);
  });
});

// --- Critério da oferta aceita ---------------------------------------------------------------------------------------------

describe('critério da oferta aceita (D294)', () => {
  test.each([2, 9, 11])('state pending com accepted_at preenchido e oferta %s não importa, espera e é reverificado até virar 3', async (offer) => {
    state.trades = [fakeTrade({ id: '4001', state: 'pending', offerState: offer, acceptedAt: '2026-11-20T14:00:00.000Z' })];
    const first = await firstRun();
    expect(first.body.data.batch.counts).toMatchObject({ purchasesCreated: 0, notTransferred: 1 });
    expect(count('items')).toBe(0);
    expect(trackings()).toEqual([{ external_id: '4001', tracking: 'WAITING_TRANSFER' }]);
    expect(await openEntries()).toEqual([]);
    // continua sendo lido de novo, mesmo em varredura incremental
    const second = await run({});
    expect(second.body.data.batch.counts.notTransferred).toBe(1);
    expect(calls('/me/trades').length).toBeGreaterThanOrEqual(2);
    state.trades = [fakeTrade({ id: '4001', state: 'pending', offerState: 3 })];
    const third = await run({});
    expect(third.body.data.batch.counts.purchasesCreated).toBe(1);
    expect(trackings()).toEqual([{ external_id: '4001', tracking: 'OPEN' }]);
  });

  test('oferta 3 sem accepted_at não importa; sem steam_offer nenhum (queued) também não', async () => {
    state.trades = [
      fakeTrade({ id: '4101', state: 'pending', offerState: 3, acceptedAt: null, createdAt: '2026-11-20T10:00:00.000Z' }),
      fakeTrade({ id: '4102', state: 'queued', offerState: null, createdAt: '2026-11-19T10:00:00.000Z' }),
    ];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 0, notTransferred: 2 });
    expect(trackings().map((t) => t.tracking)).toEqual(['WAITING_TRANSFER', 'WAITING_TRANSFER']);
    expect(count('items')).toBe(0);
  });

  test('oferta 1 ou fora do enum: estado desconhecido, nunca importado, com entrada; resolvida quando o trade passa a ser conhecido', async () => {
    state.trades = [
      fakeTrade({ id: '4201', state: 'pending', offerState: 1, acceptedAt: '2026-11-20T14:00:00.000Z', createdAt: '2026-11-20T10:00:00.000Z' }),
      fakeTrade({ id: '4202', state: 'pending', offerState: 99, createdAt: '2026-11-19T10:00:00.000Z', item: { float_value: 0.4, paint_seed: 4 } }),
    ];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ unknownState: 2, purchasesCreated: 0 });
    expect(res.body.data.batch.unknownTypes).toEqual({ 'offer:1': 1, 'offer:99': 1 });
    expect((await openEntries()).map((e) => e.outcome)).toEqual(['UNKNOWN_STATE', 'UNKNOWN_STATE']);
    state.trades = state.trades.map((t) => fakeTrade({ id: t.id, state: 'verified', createdAt: t.created_at, item: t.contract.item }));
    const next = await run({});
    expect(next.body.data.batch.counts.purchasesCreated).toBe(2);
    expect(await openEntries()).toEqual([]);
  });

  test('failed/cancelled nunca importado fica fechado: não é reverificado como pendente e nunca vira item', async () => {
    state.trades = [
      fakeTrade({ id: '4301', state: 'cancelled', offerState: 6, acceptedAt: null, createdAt: '2026-11-20T10:00:00.000Z' }),
      fakeTrade({ id: '4302', state: 'failed', offerState: 3, createdAt: '2026-11-19T10:00:00.000Z', item: { float_value: 0.4, paint_seed: 4 } }),
      fakeTrade({ id: '4303', state: 'failed', offerState: null, acceptedAt: null, createdAt: '2026-11-18T10:00:00.000Z', item: { float_value: 0.5, paint_seed: 5 } }),
    ];
    const first = await firstRun();
    expect(first.body.data.batch.counts).toMatchObject({ notTransferred: 2, revertedBeforeImport: 1, purchasesCreated: 0 });
    expect(trackings().map((t) => t.tracking)).toEqual(['CLOSED_NOT_TRANSFERRED', 'CLOSED_NOT_TRANSFERRED', 'CLOSED_NOT_TRANSFERRED']);
    // mesmo que o CSFloat depois mostre o trade como aceito, a decisão fechada não muda sozinha
    state.trades = state.trades.map((t) => fakeTrade({ id: t.id, state: 'pending', createdAt: t.created_at, item: t.contract.item }));
    const second = await run({});
    expect(second.body.data.batch.counts).toMatchObject({ purchasesCreated: 0, known: 3 });
    expect(count('items')).toBe(0);
    expect(await openEntries()).toEqual([]);
  });

  test('pending que vira verified entre duas importações sem ter sido aceito antes: importa na segunda e segue acompanhado na proteção', async () => {
    state.trades = [fakeTrade({ id: '4401', state: 'pending', offerState: 2, acceptedAt: null })];
    await firstRun();
    state.trades = [fakeTrade({ id: '4401', state: 'verified', offerState: 3 })];
    const res = await run({});
    expect(res.body.data.batch.counts.purchasesCreated).toBe(1);
    expect(trackings()).toEqual([{ external_id: '4401', tracking: 'OPEN' }]);
  });

  test('o nome do estado não diferencia maiúsculas', async () => {
    state.trades = [fakeTrade({ id: '4501', state: 'VERIFIED' }), fakeTrade({ id: '4502', state: 'Failed', offerState: 6, acceptedAt: null, createdAt: '2026-11-19T10:00:00.000Z', item: { float_value: 0.4, paint_seed: 4 } })];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, notTransferred: 1 });
  });

  test('trade enviado a outra pessoa não importa e é tentado de novo; quando o campo some, entra', async () => {
    state.trades = [fakeTrade({ id: '4601', sentToDifferentUser: '76561190000000777' })];
    const first = await firstRun();
    expect(first.body.data.batch.entries[0]).toMatchObject({ outcome: 'FAILED', reasonCode: 'TRADE_SENT_TO_OTHER_USER' });
    expect(count('items')).toBe(0);
    state.trades = [fakeTrade({ id: '4601' })];
    const second = await run({});
    expect(second.body.data.batch.counts.purchasesCreated).toBe(1);
    expect(await openEntries()).toEqual([]);
  });

  test('estorno no extrato antes de importar: o trade aceito não vira item', async () => {
    state.trades = [fakeTrade({ id: '4701' })];
    state.transactions = [fakeTransaction({ id: 'tx-ref', type: 'contract_purchase_refund', details: { contract_id: '94701' } })];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 0, notTransferred: 0, revertedBeforeImport: 1 });
    expect(count('items')).toBe(0);
  });
});

// --- Direção e conta -------------------------------------------------------------------------------------------------------

describe('direção pela impressão digital e conta', () => {
  test('9.3: a venda com unidade e crédito no extrato é registrada; a sem unidade vira "venda sem compra no app"', async () => {
    const stock = await createManual(manual({ floatValue: 0.31, paintSeed: 1 }));
    const balanceBefore = (await call(request(app).get('/api/store-balances/current'))).body.data;
    state.trades = [
      fakeTrade({ id: '5001', direction: 'SELL', state: 'verified', price: 1500, createdAt: '2026-11-21T10:00:00.000Z', item: { float_value: 0.31, paint_seed: 1 } }),
      fakeTrade({ id: '5002', direction: 'SELL', state: 'pending', createdAt: '2026-11-20T10:00:00.000Z', item: { float_value: 0.4, paint_seed: 4 } }),
    ];
    state.transactions = [fakeTransaction({ id: 'tx-sold', type: 'contract_sold', pendingOffset: 1470, details: { contract_id: '95001', fee_amount: '30' } })];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ deferredSales: 0, salesCreated: 1, withoutPurchase: 1, purchasesCreated: 0, matched: 0 });
    expect(res.body.data.batch.entries.map((e) => [e.outcome, e.reasonCode, e.entityType])).toEqual([
      ['FAILED', 'PURCHASE_NOT_FOUND', null],
      ['CREATED', null, 'ITEM_SALE'],
    ]);
    const sold = (await call(request(app).get(`/api/items/${stock.id}`))).body.data;
    expect(sold).toMatchObject({ status: 'VENDIDO', salePriceCents: 1500, netReceivedCents: 1470, soldAt: '2026-11-21T10:00:00.000Z', externalSource: 'CSFLOAT' });
    expect(count('external_links')).toBe(1);
    expect((await call(request(app).get('/api/store-balances/current'))).body.data).not.toEqual(balanceBefore);
    expect(trackings().map((t) => t.tracking).sort()).toEqual(['OPEN', 'RETRY']); // vendida ainda na proteção: acompanhada
  });

  test('9.3: compra e venda do mesmo item no mesmo lote: a compra vira item; sem o contract_sold a venda espera (SALE_TX_NOT_FOUND)', async () => {
    state.trades = [
      fakeTrade({ id: '5101', createdAt: '2026-11-20T10:00:00.000Z', protectionEndsAt: '2026-11-20T12:00:00.000Z' }),
      fakeTrade({ id: '5102', direction: 'SELL', createdAt: '2026-11-21T10:00:00.000Z', price: 1400 }),
    ];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, salesCreated: 0, failed: 1 });
    expect(res.body.data.batch.entries.find((e) => e.outcome === 'FAILED').reasonCode).toBe('SALE_TX_NOT_FOUND');
    expect((await getItems())[0]).toMatchObject({ status: 'EM_ESTOQUE', salePriceCents: null });
  });

  test('trade em que a conta não é nem comprador nem vendedor, ou é os dois: DIRECTION_UNKNOWN, nada gravado de item', async () => {
    const both = fakeTrade({ id: '5201' });
    both.seller_id = PII.steamId;
    state.trades = [both, fakeTrade({ id: '5202', steamId: PII.steamId2, createdAt: '2026-11-19T10:00:00.000Z' })];
    const res = await firstRun();
    expect(res.body.data.batch.entries.map((e) => e.reasonCode)).toEqual(['DIRECTION_UNKNOWN', 'DIRECTION_UNKNOWN']);
    expect(count('items')).toBe(0);
  });

  test('conta diferente na primeira importação: CSFLOAT_ACCOUNT_CHANGED com a impressão digital já gravada e nenhum lote novo', async () => {
    state.trades = [fakeTrade({ id: '5301' })];
    await firstRun();
    const fingerprint = dbRows('SELECT account_fingerprint AS f FROM integrations')[0].f;
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain(PII.steamId);
    state.me = meBody({ user: { steam_id: PII.steamId2 } });
    state.trades = [fakeTrade({ id: '5302', steamId: PII.steamId2, createdAt: '2026-11-21T10:00:00.000Z', item: { float_value: 0.5 } })];
    const before = { batches: count('import_batches'), records: count('external_records'), items: count('items') };
    expectError(await run({}), 409, 'CSFLOAT_ACCOUNT_CHANGED');
    expect({ batches: count('import_batches'), records: count('external_records'), items: count('items') }).toEqual(before);
    expect(dbRows('SELECT account_fingerprint AS f FROM integrations')[0].f).toBe(fingerprint);
  });
});

// --- Compra -> item --------------------------------------------------------------------------------------------------------

describe('compra -> item do app', () => {
  test('acquiredAt vem de contract.sold_at (não de created_at), o custo de contract.price e a loja é a da integração', async () => {
    state.trades = [fakeTrade({ id: '6001', createdAt: '2026-11-18T10:00:00.000Z', soldAt: '2026-11-20T16:30:00.000Z', price: 4321, listingType: 'auction' })];
    state.transactions = [purchaseTx('96001', 4321)];
    const res = await firstRun();
    expect(res.body.data.batch.entries[0]).toMatchObject({ outcome: 'CREATED', reasonCode: null });
    expect((await getItems())[0]).toMatchObject({
      acquisitionType: 'COMPRA', purchasePriceCents: 4321, purchaseCurrency: 'USD', purchaseStoreId: storeId('CSFloat'), acquiredAt: '2026-11-20T16:30:00.000Z',
    });
  });

  test('fim da proteção já passado: sem trade lock; inspect link, asset id e origem não são importados', async () => {
    state.trades = [fakeTrade({ id: '6101', state: 'verified', protectionEndsAt: '2026-11-21T14:00:00.000Z' })];
    await firstRun();
    const item = (await getItems())[0];
    expect(item.tradeUnlockAt).toBe('2026-11-21T14:00:00.000Z');
    expect(item.tradeLock.isLocked).toBe(false);
    expect(item.inspectLink ?? null).toBeNull();
    expect(item.assetId ?? null).toBeNull();
    expect(JSON.stringify(item)).not.toContain('steam://');
  });

  test('contract.price 0 entra como compra de custo 0 (sem erro e sem lixo no lote)', async () => {
    state.trades = [fakeTrade({ id: '6201', price: 0 })];
    const res = await firstRun();
    expect(res.status).toBe(200);
    expect(res.body.data.batch.entries[0]).toMatchObject({ outcome: 'CREATED', reasonCode: null });
    expect((await getItems())[0]).toMatchObject({ acquisitionType: 'COMPRA', purchasePriceCents: 0 });
  });

  test('números em string (preço) e ids numéricos seguros são aceitos como o CSFloat manda', async () => {
    const trade = fakeTrade({ id: '6301' });
    trade.id = 6301;
    trade.contract.price = '1250';
    trade.contract_id = 96301;
    trade.contract.id = 96301;
    state.trades = [trade];
    const res = await firstRun();
    expect(res.status).toBe(200);
    expect(res.body.data.batch.counts.purchasesCreated).toBe(1);
    expect((await getItems())[0].purchasePriceCents).toBe(1250);
  });

  test('a loja da importação pode ser outra loja em dólar escolhida pelo usuário', async () => {
    const other = storeId('CSMoney');
    const patch = await request(app).patch('/api/integrations/csfloat').set('Content-Type', JSON_TYPE).send({ storeId: other });
    expect(patch.status).toBe(200);
    state.trades = [fakeTrade({ id: '6401' })];
    await firstRun();
    expect((await getItems())[0].purchaseStoreId).toBe(other);
  });

  test('Doppler pela tabela de paint_index (418 = Phase 1) e pelo texto da fase em minúsculas', async () => {
    state.trades = [
      fakeTrade({ id: '6501', createdAt: '2026-11-20T10:00:00.000Z', item: { market_hash_name: '★ Karambit | Doppler (Factory New)', phase: null, paint_index: 418, float_value: 0.03, paint_seed: 8 } }),
      fakeTrade({ id: '6502', createdAt: '2026-11-19T10:00:00.000Z', item: { market_hash_name: '★ Karambit | Doppler (Factory New)', phase: 'phase 2', float_value: 0.04, paint_seed: 9 } }),
    ];
    await firstRun();
    expect((await getItems()).map((i) => [i.catalogId, i.phase]).sort()).toEqual([[CAT.KARAMBIT_DOPPLER_P1, 'Phase 1'], [CAT.KARAMBIT_DOPPLER_P2, 'Phase 2']]);
  });

  test('commodity sem float com float_value 0 ou nulo não grava atributos de arma; atributos de arma são ignorados em caixa', async () => {
    state.trades = [fakeTrade({ id: '6601', price: 5, item: { market_hash_name: 'Revolver Case', type: 'container', is_commodity: true, float_value: 0, paint_seed: 0 } })];
    await firstRun();
    const item = (await getItems())[0];
    expect(item.category).toBe('CAIXA');
    expect(item.floatValue).toBeNull();
    expect(item.paintSeed).toBeNull();
    expect(item.variant ?? null).toBeNull();
  });

  test('o GANHEI com preço não existe: a importação só cria COMPRA; origem e custo seguem o item de compra', async () => {
    state.trades = [fakeTrade({ id: '6701' })];
    await firstRun();
    expect(dbRows('SELECT DISTINCT acquisition_type AS t FROM items')).toEqual([{ t: 'COMPRA' }]);
  });
});

// --- Casamento com manuais -------------------------------------------------------------------------------------------------

describe('casamento com lançamentos manuais', () => {
  test('ligar não altera o lançamento manual (nem o updated_at) e a venda do manual continua possível', async () => {
    const m = await createManual(manual());
    const before = dbRows('SELECT * FROM items WHERE id = ?', m.id)[0];
    state.trades = [fakeTrade({ id: '7001' })];
    const res = await firstRun();
    expect(res.body.data.batch.counts.matched).toBe(1);
    expect(dbRows('SELECT * FROM items WHERE id = ?', m.id)[0]).toEqual(before);
    const sold = await request(app).post(`/api/items/${m.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 1500, soldAt: '2026-11-22T10:00:00.000Z' });
    expect(sold.status).toBe(200);
  });

  test.each([
    ['outra loja de compra', { purchaseStoreId: () => storeId('CSMoney') }],
    ['variante diferente (StatTrak)', { variant: 'STATTRAK' }],
    ['catálogo diferente', { catalogId: CAT.AWP_DLORE }],
    ['float diferente na 4a casa', { floatValue: 0.2535 }],
    ['paintSeed diferente', { paintSeed: 662 }],
    ['antes da janela do corte', { acquiredAt: '2026-10-20T09:00:00.000Z' }],
  ])('manual com %s não casa: o trade vira item novo', async (_name, change) => {
    const resolved = Object.fromEntries(Object.entries(change).map(([k, v]) => [k, typeof v === 'function' ? v() : v]));
    await createManual(manual(resolved));
    state.trades = [fakeTrade({ id: '7101' })];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ matched: 0, purchasesCreated: 1 });
    expect(count('items')).toBe(2);
  });

  test('manual GANHEI e manual já vendido: o GANHEI não casa, o vendido casa e continua vendido', async () => {
    await createManual({ catalogId: CAT.AK_REDLINE, acquisitionType: 'GANHEI', acquiredAt: '2026-11-20T09:00:00.000Z', floatValue: 0.2534, paintSeed: 661 });
    const soldItem = await createManual(manual({ floatValue: 0.2534, paintSeed: 661, acquiredAt: '2026-11-20T08:00:00.000Z' }));
    const sold = await request(app).post(`/api/items/${soldItem.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 1500, soldAt: '2026-11-21T10:00:00.000Z' });
    expect(sold.status).toBe(200);
    state.trades = [fakeTrade({ id: '7201' })];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ matched: 1, purchasesCreated: 0 });
    expect(dbRows('SELECT entity_id FROM external_links')).toEqual([{ entity_id: soldItem.id }]);
    expect(dbRows('SELECT status FROM items WHERE id = ?', soldItem.id)[0].status).toBe('VENDIDO');
  });

  test('dois trades iguais para um único manual: o primeiro liga, o segundo vira item novo (um manual nunca liga duas vezes)', async () => {
    await createManual(manual());
    state.trades = [
      fakeTrade({ id: '7301', createdAt: '2026-11-20T10:00:00.000Z' }),
      fakeTrade({ id: '7302', createdAt: '2026-11-20T12:00:00.000Z' }),
    ];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ matched: 1, purchasesCreated: 1 });
    expect(count('external_links')).toBe(2);
    expect(dbRows('SELECT COUNT(DISTINCT entity_id) AS n FROM external_links')[0].n).toBe(2);
  });

  test('dois manuais idênticos no mesmo dia para um trade com float: ambíguo, nada entra sozinho', async () => {
    const a = await createManual(manual());
    const b = await createManual(manual({ acquiredAt: '2026-11-20T11:00:00.000Z' }));
    state.trades = [fakeTrade({ id: '7401' })];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ review: 1, matched: 0, purchasesCreated: 0 });
    const entry = res.body.data.batch.entries[0];
    expect(entry.outcome).toBe('POSSIBLE_DUPLICATE');
    expect([...entry.candidateIds].sort()).toEqual([a.id, b.id].sort());
    expect(count('items')).toBe(2);
    expect(count('external_links')).toBe(0);
    expect(trackings()).toEqual([{ external_id: '7401', tracking: 'NEEDS_REVIEW' }]);
    expect(await openEntries()).toHaveLength(1);
  });

  test('sem float: dia vizinho local casa; dois dias de distância não; preço diferente não', async () => {
    await createManual(stickerManual({ acquiredAt: '2026-11-19T15:00:00.000Z' })); // dia anterior
    await createManual(stickerManual({ acquiredAt: '2026-11-17T15:00:00.000Z', purchasePriceCents: 5 })); // 3 dias antes
    await createManual(stickerManual({ acquiredAt: '2026-11-20T15:00:00.000Z', purchasePriceCents: 6 })); // preço diferente
    state.trades = [sticker('7501', '2026-11-20T15:00:00.000Z')];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ matched: 1, purchasesCreated: 0, review: 0 });
    expect(count('items')).toBe(3);
  });

  test('sem float: manuais de outra loja ou GANHEI não entram na contagem de quantidades (cria o item)', async () => {
    await createManual(stickerManual({ purchaseStoreId: storeId('CSMoney') }));
    state.trades = [sticker('7601', '2026-11-20T12:00:00.000Z')];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ matched: 0, review: 0, purchasesCreated: 1 });
  });

  test('sem float, 2 trades e 2 manuais no mesmo dia: ligam um a um, em ordem de data', async () => {
    const a = await createManual(stickerManual({ acquiredAt: '2026-11-20T10:00:00.000Z' }));
    const b = await createManual(stickerManual({ acquiredAt: '2026-11-20T11:00:00.000Z' }));
    state.trades = [sticker('7701', '2026-11-20T12:30:00.000Z'), sticker('7702', '2026-11-20T10:30:00.000Z')];
    await firstRun();
    const links = dbRows('SELECT r.external_id AS ext, l.entity_id AS item FROM external_links l JOIN external_records r ON r.id = l.record_id ORDER BY r.external_id');
    expect(links).toEqual([{ ext: '7701', item: b.id }, { ext: '7702', item: a.id }]);
  });

  test('manual criado depois da importação para um trade já importado não liga nada (sem retroativo)', async () => {
    state.trades = [fakeTrade({ id: '7801' })];
    await firstRun();
    await createManual(manual({ floatValue: 0.65 })); // outro
    const again = await run({});
    expect(again.body.data.batch.counts).toMatchObject({ matched: 0, purchasesCreated: 0, known: 1 });
  });
});

// --- PRICE_MISMATCH --------------------------------------------------------------------------------------------------------

describe('PRICE_MISMATCH pelo contract_purchased', () => {
  test('valor igual: sem aviso; valor diferente em compra ligada a manual: aviso, mas liga', async () => {
    await createManual(manual());
    state.trades = [
      fakeTrade({ id: '8001', createdAt: '2026-11-20T10:00:00.000Z', item: { float_value: 0.4, paint_seed: 4 } }),
      fakeTrade({ id: '8002', createdAt: '2026-11-19T10:00:00.000Z' }),
    ];
    state.transactions = [purchaseTx('98001', 1250), purchaseTx('98002', 1111)];
    const res = await firstRun();
    const byTrade = Object.fromEntries(res.body.data.batch.entries.map((e) => [e.display.floatValue, e]));
    expect(byTrade[0.4]).toMatchObject({ outcome: 'CREATED', reasonCode: null });
    expect(byTrade[0.2534]).toMatchObject({ outcome: 'MATCHED', reasonCode: 'PRICE_MISMATCH' });
  });

  test('sem contract_purchased no extrato não há aviso; extrato com compra duplicada: basta uma bater', async () => {
    state.trades = [fakeTrade({ id: '8101' })];
    state.transactions = [purchaseTx('98101', 1250), fakeTransaction({ id: 'tx-dup', type: 'contract_purchased', balanceOffset: -1, details: { contract_id: '98101' } })];
    const res = await firstRun();
    expect(res.body.data.batch.entries[0].reasonCode).toBeNull();
  });
});

// --- Reversão --------------------------------------------------------------------------------------------------------------

describe('reversão de compra já importada: avisa, não apaga', () => {
  test.each([
    ['cancelled com oferta 6', { state: 'cancelled', offerState: 6 }],
    ['pending, mas a oferta deixou de ser 3 (oferta 7)', { state: 'pending', offerState: 7 }],
    ['verified, mas a oferta deixou de ser 3 (oferta 5)', { state: 'verified', offerState: 5 }],
  ])('%s', async (_name, change) => {
    state.trades = [fakeTrade({ id: '9001', state: 'pending' })];
    await firstRun();
    const itemBefore = (await getItems())[0];
    state.trades = [fakeTrade({ id: '9001', ...change })];
    const res = await run({});
    expect(res.body.data.batch.counts).toMatchObject({ reverted: 1, purchasesCreated: 0 });
    expect(res.body.data.batch.entries[0]).toMatchObject({ outcome: 'REVERTED', entityType: 'ITEM_PURCHASE', entityId: itemBefore.id });
    expect(await getItems()).toEqual([itemBefore]);
    expect(count('external_links')).toBe(1);
    expect(trackings()).toEqual([{ external_id: '9001', tracking: 'REVERTED' }]);
  });

  test('rollback no extrato com o mesmo contract_id reverte um trade já fechado (SETTLED)', async () => {
    state.trades = [fakeTrade({ id: '9101', state: 'verified', protectionEndsAt: null })];
    await firstRun();
    expect(trackings()[0].tracking).toBe('SETTLED');
    state.transactions = [fakeTransaction({ id: 'tx-rb', type: 'rollback', details: { contract_id: '99101' }, createdAt: '2026-11-22T10:00:00.000Z' })];
    const res = await run({});
    expect(res.body.data.batch.counts.reverted).toBe(1);
    expect(count('items')).toBe(1);
  });

  test('compra ligada a manual e revertida: o manual continua intacto e a entrada aponta para ele', async () => {
    const m = await createManual(manual());
    const before = dbRows('SELECT * FROM items WHERE id = ?', m.id)[0];
    state.trades = [fakeTrade({ id: '9201' })];
    await firstRun();
    state.trades = [fakeTrade({ id: '9201', state: 'failed', offerState: 6 })];
    const res = await run({});
    expect(res.body.data.batch.entries[0]).toMatchObject({ outcome: 'REVERTED', entityId: m.id });
    expect(dbRows('SELECT * FROM items WHERE id = ?', m.id)[0]).toEqual(before);
  });

  test('o trade reaparece em pending/3 depois de revertido: continua REVERTED e sem nova entrada', async () => {
    state.trades = [fakeTrade({ id: '9301' })];
    await firstRun();
    state.trades = [fakeTrade({ id: '9301', state: 'failed', offerState: 6 })];
    await run({});
    state.trades = [fakeTrade({ id: '9301', state: 'verified' })];
    const res = await run({});
    expect(res.body.data.batch.counts).toMatchObject({ reverted: 0, purchasesCreated: 0 });
    expect(trackings()).toEqual([{ external_id: '9301', tracking: 'REVERTED' }]);
    expect(await openEntries()).toHaveLength(1);
  });
});

// --- Incremental -----------------------------------------------------------------------------------------------------------

describe('leitura incremental', () => {
  function bigHistory(total, { openIndex = null } = {}) {
    const trades = [];
    const txs = [];
    for (let i = 0; i < total; i += 1) {
      const minute = String(59 - (i % 60)).padStart(2, '0');
      const day = String(21 - Math.floor(i / 60)).padStart(2, '0');
      const createdAt = `2026-11-${day}T10:${minute}:00.000Z`;
      trades.push(fakeTrade({
        id: String(20000 + i), state: i === openIndex ? 'pending' : 'verified', createdAt,
        // fora da janela de acompanhamento (proteção + 2 dias já passou), menos o trade aberto
        protectionEndsAt: i === openIndex ? '2026-11-27T00:00:00.000Z' : '2026-11-19T00:00:00.000Z',
        item: { float_value: 0.2 + i / 1000, paint_seed: i },
      }));
      txs.push(purchaseTx(String(920000 + i), 1250, { id: `tx-big-${i}`, createdAt: `2026-11-${day}T10:${minute}:01.000Z` }));
    }
    return { trades, txs };
  }

  test('um trade novo no topo é importado e a leitura para na página conhecida (sem ler a lista inteira)', async () => {
    const { trades, txs } = bigHistory(120);
    state.trades = trades;
    state.transactions = txs;
    await firstRun({ cutoffAt: '2026-10-01T00:00:00.000Z' });
    state.trades = [fakeTrade({ id: '30000', createdAt: '2026-11-22T14:00:00.000Z', item: { float_value: 0.55, paint_seed: 77 } }), ...trades];
    state.transactions = [purchaseTx('930000', 1250, { id: 'tx-new', createdAt: '2026-11-22T14:00:01.000Z' }), ...txs];
    fetchFn.calls.length = 0;
    const res = await run({});
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1 });
    expect(calls('/me/trades').length).toBeLessThan(3);
    expect(dbRows('SELECT last_transaction_id AS c FROM integrations')[0].c).toBe('tx-new');
  });

  test('trade aberto lá no fim da lista é reverificado: a leitura desce até ele mesmo com páginas conhecidas no meio', async () => {
    const { trades, txs } = bigHistory(120, { openIndex: 118 });
    state.trades = trades;
    state.transactions = txs;
    await firstRun({ cutoffAt: '2026-10-01T00:00:00.000Z' });
    expect(trackings().filter((t) => t.tracking === 'OPEN')).toHaveLength(1);
    const target = trades[118];
    state.trades = trades.map((t) => (t.id === target.id ? fakeTrade({ id: target.id, state: 'failed', offerState: 6, createdAt: target.created_at, item: target.contract.item }) : t));
    fetchFn.calls.length = 0;
    const res = await run({});
    expect(res.body.data.batch.counts.reverted).toBe(1);
    expect(calls('/me/trades')).toHaveLength(3);
  });

  test('SCAN_LIMIT_REACHED: teto de 200 páginas de trades e de extrato; o lote termina (DONE) com o aviso e o que foi lido entra', async () => {
    const total = 200 * 50 + 50;
    const trades = [];
    for (let i = 0; i < total; i += 1) {
      trades.push(fakeTrade({
        id: String(100000 + i), state: 'queued', offerState: null, acceptedAt: null, createdAt: new Date(Date.parse('2026-11-22T12:00:00.000Z') - i * 1000).toISOString(),
      }));
    }
    const txs = [];
    for (let i = 0; i < total; i += 1) {
      txs.push(fakeTransaction({ id: `tx-lim-${i}`, type: 'bid_posted', createdAt: new Date(Date.parse('2026-11-22T12:00:00.000Z') - i * 1000).toISOString() }));
    }
    state.trades = trades;
    state.transactions = txs;
    const res = await firstRun({ fullScan: true });
    expect(res.status).toBe(200);
    expect(res.body.data.batch.status).toBe('DONE');
    expect(res.body.data.batch.warnings).toContain('SCAN_LIMIT_REACHED');
    expect(calls('/me/trades')).toHaveLength(200);
    expect(calls('/me/transactions')).toHaveLength(200);
    expect(count('external_records')).toBe(200 * 50 * 2);
  });

  test('o cursor do extrato só avança com a importação que deu certo (falha mantém o cursor)', async () => {
    state.trades = [fakeTrade({ id: '9801' })];
    state.transactions = [purchaseTx('99801', 1250, { id: 'tx-c1', createdAt: '2026-11-20T14:00:01.000Z' })];
    await firstRun();
    expect(dbRows('SELECT last_transaction_id AS c FROM integrations')[0].c).toBe('tx-c1');
    state.transactions = [purchaseTx('99802', 1250, { id: 'tx-c2', createdAt: '2026-11-22T10:00:01.000Z' }), ...state.transactions];
    state.failAt = { path: '/me/trades', page: 0, status: 503 };
    expectError(await run({}), 502, 'IMPORT_SOURCE_UNAVAILABLE');
    expect(dbRows('SELECT last_transaction_id AS c FROM integrations')[0].c).toBe('tx-c1');
    expect(count('external_records')).toBe(2); // 1 trade + 1 transação da primeira importação
    delete state.failAt;
    await run({});
    expect(dbRows('SELECT last_transaction_id AS c FROM integrations')[0].c).toBe('tx-c2');
  });
});

// --- Desfazer --------------------------------------------------------------------------------------------------------------

describe('desfazer importação', () => {
  test('desfazer o 2o lote restaura o cursor do 1o, mantém o corte e os registros do 1o, e a reimportação recria o item', async () => {
    state.trades = [fakeTrade({ id: '1001' })];
    state.transactions = [purchaseTx('91001', 1250, { id: 'tx-u1', createdAt: '2026-11-20T14:00:01.000Z' })];
    const first = (await firstRun()).body.data.batch;
    state.trades = [fakeTrade({ id: '1002', createdAt: '2026-11-21T10:00:00.000Z', item: { float_value: 0.4, paint_seed: 4 } }), ...state.trades];
    state.transactions = [purchaseTx('91002', 1250, { id: 'tx-u2', createdAt: '2026-11-21T10:00:01.000Z' }), ...state.transactions];
    const second = (await run({})).body.data.batch;
    expect(second.counts.purchasesCreated).toBe(1);
    expect(dbRows('SELECT last_transaction_id AS c FROM integrations')[0].c).toBe('tx-u2');
    const res = await undo(second.id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('UNDONE');
    expect(dbRows('SELECT last_transaction_id AS c FROM integrations')[0].c).toBe('tx-u1');
    expect((await call(request(app).get('/api/integrations/csfloat'))).body.data).toMatchObject({ tradesCutoffAt: CUTOFF, autoImportPaused: true });
    expect(count('items')).toBe(1);
    expect(trackings().map((t) => t.external_id)).toEqual(['1001']);
    // reimportar: o item volta e o primeiro não duplica; a pausa da importação ao abrir só sai por "Reativar" (9.5)
    const again = (await run({})).body.data.batch;
    expect(again.counts).toMatchObject({ purchasesCreated: 1, known: 1 });
    expect(count('items')).toBe(2);
    expect((await call(request(app).get('/api/integrations/csfloat'))).body.data.autoImportPaused).toBe(true);
    // o primeiro lote já não é o último que mudou algo
    expectError(await undo(first.id), 409, 'IMPORT_UNDO_NOT_LATEST');
  });

  test('desfazer o 1o lote (recomeço completo) apaga registros, entradas abertas e limpa tudo; reimportar com outro corte funciona', async () => {
    state.trades = [
      fakeTrade({ id: '1001', createdAt: '2026-11-20T10:00:00.000Z' }),
      fakeTrade({ id: '1002', createdAt: '2026-11-19T10:00:00.000Z', state: 'weird', item: { float_value: 0.4, paint_seed: 4 } }),
      fakeTrade({ id: '1003', createdAt: '2026-10-10T10:00:00.000Z', item: { float_value: 0.5, paint_seed: 5 } }),
    ];
    const first = (await firstRun()).body.data.batch;
    expect(await openEntries()).toHaveLength(1);
    expect((await undo(first.id)).status).toBe(200);
    expect(count('external_records')).toBe(0);
    expect(count('external_links')).toBe(0);
    expect(await openEntries()).toEqual([]);
    expect(count('items')).toBe(0);
    const batches = (await call(request(app).get('/api/imports/batches'))).body.data.batches;
    expect(batches[0]).toMatchObject({ id: first.id, status: 'UNDONE', undoable: false });
    const view = (await call(request(app).get(`/api/imports/batches/${first.id}`))).body.data;
    expect(view.status).toBe('UNDONE');
    // novo corte, que agora inclui o trade antigo
    const again = await run({ cutoffAt: '2026-10-01T00:00:00.000Z' });
    expect(again.body.data.batch.counts).toMatchObject({ purchasesCreated: 2, unknownState: 1, beforeCutoff: 0 });
  });

  test('desfazer só desliga o manual ligado: o lançamento fica intacto mesmo se editado depois, sem aviso', async () => {
    const m = await createManual(manual());
    state.trades = [fakeTrade({ id: '1001' })];
    const batch = (await firstRun()).body.data.batch;
    const edit = await request(app).patch(`/api/items/${m.id}`).send({ purchasePriceCents: 1300 });
    expect(edit.status).toBe(200);
    const preview = await undoPreview(batch.id);
    expect(preview).toMatchObject({ undoable: true, blockers: [], warnings: [], counts: { itemsToDelete: 0, linksToRemove: 1 } });
    expect((await undo(batch.id)).status).toBe(200);
    expect(dbRows('SELECT purchase_price_cents AS p FROM items WHERE id = ?', m.id)).toEqual([{ p: 1300 }]);
    expect((await getItems())[0].externalSource).toBeNull();
  });

  test('item criado e editado depois: aviso ITEM_EDITED; com confirmWarnings o desfazer apaga o item', async () => {
    state.trades = [fakeTrade({ id: '1001' })];
    const batch = (await firstRun()).body.data.batch;
    const item = (await getItems())[0];
    clock = new Date('2026-11-22T16:00:00.000Z');
    expect((await request(app).patch(`/api/items/${item.id}`).send({ paintSeed: 5 })).status).toBe(200);
    const preview = await undoPreview(batch.id);
    expect(preview.warnings.map((w) => w.code)).toEqual(['ITEM_EDITED']);
    expectError(await undo(batch.id, { confirmWarnings: false }), 409, 'IMPORT_UNDO_WARNINGS_NOT_CONFIRMED');
    expect(count('items')).toBe(1);
    expect((await undo(batch.id, { confirmWarnings: true })).status).toBe(200);
    expect(count('items')).toBe(0);
  });

  test('item vendido no app bloqueia; depois de desfazer a venda, o bloqueio some', async () => {
    state.trades = [fakeTrade({ id: '1001', protectionEndsAt: '2026-11-21T14:00:00.000Z' })];
    const batch = (await firstRun()).body.data.batch;
    const item = (await getItems())[0];
    clock = new Date('2026-11-22T16:00:00.000Z');
    await request(app).post(`/api/items/${item.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 1500, soldAt: '2026-11-22T10:00:00.000Z' });
    expectError(await undo(batch.id, { confirmWarnings: true }), 409, 'IMPORT_UNDO_CONFLICT');
    expect(count('items')).toBe(1);
    expect((await request(app).post(`/api/items/${item.id}/unsell`).send({})).status).toBe(200);
    const preview = await undoPreview(batch.id);
    expect(preview.blockers).toEqual([]);
    expect((await undo(batch.id, { confirmWarnings: true })).status).toBe(200);
    expect(count('items')).toBe(0);
  });

  test('lote FAILED não é desfazível; lote sem mudanças não; corpo inválido é recusado', async () => {
    state.failAt = { path: '/me/trades', page: 0, status: 500 };
    await firstRun();
    delete state.failAt;
    const failed = dbRows("SELECT id FROM import_batches WHERE status = 'FAILED'")[0].id;
    expect((await undoPreview(failed))).toMatchObject({ undoable: false, reason: 'FAILED_BATCH' });
    expectError(await undo(failed), 409, 'IMPORT_UNDO_NOT_LATEST');
    expectError(await undo(failed, { confirmWarnings: 'sim' }), 400, 'INVALID_FIELD', { field: 'confirmWarnings' });
    expectError(await call(request(app).post(`/api/imports/batches/${failed}/undo`).set('Content-Type', 'text/plain').send('x')), 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  test('desfazer durante uma importação em andamento: IMPORT_IN_PROGRESS', async () => {
    state.trades = [fakeTrade({ id: '1001' })];
    const batch = (await firstRun()).body.data.batch;
    const release = gatedApp();
    const running = run({});
    await tick();
    try {
      expectError(await undo(batch.id), 409, 'IMPORT_IN_PROGRESS');
    } finally {
      release();
    }
    expect((await running).status).toBe(200);
    expect(count('items')).toBe(1);
  });
});

// --- detachOnRemove --------------------------------------------------------------------------------------------------------

describe('excluir ou desfazer venda de lançamento ligado: o vínculo desliga e a reimportação não duplica nem quebra', () => {
  test('excluir manual ligado: REMOVED_IN_APP, entradas abertas resolvidas, e importar de novo não recria nada', async () => {
    const m = await createManual(manual());
    state.trades = [fakeTrade({ id: '1001' })];
    await firstRun();
    state.trades = [fakeTrade({ id: '1001', state: 'failed', offerState: 6 })];
    await run({});
    expect(await openEntries()).toHaveLength(1);
    expect((await request(app).delete(`/api/items/${m.id}`)).status).toBe(200);
    expect(await openEntries()).toEqual([]);
    expect(trackings()).toEqual([{ external_id: '1001', tracking: 'REMOVED_IN_APP' }]);
    state.trades = [fakeTrade({ id: '1001' })]; // o CSFloat volta a mostrar como aceito
    const res = await run({});
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 0, matched: 0, known: 1 });
    expect(count('items')).toBe(0);
    expect(count('external_links')).toBe(0);
  });

  test('desfazer o lote depois de excluir o item à mão não quebra (vínculo já não existe)', async () => {
    state.trades = [fakeTrade({ id: '1001' }), fakeTrade({ id: '1002', createdAt: '2026-11-19T10:00:00.000Z', item: { float_value: 0.4, paint_seed: 4 } })];
    const batch = (await firstRun()).body.data.batch;
    const first = (await getItems())[0];
    await request(app).delete(`/api/items/${first.id}`);
    const preview = await undoPreview(batch.id);
    expect(preview.undoable).toBe(true);
    expect((await undo(batch.id)).status).toBe(200);
    expect(count('items')).toBe(0);
  });

  test('desfazer venda (unsell) de item com vínculo de venda desliga o vínculo e marca o registro como removido', async () => {
    const m = await createManual(manual());
    expect((await request(app).post(`/api/items/${m.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 1500, soldAt: '2026-11-21T10:00:00.000Z' })).status).toBe(200);
    // vínculo de venda inserido direto (a importação de vendas é da 9.3); o serviço de itens precisa desligá-lo
    const db = getDb();
    const stamp = '2026-11-22T00:00:00.000Z';
    const batchId = db.prepare(`INSERT INTO import_batches (source, trigger, status, started_at, finished_at, created_at) VALUES ('CSFLOAT','MANUAL','DONE',?,?,?)`).run(stamp, stamp, stamp).lastInsertRowid;
    const recordId = db.prepare(
      `INSERT INTO external_records (source, kind, external_id, direction, tracking, external_created_at, last_seen_at, created_at, updated_at)
       VALUES ('CSFLOAT','TRADE','SALE-1','SELL','SETTLED',?,?,?,?)`
    ).run(stamp, stamp, stamp, stamp).lastInsertRowid;
    db.prepare(`INSERT INTO external_links (record_id, entity_type, entity_id, link_kind, batch_id, entity_updated_at, created_at) VALUES (?, 'ITEM_SALE', ?, 'MATCHED', ?, ?, ?)`).run(recordId, m.id, batchId, stamp, stamp);
    expect((await request(app).post(`/api/items/${m.id}/unsell`).send({})).status).toBe(200);
    expect(count('external_links')).toBe(0);
    expect(dbRows('SELECT tracking FROM external_records WHERE external_id = ?', 'SALE-1')[0].tracking).toBe('REMOVED_IN_APP');
  });
});

// --- Concorrência e falhas -------------------------------------------------------------------------------------------------

describe('concorrência e recuperação', () => {
  test('depois de uma falha de rede o trinco é liberado e a próxima importação funciona; o app segue respondendo', async () => {
    state.trades = [fakeTrade({ id: '1001' })];
    const original = fetchFn;
    fetchFn = jest.fn(async () => { throw new TypeError('fetch failed'); });
    fetchFn.calls = [];
    app = createApp({ now: () => new Date(clock.getTime()), fetchFn, sleepFn: async () => {} });
    const bad = await firstRun();
    expect(bad.status).toBe(502);
    expect(bad.body.error.code).toBe('IMPORT_SOURCE_UNREACHABLE');
    expect(bad.body.error.message).toEqual(expect.any(String));
    expect((await call(request(app).get('/api/integrations/csfloat'))).body.data.importInProgress).toBe(false);
    expect((await call(request(app).get('/api/health'))).status).toBe(200);
    expect((await call(request(app).get('/api/items'))).status).toBe(200);
    app = createApp({ now: () => new Date(clock.getTime()), fetchFn: original, sleepFn: async () => {} });
    expect((await firstRun()).status).toBe(200);
  });

  test('resolver a corrida: de 5 chamadas simultâneas, exatamente uma importa e as outras 4 recebem IMPORT_IN_PROGRESS', async () => {
    state.trades = [fakeTrade({ id: '1001' })];
    const release = gatedApp();
    const all = Array.from({ length: 5 }, () => firstRun());
    await tick(60);
    release();
    const results = await Promise.all(all);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
    results.filter((r) => r.status === 409).forEach((r) => expect(r.body.error.code).toBe('IMPORT_IN_PROGRESS'));
    expect(count('items')).toBe(1);
    expect(count('import_batches')).toBe(1);
  });

  test('o GET da integração mostra importInProgress durante a execução e o botão (resumo) depois', async () => {
    state.trades = [fakeTrade({ id: '1001' })];
    const release = gatedApp();
    const running = firstRun();
    await tick();
    const during = (await call(request(app).get('/api/integrations/csfloat'))).body.data;
    expect(during.importInProgress).toBe(true);
    release();
    await running;
    expect((await call(request(app).get('/api/integrations/csfloat'))).body.data.importInProgress).toBe(false);
  });

  test('importação recusada por BACKUP_BUSY quando há exportação/importação de backup em andamento; nada é lido', async () => {
    const backupService = require('../../src/services/backupService');
    jest.spyOn(backupService, 'isBackupBusy').mockReturnValue(true);
    expectError(await firstRun(), 409, 'BACKUP_BUSY');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(count('import_batches')).toBe(0);
  });
});

// --- Atomicidade e erros ---------------------------------------------------------------------------------------------------

describe('atomicidade e mensagens de erro', () => {
  test('erro na aplicação do 2o de 3 itens: o 1o não fica gravado (tudo ou nada) e só o lote FAILED existe', async () => {
    state.trades = [
      fakeTrade({ id: '1001', createdAt: '2026-11-20T10:00:00.000Z', item: { float_value: 0.31, paint_seed: 1 } }),
      fakeTrade({ id: '1002', createdAt: '2026-11-21T10:00:00.000Z', item: { float_value: 0.32, paint_seed: 2 } }),
      fakeTrade({ id: '1003', createdAt: '2026-11-22T10:00:00.000Z', item: { float_value: 0.33, paint_seed: 3 } }),
    ];
    const itemService = require('../../src/services/itemService');
    const real = itemService.createItem;
    let n = 0;
    jest.spyOn(itemService, 'createItem').mockImplementation((...args) => {
      n += 1;
      if (n === 2) throw new TypeError('boom');
      return real(...args);
    });
    const res = await firstRun();
    expect(res.status).toBe(500);
    expect(count('items')).toBe(0);
    expect(count('external_records')).toBe(0);
    expect(count('external_links')).toBe(0);
    expect(count('import_batch_entries')).toBe(0);
    expect(dbRows('SELECT status, error_code FROM import_batches')).toEqual([{ status: 'FAILED', error_code: 'INTERNAL_ERROR' }]);
    expect(dbRows('SELECT trades_cutoff_at AS c, last_transaction_id AS t FROM integrations')[0]).toEqual({ c: null, t: null });
    jest.restoreAllMocks();
    expect((await firstRun()).body.data.batch.counts.purchasesCreated).toBe(3);
  });

  test.each([
    ['/me', 401, 'CSFLOAT_AUTH_FAILED'],
    ['/me/transactions', 429, 'IMPORT_RATE_LIMITED'],
    ['/me/transactions', 403, 'CSFLOAT_AUTH_FAILED'],
    ['/me/trades', 502, 'IMPORT_SOURCE_UNAVAILABLE'],
  ])('falha em %s (HTTP %s): lote FAILED com %s, mensagem em português, sem dados parciais e sem vazar o corpo do erro', async (path, status, code) => {
    state.trades = [fakeTrade({ id: '1001' })];
    state.failAt = { path, status, body: { message: `chave ${KEY} inválida para ${PII.username} (${OTHER.steamId})` } };
    const res = await firstRun();
    expectError(res, 502, code);
    expect(res.body.error.message).not.toMatch(/undefined|\[object/);
    expect(count('items')).toBe(0);
    expect(count('external_records')).toBe(0);
    const batches = (await call(request(app).get('/api/imports/batches'))).body.data.batches;
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ status: 'FAILED', errorCode: code, undoable: false });
  });

  test('formato mudou no extrato (sem lista) -> IMPORT_SOURCE_FORMAT_CHANGED e nada gravado', async () => {
    const inner = routedFetch(state);
    fetchFn = jest.fn(async (url, init) => (String(url).includes('/me/transactions') ? fakeResponse(200, { data: [] }) : inner(url, init)));
    fetchFn.calls = [];
    app = createApp({ now: () => new Date(clock.getTime()), fetchFn, sleepFn: async () => {} });
    expectError(await firstRun(), 502, 'IMPORT_SOURCE_FORMAT_CHANGED');
    expect(count('external_records')).toBe(0);
  });

  test('falha numa importação posterior não toca no que já foi importado e não muda o último lote desfazível', async () => {
    state.trades = [fakeTrade({ id: '1001' })];
    const first = (await firstRun()).body.data.batch;
    const snapshot = { items: await getItems(), records: dbRows('SELECT * FROM external_records ORDER BY id') };
    state.failAt = { path: '/me/trades', page: 0, status: 500 };
    await run({});
    expect(await getItems()).toEqual(snapshot.items);
    expect(dbRows('SELECT * FROM external_records ORDER BY id')).toEqual(snapshot.records);
    expect((await undoPreview(first.id)).undoable).toBe(true);
    const view = (await call(request(app).get('/api/integrations/csfloat'))).body.data;
    expect(view).toMatchObject({ lastImportStatus: 'FAILED', lastImportErrorCode: 'IMPORT_SOURCE_UNAVAILABLE' });
  });

  test('registro com dado essencial inválido entra como falha e não apaga o lançamento já importado dele', async () => {
    state.trades = [fakeTrade({ id: '1001' })];
    await firstRun();
    const broken = fakeTrade({ id: '1001' });
    delete broken.contract.item.market_hash_name;
    state.trades = [broken];
    const res = await run({});
    expect(res.status).toBe(200);
    expect(count('items')).toBe(1);
    expect(count('external_links')).toBe(1);
  });
});

// --- Privacidade -----------------------------------------------------------------------------------------------------------

describe('privacidade', () => {
  test('campos pessoais e desconhecidos em trades e transações nunca chegam ao banco, às respostas nem ao console', async () => {
    const trade = fakeTrade({ id: '1001' });
    trade.surprise = 'UNKNOWN-FIELD-PII-QA';
    trade.buyer.email = PII.email;
    trade.contract.item.custom_name = 'UNKNOWN-FIELD-PII-QA';
    trade.steam_offer.partner_steam_id = OTHER.steamId;
    state.trades = [trade, fakeTrade({ id: '1002', direction: 'SELL', createdAt: '2026-11-19T10:00:00.000Z' }), fakeTrade({ id: '1003', state: 'weird', createdAt: '2026-11-18T10:00:00.000Z' })];
    const tx = purchaseTx('91001', 1250);
    tx.details.payment_account = PII.payment;
    tx.details.stripe_id = PII.stripe;
    tx.details.email = PII.email;
    tx.surprise = 'UNKNOWN-FIELD-PII-QA';
    state.transactions = [tx, fakeTransaction({ id: 'tx-dep', type: 'deposit', balanceOffset: 5000, details: { fee: '100', payment_method: 'card', payment_processor: PII.stripe, exchange_rate: '5.5' } })];
    const res = await firstRun();
    expect(res.status).toBe(200);
    await call(request(app).get('/api/imports/batches'));
    await call(request(app).get('/api/imports/entries?open=true'));
    await call(request(app).get(`/api/imports/batches/${res.body.data.batch.id}`));
    await call(request(app).get('/api/items'));
    await call(request(app).get('/api/integrations/csfloat'));
    // varredura reforçada: a coluna a coluna do banco inteiro (o afterEach repete para todos os segredos)
    for (const t of ['external_records', 'import_batch_entries', 'import_batches', 'integrations']) {
      const text = JSON.stringify(dbRows(`SELECT * FROM ${t}`).map((r) => ({ ...r, api_key: undefined })));
      for (const secret of [...TRADE_PII, ...Object.values(PII), 'UNKNOWN-FIELD-PII-QA', 'steam://']) expect(text).not.toContain(secret);
    }
  });

  test('o Steam ID da conta só existe como impressão digital HMAC; trocar a chave não o expõe; mensagens de erro não o citam', async () => {
    state.trades = [fakeTrade({ id: '1001' })];
    await firstRun();
    expect(JSON.stringify(dbRows('SELECT * FROM integrations').map((r) => ({ ...r, api_key: undefined })))).not.toContain(PII.steamId);
    state.me = meBody({ user: { steam_id: PII.steamId2 } });
    const changed = await run({});
    expectError(changed, 409, 'CSFLOAT_ACCOUNT_CHANGED');
    expect(JSON.stringify(changed.body)).not.toContain(PII.steamId2);
  });

  test('a chave sentinela não aparece em nenhuma tabela de importação nem em respostas de falha de autenticação', async () => {
    state.failAt = { path: '/me', status: 401, body: `Bearer ${KEY} rejeitada` };
    const res = await firstRun();
    expectError(res, 502, 'CSFLOAT_AUTH_FAILED');
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(JSON.stringify(dbRows('SELECT * FROM import_batches'))).not.toContain(KEY);
  });
});

// --- Saldo e lucro real ----------------------------------------------------------------------------------------------------

describe('saldo calculado e lucro real: a compra importada pesa como uma compra manual', () => {
  const csf = () => storeId('CSFloat');
  const balance = async () => (await call(request(app).get('/api/store-balances/current'))).body.data.stores.find((s) => s.storeName === 'CSFloat');
  const profit = async () => (await call(request(app).get('/api/profit/summary'))).body.data;

  async function deposit() {
    const res = await request(app).post('/api/deposits').send({ storeId: csf(), amountStoreCents: 10000, depositedAt: '2026-11-02T12:00:00.000Z' });
    expect(res.status).toBe(201);
  }

  test('o disponível cai exatamente o preço, igual a lançar a mesma compra à mão; ligada ao manual não desconta duas vezes; desfazer devolve', async () => {
    await deposit();
    const base = await balance();
    expect(base.availableCents).toBe(10000);
    const baseProfit = await profit();

    // 1) lançada à mão
    const m = await createManual(manual({ floatValue: 0.31, paintSeed: 1 }));
    const afterManual = await balance();
    expect(afterManual.availableCents).toBe(8750);
    const profitManual = await profit();
    await request(app).delete(`/api/items/${m.id}`);
    expect((await balance()).availableCents).toBe(10000);

    // 2) importada
    state.trades = [fakeTrade({ id: '1001', item: { float_value: 0.31, paint_seed: 1 } })];
    state.transactions = [purchaseTx('91001', 1250)];
    const batch = (await firstRun()).body.data.batch;
    const afterImport = await balance();
    expect(afterImport.availableCents).toBe(afterManual.availableCents);
    expect(afterImport.breakdown).toEqual(afterManual.breakdown);
    expect(await profit()).toEqual(profitManual);

    // 3) desfazer devolve
    await undo(batch.id);
    expect((await balance()).availableCents).toBe(10000);
    expect(await profit()).toEqual(baseProfit);

    // 4) manual + importação ligada: continua descontando uma vez só
    await createManual(manual({ floatValue: 0.31, paintSeed: 1 }));
    await firstRun({ cutoffAt: CUTOFF });
    expect((await balance()).availableCents).toBe(8750);
    expect(count('items')).toBe(1);
  });

  test('compra com PRICE_MISMATCH desconta o preço do trade; GANHEI e trades de venda não mexem no saldo', async () => {
    await deposit();
    await createManual({ catalogId: CAT.AK_REDLINE, acquisitionType: 'GANHEI', acquiredAt: '2026-11-20T09:00:00.000Z', floatValue: 0.65, paintSeed: 9 });
    state.trades = [
      fakeTrade({ id: '1001', createdAt: '2026-11-20T10:00:00.000Z' }),
      fakeTrade({ id: '1002', direction: 'SELL', state: 'verified', price: 9999, createdAt: '2026-11-21T10:00:00.000Z', item: { float_value: 0.65, paint_seed: 9 } }),
    ];
    state.transactions = [purchaseTx('91001', 1300)];
    await firstRun();
    const b = await balance();
    expect(b.availableCents).toBe(10000 - 1250);
    expect(b.pending.cents).toBe(0);
  });

  test('a compra importada cai no estoque pelo custo do lucro real (mesmo cálculo da compra manual)', async () => {
    await deposit();
    const before = await profit();
    state.trades = [fakeTrade({ id: '1001' })];
    await firstRun();
    const after = await profit();
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
    expect(JSON.stringify(after)).toContain('1250');
  });
});
