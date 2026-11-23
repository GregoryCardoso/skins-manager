'use strict';

// 9.5.1b (D327 a D331): "Lançar compra", "Foi drop", ignoradas com "Voltar para pendências" e ações em lote nas pendências.
// Banco em memória, fetchFn falso roteado e dados INVENTADOS. Nenhuma chamada real ao CSFloat.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, CAT } = require('../helpers/catalog');
const { storeId, expectError } = require('../helpers/apiFixtures');
const { KEY, meBody, fakeTrade, fakeTransaction, routedFetch } = require('../helpers/csfloatFixtures');

jest.setTimeout(60000);

const JSON_TYPE = 'application/json';
const NOW = new Date('2026-11-22T15:00:00.000Z');
const CUTOFF = '2026-11-01T00:00:00.000Z';
const SOLD_AT = '2026-11-20T10:00:00.000Z';

let app;
let state;

function useApp() {
  state = { me: meBody(), trades: [], transactions: [] };
  app = createApp({ now: () => new Date(NOW.getTime()), fetchFn: routedFetch(state), sleepFn: async () => {} });
}
const post = (url, body = {}) => request(app).post(url).set('Content-Type', JSON_TYPE).send(body);
const run = (body = {}) => post('/api/imports/csfloat/run', body);
const resolve = (id, body) => post(`/api/imports/entries/${id}/resolve`, body);
const reopen = (id) => post(`/api/imports/entries/${id}/reopen`, {});
const bulk = (body) => post('/api/imports/entries/bulk-resolve', body);
const openEntries = async () => (await request(app).get('/api/imports/entries?open=true')).body.data.entries;
const ignoredEntries = async () => (await request(app).get('/api/imports/entries?ignored=true')).body.data.entries;
const item = async (id) => (await request(app).get(`/api/items/${id}`)).body.data;
const count = (table) => getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const tracking = (externalId) => getDb().prepare("SELECT tracking FROM external_records WHERE kind = 'TRADE' AND external_id = ?").get(externalId).tracking;

// Venda de um AK (float distinto por id) com o crédito no extrato.
const sale = (id, { floatValue = 0.2534, paintSeed = 661, item: extra = {}, soldAt = SOLD_AT } = {}) =>
  fakeTrade({ id, direction: 'SELL', state: 'verified', protectionEndsAt: null, price: 1500, createdAt: soldAt, item: { float_value: floatValue, paint_seed: paintSeed, ...extra } });
const credit = (id, { pending = 1470, fee = '30' } = {}) =>
  fakeTransaction({ id: `tx-sold-${id}`, type: 'contract_sold', pendingOffset: pending, createdAt: '2026-11-20T10:00:05.000Z', details: { contract_id: `9${id}`, fee_amount: fee } });
const stickerSale = (id) => fakeTrade({
  id, direction: 'SELL', state: 'verified', protectionEndsAt: null, price: 10, createdAt: SOLD_AT,
  item: { market_hash_name: 'Sticker | Titan | Katowice 2014', type: 'sticker', is_commodity: true, float_value: null, paint_seed: null },
});
const purchase = (extra = {}) => ({
  purchaseStoreId: storeId('CSMoney'), purchasePriceCents: 900, acquiredAt: '2026-10-01T12:00:00.000Z', tradeUnlockAt: '2026-10-08T12:00:00.000Z', ...extra,
});

async function withoutPurchase(trades, transactions) {
  state.trades = trades;
  state.transactions = transactions;
  const batch = (await run({ cutoffAt: CUTOFF })).body.data.batch;
  return batch.entries.filter((e) => e.reasonCode === 'PURCHASE_NOT_FOUND');
}

beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  useApp();
  const res = await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY });
  expect(res.status).toBe(200);
});
afterAll(() => closeDb());

describe('ações vindas do backend (D331)', () => {
  test('venda sem compra no app traz Lançar compra, Foi drop e Ignorar; SPLIT_FROM_ITEM fica reservado e recusado', async () => {
    const [entry] = await withoutPurchase([sale('2001')], [credit('2001')]);
    expect(entry.allowedActions).toEqual(['CREATE_PURCHASE', 'MARK_WON', 'IGNORE']);
    expect((await openEntries())[0].allowedActions).toEqual(['CREATE_PURCHASE', 'MARK_WON', 'IGNORE']);
    expectError(await resolve(entry.id, { action: 'SPLIT_FROM_ITEM' }), 400, 'IMPORT_ENTRY_ACTION_NOT_ALLOWED');
  });
});

describe('"Lançar compra" (CREATE_PURCHASE)', () => {
  test('cria a compra com a identidade da pendência e registra a venda na hora, com o líquido real', async () => {
    const [entry] = await withoutPurchase([sale('2001')], [credit('2001')]);
    const res = await resolve(entry.id, { action: 'CREATE_PURCHASE', purchase: purchase() });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ resolution: 'CREATED', allowedActions: [] });
    const link = getDb().prepare("SELECT entity_id AS id, link_kind FROM external_links WHERE entity_type = 'ITEM_SALE'").get();
    expect(link.link_kind).toBe('CREATED');
    const created = await item(link.id);
    expect(created).toMatchObject({
      catalogId: CAT.AK_REDLINE, floatValue: 0.2534, paintSeed: 661, variant: 'NORMAL', acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSMoney'),
      purchasePriceCents: 900, acquiredAt: '2026-10-01T12:00:00.000Z', tradeUnlockAt: '2026-10-08T12:00:00.000Z',
      status: 'VENDIDO', salePriceCents: 1500, netReceivedCents: 1470, soldAt: SOLD_AT, externalSource: 'CSFLOAT',
    });
    expect(await openEntries()).toEqual([]);
    expect(tracking('2001')).toBe('SETTLED');
    // a compra é manual (sem vínculo de compra) e a próxima importação não duplica nada
    expect(count("external_links WHERE entity_type = 'ITEM_PURCHASE'")).toBe(0);
    expect((await run()).body.data.batch.counts).toMatchObject({ salesCreated: 0, withoutPurchase: 0 });
    expect(count('items')).toBe(1);
  });

  test('desfazer o lote da pendência desfaz a venda e mantém a compra manual', async () => {
    const [entry] = await withoutPurchase([sale('2001')], [credit('2001')]);
    await resolve(entry.id, { action: 'CREATE_PURCHASE', purchase: purchase() });
    const undo = await post(`/api/imports/batches/${entry.batchId}/undo`, { confirmWarnings: true });
    expect(undo.status).toBe(200);
    const items = getDb().prepare('SELECT status, purchase_price_cents FROM items').all();
    expect(items).toEqual([{ status: 'EM_ESTOQUE', purchase_price_cents: 900 }]);
  });

  test('data da compra depois da venda e trade lock terminando depois da venda: erros claros, nada gravado', async () => {
    const [entry] = await withoutPurchase([sale('2001')], [credit('2001')]);
    const after = await resolve(entry.id, { action: 'CREATE_PURCHASE', purchase: purchase({ acquiredAt: '2026-11-21T00:00:00.000Z', tradeUnlockAt: null }) });
    expectError(after, 400, 'PURCHASE_AFTER_SALE', { field: 'acquiredAt' });
    expect(after.body.error.params).toEqual({ soldAt: SOLD_AT });
    const locked = await resolve(entry.id, { action: 'CREATE_PURCHASE', purchase: purchase({ acquiredAt: '2026-11-15T00:00:00.000Z', tradeUnlockAt: '2026-11-22T00:00:00.000Z' }) });
    expectError(locked, 400, 'PURCHASE_UNLOCK_AFTER_SALE', { field: 'tradeUnlockAt' });
    expect(locked.body.error.message).toMatch(/trade lock terminaria depois da venda/);
    // igualdade é permitida
    expect((await resolve(entry.id, { action: 'CREATE_PURCHASE', purchase: purchase({ acquiredAt: '2026-11-13T10:00:00.000Z', tradeUnlockAt: SOLD_AT }) })).status).toBe(200);
  });

  test('unidade com o MESMO float já em estoque bloqueia (UNIT_IN_STOCK); com outro float, não', async () => {
    const [entry] = await withoutPurchase([sale('2001')], [credit('2001')]);
    const other = await post('/api/items', { catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSMoney'), purchasePriceCents: 800, acquiredAt: '2026-10-02T00:00:00.000Z', floatValue: 0.41, paintSeed: 5 });
    expect(other.status).toBe(201);
    // outro float: não bloqueia
    expect((await resolve(entry.id, { action: 'CREATE_PURCHASE', purchase: purchase() })).status).toBe(200);

    const [second] = await withoutPurchaseAgain('2002', 0.31);
    const same = await post('/api/items', { catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSMoney'), purchasePriceCents: 800, acquiredAt: '2026-11-21T00:00:00.000Z', floatValue: 0.31, paintSeed: 7 });
    const blocked = await resolve(second.id, { action: 'CREATE_PURCHASE', purchase: purchase() });
    expectError(blocked, 409, 'IMPORT_ENTRY_CONFLICT');
    expect(blocked.body.error.params).toMatchObject({ reason: 'UNIT_IN_STOCK', itemIds: [same.body.data.id] });
  });

  async function withoutPurchaseAgain(id, floatValue) {
    state.trades = [sale(id, { floatValue, paintSeed: 7 }), ...state.trades];
    state.transactions = [credit(id), ...state.transactions];
    const batch = (await run()).body.data.batch;
    return batch.entries.filter((e) => e.reasonCode === 'PURCHASE_NOT_FOUND');
  }

  test('item sem float: qualquer unidade em estoque bloqueia e é indicada', async () => {
    const [entry] = await withoutPurchase([stickerSale('3001')], [credit('3001', { pending: 10, fee: '0' })]);
    // comprada antes da venda: pode ser a unidade vendida (uma comprada depois da venda não bloqueia)
    const existing = await post('/api/items', { catalogId: CAT.STICKER_TITAN, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSMoney'), purchasePriceCents: 4, acquiredAt: '2026-11-10T00:00:00.000Z' });
    const res = await resolve(entry.id, { action: 'CREATE_PURCHASE', purchase: purchase({ tradeUnlockAt: null }) });
    expectError(res, 409, 'IMPORT_ENTRY_CONFLICT');
    expect(res.body.error.params).toMatchObject({ reason: 'UNIT_IN_STOCK', itemIds: [existing.body.data.id] });
  });

  test('sem o contract_sold: 409 SALE_TX_NOT_FOUND e nada gravado (nem a compra)', async () => {
    const [entry] = await withoutPurchase([sale('2001')], []);
    const res = await resolve(entry.id, { action: 'CREATE_PURCHASE', purchase: purchase() });
    expectError(res, 409, 'IMPORT_ENTRY_CONFLICT');
    expect(res.body.error.params.reason).toBe('SALE_TX_NOT_FOUND');
    expect(count('items')).toBe(0);
    expect((await openEntries())).toHaveLength(1);
    // "Salvar só a compra": grava a compra, a pendência continua aberta e a próxima importação registra a venda nela
    const only = await resolve(entry.id, { action: 'CREATE_PURCHASE', purchase: purchase(), purchaseOnly: true });
    expect(only.body.data).toMatchObject({ resolution: null });
    expect(getDb().prepare('SELECT status FROM items').all()).toEqual([{ status: 'EM_ESTOQUE' }]);
    state.transactions = [credit('2001')];
    expect((await run()).body.data.batch.counts.salesCreated).toBe(1);
    expect(await openEntries()).toEqual([]);
  });

  test('compra na loja CSFloat antes da data de corte: aviso a confirmar', async () => {
    const [entry] = await withoutPurchase([sale('2001')], [credit('2001')]);
    const body = { action: 'CREATE_PURCHASE', purchase: purchase({ purchaseStoreId: storeId('CSFloat'), acquiredAt: '2026-10-01T12:00:00.000Z' }) };
    const warned = await resolve(entry.id, body);
    expectError(warned, 409, 'IMPORT_ENTRY_WARNINGS_NOT_CONFIRMED');
    expect(warned.body.error.params.warnings).toEqual([{ code: 'PURCHASE_IN_INTEGRATION_STORE_BEFORE_CUTOFF', cutoffAt: CUTOFF }]);
    expect(count('items')).toBe(0);
    expect((await resolve(entry.id, { ...body, confirmWarnings: true })).status).toBe(200);
  });

  test('validação: identidade no corpo, purchase em outra ação, sem data', async () => {
    const [entry] = await withoutPurchase([sale('2001')], [credit('2001')]);
    expectError(await resolve(entry.id, { action: 'CREATE_PURCHASE', purchase: purchase({ floatValue: 0.1 }) }), 400, 'UNKNOWN_FIELD', { field: 'floatValue' });
    expectError(await resolve(entry.id, { action: 'IGNORE', purchase: purchase() }), 400, 'INVALID_FIELD', { field: 'purchase' });
    expectError(await resolve(entry.id, { action: 'CREATE_PURCHASE' }), 400, 'REQUIRED_FIELD', { field: 'purchase' });
    expectError(await resolve(entry.id, { action: 'CREATE_PURCHASE', purchase: purchase({ acquiredAt: undefined }) }), 400, 'REQUIRED_FIELD', { field: 'acquiredAt' });
  });
});

describe('"Foi drop" (MARK_WON)', () => {
  test('GANHEI com custo 0, sem trade lock e com a data da venda; a venda entra na hora', async () => {
    const [entry] = await withoutPurchase([sale('2001')], [credit('2001')]);
    const res = await resolve(entry.id, { action: 'MARK_WON' });
    expect(res.body.data.resolution).toBe('CREATED');
    const row = getDb().prepare('SELECT * FROM items').get();
    expect(row).toMatchObject({
      acquisition_type: 'GANHEI', purchase_price_cents: 0, purchase_store_id: null, trade_unlock_at: null, acquired_at: SOLD_AT,
      status: 'VENDIDO', net_received_cents: 1470,
    });
  });

  test('data informada vale; depois da venda é recusada', async () => {
    const [entry] = await withoutPurchase([sale('2001')], [credit('2001')]);
    expectError(await resolve(entry.id, { action: 'MARK_WON', acquiredAt: '2026-11-21T00:00:00.000Z' }), 400, 'PURCHASE_AFTER_SALE');
    await resolve(entry.id, { action: 'MARK_WON', acquiredAt: '2026-09-01T00:00:00.000Z' });
    expect(getDb().prepare('SELECT acquired_at FROM items').get().acquired_at).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('ignoradas e "Voltar para pendências" (REOPEN)', () => {
  test('ignorar leva para a lista de ignoradas; voltar devolve às pendências e a importação tenta de novo', async () => {
    const [entry] = await withoutPurchase([sale('2001')], [credit('2001')]);
    await resolve(entry.id, { action: 'IGNORE' });
    expect(await openEntries()).toEqual([]);
    const ignored = await ignoredEntries();
    expect(ignored.map((e) => [e.id, e.allowedActions])).toEqual([[entry.id, ['REOPEN']]]);
    expect(tracking('2001')).toBe('IGNORED');

    const res = await reopen(entry.id);
    expect(res.body.data).toMatchObject({ id: entry.id, resolution: null, allowedActions: ['CREATE_PURCHASE', 'MARK_WON', 'IGNORE'] });
    expect(tracking('2001')).toBe('RETRY');
    expect(await ignoredEntries()).toEqual([]);
    expect((await openEntries()).map((e) => e.id)).toEqual([entry.id]);
    expect((await run()).body.data.batch.counts.withoutPurchase).toBe(1);
  });

  test('não reabre o que não está ignorado nem o ignorado de outra conta', async () => {
    const [entry] = await withoutPurchase([sale('2001')], [credit('2001')]);
    expectError(await reopen(entry.id), 409, 'IMPORT_ENTRY_NOT_REOPENABLE');
    await resolve(entry.id, { action: 'IGNORE' });
    getDb().prepare("UPDATE external_records SET account_fingerprint = ? WHERE kind = 'TRADE'").run('f'.repeat(64));
    expect(await ignoredEntries()).toEqual([]);
    const res = await reopen(entry.id);
    expectError(res, 409, 'IMPORT_ENTRY_NOT_REOPENABLE');
    expect(res.body.error.params).toEqual({ reason: 'OTHER_ACCOUNT' });
    expectError(await reopen(999), 404, 'IMPORT_ENTRY_NOT_FOUND');
  });

  test('query: open e ignored juntos ou valor inválido -> INVALID_QUERY', async () => {
    expectError(await request(app).get('/api/imports/entries?open=true&ignored=true'), 400, 'INVALID_QUERY');
    expectError(await request(app).get('/api/imports/entries?ignored=sim'), 400, 'INVALID_QUERY');
  });
});

describe('ações em lote (bulk-resolve)', () => {
  const three = () => withoutPurchase(
    [sale('2001', { floatValue: 0.21 }), sale('2002', { floatValue: 0.22 }), sale('2003', { floatValue: 0.23 })],
    [credit('2001'), credit('2002'), credit('2003')]
  );

  test('"Foi drop" em várias de uma vez', async () => {
    const entries = await three();
    const res = await bulk({ action: 'MARK_WON', entryIds: entries.map((e) => e.id) });
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(3);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM items WHERE acquisition_type = 'GANHEI' AND status = 'VENDIDO'").get().n).toBe(3);
    expect(await openEntries()).toEqual([]);
  });

  test('tudo ou nada: uma falha desfaz o lote inteiro e lista o motivo', async () => {
    const entries = await three();
    await resolve(entries[1].id, { action: 'IGNORE' });
    const res = await bulk({ action: 'MARK_WON', entryIds: entries.map((e) => e.id) });
    expectError(res, 409, 'IMPORT_BULK_CONFLICT');
    expect(res.body.error.params.failures).toEqual([{ entryId: entries[1].id, code: 'IMPORT_ENTRY_ALREADY_RESOLVED', reason: null }]);
    expect(count('items')).toBe(0);
    expect((await openEntries())).toHaveLength(2);
  });

  test('ignorar e voltar em lote', async () => {
    const entries = await three();
    const ids = entries.map((e) => e.id);
    expect((await bulk({ action: 'IGNORE', entryIds: ids })).body.data.count).toBe(3);
    expect(await ignoredEntries()).toHaveLength(3);
    expect((await bulk({ action: 'REOPEN', entryIds: ids })).body.data.count).toBe(3);
    expect(await openEntries()).toHaveLength(3);
  });

  test('validação do lote', async () => {
    expectError(await bulk({ action: 'CREATE_PURCHASE', entryIds: [1] }), 400, 'INVALID_FIELD', { field: 'action' });
    expectError(await bulk({ action: 'IGNORE', entryIds: [] }), 400, 'INVALID_FIELD', { field: 'entryIds' });
    expectError(await bulk({ action: 'IGNORE', entryIds: [1, 1] }), 400, 'INVALID_FIELD', { field: 'entryIds' });
    expectError(await bulk({ action: 'IGNORE', entryIds: Array.from({ length: 201 }, (_, i) => i + 1) }), 400, 'INVALID_FIELD', { field: 'entryIds' });
    expectError(await bulk({ action: 'IGNORE', entryIds: [1], acquiredAt: SOLD_AT }), 400, 'INVALID_FIELD', { field: 'acquiredAt' });
  });
});
