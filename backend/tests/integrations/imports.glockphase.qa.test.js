'use strict';

// 10.9 (D368, QA, E-P2-Q56): importação do CSFloat com a Glock-18 | Gamma Doppler. Sem o texto `phase`, o paint_index 1119-1123 casa com a
// entrada do catálogo daquela fase (antes dava CATALOG_AMBIGUOUS). Parte pura (mapTradeItem) e parte pela API com fetch falso e banco em
// memória. Dados INVENTADOS; nenhuma rede real.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, CAT } = require('../helpers/catalog');
const CatalogItem = require('../../src/models/CatalogItem');
const mapperItem = require('../../src/services/imports/externalItemMapper');
const { KEY, meBody, fakeTrade, routedFetch } = require('../helpers/csfloatFixtures');

const GLOCK = 'Glock-18 | Gamma Doppler';
const PHASES = [['Emerald', 1119], ['Phase 1', 1120], ['Phase 2', 1121], ['Phase 3', 1122], ['Phase 4', 1123]];
const catalogId = (phase) => `skin-glock-gd-${phase.toLowerCase().replace(/\s+/g, '')}`;
const row = (id, name, phase, extra = {}) => ({
  id, source: 'SKINS', category: 'SKIN', name, nameKey: name.toLowerCase(), searchText: name.toLowerCase(),
  minFloat: 0, maxFloat: 0.08, hasStattrak: 1, hasSouvenir: 0, phase, ...extra,
});
const GLOCK_ROWS = PHASES.map(([phase]) => row(catalogId(phase), GLOCK, phase));

describe('Q56 importação (puro): mapTradeItem', () => {
  const item = (extra = {}) => ({
    marketHashName: `${GLOCK} (Factory New)`, isStattrak: false, isSouvenir: false, isCommodity: false, floatValue: 0.02, paintSeed: 5, phase: null, paintIndex: null, ...extra,
  });
  const find = (rows = GLOCK_ROWS) => ({ findByNameKeyAnyCategory: (key) => rows.filter((r) => r.nameKey === key) });

  test.each(PHASES)('sem texto de fase, o paint_index casa a fase %s', (phase, index) => {
    const mapped = mapperItem.mapTradeItem(item({ paintIndex: index }), find());
    expect(mapped).toMatchObject({ ok: true, category: 'SKIN', name: GLOCK, catalogEntry: { id: catalogId(phase), phase } });
    expect(mapped.phase).toBeNull(); // a fase gravada vem do catálogo, nunca reenviada (senão daria CATALOG_DERIVED_FIELD)
  });

  test('StatTrak: o mesmo índice casa a fase e a variante segue STATTRAK', () => {
    const mapped = mapperItem.mapTradeItem(item({ marketHashName: `StatTrak™ ${GLOCK} (Factory New)`, isStattrak: true, paintIndex: 1122 }), find());
    expect(mapped).toMatchObject({ ok: true, variant: 'STATTRAK', catalogEntry: { id: catalogId('Phase 3') } });
  });

  test('sem texto de fase: sem paint_index ou com paint_index fora da tabela (1118, 1124, 0, 418) -> CATALOG_AMBIGUOUS', () => {
    for (const paintIndex of [null, 1118, 1124, 0]) {
      expect(mapperItem.mapTradeItem(item({ paintIndex }), find())).toEqual({ ok: false, reason: 'CATALOG_AMBIGUOUS' });
    }
    // 418 é "Phase 1" da faca Doppler na tabela plana: casa a fase "Phase 1" da Glock (comportamento atual, documentado)
    expect(mapperItem.mapTradeItem(item({ paintIndex: 418 }), find())).toMatchObject({ ok: true, catalogEntry: { id: catalogId('Phase 1') } });
  });

  test('o texto `phase` do CSFloat tem prioridade sobre o paint_index (também em minúsculas)', () => {
    expect(mapperItem.mapTradeItem(item({ phase: 'Phase 4', paintIndex: 1120 }), find()).catalogEntry.id).toBe(catalogId('Phase 4'));
    expect(mapperItem.mapTradeItem(item({ phase: 'emerald', paintIndex: 1123 }), find()).catalogEntry.id).toBe(catalogId('Emerald'));
    expect(mapperItem.tradePhaseKey(item({ phase: 'Phase 2', paintIndex: 1119 }))).toBe('phase 2');
    expect(mapperItem.tradePhaseKey(item({ paintIndex: 1119 }))).toBe('emerald');
    expect(mapperItem.tradePhaseKey(item({ paintIndex: 1124 }))).toBeNull();
  });

  test('catálogo sem a fase pedida -> AMBIGUOUS (não escolhe outra fase)', () => {
    const rows = GLOCK_ROWS.filter((r) => r.phase !== 'Phase 2');
    expect(mapperItem.mapTradeItem(item({ paintIndex: 1121 }), find(rows))).toEqual({ ok: false, reason: 'CATALOG_AMBIGUOUS' });
  });

  test('item sem fase no catálogo não é afetado por paint_index 1119-1123', () => {
    const ak = row('skin-ak-x', 'AK-47 | Redline', null);
    for (const [, index] of PHASES) {
      const mapped = mapperItem.mapTradeItem(item({ marketHashName: 'AK-47 | Redline (Field-Tested)', paintIndex: index }), find([ak]));
      expect(mapped).toMatchObject({ ok: true, catalogEntry: { id: 'skin-ak-x' }, phase: null });
    }
  });

  test('facas Doppler: os índices de faca seguem iguais (419 = Phase 2)', () => {
    const k = [row('k1', '★ Karambit | Doppler', 'Phase 1', { category: 'FACA' }), row('k2', '★ Karambit | Doppler', 'Phase 2', { category: 'FACA' })];
    const knife = { marketHashName: '★ Karambit | Doppler (Factory New)' };
    expect(mapperItem.mapTradeItem(item({ ...knife, paintIndex: 419 }), { findByNameKeyAnyCategory: () => k }).catalogEntry.id).toBe('k2');
    expect(mapperItem.mapTradeItem(item({ ...knife, paintIndex: 418 }), { findByNameKeyAnyCategory: () => k }).catalogEntry.id).toBe('k1');
  });
});

describe('Q56 importação (API, fetch falso)', () => {
  const JSON_TYPE = 'application/json';
  const NOW = new Date('2026-11-22T15:00:00.000Z');
  const CUTOFF = '2026-11-01T00:00:00.000Z';
  let app;
  let state;
  const run = () => request(app).post('/api/imports/csfloat/run').set('Content-Type', JSON_TYPE).send({ cutoffAt: CUTOFF });
  const getItems = async () => (await request(app).get('/api/items')).body.data.items;
  const glockTrade = (id, hours, item) => fakeTrade({
    id, createdAt: `2026-11-20T${String(hours).padStart(2, '0')}:00:00.000Z`,
    item: { market_hash_name: `${GLOCK} (Factory New)`, float_value: 0.02, paint_seed: 7, ...item },
  });

  beforeEach(async () => {
    freshDb();
    importCatalogFixture();
    CatalogItem.upsertMany(GLOCK_ROWS, { now: NOW });
    state = { me: meBody(), trades: [], transactions: [] };
    app = createApp({ now: () => new Date(NOW), fetchFn: routedFetch(state), sleepFn: async () => {} });
    await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY }).expect(200);
  });
  afterAll(() => closeDb());

  test('as 5 compras só com paint_index entram, cada uma na fase certa, sem CATALOG_AMBIGUOUS nem CATALOG_DERIVED_FIELD', async () => {
    state.trades = PHASES.map(([, index], i) => glockTrade(`71${i}`, 10 + i, { phase: null, paint_index: index }));
    const res = await run();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 5, failed: 0 });
    expect(res.body.data.batch.entries.map((e) => e.reasonCode).filter(Boolean)).toEqual([]);
    const items = await getItems();
    expect(items.map((i) => [i.catalogId, i.phase]).sort()).toEqual(PHASES.map(([phase]) => [catalogId(phase), phase]).sort());
    expect(items.every((i) => i.exterior === 'FN' && i.name === GLOCK)).toBe(true);
  });

  test('StatTrak sem texto de fase: fase do catálogo e variante STATTRAK', async () => {
    state.trades = [glockTrade('720', 10, { market_hash_name: `StatTrak™ ${GLOCK} (Factory New)`, is_stattrak: true, phase: null, paint_index: 1123 })];
    const res = await run();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, failed: 0 });
    expect((await getItems())[0]).toMatchObject({ catalogId: catalogId('Phase 4'), phase: 'Phase 4', variant: 'STATTRAK' });
  });

  test('o texto `phase` presente tem prioridade sobre o paint_index', async () => {
    state.trades = [glockTrade('730', 10, { phase: 'Phase 2', paint_index: 1119 })];
    await run();
    expect((await getItems())[0]).toMatchObject({ catalogId: catalogId('Phase 2'), phase: 'Phase 2' });
  });

  test('sem fase e sem paint_index: falha CATALOG_AMBIGUOUS e nenhum item é criado', async () => {
    state.trades = [glockTrade('740', 10, { phase: null, paint_index: null })];
    const res = await run();
    expect(res.body.data.batch.entries[0]).toMatchObject({ outcome: 'FAILED', reasonCode: 'CATALOG_AMBIGUOUS' });
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM items').get().n).toBe(0);
  });

  test('item sem fase no catálogo (AK Redline) com paint_index 1121 entra normalmente, sem fase', async () => {
    state.trades = [fakeTrade({
      id: '750', createdAt: '2026-11-20T10:00:00.000Z',
      item: { market_hash_name: 'AK-47 | Redline (Field-Tested)', phase: null, paint_index: 1121, float_value: 0.3, paint_seed: 3 },
    })];
    const res = await run();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, failed: 0 });
    expect((await getItems())[0]).toMatchObject({ catalogId: CAT.AK_REDLINE, phase: null });
  });
});
