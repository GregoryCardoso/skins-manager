'use strict';

// 9.3 (D299, D312): importação de VENDAS do CSFloat. Banco em memória, fetchFn falso roteado e dados INVENTADOS. Nenhuma chamada
// real ao CSFloat.
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
const VERIFY_AT = '2026-11-28T16:00:00.000Z'; // diferente de soldAt + 7 dias (27/11 10:00)

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
const getItem = async (id) => (await call(request(app).get(`/api/items/${id}`))).body.data;
const getItems = async () => (await call(request(app).get('/api/items'))).body.data.items;
const dbRows = (sql, ...params) => getDb().prepare(sql).all(...params);
const count = (table) => dbRows(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
const tracking = (externalId) => dbRows("SELECT tracking FROM external_records WHERE kind = 'TRADE' AND external_id = ?", externalId)[0].tracking;
const openEntries = async () => (await call(request(app).get('/api/imports/entries?open=true'))).body.data.entries;
const undoPreview = async (id) => (await call(request(app).get(`/api/imports/batches/${id}/undo-preview`))).body.data;
const undo = (id, body = {}) => call(request(app).post(`/api/imports/batches/${id}/undo`).set('Content-Type', JSON_TYPE).send(body));
const csfBalance = async () =>
  (await call(request(app).get('/api/store-balances/current'))).body.data.stores.find((s) => s.storeName === 'CSFloat');
const createManual = async (body) => {
  const res = await call(request(app).post('/api/items').set('Content-Type', JSON_TYPE).send(body));
  if (res.status !== 201) throw new Error(`criação manual falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
};
const manual = (extra = {}) => ({
  catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSMoney'), purchasePriceCents: 900,
  acquiredAt: '2026-11-03T09:00:00.000Z', floatValue: 0.2534, paintSeed: 661, ...extra,
});

// Compra no CSFloat (já fora da proteção) e venda do mesmo AK (float 0.2534, seed 661 do fakeTrade padrão).
const buy = (id = '1001', extra = {}) =>
  fakeTrade({ id, createdAt: '2026-11-05T10:00:00.000Z', protectionEndsAt: '2026-11-12T10:00:00.000Z', state: 'verified', ...extra });
const sell = (id = '2001', extra = {}) =>
  fakeTrade({
    id, direction: 'SELL', state: 'pending', price: 1500, createdAt: '2026-11-20T10:00:00.000Z', verifySaleAt: VERIFY_AT,
    protectionEndsAt: '2026-11-27T10:00:00.000Z', ...extra,
  });
// Crédito da venda no extrato (`contract_sold`): pendente = preço − taxa.
const soldTx = (contractId, { pending = 1470, fee = '30', createdAt = '2026-11-20T10:00:05.000Z', id } = {}) =>
  fakeTransaction({ id: id || `tx-sold-${contractId}`, type: 'contract_sold', pendingOffset: pending, createdAt, details: { contract_id: contractId, fee_amount: fee } });
const verifiedTx = (contractId, createdAt, net = 1470) =>
  fakeTransaction({ id: `tx-ver-${contractId}`, type: 'trade_verified', pendingOffset: -net, balanceOffset: net, createdAt, details: { contract_id: contractId, trade_id: 'T1', type: 'notary' } });
const sticker = (id, direction, createdAt, extra = {}) => fakeTrade({
  id, direction, createdAt, price: 5, protectionEndsAt: null, acceptedAt: createdAt, state: 'verified',
  item: { market_hash_name: 'Sticker | Titan | Katowice 2014', type: 'sticker', is_commodity: true, float_value: null, paint_seed: null }, ...extra,
});

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

describe('venda casada com uma compra importada', () => {
  test('compra num lote, venda no seguinte: líquido real, liberação pelo verify_sale_at e nada duplicado na terceira', async () => {
    state.trades = [buy()];
    state.transactions = [purchaseTx('91001', 1250, { createdAt: '2026-11-05T10:00:01.000Z' })];
    const first = (await firstRun()).body.data.batch;
    expect(first.counts).toMatchObject({ purchasesCreated: 1, salesCreated: 0 });
    const itemId = first.entries[0].entityId;

    state.trades = [sell(), buy()];
    state.transactions = [soldTx('92001'), ...state.transactions];
    const second = (await run()).body.data.batch;
    expect(second.counts).toMatchObject({ salesCreated: 1, purchasesCreated: 0, withoutPurchase: 0, failed: 0 });
    expect(second.undoable).toBe(true);
    const created = second.entries.find((e) => e.outcome === 'CREATED');
    expect(created).toMatchObject({ entityType: 'ITEM_SALE', entityId: itemId, reasonCode: null, display: { direction: 'SELL', priceCents: 1500 } });

    const item = await getItem(itemId);
    expect(item).toMatchObject({
      status: 'VENDIDO', saleStoreId: storeId('CSFloat'), salePriceCents: 1500, netReceivedCents: 1470, soldAt: '2026-11-20T10:00:00.000Z',
      saleReleaseAt: VERIFY_AT, saleHoldDaysApplied: 7, externalSource: 'CSFLOAT',
    });
    expect(item.saleRelease).toEqual({ releasesAt: VERIFY_AT, isHeld: true });
    expect(dbRows("SELECT link_kind FROM external_links WHERE entity_type = 'ITEM_SALE'")).toEqual([{ link_kind: 'CREATED' }]);
    expect(tracking('2001')).toBe('OPEN');
    const balance = await csfBalance();
    expect(balance.pending).toMatchObject({ cents: 1470, count: 1, nextReleaseAt: VERIFY_AT });

    // terceira importação: nada novo, nada duplicado
    const third = (await run()).body.data.batch;
    expect(third.counts).toMatchObject({ salesCreated: 0, purchasesCreated: 0, matched: 0, failed: 0, withoutPurchase: 0 });
    expect(third.counts.known).toBeGreaterThanOrEqual(2);
    expect(count('items')).toBe(1);
    expect(dbRows("SELECT COUNT(*) AS n FROM items WHERE status = 'VENDIDO'")[0].n).toBe(1);
    expect(count('external_links')).toBe(2);
  });

  test('D370: venda importada numa loja "só compra" (sellsHere false) continua sendo registrada', async () => {
    state.trades = [buy()];
    state.transactions = [purchaseTx('91001', 1250, { createdAt: '2026-11-05T10:00:01.000Z' })];
    const itemId = (await firstRun()).body.data.batch.entries[0].entityId;
    getDb().prepare("UPDATE stores SET sells_here = 0 WHERE name = 'CSFloat'").run();

    state.trades = [sell(), buy()];
    state.transactions = [soldTx('92001'), ...state.transactions];
    const second = (await run()).body.data.batch;
    expect(second.counts).toMatchObject({ salesCreated: 1, failed: 0 });
    expect(await getItem(itemId)).toMatchObject({ status: 'VENDIDO', saleStoreId: storeId('CSFloat'), salePriceCents: 1500 });
  });

  test('a liberação real é a do verify_sale_at mesmo quando difere de soldAt + 7; trade_verified depois vale a data dele', async () => {
    const verifyAt = '2026-11-29T18:30:00.000Z';
    state.trades = [buy()];
    await firstRun();
    state.trades = [sell('2001', { verifySaleAt: verifyAt }), buy()];
    state.transactions = [soldTx('92001')];
    const second = (await run()).body.data.batch;
    const itemId = second.entries.find((e) => e.outcome === 'CREATED').entityId;
    expect((await getItem(itemId)).saleRelease.releasesAt).toBe(verifyAt);

    // chega o trade_verified (liberação real) num lote seguinte; o trade já virou verified
    clock = new Date('2026-11-30T12:00:00.000Z');
    state.trades = [sell('2001', { verifySaleAt: verifyAt, state: 'verified' }), buy()];
    state.transactions = [verifiedTx('92001', '2026-11-29T20:00:00.000Z'), soldTx('92001')];
    await run();
    const item = await getItem(itemId);
    expect(item.saleReleaseAt).toBe('2026-11-29T20:00:00.000Z');
    expect(item.saleRelease).toEqual({ releasesAt: '2026-11-29T20:00:00.000Z', isHeld: false });
    // a atualização do próprio import não conta como edição no desfazer
    const batches = (await call(request(app).get('/api/imports/batches'))).body.data.batches;
    const latest = batches.find((b) => b.undoable);
    expect(latest.id).toBe(second.id);
    expect((await undoPreview(second.id)).warnings).toEqual([]);
    expect((await csfBalance()).pending.cents).toBe(0);
  });

  test('compra e venda no mesmo lote: a compra é aplicada antes e a venda vende o item criado', async () => {
    state.trades = [sell(), buy()];
    state.transactions = [soldTx('92001'), purchaseTx('91001', 1250, { createdAt: '2026-11-05T10:00:01.000Z' })];
    const batch = (await firstRun()).body.data.batch;
    expect(batch.counts).toMatchObject({ purchasesCreated: 1, salesCreated: 1 });
    const items = await getItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'VENDIDO', purchasePriceCents: 1250, salePriceCents: 1500, netReceivedCents: 1470 });

    // desfazer o lote: o item criado sai inteiro (sem bloqueio por "vendido no app": a venda é do próprio lote)
    const preview = await undoPreview(batch.id);
    expect(preview).toMatchObject({ undoable: true, blockers: [], warnings: [], counts: { itemsToDelete: 1, linksToRemove: 0, salesToUndo: 0 } });
    expect((await undo(batch.id)).status).toBe(200);
    expect(count('items')).toBe(0);
    expect(count('external_links')).toBe(0);
  });
});

describe('taxa real do contract_sold', () => {
  test('FEE_MISMATCH: entra o líquido real e o resumo mostra as duas taxas', async () => {
    state.trades = [buy()];
    await firstRun();
    state.trades = [sell(), buy()];
    state.transactions = [soldTx('92001', { pending: 1480, fee: '20' })];
    const batch = (await run()).body.data.batch;
    const entry = batch.entries.find((e) => e.outcome === 'CREATED');
    expect(entry).toMatchObject({ reasonCode: 'FEE_MISMATCH', display: { feeCents: 20, expectedFeeCents: 30 } });
    expect((await getItem(entry.entityId))).toMatchObject({ netReceivedCents: 1480, netReceivedManual: true });
  });

  test('FEE_INCONSISTENT (pendente ≠ preço − taxa): não vende e tenta de novo', async () => {
    state.trades = [buy()];
    const first = (await firstRun()).body.data.batch;
    state.trades = [sell(), buy()];
    state.transactions = [soldTx('92001', { pending: 1400, fee: '30' })];
    const batch = (await run()).body.data.batch;
    expect(batch.counts).toMatchObject({ salesCreated: 0, failed: 1 });
    expect(batch.entries.find((e) => e.outcome === 'FAILED').reasonCode).toBe('FEE_INCONSISTENT');
    expect((await getItem(first.entries[0].entityId)).status).toBe('EM_ESTOQUE');
    expect(tracking('2001')).toBe('RETRY');
  });

  test('sem o contract_sold a venda fica para a próxima importação (SALE_TX_NOT_FOUND) e entra quando o extrato traz', async () => {
    state.trades = [buy()];
    const first = (await firstRun()).body.data.batch;
    const itemId = first.entries[0].entityId;
    state.trades = [sell(), buy()];
    const waiting = (await run()).body.data.batch;
    expect(waiting.entries.map((e) => e.reasonCode)).toEqual(['SALE_TX_NOT_FOUND']);
    expect((await getItem(itemId)).status).toBe('EM_ESTOQUE');
    expect((await openEntries()).map((e) => e.reasonCode)).toEqual(['SALE_TX_NOT_FOUND']);

    state.transactions = [soldTx('92001', { createdAt: '2026-11-22T14:00:00.000Z' })];
    const later = (await run()).body.data.batch;
    expect(later.counts.salesCreated).toBe(1);
    expect((await getItem(itemId))).toMatchObject({ status: 'VENDIDO', netReceivedCents: 1470 });
    expect(await openEntries()).toEqual([]);
  });
});

describe('venda sem compra no app', () => {
  test('não importa, aparece no resumo e nas pendências com os dados do item; lançada a compra, a próxima importação vende', async () => {
    state.trades = [sell()];
    state.transactions = [soldTx('92001')];
    const batch = (await firstRun()).body.data.batch;
    expect(batch.counts).toMatchObject({ withoutPurchase: 1, salesCreated: 0, failed: 0 });
    const entry = batch.entries[0];
    expect(entry).toMatchObject({
      outcome: 'FAILED', reasonCode: 'PURCHASE_NOT_FOUND', entityId: null,
      display: {
        direction: 'SELL', name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', floatValue: 0.2534, paintSeed: 661,
        priceCents: 1500, date: '2026-11-20T10:00:00.000Z', catalogId: CAT.AK_REDLINE,
      },
    });
    expect(entry.display.imageUrl).not.toBeUndefined();
    expect(count('items')).toBe(0);
    expect((await openEntries()).map((e) => e.reasonCode)).toEqual(['PURCHASE_NOT_FOUND']);

    // segunda importação sem a compra: continua pendente (uma só na lista) e não duplica nada
    const again = (await run()).body.data.batch;
    expect(again.counts.withoutPurchase).toBe(1);
    expect((await openEntries())).toHaveLength(1);

    // o usuário lança a compra à mão (em outra loja) e importa de novo: a venda entra
    const stock = await createManual(manual());
    const done = (await run()).body.data.batch;
    expect(done.counts).toMatchObject({ salesCreated: 1, withoutPurchase: 0 });
    expect(await getItem(stock.id)).toMatchObject({ status: 'VENDIDO', salePriceCents: 1500, netReceivedCents: 1470, purchaseStoreId: storeId('CSMoney') });
    expect(await openEntries()).toEqual([]);
    expect(tracking('2001')).toBe('OPEN');
  });

  test('unidade com outro float não serve: continua sem compra no app', async () => {
    await createManual(manual({ floatValue: 0.4, paintSeed: 1 }));
    state.trades = [sell()];
    state.transactions = [soldTx('92001')];
    const batch = (await firstRun()).body.data.batch;
    expect(batch.counts.withoutPurchase).toBe(1);
    expect(dbRows("SELECT COUNT(*) AS n FROM items WHERE status = 'VENDIDO'")[0].n).toBe(0);
  });
});

describe('escolha da unidade', () => {
  test('sem float: a mais antiga à venda antes das do holding; sem nenhuma à venda, a mais antiga do holding', async () => {
    const st = (acquiredAt) => createManual({ catalogId: CAT.STICKER_TITAN, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSMoney'), purchasePriceCents: 4, acquiredAt });
    const holdOld = await st('2026-11-02T10:00:00.000Z');
    const forSaleOld = await st('2026-11-03T10:00:00.000Z');
    const forSaleNew = await st('2026-11-04T10:00:00.000Z');
    expect((await call(request(app).post(`/api/items/${holdOld.id}/off-sale`).set('Content-Type', JSON_TYPE).send({}))).status).toBe(200);

    state.trades = [
      sticker('3003', 'SELL', '2026-11-20T12:00:00.000Z'),
      sticker('3002', 'SELL', '2026-11-20T11:00:00.000Z'),
      sticker('3001', 'SELL', '2026-11-20T10:00:00.000Z'),
    ];
    state.transactions = [soldTx('93003', { pending: 5, fee: '0' }), soldTx('93002', { pending: 5, fee: '0' }), soldTx('93001', { pending: 5, fee: '0' })];
    const batch = (await firstRun()).body.data.batch;
    expect(batch.counts.salesCreated).toBe(3);
    const soldOrder = batch.entries.filter((e) => e.outcome === 'CREATED').map((e) => e.entityId);
    expect(soldOrder).toEqual([forSaleOld.id, forSaleNew.id, holdOld.id]);
    // a do holding vendida direto fica SEM_GIRO (2.6.1)
    expect((await getItem(holdOld.id)).aging.turnaroundBucket).toBe('SEM_GIRO');
  });

  test('duas unidades com o mesmo float: possível duplicado, nada vendido', async () => {
    await createManual(manual());
    await createManual(manual({ acquiredAt: '2026-11-04T09:00:00.000Z' }));
    state.trades = [sell()];
    state.transactions = [soldTx('92001')];
    const batch = (await firstRun()).body.data.batch;
    expect(batch.counts).toMatchObject({ review: 1, salesCreated: 0 });
    expect(batch.entries[0]).toMatchObject({ outcome: 'POSSIBLE_DUPLICATE' });
    expect(batch.entries[0].candidateIds).toHaveLength(2);
    expect(tracking('2001')).toBe('NEEDS_REVIEW');
  });

  test('trade lock do app depois da venda: ITEM_TRADE_LOCKED com o link da unidade, tentado de novo', async () => {
    const stock = await createManual(manual({ tradeUnlockAt: '2026-11-25T00:00:00.000Z' }));
    state.trades = [sell()];
    state.transactions = [soldTx('92001')];
    const batch = (await firstRun()).body.data.batch;
    expect(batch.entries[0]).toMatchObject({ outcome: 'FAILED', reasonCode: 'ITEM_TRADE_LOCKED', entityType: 'ITEM_PURCHASE', entityId: stock.id });
    expect((await getItem(stock.id)).status).toBe('EM_ESTOQUE');
    expect(tracking('2001')).toBe('RETRY');
  });
});

describe('venda manual já lançada', () => {
  test('liga (MATCHED) sem alterar o lançamento: líquido e liberação da loja continuam', async () => {
    const stock = await createManual(manual());
    const sold = await call(request(app).post(`/api/items/${stock.id}/sell`).set('Content-Type', JSON_TYPE).send({
      saleStoreId: storeId('CSFloat'), salePriceCents: 1500, soldAt: '2026-11-20T09:00:00.000Z',
    }));
    expect(sold.status).toBe(200);
    const before = await getItem(stock.id);
    state.trades = [sell()];
    state.transactions = [soldTx('92001', { pending: 1480, fee: '20' })];
    const batch = (await firstRun()).body.data.batch;
    expect(batch.counts).toMatchObject({ matched: 1, salesCreated: 0 });
    expect(batch.entries[0]).toMatchObject({ outcome: 'MATCHED', entityType: 'ITEM_SALE', entityId: stock.id });
    const after = await getItem(stock.id);
    expect(after).toMatchObject({ netReceivedCents: before.netReceivedCents, saleReleaseAt: null, updatedAt: before.updatedAt, externalSource: 'CSFLOAT' });
    expect(after.saleRelease.releasesAt).toBe('2026-11-27T09:00:00.000Z'); // soldAt + 7 dias da loja

    // desfazer só desliga
    expect((await undo(batch.id)).status).toBe(200);
    expect(await getItem(stock.id)).toMatchObject({ status: 'VENDIDO', netReceivedCents: before.netReceivedCents, externalSource: null });
  });
});

describe('desfazer e desfazer a venda', () => {
  test('desfazer o lote da venda: o item volta ao estoque, sem a liberação real; a compra (outro lote) continua', async () => {
    state.trades = [buy()];
    const first = (await firstRun()).body.data.batch;
    const itemId = first.entries[0].entityId;
    state.trades = [sell(), buy()];
    state.transactions = [soldTx('92001')];
    const second = (await run()).body.data.batch;
    expect(await undoPreview(second.id)).toMatchObject({ undoable: true, counts: { itemsToDelete: 0, linksToRemove: 0, salesToUndo: 1 } });
    expect((await undo(second.id)).status).toBe(200);
    expect(await getItem(itemId)).toMatchObject({ status: 'EM_ESTOQUE', salePriceCents: null, netReceivedCents: null, saleReleaseAt: null, externalSource: 'CSFLOAT' });
    expect((await csfBalance()).pending.cents).toBe(0);

    // a próxima importação vende de novo (o registro voltou a ser reavaliado), sem duplicar
    const redo = (await run()).body.data.batch;
    expect(redo.counts.salesCreated).toBe(1);
    expect(dbRows("SELECT COUNT(*) AS n FROM external_links WHERE entity_type = 'ITEM_SALE'")[0].n).toBe(1);
  });

  test('desfazer a venda importada à mão: o registro vira REMOVED_IN_APP e a venda não volta', async () => {
    state.trades = [buy()];
    const first = (await firstRun()).body.data.batch;
    const itemId = first.entries[0].entityId;
    state.trades = [sell(), buy()];
    state.transactions = [soldTx('92001')];
    await run();
    const res = await call(request(app).post(`/api/items/${itemId}/unsell`).set('Content-Type', JSON_TYPE).send({}));
    expect(res.status).toBe(200);
    expect(res.body.data.saleReleaseAt).toBeNull();
    expect(tracking('2001')).toBe('REMOVED_IN_APP');
    const again = (await run()).body.data.batch;
    expect(again.counts.salesCreated).toBe(0);
    expect((await getItem(itemId)).status).toBe('EM_ESTOQUE');
  });
});

describe('vendas adiadas da 9.2 e API', () => {
  test('registro DEFERRED força a varredura completa na primeira importação da 9.3 e a venda é processada', async () => {
    state.trades = [buy()];
    await firstRun();
    // simula a venda vista pela 9.2 (DEFERRED)
    getDb().prepare(
      `INSERT INTO external_records (source, kind, external_id, contract_id, direction, tracking, external_created_at, sold_at, amount_cents, last_seen_at, created_at, updated_at)
       VALUES ('CSFLOAT','TRADE','2001','92001','SELL','DEFERRED',?,?,1500,?,?,?)`
    ).run('2026-11-20T10:00:00.000Z', '2026-11-20T10:00:00.000Z', NOW.toISOString(), NOW.toISOString(), NOW.toISOString());
    state.trades = [sell(), buy()];
    state.transactions = [soldTx('92001')];
    const batch = (await run()).body.data.batch;
    expect(batch.fullScan).toBe(true);
    expect(batch.counts).toMatchObject({ salesCreated: 1, deferredSales: 0 });
    expect(tracking('2001')).toBe('OPEN');
    // e a seguinte já não força a varredura completa
    expect((await run()).body.data.batch.fullScan).toBe(false);
  });

  test('a API de itens não aceita saleReleaseAt (UNKNOWN_FIELD) e a venda manual segue soldAt + retenção', async () => {
    const stock = await createManual(manual());
    const bad = await call(request(app).post(`/api/items/${stock.id}/sell`).set('Content-Type', JSON_TYPE).send({
      saleStoreId: storeId('CSFloat'), salePriceCents: 1500, soldAt: '2026-11-20T09:00:00.000Z', saleReleaseAt: '2026-11-21T00:00:00.000Z',
    }));
    expectError(bad, 400, 'UNKNOWN_FIELD', { field: 'saleReleaseAt' });
    const patch = await call(request(app).patch(`/api/items/${stock.id}`).set('Content-Type', JSON_TYPE).send({ saleReleaseAt: '2026-11-21T00:00:00.000Z' }));
    expect(patch.status).toBe(400);
    const ok = await call(request(app).post(`/api/items/${stock.id}/sell`).set('Content-Type', JSON_TYPE).send({
      saleStoreId: storeId('CSFloat'), salePriceCents: 1500, soldAt: '2026-11-20T09:00:00.000Z',
    }));
    expect(ok.body.data.item).toMatchObject({ saleReleaseAt: null, saleRelease: { releasesAt: '2026-11-27T09:00:00.000Z' } });
  });
});
