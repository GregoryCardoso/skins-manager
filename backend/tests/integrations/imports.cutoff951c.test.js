'use strict';

// 9.5.1c (D324 a D326): varredura completa respeitando o corte, data de corte editável (pré-visualização, para trás, para frente)
// e desfazer restaurando o corte. Banco em memória, fetchFn falso roteado e dados INVENTADOS. Nenhuma chamada real ao CSFloat.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, CAT } = require('../helpers/catalog');
const { storeId, expectError } = require('../helpers/apiFixtures');
const { KEY, meBody, fakeTrade, fakeTransaction, purchaseTx, routedFetch } = require('../helpers/csfloatFixtures');

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
const change = (cutoffAt, confirm = true) => post('/api/imports/csfloat/change-cutoff', { cutoffAt, confirm });
const preview = (cutoffAt) => request(app).get(`/api/imports/csfloat/cutoff-preview?cutoffAt=${encodeURIComponent(cutoffAt)}`);
const integration = async () => (await request(app).get('/api/integrations/csfloat')).body.data;
const tracking = (id) => getDb().prepare("SELECT tracking FROM external_records WHERE kind = 'TRADE' AND external_id = ?").get(id).tracking;
const count = (sql) => getDb().prepare(`SELECT COUNT(*) AS n FROM ${sql}`).get().n;

// Compra (fora da proteção) com float próprio; venda do mesmo float; crédito da venda.
const buy = (id, createdAt, floatValue, price = 1000) => fakeTrade({ id, createdAt, state: 'verified', protectionEndsAt: null, price, item: { float_value: floatValue, paint_seed: Number(id) % 1000 } });
const sell = (id, createdAt, floatValue, paintSeed) => fakeTrade({ id, direction: 'SELL', createdAt, state: 'verified', protectionEndsAt: null, price: 1500, item: { float_value: floatValue, paint_seed: paintSeed } });
const soldTx = (id, createdAt) => fakeTransaction({ id: `tx-sold-${id}`, type: 'contract_sold', pendingOffset: 1470, createdAt, details: { contract_id: `9${id}`, fee_amount: '30' } });

beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  useApp();
  const res = await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY });
  expect(res.status).toBe(200);
});
afterAll(() => closeDb());

// Histórico: A (10-15) e a venda de A (10-20), B (10-05, igual a um lançamento manual), C (09-01), D (11-10, depois do corte).
async function history() {
  const manualB = await post('/api/items', {
    catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 1000,
    acquiredAt: '2026-10-05T09:00:00.000Z', floatValue: 0.2, paintSeed: 2,
  });
  expect(manualB.status).toBe(201);
  await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 5000, depositedAt: '2026-10-02T12:00:00.000Z' });
  state.trades = [
    buy('1004', '2026-11-10T10:00:00.000Z', 0.4),
    sell('2001', '2026-10-25T10:00:00.000Z', 0.1, 1),
    buy('1001', '2026-10-15T10:00:00.000Z', 0.1),
    buy('1002', '2026-10-05T10:00:00.000Z', 0.2),
    buy('1003', '2026-09-01T10:00:00.000Z', 0.3),
  ];
  state.transactions = [
    purchaseTx('91004', 1000, { createdAt: '2026-11-10T10:00:01.000Z' }),
    soldTx('2001', '2026-10-25T10:00:05.000Z'),
    purchaseTx('91001', 1000, { createdAt: '2026-10-15T10:00:01.000Z' }),
  ];
  const first = (await run({ cutoffAt: CUTOFF })).body.data.batch;
  expect(first.counts).toMatchObject({ purchasesCreated: 1, beforeCutoff: 4 });
  return { manualB: manualB.body.data, first };
}

describe('varredura completa (D324)', () => {
  test('lê todo o histórico mas respeita o corte: nada antes dele entra e nada duplica', async () => {
    await history();
    const full = (await run({ fullScan: true })).body.data.batch;
    expect(full).toMatchObject({ fullScan: true, counts: { purchasesCreated: 0, salesCreated: 0, beforeCutoff: 4, known: 1 } });
    expect(count('items')).toBe(2); // D e o manual B
  });
});

describe('data de corte para trás (D325)', () => {
  test('pré-visualização mostra até quanto entra, os aportes no intervalo e os lançamentos manuais', async () => {
    await history();
    const res = await preview('2026-10-01T00:00:00.000Z');
    expect(res.status).toBe(200);
    // Revisão 28: a pré-visualização da data única também traz os aportes e saques (testados em imports.transfers.test.js)
    expect(res.body.data.transfers).toEqual(expect.objectContaining({ deposits: { count: 0, amountCents: 0 } }));
    delete res.body.data.transfers;
    expect(res.body.data).toEqual({
      currentCutoffAt: CUTOFF, newCutoffAt: '2026-10-01T00:00:00.000Z', direction: 'BACKWARD', forward: null,
      backward: {
        purchases: { count: 2, amountCents: 2000 }, sales: { count: 1, amountCents: 1500 }, mayHaveUnseen: true,
        deposits: [{ id: expect.any(Number), depositedAt: '2026-10-02T12:00:00.000Z', amountStoreCents: 5000 }],
        manualLaunches: { purchases: 1, sales: 0 },
      },
    });
    expect(await integration()).toMatchObject({ tradesCutoffAt: CUTOFF }); // a pré-visualização não grava nada
  });

  test('antecipar importa o intervalo (compras antes das vendas), liga o manual sem duplicar e grava o corte', async () => {
    const { manualB } = await history();
    const res = await change('2026-10-01T00:00:00.000Z');
    expect(res.status).toBe(200);
    const batch = res.body.data.batch;
    expect(batch).toMatchObject({
      fullScan: true, cutoffAt: '2026-10-01T00:00:00.000Z', cutoffChange: { from: CUTOFF, to: '2026-10-01T00:00:00.000Z' },
      counts: { purchasesCreated: 1, matched: 1, salesCreated: 1, beforeCutoff: 1 },
    });
    expect(await integration()).toMatchObject({ tradesCutoffAt: '2026-10-01T00:00:00.000Z' });
    expect(tracking('1003')).toBe('BEFORE_CUTOFF');
    expect(getDb().prepare("SELECT entity_id FROM external_links WHERE link_kind = 'MATCHED'").get().entity_id).toBe(manualB.id);
    expect(count("items WHERE status = 'VENDIDO'")).toBe(1);
    expect(count('items')).toBe(3);
  });

  test('desfazer o lote da mudança restaura o corte, tira o que entrou e não reimporta na próxima', async () => {
    const { manualB } = await history();
    const batch = (await change('2026-10-01T00:00:00.000Z')).body.data.batch;
    const undo = await post(`/api/imports/batches/${batch.id}/undo`, { confirmWarnings: true });
    expect(undo.status).toBe(200);
    expect(await integration()).toMatchObject({ tradesCutoffAt: CUTOFF });
    expect(count('items')).toBe(2); // D e o manual B (intacto)
    expect((await request(app).get(`/api/items/${manualB.id}`)).body.data).toMatchObject({ status: 'EM_ESTOQUE', externalSource: null });
    for (const id of ['1001', '1002', '2001', '1003']) expect(tracking(id)).toBe('BEFORE_CUTOFF');
    const again = (await run({})).body.data.batch;
    expect(again.counts).toMatchObject({ purchasesCreated: 0, salesCreated: 0, matched: 0 });
  });

  test('falha de rede durante a mudança: o corte não muda e nada é gravado', async () => {
    await history();
    state.failAt = { path: '/me/trades', status: 503 };
    expectError(await change('2026-10-01T00:00:00.000Z'), 502, 'IMPORT_SOURCE_UNAVAILABLE');
    expect(await integration()).toMatchObject({ tradesCutoffAt: CUTOFF });
    expect(count('items')).toBe(2);
  });
});

describe('data de corte para frente (D325)', () => {
  test('o importado continua; trades e pendências abertas antes do corte novo são fechados', async () => {
    state.trades = [sell('2002', '2026-11-12T10:00:00.000Z', 0.5, 9), buy('1004', '2026-11-10T10:00:00.000Z', 0.4)];
    state.transactions = [soldTx('2002', '2026-11-12T10:00:05.000Z'), purchaseTx('91004', 1000, { createdAt: '2026-11-10T10:00:01.000Z' })];
    const first = (await run({ cutoffAt: CUTOFF })).body.data.batch;
    expect(first.counts).toMatchObject({ purchasesCreated: 1, withoutPurchase: 1 });

    const pre = (await preview('2026-11-15T00:00:00.000Z')).body.data;
    expect(pre).toMatchObject({ direction: 'FORWARD', backward: null, forward: { importedKept: 1, openToClose: 1 } });

    const batch = (await change('2026-11-15T00:00:00.000Z')).body.data.batch;
    expect(batch.cutoffChange).toEqual({ from: CUTOFF, to: '2026-11-15T00:00:00.000Z' });
    expect(count('items')).toBe(1); // o importado continua
    expect(tracking('2002')).toBe('BEFORE_CUTOFF');
    expect((await request(app).get('/api/imports/entries?open=true')).body.data.entries).toEqual([]);
  });
});

describe('validação', () => {
  test('sem primeira importação, igual, futura, sem confirmação, inválida', async () => {
    expectError(await preview('2026-10-01T00:00:00.000Z'), 409, 'IMPORT_CUTOFF_NOT_SET');
    expectError(await change('2026-10-01T00:00:00.000Z'), 409, 'IMPORT_CUTOFF_NOT_SET');
    await run({ cutoffAt: CUTOFF });
    expectError(await change(CUTOFF), 400, 'IMPORT_CUTOFF_UNCHANGED');
    expectError(await preview(CUTOFF), 400, 'IMPORT_CUTOFF_UNCHANGED');
    expectError(await change('2026-12-01T00:00:00.000Z'), 400, 'DATE_IN_FUTURE');
    expectError(await change('2026-10-01T00:00:00.000Z', false), 400, 'CONFIRMATION_REQUIRED');
    expectError(await change('ontem'), 400, 'INVALID_DATE');
    expectError(await post('/api/imports/csfloat/change-cutoff', { confirm: true }), 400, 'IMPORT_CUTOFF_REQUIRED');
    expectError(await post('/api/imports/csfloat/change-cutoff', { cutoffAt: CUTOFF, confirm: true, extra: 1 }), 400, 'UNKNOWN_FIELD');
    expectError(await request(app).get('/api/imports/csfloat/cutoff-preview'), 400, 'IMPORT_CUTOFF_REQUIRED');
    // o run (manual ou automático) não muda o corte
    expectError(await run({ newCutoffAt: '2026-10-01T00:00:00.000Z' }), 400, 'UNKNOWN_FIELD');
  });
});
