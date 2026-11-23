'use strict';

// Correções da revisão da Etapa 9 (D340). Banco em memória, fetchFn falso roteado e dados INVENTADOS; nenhuma chamada real.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture } = require('../helpers/catalog');
const { expectError } = require('../helpers/apiFixtures');
const importService = require('../../src/services/imports/importService');
const settingsService = require('../../src/services/settingsService');
const { KEY, PII, meBody, fakeTrade, fakeTransaction, purchaseTx, routedFetch } = require('../helpers/csfloatFixtures');

jest.setTimeout(60000);

const JSON_TYPE = 'application/json';
const NOW = new Date('2026-11-22T15:00:00.000Z');
const CUTOFF = '2026-11-01T00:00:00.000Z';

let app;
let state;
const post = (url, body = {}) => request(app).post(url).set('Content-Type', JSON_TYPE).send(body);
const run = (body = {}) => post('/api/imports/csfloat/run', body);
const rows = (sql, ...args) => getDb().prepare(sql).all(...args);
const trackingOf = (externalId) => getDb().prepare("SELECT tracking FROM external_records WHERE kind = 'TRADE' AND external_id = ?").get(externalId)?.tracking;
const itemsCount = () => getDb().prepare('SELECT COUNT(*) AS n FROM items').get().n;
const openEntries = async () => (await request(app).get('/api/imports/entries?open=true')).body.data.entries;

beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  importService.resetAutoForTests();
  state = { me: meBody(), trades: [], transactions: [] };
  app = createApp({ now: () => new Date(NOW.getTime()), fetchFn: routedFetch(state), sleepFn: async () => {} });
  expect((await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY })).status).toBe(200);
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => closeDb());

describe('importação ao abrir não é pulada pela cotação (item 1)', () => {
  test('com a cotação sendo atualizada, a importação automática roda normalmente (as duas correm juntas)', async () => {
    await run({ cutoffAt: CUTOFF });
    expect((await request(app).patch('/api/integrations/csfloat').set('Content-Type', JSON_TYPE).send({ autoImportOnOpen: true })).status).toBe(200);
    jest.spyOn(settingsService, 'isFxRefreshInProgress').mockReturnValue(true);
    state.trades = [fakeTrade({ id: '7001', createdAt: '2026-11-21T10:00:00.000Z' })];
    state.transactions = [purchaseTx('97001', 1250, { createdAt: '2026-11-21T10:00:01.000Z' })];
    const res = await run({ trigger: 'AUTO' });
    expect(res.status).toBe(200);
    expect(res.body.data.skipped).toBeUndefined();
    expect(res.body.data.batch.counts.purchasesCreated).toBe(1);
  });
});

describe('resposta ruim da fonte não desfaz uma decisão (item 3)', () => {
  test('venda ignorada continua ignorada quando o trade volta com dado inválido', async () => {
    state.trades = [fakeTrade({ id: '7101', direction: 'SELL', state: 'verified' })];
    await run({ cutoffAt: CUTOFF });
    const entry = (await openEntries())[0];
    expect((await post(`/api/imports/entries/${entry.id}/resolve`, { action: 'IGNORE' })).status).toBe(200);
    expect(trackingOf('7101')).toBe('IGNORED');
    const broken = fakeTrade({ id: '7101', direction: 'SELL', state: 'verified' });
    delete broken.contract.price;
    state.trades = [broken];
    const res = await run({});
    expect(trackingOf('7101')).toBe('IGNORED');
    expect(res.body.data.batch === null || res.body.data.batch.counts.failed === 0).toBe(true);
    expect(await openEntries()).toHaveLength(0);
  });

  test('compra excluída no app não volta, nem depois de uma resposta sem direção', async () => {
    state.trades = [fakeTrade({ id: '7201' })];
    await run({ cutoffAt: CUTOFF });
    const itemId = rows('SELECT id FROM items')[0].id;
    expect((await request(app).delete(`/api/items/${itemId}`)).status).toBe(200);
    expect(trackingOf('7201')).toBe('REMOVED_IN_APP');
    state.trades = [fakeTrade({ id: '7201', steamId: PII.steamId2 })]; // nenhum dos lados é a conta: direção desconhecida
    await run({});
    expect(trackingOf('7201')).toBe('REMOVED_IN_APP');
    state.trades = [fakeTrade({ id: '7201' })];
    await run({});
    expect(itemsCount()).toBe(0);
  });
});

describe('desfazer preserva o que foi excluído ou ignorado (item 4)', () => {
  test('excluir a compra importada e desfazer o lote: a próxima importação não a recria', async () => {
    state.trades = [fakeTrade({ id: '7301' }), fakeTrade({ id: '7302', createdAt: '2026-11-19T10:00:00.000Z', item: { float_value: 0.41 } })];
    const batchId = (await run({ cutoffAt: CUTOFF })).body.data.batch.id;
    const removed = rows("SELECT entity_id AS id FROM external_links l JOIN external_records r ON r.id = l.record_id WHERE r.external_id = '7301'")[0].id;
    expect((await request(app).delete(`/api/items/${removed}`)).status).toBe(200);
    const undo = await post(`/api/imports/batches/${batchId}/undo`, { confirmWarnings: true });
    expect(undo.status).toBe(200);
    expect(trackingOf('7301')).toBe('REMOVED_IN_APP');
    expect(itemsCount()).toBe(0);
    await run({ cutoffAt: CUTOFF }); // recomeço completo: o corte é perguntado de novo
    expect(itemsCount()).toBe(1); // só a 7302 volta
    expect(trackingOf('7301')).toBe('REMOVED_IN_APP');
  });
});

describe('trocar de conta ignora os aportes e saques abertos da conta anterior (item 5)', () => {
  test('aportes ainda sem lançamento viram IGNORED e não entram na loja da conta nova', async () => {
    state.transactions = [fakeTransaction({ id: 'tx-dep-a', type: 'deposit', balanceOffset: 5000, createdAt: '2026-11-10T10:00:00.000Z', details: { fee: '0' } })];
    await run({ cutoffAt: CUTOFF }); // sem corte dos aportes: o aporte fica "visto"
    state.me = meBody({ user: { steam_id: PII.steamId2 } });
    expect((await post('/api/integrations/csfloat/switch-account', { confirm: true })).status).toBe(200);
    expect(rows("SELECT tracking FROM external_records WHERE external_id = 'tx-dep-a'")[0].tracking).toBe('IGNORED');
    state.transactions = [];
    await run({ cutoffAt: CUTOFF });
    await post('/api/imports/csfloat/change-cutoff', { cutoffAt: CUTOFF, confirm: true, target: 'TRANSACTIONS' });
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM deposits').get().n).toBe(0);
  });
});

describe('pendências exigem a loja da integração em US$ (item 6)', () => {
  test('com a loja trocada para R$, "Foi drop" é recusado e nada é gravado', async () => {
    state.trades = [fakeTrade({ id: '7401', direction: 'SELL', state: 'verified' })];
    await run({ cutoffAt: CUTOFF });
    const entry = (await openEntries())[0];
    getDb().prepare("UPDATE stores SET currency = 'BRL' WHERE name = 'CSFloat'").run();
    expectError(await post(`/api/imports/entries/${entry.id}/resolve`, { action: 'MARK_WON' }), 400, 'IMPORT_STORE_CURRENCY_NOT_ALLOWED');
    expect(itemsCount()).toBe(0);
  });
});
