'use strict';

// 9.4 (D294, D301, D302, E9-Q22): reversões e resolução de pendências. Banco em memória, fetchFn falso roteado e dados INVENTADOS.
// Nenhuma chamada real ao CSFloat.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, CAT } = require('../helpers/catalog');
const { storeId, expectError } = require('../helpers/apiFixtures');
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
const post = (url, body = {}) => call(request(app).post(url).set('Content-Type', JSON_TYPE).send(body));
const run = (body = {}) => post('/api/imports/csfloat/run', body);
const firstRun = (extra = {}) => run({ cutoffAt: CUTOFF, ...extra });
const resolve = (id, body) => post(`/api/imports/entries/${id}/resolve`, body);
const getItem = async (id) => call(request(app).get(`/api/items/${id}`));
const dbRows = (sql, ...params) => getDb().prepare(sql).all(...params);
const count = (table) => dbRows(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
const tracking = (externalId) => dbRows("SELECT tracking FROM external_records WHERE kind = 'TRADE' AND external_id = ?", externalId)[0].tracking;
const openEntries = async () => (await call(request(app).get('/api/imports/entries?open=true'))).body.data.entries;
const csfBalance = async () =>
  (await call(request(app).get('/api/store-balances/current'))).body.data.stores.find((s) => s.storeName === 'CSFloat');
const createManual = async (body) => {
  const res = await post('/api/items', body);
  if (res.status !== 201) throw new Error(`criação manual falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
};
const manual = (extra = {}) => ({
  catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 1250,
  acquiredAt: '2026-11-20T09:00:00.000Z', floatValue: 0.2534, paintSeed: 661, ...extra,
});
// Compra aceita, na proteção (até 27/11 14:00).
const buy = (extra = {}) => fakeTrade({ id: '1001', state: 'pending', ...extra });

async function importOnePurchase() {
  state.trades = [buy()];
  state.transactions = [purchaseTx('91001', 1250)];
  const batch = (await firstRun()).body.data.batch;
  return { batch, itemId: batch.entries[0].entityId };
}

beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  clock = NOW;
  responses.length = 0;
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) consoleSpies.push(jest.spyOn(console, method).mockImplementation(() => {}));
  useApp();
  const res = await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY });
  expect(res.status).toBe(200);
});
afterEach(() => {
  const consoleOutput = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls.map((args) => args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : a)))));
  while (consoleSpies.length) consoleSpies.pop().mockRestore();
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
  for (const secret of [KEY, ...Object.values(PII), ...TRADE_PII]) {
    expect(all).not.toContain(secret);
    expect(consoleOutput).not.toContain(secret);
    expect(dumpText).not.toContain(secret);
  }
});
afterAll(() => closeDb());

describe('compra revertida', () => {
  test('state failed: entrada REVERTED com os dados do item; "Remover lançamento" exclui o item e devolve o saldo', async () => {
    const { itemId } = await importOnePurchase();
    expect((await csfBalance()).availableCents).toBe(-1250);

    state.trades = [buy({ state: 'failed' })];
    const batch = (await run()).body.data.batch;
    expect(batch.counts).toMatchObject({ reverted: 1, purchasesCreated: 0 });
    const entry = batch.entries[0];
    expect(entry).toMatchObject({
      outcome: 'REVERTED', reasonCode: 'REVERTED_STATE_FAILED', entityType: 'ITEM_PURCHASE', entityId: itemId, linkKind: 'CREATED',
      display: { name: 'AK-47 | Redline', catalogId: CAT.AK_REDLINE, floatValue: 0.2534, state: 'failed' },
    });
    // nada é apagado sozinho
    expect((await getItem(itemId)).status).toBe(200);
    expect(tracking('1001')).toBe('REVERTED');
    expect((await openEntries()).map((e) => e.id)).toEqual([entry.id]);

    const res = await resolve(entry.id, { action: 'REMOVE' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: entry.id, resolution: 'REMOVED' });
    expect((await getItem(itemId)).status).toBe(404);
    expect((await csfBalance()).availableCents).toBe(0);
    expect(tracking('1001')).toBe('REMOVED_IN_APP');
    expect(await openEntries()).toEqual([]);

    // a próxima importação não recria nem acusa de novo
    const again = (await run()).body.data.batch;
    expect(again.counts).toMatchObject({ purchasesCreated: 0, reverted: 0 });
    expect(count('items')).toBe(0);
  });

  test('oferta que deixa de ser 3: REVERTED_OFFER_CHANGED; "Manter" fecha e a reversão não volta', async () => {
    const { itemId } = await importOnePurchase();
    state.trades = [buy({ offerState: 7 })];
    const entry = (await run()).body.data.batch.entries[0];
    expect(entry).toMatchObject({ outcome: 'REVERTED', reasonCode: 'REVERTED_OFFER_CHANGED' });
    const res = await resolve(entry.id, { action: 'KEEP' });
    expect(res.body.data.resolution).toBe('KEPT');
    expect(tracking('1001')).toBe('SETTLED');
    expect((await getItem(itemId)).status).toBe(200);
    const again = (await run()).body.data.batch;
    expect(again.counts.reverted).toBe(0);
    expect(await openEntries()).toEqual([]);
  });

  test('estorno no extrato de um trade que não foi relido (já fechado): REVERTED_REFUND', async () => {
    state.trades = [buy({ state: 'verified', protectionEndsAt: null })];
    await firstRun();
    expect(tracking('1001')).toBe('SETTLED');
    state.trades = []; // o trade fechado não aparece mais na leitura
    state.transactions = [fakeTransaction({ id: 'tx-ref', type: 'contract_purchase_refund', balanceOffset: 1250, details: { contract_id: '91001' }, createdAt: '2026-11-22T12:00:00.000Z' })];
    const batch = (await run()).body.data.batch;
    expect(batch.counts.reverted).toBe(1);
    expect(batch.entries[0]).toMatchObject({ outcome: 'REVERTED', reasonCode: 'REVERTED_REFUND', entityType: 'ITEM_PURCHASE', display: { name: 'AK-47 | Redline' } });
    // a segunda leitura do mesmo estorno não repete a entrada
    expect((await run()).body.data.batch.counts.reverted).toBe(0);
  });

  test('compra revertida já vendida no app: remover é bloqueado (IMPORT_ENTRY_CONFLICT) até desfazer a venda', async () => {
    const { itemId } = await importOnePurchase();
    clock = new Date('2026-11-28T15:00:00.000Z'); // depois do trade lock (27/11 14:00)
    const sold = await post(`/api/items/${itemId}/sell`, { saleStoreId: storeId('CSMoney'), salePriceCents: 1500, netReceivedCents: 1400, soldAt: '2026-11-28T10:00:00.000Z' });
    expect(sold.status).toBe(200);
    state.trades = [buy({ state: 'cancelled' })];
    const entry = (await run()).body.data.batch.entries[0];
    const blocked = await resolve(entry.id, { action: 'REMOVE' });
    expectError(blocked, 409, 'IMPORT_ENTRY_CONFLICT');
    expect(blocked.body.error.params).toMatchObject({ reason: 'ITEM_SOLD_IN_APP', itemId });
    expect(blocked.body.error.message).toMatch(/Desfaça a venda/);
    expect((await getItem(itemId)).body.data.status).toBe('VENDIDO');
    expect((await openEntries()).map((e) => e.id)).toEqual([entry.id]);

    expect((await post(`/api/items/${itemId}/unsell`, {})).status).toBe(200);
    expect((await resolve(entry.id, { action: 'REMOVE' })).status).toBe(200);
    expect((await getItem(itemId)).status).toBe(404);
  });

  test('lançamento manual ligado (MATCHED): a entrada avisa (linkKind MATCHED) e remover exclui o lançamento manual', async () => {
    const mine = await createManual(manual());
    state.trades = [buy()];
    const first = (await firstRun()).body.data.batch;
    expect(first.counts.matched).toBe(1);
    state.trades = [buy({ state: 'failed' })];
    const entry = (await run()).body.data.batch.entries[0];
    expect(entry).toMatchObject({ outcome: 'REVERTED', linkKind: 'MATCHED', entityId: mine.id });
    expect((await resolve(entry.id, { action: 'REMOVE' })).status).toBe(200);
    expect((await getItem(mine.id)).status).toBe(404);
  });
});

describe('venda revertida', () => {
  test('contract_sale_refund: "Remover lançamento" desfaz a venda (o item volta ao estoque) e o pendente some', async () => {
    const { itemId } = await importOnePurchase();
    clock = new Date('2026-11-28T15:00:00.000Z');
    const sale = fakeTrade({ id: '2001', direction: 'SELL', state: 'pending', price: 1500, createdAt: '2026-11-28T10:00:00.000Z', verifySaleAt: '2026-12-05T10:00:00.000Z', protectionEndsAt: '2026-12-05T10:00:00.000Z' });
    state.trades = [sale, buy({ state: 'verified' })];
    state.transactions = [fakeTransaction({ id: 'tx-sold', type: 'contract_sold', pendingOffset: 1470, createdAt: '2026-11-28T10:00:05.000Z', details: { contract_id: '92001', fee_amount: '30' } }), ...state.transactions];
    expect((await run()).body.data.batch.counts.salesCreated).toBe(1);
    expect((await csfBalance()).pending.cents).toBe(1470);

    state.transactions = [fakeTransaction({ id: 'tx-sref', type: 'contract_sale_refund', pendingOffset: -1470, createdAt: '2026-11-28T12:00:00.000Z', details: { contract_id: '92001' } }), ...state.transactions];
    const batch = (await run()).body.data.batch;
    const entry = batch.entries.find((e) => e.outcome === 'REVERTED');
    expect(entry).toMatchObject({ reasonCode: 'REVERTED_REFUND', entityType: 'ITEM_SALE', entityId: itemId });
    expect((await getItem(itemId)).body.data.status).toBe('VENDIDO'); // nada sozinho

    expect((await resolve(entry.id, { action: 'REMOVE' })).status).toBe(200);
    expect((await getItem(itemId)).body.data).toMatchObject({ status: 'EM_ESTOQUE', saleReleaseAt: null, salePriceCents: null });
    expect((await csfBalance()).pending.cents).toBe(0);
    expect(tracking('2001')).toBe('REMOVED_IN_APP');
  });
});

describe('antes de importar e estado desconhecido', () => {
  test('failed/cancelled com oferta 3 nunca importado: não importa e conta como "revertido antes de importar"', async () => {
    state.trades = [buy({ state: 'cancelled', offerState: 3 })];
    const batch = (await firstRun()).body.data.batch;
    expect(batch.counts).toMatchObject({ revertedBeforeImport: 1, purchasesCreated: 0, reverted: 0, notTransferred: 0 });
    expect(batch.entries).toEqual([]);
    expect(count('items')).toBe(0);
    expect(tracking('1001')).toBe('CLOSED_NOT_TRANSFERRED');
    // na listagem de lotes também
    const listed = (await call(request(app).get('/api/imports/batches'))).body.data.batches[0];
    expect(listed.counts.revertedBeforeImport).toBe(1);
  });

  test('estado desconhecido com oferta 3: não importa, aparece como estado desconhecido e é tentado de novo', async () => {
    state.trades = [buy({ state: 'held_by_support' })];
    const first = (await firstRun()).body.data.batch;
    expect(first.counts).toMatchObject({ unknownState: 1, purchasesCreated: 0 });
    expect(first.entries[0]).toMatchObject({ outcome: 'UNKNOWN_STATE', display: { state: 'held_by_support' } });
    expect(tracking('1001')).toBe('UNKNOWN_STATE');
    state.trades = [buy()];
    const second = (await run()).body.data.batch;
    expect(second.counts.purchasesCreated).toBe(1);
    expect(await openEntries()).toEqual([]);
  });
});

describe('acompanhamento até a proteção/liberação + 2 dias', () => {
  test('depois da janela o trade fecha e deixa de ser verificado (só um estorno o reabre)', async () => {
    await importOnePurchase();
    expect(tracking('1001')).toBe('OPEN');
    clock = new Date('2026-11-29T14:00:01.000Z'); // proteção até 27/11 14:00 + 2 dias
    await run();
    expect(tracking('1001')).toBe('SETTLED');
    // o CSFloat mostra failed depois disso: não é mais acusado pelo estado
    state.trades = [buy({ state: 'failed' })];
    expect((await run()).body.data.batch.counts.reverted).toBe(0);
    // um estorno no extrato ainda é reversão
    state.transactions = [fakeTransaction({ id: 'tx-late', type: 'rollback', details: { contract_id: '91001' }, createdAt: '2026-11-29T15:00:00.000Z' }), ...state.transactions];
    expect((await run()).body.data.batch.counts.reverted).toBe(1);
  });
});

describe('possível duplicado e falhas', () => {
  async function duplicate() {
    const a = await createManual(manual());
    const b = await createManual(manual({ acquiredAt: '2026-11-20T10:00:00.000Z' }));
    state.trades = [buy()];
    const entry = (await firstRun()).body.data.batch.entries[0];
    expect(entry.outcome).toBe('POSSIBLE_DUPLICATE');
    return { a, b, entry };
  }

  test('"Ligar a este lançamento": liga ao candidato escolhido, sem alterar o item', async () => {
    const { b, entry } = await duplicate();
    const res = await resolve(entry.id, { action: 'LINK', targetId: b.id });
    expect(res.body.data).toMatchObject({ resolution: 'LINKED', linkKind: 'MATCHED' });
    expect(dbRows('SELECT entity_id, link_kind FROM external_links')).toEqual([{ entity_id: b.id, link_kind: 'MATCHED' }]);
    expect((await getItem(b.id)).body.data.updatedAt).toBe(b.updatedAt);
    expect(tracking('1001')).toBe('OPEN');
  });

  test('"Criar mesmo assim" cria a compra; "Ignorar" não volta mais', async () => {
    const { entry } = await duplicate();
    const res = await resolve(entry.id, { action: 'CREATE' });
    expect(res.body.data).toMatchObject({ resolution: 'CREATED', linkKind: 'CREATED' });
    expect(count('items')).toBe(3);
    const created = dbRows("SELECT i.* FROM items i JOIN external_links l ON l.entity_id = i.id WHERE l.link_kind = 'CREATED'")[0];
    expect(created).toMatchObject({ catalog_id: CAT.AK_REDLINE, purchase_price_cents: 1250, float_value: 0.2534, trade_unlock_at: '2026-11-27T14:00:00.000Z' });
  });

  test('"Ignorar" no possível duplicado: o registro fica IGNORED e a importação seguinte não mexe', async () => {
    const { entry } = await duplicate();
    expect((await resolve(entry.id, { action: 'IGNORE' })).body.data.resolution).toBe('IGNORED');
    expect(tracking('1001')).toBe('IGNORED');
    const again = (await run()).body.data.batch;
    expect(again.counts).toMatchObject({ review: 0, purchasesCreated: 0 });
    expect(await openEntries()).toEqual([]);
  });

  test('"Ignorar" uma venda sem compra no app: não é mais tentada', async () => {
    state.trades = [fakeTrade({ id: '2001', direction: 'SELL', price: 1500 })];
    state.transactions = [fakeTransaction({ id: 'tx-sold', type: 'contract_sold', pendingOffset: 1470, details: { contract_id: '92001', fee_amount: '30' } })];
    const entry = (await firstRun()).body.data.batch.entries[0];
    expect(entry.reasonCode).toBe('PURCHASE_NOT_FOUND');
    await resolve(entry.id, { action: 'IGNORE' });
    await createManual(manual({ purchaseStoreId: storeId('CSMoney'), acquiredAt: '2026-11-10T00:00:00.000Z' }));
    expect((await run()).body.data.batch.counts).toMatchObject({ salesCreated: 0, withoutPurchase: 0 });
  });

  test('erros: inexistente, já resolvida, ação que não vale, LINK sem alvo ou fora dos candidatos, corpo inválido', async () => {
    const { a, entry } = await duplicate();
    expectError(await resolve(999, { action: 'IGNORE' }), 404, 'IMPORT_ENTRY_NOT_FOUND');
    expectError(await resolve(entry.id, { action: 'KEEP' }), 400, 'IMPORT_ENTRY_ACTION_NOT_ALLOWED');
    expectError(await resolve(entry.id, { action: 'LINK' }), 400, 'REQUIRED_FIELD', { field: 'targetId' });
    expectError(await resolve(entry.id, { action: 'LINK', targetId: 4242 }), 400, 'IMPORT_ENTRY_ACTION_NOT_ALLOWED', { field: 'targetId' });
    expectError(await resolve(entry.id, { action: 'DELETE' }), 400, 'INVALID_FIELD', { field: 'action' });
    expectError(await resolve(entry.id, { action: 'IGNORE', extra: 1 }), 400, 'UNKNOWN_FIELD');
    expectError(await resolve(entry.id, { action: 'IGNORE', targetId: a.id }), 400, 'INVALID_FIELD', { field: 'targetId' });
    const noJson = await call(request(app).post(`/api/imports/entries/${entry.id}/resolve`).set('Content-Type', 'text/plain').send('x'));
    expect(noJson.status).toBe(415);
    expect((await resolve(entry.id, { action: 'IGNORE' })).status).toBe(200);
    expectError(await resolve(entry.id, { action: 'IGNORE' }), 409, 'IMPORT_ENTRY_ALREADY_RESOLVED');
    const created = (await call(request(app).get('/api/imports/batches'))).body.data.batches[0];
    expect(created.openEntriesCount).toBe(0);
  });
});

describe('desfazer com pendência resolvida', () => {
  test('aviso ENTRY_RESOLVED quando uma pendência do lote já foi resolvida', async () => {
    await importOnePurchase();
    // lote 2: compra nova + reversão da primeira
    state.trades = [fakeTrade({ id: '1002', createdAt: '2026-11-21T10:00:00.000Z', item: { float_value: 0.31, paint_seed: 2 } }), buy({ state: 'failed' })];
    const batch = (await run()).body.data.batch;
    const reverted = batch.entries.find((e) => e.outcome === 'REVERTED');
    await resolve(reverted.id, { action: 'KEEP' });
    const preview = (await call(request(app).get(`/api/imports/batches/${batch.id}/undo-preview`))).body.data;
    expect(preview.warnings).toEqual([expect.objectContaining({ code: 'ENTRY_RESOLVED', entryId: reverted.id })]);
    expectError(await post(`/api/imports/batches/${batch.id}/undo`, {}), 409, 'IMPORT_UNDO_WARNINGS_NOT_CONFIRMED');
    expect((await post(`/api/imports/batches/${batch.id}/undo`, { confirmWarnings: true })).status).toBe(200);
  });
});
