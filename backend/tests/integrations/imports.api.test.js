'use strict';

// 9.2 (D318): API /api/imports com fetchFn falso roteado, banco em memória e dados INVENTADOS. Nenhuma chamada real ao CSFloat.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, CAT } = require('../helpers/catalog');
const { storeId, expectError } = require('../helpers/apiFixtures');
const CatalogItem = require('../../src/models/CatalogItem');
const {
  KEY, PII, TRADE_PII, meBody, fakeResponse, fakeTrade, fakeTransaction, purchaseTx, routedFetch,
} = require('../helpers/csfloatFixtures');

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
const batchesCount = () => dbRows('SELECT COUNT(*) AS n FROM import_batches')[0].n;
const itemsCount = () => dbRows('SELECT COUNT(*) AS n FROM items')[0].n;
const calls = (path) => fetchFn.calls.filter((c) => c.path === path);

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
  // varredura de privacidade: respostas, logs e TODAS as tabelas (menos a chave local) sem dado pessoal nem a chave
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

describe('primeira importação e corte', () => {
  test('sem corte -> 400 IMPORT_CUTOFF_REQUIRED; nada é lido nem gravado', async () => {
    const res = await run({});
    expectError(res, 400, 'IMPORT_CUTOFF_REQUIRED', { field: 'cutoffAt' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(batchesCount()).toBe(0);
  });

  test('corte inválido e corte futuro', async () => {
    expectError(await run({ cutoffAt: 'ontem' }), 400, 'INVALID_DATE', { field: 'cutoffAt' });
    expectError(await run({ cutoffAt: '2026-11-23T00:00:00.000Z' }), 400, 'DATE_IN_FUTURE', { field: 'cutoffAt' });
    expect(batchesCount()).toBe(0);
  });

  test('importa a compra aceita (pending + oferta 3 + aceite), com trade lock até o fim da proteção', async () => {
    state.trades = [fakeTrade({ id: '1001', state: 'pending', offerState: 3 })];
    state.transactions = [purchaseTx('91001', 1250)];
    const res = await firstRun();
    expect(res.status).toBe(200);
    const batch = res.body.data.batch;
    expect(batch).toMatchObject({
      status: 'DONE', trigger: 'MANUAL', fullScan: false, cutoffAt: CUTOFF, undoable: true,
      counts: { purchasesCreated: 1, matched: 0, deferredSales: 0, failed: 0 },
    });
    expect(batch.entries).toHaveLength(1);
    expect(batch.entries[0]).toMatchObject({
      outcome: 'CREATED', entityType: 'ITEM_PURCHASE', reasonCode: null,
      display: { marketHashName: 'AK-47 | Redline (Field-Tested)', name: 'AK-47 | Redline', namePtBr: 'AK-47 | Linha Vermelha', priceCents: 1250, currency: 'USD', floatValue: 0.2534, paintSeed: 661 },
    });
    const items = await getItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 1250, purchaseCurrency: 'USD',
      floatValue: 0.2534, paintSeed: 661, variant: 'NORMAL', exterior: 'FT', tradeUnlockAt: '2026-11-27T14:00:00.000Z',
      acquiredAt: '2026-11-20T14:00:00.000Z', externalSource: 'CSFLOAT', status: 'EM_ESTOQUE',
    });
    expect(items[0].tradeLock.isLocked).toBe(true);
    // lote, registro e vínculo gravados; corte e cursor no estado da integração
    const integration = (await call(request(app).get('/api/integrations/csfloat'))).body.data;
    expect(integration).toMatchObject({ tradesCutoffAt: CUTOFF, lastImportStatus: 'OK', lastImportAt: NOW.toISOString(), accountLinked: true, importInProgress: false });
    expect(dbRows('SELECT last_transaction_id FROM integrations')[0].last_transaction_id).toBe('tx-91001');
    expect(dbRows('SELECT tracking FROM external_records WHERE kind = ?', 'TRADE')[0].tracking).toBe('OPEN');
    expect(dbRows('SELECT link_kind FROM external_links')[0].link_kind).toBe('CREATED');
  });

  test('sem proteção informada: aceite + 7 dias', async () => {
    state.trades = [fakeTrade({ id: '1002', protectionEndsAt: null })];
    await firstRun();
    expect((await getItems())[0].tradeUnlockAt).toBe('2026-11-27T14:00:00.000Z');
  });

  test('corte repetido -> IMPORT_CUTOFF_ALREADY_SET', async () => {
    await firstRun();
    expectError(await run({ cutoffAt: CUTOFF }), 400, 'IMPORT_CUTOFF_ALREADY_SET', { field: 'cutoffAt' });
  });

  test('antes do corte: contado e não importado', async () => {
    state.trades = [fakeTrade({ id: '1003', createdAt: '2026-10-15T10:00:00.000Z', soldAt: '2026-10-15T10:00:00.000Z' })];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ beforeCutoff: 1, purchasesCreated: 0 });
    expect(itemsCount()).toBe(0);
    expect(dbRows('SELECT tracking FROM external_records WHERE kind = ?', 'TRADE')[0].tracking).toBe('BEFORE_CUTOFF');
  });
});

describe('deduplicação e leitura incremental', () => {
  test('importar duas vezes não cria nada e conta como já importada', async () => {
    state.trades = [fakeTrade({ id: '1001' })];
    await firstRun();
    const second = await run({});
    expect(second.status).toBe(200);
    expect(second.body.data.batch.counts).toMatchObject({ purchasesCreated: 0, known: 1 });
    expect(itemsCount()).toBe(1);
    expect(dbRows('SELECT COUNT(*) AS n FROM external_links')[0].n).toBe(1);
  });

  test('a segunda importação para cedo pelo cursor do extrato e a página conhecida de trades', async () => {
    const trades = [];
    const txs = [];
    for (let i = 0; i < 120; i += 1) {
      const day = String(20 - Math.floor(i / 10)).padStart(2, '0');
      trades.push(fakeTrade({ id: String(2000 + i), state: 'verified', createdAt: `2026-11-${day}T1${i % 10}:00:00.000Z`, item: { float_value: 0.2 + i / 1000, paint_seed: i } }));
      txs.push(purchaseTx(String(92000 + i), 1250, { createdAt: `2026-11-${day}T1${i % 10}:00:01.000Z`, id: `tx-${i}` }));
    }
    // ordem: da mais nova para a mais antiga
    state.trades = trades.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    state.transactions = txs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const first = await firstRun({ cutoffAt: '2026-10-01T00:00:00.000Z' });
    expect(first.body.data.batch.counts.purchasesCreated).toBe(120);
    expect(first.body.data.batch.pagesRead.trades).toBe(3);
    fetchFn.calls.length = 0;
    const second = await run({});
    expect(second.body.data.batch.counts).toMatchObject({ purchasesCreated: 0, known: expect.any(Number) });
    // o extrato e os trades param na primeira página: tudo já era conhecido e fechado
    expect(calls('/me/transactions').length).toBe(1);
    expect(calls('/me/trades').length).toBeLessThan(3);
    // "Varredura completa" lê tudo de novo
    fetchFn.calls.length = 0;
    const full = await run({ fullScan: true });
    expect(full.body.data.batch.fullScan).toBe(true);
    expect(calls('/me/trades')).toHaveLength(3);
    expect(calls('/me/transactions')).toHaveLength(3);
  });

  test('ordem quebrada vira varredura completa com aviso', async () => {
    const a = fakeTrade({ id: '3001', createdAt: '2026-11-10T10:00:00.000Z', item: { float_value: 0.31 } });
    const b = fakeTrade({ id: '3002', createdAt: '2026-11-12T10:00:00.000Z', item: { float_value: 0.32 } });
    state.trades = [a, b]; // do mais antigo para o mais novo: fora de ordem
    const res = await firstRun();
    expect(res.body.data.batch).toMatchObject({ fullScan: true, warnings: ['ORDER_NOT_GUARANTEED'] });
    expect(res.body.data.batch.counts.purchasesCreated).toBe(2);
  });

  test('trade pendente que depois é aceito entra na segunda importação', async () => {
    state.trades = [fakeTrade({ id: '1004', state: 'queued', offerState: null, acceptedAt: null })];
    const first = await firstRun();
    expect(first.body.data.batch.counts).toMatchObject({ notTransferred: 1, purchasesCreated: 0 });
    expect(dbRows('SELECT tracking FROM external_records WHERE kind = ?', 'TRADE')[0].tracking).toBe('WAITING_TRANSFER');
    state.trades = [fakeTrade({ id: '1004', state: 'pending', offerState: 3 })];
    const second = await run({});
    expect(second.body.data.batch.counts.purchasesCreated).toBe(1);
    expect(itemsCount()).toBe(1);
  });

  test('compra em proteção que vira verified fecha (SETTLED)', async () => {
    state.trades = [fakeTrade({ id: '1005', state: 'pending' })];
    await firstRun();
    expect(dbRows('SELECT tracking FROM external_records WHERE kind = ?', 'TRADE')[0].tracking).toBe('OPEN');
    state.trades = [fakeTrade({ id: '1005', state: 'verified' })];
    const res = await run({});
    expect(res.body.data.batch.counts).toMatchObject({ known: 1, reverted: 0 });
    expect(dbRows('SELECT tracking FROM external_records WHERE kind = ?', 'TRADE')[0].tracking).toBe('SETTLED');
  });

  test('importado que depois volta failed -> entrada REVERTED, nada é apagado', async () => {
    state.trades = [fakeTrade({ id: '1006', state: 'pending' })];
    await firstRun();
    state.trades = [fakeTrade({ id: '1006', state: 'failed', offerState: 6 })];
    const res = await run({});
    expect(res.body.data.batch.counts.reverted).toBe(1);
    expect(res.body.data.batch.entries[0]).toMatchObject({ outcome: 'REVERTED', reasonCode: 'REVERTED_PENDING_ACTION', entityType: 'ITEM_PURCHASE' });
    expect(itemsCount()).toBe(1);
    const open = (await call(request(app).get('/api/imports/entries?open=true'))).body.data.entries;
    expect(open).toHaveLength(1);
    // reverter de novo não acumula entradas abertas nem muda o resumo
    const third = await run({});
    expect(third.body.data.batch.counts.reverted).toBe(0);
    expect(third.body.data.batch.counts.known).toBe(1);
  });

  test('contract_purchase_refund no extrato com o mesmo contrato reverte o importado', async () => {
    state.trades = [fakeTrade({ id: '1007', state: 'verified' })];
    await firstRun();
    state.transactions = [fakeTransaction({ id: 'tx-r1', type: 'contract_purchase_refund', details: { contract_id: '91007' }, createdAt: '2026-11-22T10:00:00.000Z' })];
    const res = await run({});
    expect(res.body.data.batch.counts.reverted).toBe(1);
  });
});

describe('estados especiais', () => {
  test('failed sem aceite fecha; failed com aceite e nunca importado fecha; estado novo vira UNKNOWN_STATE; oferta 12 também', async () => {
    state.trades = [
      fakeTrade({ id: '4001', state: 'failed', offerState: 6, acceptedAt: null, createdAt: '2026-11-20T10:00:00.000Z' }),
      fakeTrade({ id: '4002', state: 'cancelled', offerState: 3, createdAt: '2026-11-19T10:00:00.000Z' }),
      fakeTrade({ id: '4003', state: 'weird_state', offerState: 3, createdAt: '2026-11-18T10:00:00.000Z' }),
      fakeTrade({ id: '4004', state: 'pending', offerState: 12, createdAt: '2026-11-17T10:00:00.000Z' }),
    ];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ notTransferred: 2, unknownState: 2, purchasesCreated: 0 });
    expect(res.body.data.batch.unknownTypes).toEqual({ 'state:weird_state': 1, 'offer:12': 1 });
    expect(itemsCount()).toBe(0);
    const open = (await call(request(app).get('/api/imports/entries?open=true'))).body.data.entries;
    expect(open.map((e) => e.outcome)).toEqual(['UNKNOWN_STATE', 'UNKNOWN_STATE']);
  });

  test('trade enviado a outra pessoa e direção desconhecida viram falhas para conferir', async () => {
    state.trades = [
      fakeTrade({ id: '4101', sentToDifferentUser: '76561190000000777', createdAt: '2026-11-20T10:00:00.000Z' }),
      fakeTrade({ id: '4102', steamId: '76561190000000555', createdAt: '2026-11-19T10:00:00.000Z' }),
    ];
    const res = await firstRun();
    expect(res.body.data.batch.counts.failed).toBe(2);
    const reasons = res.body.data.batch.entries.map((e) => e.reasonCode).sort();
    expect(reasons).toEqual(['DIRECTION_UNKNOWN', 'TRADE_SENT_TO_OTHER_USER']);
    expect(itemsCount()).toBe(0);
  });

  test('9.3: venda sem unidade no app vira "venda sem compra no app" (RETRY), sem itens vendidos', async () => {
    state.trades = [fakeTrade({ id: '4201', direction: 'SELL', state: 'verified' })];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ deferredSales: 0, purchasesCreated: 0, salesCreated: 0, withoutPurchase: 1 });
    expect(res.body.data.batch.entries.map((e) => e.reasonCode)).toEqual(['PURCHASE_NOT_FOUND']);
    expect(itemsCount()).toBe(0);
    expect(dbRows('SELECT tracking, direction FROM external_records WHERE kind = ?', 'TRADE')[0]).toMatchObject({ tracking: 'RETRY', direction: 'SELL' });
  });

  test('dado essencial ausente: SOURCE_RECORD_INVALID, sem derrubar o resto', async () => {
    const broken = fakeTrade({ id: '4301' });
    delete broken.contract.price;
    state.trades = [broken, fakeTrade({ id: '4302', createdAt: '2026-11-19T10:00:00.000Z', item: { float_value: 0.4 } })];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, failed: 1 });
    expect(res.body.data.batch.entries.find((e) => e.outcome === 'FAILED').reasonCode).toBe('SOURCE_RECORD_INVALID');
  });
});

describe('catálogo e atributos', () => {
  test('item fora do catálogo: falha CATALOG_NOT_FOUND, tentada de novo; depois de entrar no catálogo, a próxima importação cria', async () => {
    state.trades = [fakeTrade({ id: '5001', item: { market_hash_name: 'Glock-18 | Teste Novo (Factory New)', float_value: 0.01, paint_seed: 5 } })];
    const first = await firstRun();
    expect(first.body.data.batch.counts.failed).toBe(1);
    expect(first.body.data.batch.entries[0]).toMatchObject({ outcome: 'FAILED', reasonCode: 'CATALOG_NOT_FOUND' });
    expect(itemsCount()).toBe(0);
    CatalogItem.upsertMany([{
      id: 'skin-glock-teste', source: 'SKINS', category: 'SKIN', name: 'Glock-18 | Teste Novo', nameKey: 'glock-18 | teste novo',
      searchText: 'glock-18 | teste novo', minFloat: 0, maxFloat: 1, hasStattrak: 1, hasSouvenir: 0,
    }]);
    const second = await run({});
    expect(second.body.data.batch.counts.purchasesCreated).toBe(1);
    expect((await getItems())[0]).toMatchObject({ catalogId: 'skin-glock-teste', exterior: 'FN' });
    // a pendência antiga fica resolvida
    expect((await call(request(app).get('/api/imports/entries?open=true'))).body.data.entries).toHaveLength(0);
  });

  test('Doppler com `phase` e Doppler só com paint_index 419; StatTrak; faca ★ vanilla; Souvenir', async () => {
    state.trades = [
      fakeTrade({ id: '5101', createdAt: '2026-11-20T10:00:00.000Z', item: { market_hash_name: '★ Karambit | Doppler (Factory New)', phase: 'Phase 1', float_value: 0.01, paint_seed: 1 } }),
      fakeTrade({ id: '5102', createdAt: '2026-11-19T10:00:00.000Z', item: { market_hash_name: '★ Karambit | Doppler (Factory New)', phase: null, paint_index: 419, float_value: 0.02, paint_seed: 2 } }),
      fakeTrade({ id: '5103', createdAt: '2026-11-18T10:00:00.000Z', item: { market_hash_name: 'StatTrak™ AK-47 | Redline (Field-Tested)', is_stattrak: true, float_value: 0.3, paint_seed: 3 } }),
      fakeTrade({ id: '5104', createdAt: '2026-11-17T10:00:00.000Z', item: { market_hash_name: '★ Karambit', float_value: null, paint_seed: null, def_index: 507 } }),
      fakeTrade({ id: '5105', createdAt: '2026-11-16T10:00:00.000Z', item: { market_hash_name: 'Souvenir Desert Eagle | Urban DDPAT (Minimal Wear)', is_souvenir: true, float_value: 0.1, paint_seed: 5 } }),
    ];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 5, failed: 0 });
    const byCatalog = Object.fromEntries((await getItems()).map((i) => [`${i.catalogId}:${i.variant}`, i]));
    expect(byCatalog[`${CAT.KARAMBIT_DOPPLER_P1}:NORMAL`].phase).toBe('Phase 1');
    expect(byCatalog[`${CAT.KARAMBIT_DOPPLER_P2}:NORMAL`].phase).toBe('Phase 2');
    expect(byCatalog[`${CAT.AK_REDLINE}:STATTRAK`]).toBeDefined();
    expect(byCatalog[`${CAT.KARAMBIT_VANILLA}:NORMAL`].floatValue).toBeNull();
    expect(byCatalog[`${CAT.DEAGLE_DDPAT}:SOUVENIR`]).toBeDefined();
  });

  test('Doppler sem fase conhecida é ambíguo (RETRY)', async () => {
    state.trades = [fakeTrade({ id: '5201', item: { market_hash_name: '★ Karambit | Doppler (Factory New)', phase: null, paint_index: null, float_value: 0.01 } })];
    const res = await firstRun();
    expect(res.body.data.batch.entries[0]).toMatchObject({ outcome: 'FAILED', reasonCode: 'CATALOG_AMBIGUOUS' });
  });

  test('sticker, caixa, charm sem float e patch/chave como OUTRO', async () => {
    const commodity = (name, id, createdAt) => fakeTrade({ id, createdAt, price: 5, item: { market_hash_name: name, type: 'sticker', is_commodity: true, float_value: null, paint_seed: null } });
    state.trades = [
      commodity('Sticker | Titan | Katowice 2014', '5301', '2026-11-20T10:00:00.000Z'),
      commodity('Revolver Case', '5302', '2026-11-19T10:00:00.000Z'),
      commodity("Charm | Lil' Ava", '5303', '2026-11-18T10:00:00.000Z'),
      commodity('Patch | Teste Fictício', '5304', '2026-11-17T10:00:00.000Z'),
      commodity('Revolver Case Key', '5305', '2026-11-16T10:00:00.000Z'),
    ];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 5, failed: 0 });
    const items = await getItems();
    expect(items.map((i) => i.category).sort()).toEqual(['CAIXA', 'OUTRO', 'OUTRO', 'PINGENTE', 'STICKER']);
    expect(items.find((i) => i.name === 'Patch | Teste Fictício')).toMatchObject({ catalogId: null, floatValue: null, variant: null });
  });

  test('PRICE_MISMATCH: o extrato debitou outro valor; a compra entra pelo preço do trade', async () => {
    state.trades = [fakeTrade({ id: '5401', price: 1250 })];
    state.transactions = [purchaseTx('95401', 1300)];
    const res = await firstRun();
    expect(res.body.data.batch.entries[0]).toMatchObject({ outcome: 'CREATED', reasonCode: 'PRICE_MISMATCH' });
    expect((await getItems())[0].purchasePriceCents).toBe(1250);
  });
});

describe('casamento com lançamentos manuais', () => {
  const manual = (extra = {}) => ({
    catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 1250,
    acquiredAt: '2026-11-20T09:00:00.000Z', ...extra,
  });
  const createManual = async (body) => {
    const res = await request(app).post('/api/items').send(body);
    expect(res.status).toBe(201);
    return res.body.data;
  };

  test('com float: liga ao manual (float digitado com 4 casas) sem alterá-lo e sem criar item', async () => {
    const m = await createManual(manual({ floatValue: 0.2534, paintSeed: 661 }));
    state.trades = [fakeTrade({ id: '6001', item: { float_value: 0.25340012 } })];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ matched: 1, purchasesCreated: 0 });
    expect(itemsCount()).toBe(1);
    expect(dbRows('SELECT link_kind, entity_id FROM external_links')[0]).toEqual({ link_kind: 'MATCHED', entity_id: m.id });
    const after = (await getItems())[0];
    expect(after.tradeUnlockAt).toBeNull(); // ligar não completa o trade lock (E9-Q10)
    expect(after.externalSource).toBe('CSFLOAT');
  });

  test('sem float: mesmo item, preço e dia; quantidades iguais ligam um a um', async () => {
    await createManual(manual({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 5 }));
    await createManual(manual({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 5, acquiredAt: '2026-11-20T11:00:00.000Z' }));
    const sticker = (id, createdAt) => fakeTrade({ id, createdAt, price: 5, item: { market_hash_name: 'Sticker | Titan | Katowice 2014', type: 'sticker', is_commodity: true, float_value: null, paint_seed: null } });
    state.trades = [sticker('6101', '2026-11-20T12:00:00.000Z'), sticker('6102', '2026-11-20T10:00:00.000Z')];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ matched: 2, purchasesCreated: 0, review: 0 });
    expect(itemsCount()).toBe(2);
  });

  test('sem float com quantidades diferentes: possível duplicado, nada é criado nem ligado', async () => {
    await createManual(manual({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 5 }));
    const sticker = (id, createdAt) => fakeTrade({ id, createdAt, price: 5, item: { market_hash_name: 'Sticker | Titan | Katowice 2014', type: 'sticker', is_commodity: true, float_value: null, paint_seed: null } });
    state.trades = [sticker('6201', '2026-11-20T12:00:00.000Z'), sticker('6202', '2026-11-20T10:00:00.000Z')];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ review: 2, matched: 0, purchasesCreated: 0 });
    expect(res.body.data.batch.entries.every((e) => e.outcome === 'POSSIBLE_DUPLICATE' && e.candidateIds.length === 1)).toBe(true);
    expect(itemsCount()).toBe(1);
    expect(dbRows('SELECT COUNT(*) AS n FROM external_links')[0].n).toBe(0);
    // não é reavaliado sozinho
    const again = await run({});
    expect(again.body.data.batch.counts).toMatchObject({ review: 0, purchasesCreated: 0, matched: 0 });
  });

  test('o manual fora da janela de dias não casa (cria o item)', async () => {
    await createManual(manual({ floatValue: 0.2534, paintSeed: 661, acquiredAt: '2026-11-10T09:00:00.000Z' }));
    state.trades = [fakeTrade({ id: '6301' })];
    const res = await firstRun();
    // com float igual o casamento não depende do dia; o item manual é ligado
    expect(res.body.data.batch.counts.matched).toBe(1);
  });
});

describe('desfazer importação', () => {
  test('desfaz: itens criados somem, ligados só desligam, corte e cursor voltam, importação ao abrir pausa', async () => {
    const manualItem = (await request(app).post('/api/items').send({
      catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 1250,
      acquiredAt: '2026-11-20T09:00:00.000Z', floatValue: 0.2534, paintSeed: 661,
    })).body.data;
    state.trades = [
      fakeTrade({ id: '7001' }),
      fakeTrade({ id: '7002', createdAt: '2026-11-19T10:00:00.000Z', item: { market_hash_name: 'AWP | Dragon Lore (Factory New)', float_value: 0.01, paint_seed: 9 } }),
    ];
    state.transactions = [purchaseTx('97002', 1250)];
    const batch = (await firstRun()).body.data.batch;
    expect(batch.counts).toMatchObject({ matched: 1, purchasesCreated: 1 });
    expect(itemsCount()).toBe(2);

    const preview = await call(request(app).get(`/api/imports/batches/${batch.id}/undo-preview`));
    expect(preview.body.data).toMatchObject({ undoable: true, reason: null, blockers: [], counts: { itemsToDelete: 1, linksToRemove: 1 } });
    const undone = await call(request(app).post(`/api/imports/batches/${batch.id}/undo`).set('Content-Type', JSON_TYPE).send({}));
    expect(undone.status).toBe(200);
    expect(undone.body.data).toMatchObject({ status: 'UNDONE', undoable: false });
    const items = await getItems();
    expect(items.map((i) => i.id)).toEqual([manualItem.id]);
    expect(items[0].externalSource).toBeNull();
    const integration = (await call(request(app).get('/api/integrations/csfloat'))).body.data;
    expect(integration).toMatchObject({ tradesCutoffAt: null, autoImportPaused: true, lastImportAt: null });
    expect(dbRows('SELECT last_transaction_id FROM integrations')[0].last_transaction_id).toBeNull();
    expect(dbRows('SELECT COUNT(*) AS n FROM external_records')[0].n).toBe(0);
    // o corte é perguntado de novo e a mesma compra volta a ser importada
    expectError(await run({}), 400, 'IMPORT_CUTOFF_REQUIRED');
    expect((await firstRun()).body.data.batch.counts).toMatchObject({ matched: 1, purchasesCreated: 1 });
  });

  test('item criado e vendido no app bloqueia; editado/holding exigem confirmação', async () => {
    state.trades = [fakeTrade({ id: '7101', protectionEndsAt: '2026-11-21T14:00:00.000Z' })];
    const batch = (await firstRun()).body.data.batch;
    const itemId = (await getItems())[0].id;

    clock = new Date('2026-11-22T16:00:00.000Z'); // depois da importação: o item muda
    await request(app).post(`/api/items/${itemId}/off-sale`).send({});
    const preview = (await call(request(app).get(`/api/imports/batches/${batch.id}/undo-preview`))).body.data;
    expect(preview.undoable).toBe(true);
    expect(preview.warnings.map((w) => w.code).sort()).toEqual(['ITEM_EDITED', 'ITEM_IN_HOLDING']);
    expectError(await call(request(app).post(`/api/imports/batches/${batch.id}/undo`).set('Content-Type', JSON_TYPE).send({})), 409, 'IMPORT_UNDO_WARNINGS_NOT_CONFIRMED');
    expect(itemsCount()).toBe(1);

    await request(app).post(`/api/items/${itemId}/for-sale`).send({});
    const sold = await request(app).post(`/api/items/${itemId}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 1500, soldAt: '2026-11-22T10:00:00.000Z' });
    expect(sold.status).toBe(200);
    const blocked = (await call(request(app).get(`/api/imports/batches/${batch.id}/undo-preview`))).body.data;
    expect(blocked).toMatchObject({ undoable: false, blockers: [{ code: 'ITEM_SOLD_IN_APP', itemId }] });
    expectError(await call(request(app).post(`/api/imports/batches/${batch.id}/undo`).set('Content-Type', JSON_TYPE).send({ confirmWarnings: true })), 409, 'IMPORT_UNDO_CONFLICT');
    expect(itemsCount()).toBe(1);
  });

  test('só o último lote que mudou algo pode ser desfeito; lote sem mudanças não', async () => {
    state.trades = [fakeTrade({ id: '7201' })];
    const first = (await firstRun()).body.data.batch;
    state.trades = [fakeTrade({ id: '7201' }), fakeTrade({ id: '7202', createdAt: '2026-11-21T10:00:00.000Z', item: { float_value: 0.4, paint_seed: 7 } })];
    const second = (await run({})).body.data.batch;
    expect(second.counts.purchasesCreated).toBe(1);
    const nothing = (await run({})).body.data.batch;
    expect(nothing.undoable).toBe(false);
    expect((await call(request(app).get(`/api/imports/batches/${first.id}/undo-preview`))).body.data).toMatchObject({ undoable: false, reason: 'NOT_LATEST' });
    expect((await call(request(app).get(`/api/imports/batches/${nothing.id}/undo-preview`))).body.data).toMatchObject({ undoable: false, reason: 'NOTHING_TO_UNDO' });
    expectError(await call(request(app).post(`/api/imports/batches/${first.id}/undo`).set('Content-Type', JSON_TYPE).send({})), 409, 'IMPORT_UNDO_NOT_LATEST');
    const ok = await call(request(app).post(`/api/imports/batches/${second.id}/undo`).set('Content-Type', JSON_TYPE).send({}));
    expect(ok.status).toBe(200);
    expect(itemsCount()).toBe(1);
    expect((await call(request(app).get(`/api/imports/batches/${second.id}/undo-preview`))).body.data.reason).toBe('ALREADY_UNDONE');
  });

  test('lote inexistente e id inválido', async () => {
    expectError(await call(request(app).get('/api/imports/batches/999')), 404, 'IMPORT_BATCH_NOT_FOUND');
    expectError(await call(request(app).get('/api/imports/batches/abc')), 400, 'INVALID_ID');
  });
});

describe('item importado e removido no app', () => {
  test('excluir à mão um item importado: não volta na próxima importação', async () => {
    state.trades = [fakeTrade({ id: '8001' })];
    await firstRun();
    const itemId = (await getItems())[0].id;
    const del = await request(app).delete(`/api/items/${itemId}`);
    expect(del.status).toBe(200);
    expect(dbRows('SELECT tracking FROM external_records WHERE kind = ?', 'TRADE')[0].tracking).toBe('REMOVED_IN_APP');
    expect(dbRows('SELECT COUNT(*) AS n FROM external_links')[0].n).toBe(0);
    const res = await run({});
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 0, known: 1 });
    expect(itemsCount()).toBe(0);
  });
});

describe('pré-condições, concorrência e falhas de rede', () => {
  test('sem chave -> CSFLOAT_API_KEY_REQUIRED (409); trigger AUTO -> IMPORT_AUTO_NOT_AVAILABLE', async () => {
    expectError(await run({ trigger: 'AUTO', cutoffAt: CUTOFF }), 409, 'IMPORT_AUTO_NOT_AVAILABLE');
    expectError(await run({ trigger: 'OUTRO' }), 400, 'INVALID_FIELD', { field: 'trigger' });
    expectError(await run({ fullScan: 'sim' }), 400, 'INVALID_FIELD', { field: 'fullScan' });
    expectError(await run({ surpresa: 1 }), 400, 'UNKNOWN_FIELD');
    await request(app).delete('/api/integrations/csfloat/api-key');
    expectError(await run({ cutoffAt: CUTOFF }), 409, 'CSFLOAT_API_KEY_REQUIRED');
  });

  test('sem loja ligada -> IMPORT_STORE_REQUIRED; loja em R$ -> IMPORT_STORE_CURRENCY_NOT_ALLOWED', async () => {
    getDb().prepare('UPDATE stores SET name = ? WHERE id = ?').run('Outra', storeId('CSFloat'));
    getDb().prepare('UPDATE integrations SET store_id = NULL').run();
    expectError(await run({ cutoffAt: CUTOFF }), 409, 'IMPORT_STORE_REQUIRED');
    const brl = storeId('Steam');
    getDb().prepare('UPDATE integrations SET store_id = ?').run(brl);
    const currency = getDb().prepare('SELECT currency FROM stores WHERE id = ?').get(brl).currency;
    if (currency !== 'USD') expectError(await run({ cutoffAt: CUTOFF }), 400, 'IMPORT_STORE_CURRENCY_NOT_ALLOWED');
  });

  test('duas importações simultâneas: uma passa e a outra recebe 409 IMPORT_IN_PROGRESS', async () => {
    state.trades = [fakeTrade({ id: '9001' })];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const slow = routedFetch(state);
    fetchFn = jest.fn(async (url, init) => { await gate; return slow(url, init); });
    fetchFn.calls = slow.calls;
    app = createApp({ now: () => new Date(clock.getTime()), fetchFn, sleepFn: async () => {} });
    const first = firstRun();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = await firstRun();
    expectError(second, 409, 'IMPORT_IN_PROGRESS');
    release();
    expect((await first).status).toBe(200);
    expect(itemsCount()).toBe(1);
  });

  test('importar backup e trocar de conta durante a importação são recusados', async () => {
    state.trades = [fakeTrade({ id: '9101' })];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const slow = routedFetch(state);
    fetchFn = jest.fn(async (url, init) => { await gate; return slow(url, init); });
    fetchFn.calls = slow.calls;
    app = createApp({ now: () => new Date(clock.getTime()), fetchFn, sleepFn: async () => {} });
    const running = firstRun();
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
    expect((await call(request(app).get('/api/integrations/csfloat'))).body.data.importInProgress).toBe(true);
      // a importação de backup consulta a mesma trava (com banco em memória a rota responde antes, BACKUP_UNAVAILABLE)
      expect(require('../../src/services/backupService').isBackupBusy()).toBe(true);
    expectError(await call(request(app).post('/api/integrations/csfloat/switch-account').set('Content-Type', JSON_TYPE).send({ confirm: true })), 409, 'IMPORT_IN_PROGRESS');
    } finally {
      release();
    }
    expect((await running).status).toBe(200);
  });

  test('conta diferente -> CSFLOAT_ACCOUNT_CHANGED sem gravar nada; depois de "Trocar de conta", os abertos viram IGNORED', async () => {
    state.trades = [fakeTrade({ id: '9201', state: 'queued', offerState: null, acceptedAt: null })];
    await firstRun();
    expect(dbRows('SELECT tracking FROM external_records WHERE kind = ?', 'TRADE')[0].tracking).toBe('WAITING_TRANSFER');
    const before = batchesCount();
    state.me = meBody({ user: { steam_id: PII.steamId2 } });
    expectError(await run({}), 409, 'CSFLOAT_ACCOUNT_CHANGED');
    expect(batchesCount()).toBe(before);
    // a resposta da troca traz o nome da conta (D309: só na resposta), por isso não entra na varredura de vazamento
    const sw = await request(app).post('/api/integrations/csfloat/switch-account').set('Content-Type', JSON_TYPE).send({ confirm: true });
    expect(sw.status).toBe(200);
    expect(dbRows('SELECT tracking FROM external_records WHERE kind = ?', 'TRADE')[0].tracking).toBe('IGNORED');
    expect((await call(request(app).get('/api/integrations/csfloat'))).body.data.tradesCutoffAt).toBeNull();
  });

  test.each([
    [401, 'CSFLOAT_AUTH_FAILED'],
    [403, 'CSFLOAT_AUTH_FAILED'],
    [500, 'IMPORT_SOURCE_UNAVAILABLE'],
    [429, 'IMPORT_RATE_LIMITED'],
  ])('HTTP %s no meio da paginação: nada é aplicado e o lote FAILED é gravado com o código', async (status, code) => {
    const trades = [];
    for (let i = 0; i < 60; i += 1) trades.push(fakeTrade({ id: String(9300 + i), createdAt: `2026-11-20T10:${String(59 - i).padStart(2, '0')}:00.000Z`, item: { float_value: 0.2 + i / 1000 } }));
    state.trades = trades;
    state.failAt = { path: '/me/trades', page: 1, status };
    const res = await firstRun();
    expectError(res, 502, code);
    expect(itemsCount()).toBe(0);
    expect(dbRows('SELECT COUNT(*) AS n FROM external_records')[0].n).toBe(0);
    expect(dbRows('SELECT status, error_code FROM import_batches')).toEqual([{ status: 'FAILED', error_code: code }]);
    const integration = (await call(request(app).get('/api/integrations/csfloat'))).body.data;
    expect(integration).toMatchObject({ lastImportStatus: 'FAILED', lastImportErrorCode: code, tradesCutoffAt: null, importInProgress: false });
  });

  test('formato mudou (trades sem lista) -> IMPORT_SOURCE_FORMAT_CHANGED', async () => {
    fetchFn = jest.fn(async (url) => (String(url).includes('/me/trades') ? fakeResponse(200, { items: [] }) : routedFetch(state)(url)));
    fetchFn.calls = [];
    app = createApp({ now: () => new Date(clock.getTime()), fetchFn, sleepFn: async () => {} });
    expectError(await firstRun(), 502, 'IMPORT_SOURCE_FORMAT_CHANGED');
    expect(dbRows('SELECT error_code FROM import_batches')[0].error_code).toBe('IMPORT_SOURCE_FORMAT_CHANGED');
  });

  test('erro inesperado na aplicação: nada é aplicado e o lote FAILED (INTERNAL_ERROR) é gravado', async () => {
    state.trades = [fakeTrade({ id: '9401' })];
    const itemService = require('../../src/services/itemService');
    const spy = jest.spyOn(itemService, 'createItem').mockImplementation(() => { throw new TypeError('boom'); });
    try {
      const res = await firstRun();
      expect(res.status).toBe(500);
      expect(itemsCount()).toBe(0);
      expect(dbRows('SELECT COUNT(*) AS n FROM external_records')[0].n).toBe(0);
      expect(dbRows('SELECT status, error_code FROM import_batches')).toEqual([{ status: 'FAILED', error_code: 'INTERNAL_ERROR' }]);
    } finally {
      spy.mockRestore();
    }
  });

  test('item que o app recusa (float fora da faixa do catálogo): falha da compra, as outras entram', async () => {
    state.trades = [
      fakeTrade({ id: '9501', createdAt: '2026-11-20T10:00:00.000Z', item: { float_value: 0.02 } }), // Redline: mínimo 0,10
      fakeTrade({ id: '9502', createdAt: '2026-11-19T10:00:00.000Z', item: { float_value: 0.3, paint_seed: 8 } }),
    ];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, failed: 1 });
    expect(res.body.data.batch.entries.find((e) => e.outcome === 'FAILED').reasonCode).toBe('FLOAT_OUT_OF_RANGE');
    expect(itemsCount()).toBe(1);
  });
});

describe('listas e rotas', () => {
  test('lotes com limit/before e pendências; Content-Type e query inválidos', async () => {
    state.trades = [fakeTrade({ id: 'a1'.replace('a', '1') })];
    await firstRun();
    await run({});
    await run({});
    const page1 = (await call(request(app).get('/api/imports/batches?limit=2'))).body.data;
    expect(page1.batches).toHaveLength(2);
    expect(page1.nextBefore).toBe(page1.batches[1].id);
    expect(page1.batches[0]).not.toHaveProperty('entries');
    const page2 = (await call(request(app).get(`/api/imports/batches?limit=2&before=${page1.nextBefore}`))).body.data;
    expect(page2.batches).toHaveLength(1);
    expect(page2.nextBefore).toBeNull();
    expectError(await call(request(app).get('/api/imports/batches?limit=0')), 400, 'INVALID_QUERY');
    expectError(await call(request(app).get('/api/imports/batches?limit=99')), 400, 'INVALID_QUERY');
    expectError(await call(request(app).get('/api/imports/batches?before=x')), 400, 'INVALID_QUERY');
    expectError(await call(request(app).get('/api/imports/entries')), 400, 'INVALID_QUERY');
    expectError(await call(request(app).get('/api/imports/entries?open=false')), 400, 'INVALID_QUERY');
    expect((await call(request(app).post('/api/imports/csfloat/run').set('Content-Type', 'text/plain').send('{}'))).status).toBe(415);
    expect((await call(request(app).post('/api/imports/csfloat/run').set('Host', 'evil.example').set('Content-Type', JSON_TYPE).send({}))).status).toBeGreaterThanOrEqual(400);
  });

  test('GET integração: suggestedCutoffAt (último manual ou aporte), importInProgress e openEntriesCount reais', async () => {
    const sid = storeId('CSFloat');
    const initial = (await call(request(app).get('/api/integrations/csfloat'))).body.data;
    expect(initial.suggestedCutoffAt).toBeNull();
    await request(app).post('/api/items').send({ catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: sid, purchasePriceCents: 100, acquiredAt: '2026-11-05T10:00:00.000Z' });
    const dep = await request(app).post('/api/deposits').send({ storeId: sid, amountStoreCents: 5000, depositedAt: '2026-11-08T10:00:00.000Z' });
    expect(dep.status).toBe(201);
    const view = (await call(request(app).get('/api/integrations/csfloat'))).body.data;
    expect(view.suggestedCutoffAt).toBe('2026-11-08T10:00:00.000Z');
    state.trades = [fakeTrade({ id: '9601', state: 'weird_state' })];
    await firstRun();
    const after = (await call(request(app).get('/api/integrations/csfloat'))).body.data;
    expect(after.openEntriesCount).toBe(1);
    expect(after.suggestedCutoffAt).toBeNull();
  });
});
