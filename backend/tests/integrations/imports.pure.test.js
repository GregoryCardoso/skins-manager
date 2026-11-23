'use strict';

// 9.2 (D318): funções puras da importação (classificador, paradas da varredura, mapper do item, casamento, mapper do Adapter).
const { classify, settleTracking } = require('../../src/services/imports/tradeClassifier');
const scanPolicy = require('../../src/services/imports/scanPolicy');
const mapperItem = require('../../src/services/imports/externalItemMapper');
const { matchPurchases, floatsMatch } = require('../../src/services/imports/manualMatchService');
const { assessUndo } = require('../../src/services/imports/undoService');
const { pickLatest } = require('../../src/services/imports/cutoffService');
const importViews = require('../../src/services/imports/importViews');
const { mapTradesPage, mapTrade, mapTransactionsPage } = require('../../src/services/imports/adapters/csfloatMapper');
const { fakeTrade, fakeTransaction, TRADE_PII, OTHER } = require('../helpers/csfloatFixtures');
const { IMPORT_RECHECK_WINDOW_MS } = require('../../src/config/constants');

const NOW = new Date('2026-11-22T15:00:00.000Z');
const CUTOFF = Date.parse('2026-11-01T00:00:00.000Z');
const norm = (raw) => mapTrade(raw).trade;
const ctx = (extra = {}) => ({ now: NOW, cutoffMs: CUTOFF, ...extra });

describe('csfloatMapper: allowlist de trades e extrato', () => {
  test('nenhum dado pessoal sai do mapper (busca recursiva dos valores falsos)', () => {
    const page = mapTradesPage({ trades: [fakeTrade({ id: '1' }), fakeTrade({ id: '2', direction: 'SELL' })], count: 2 });
    const text = JSON.stringify(page);
    // `buyerId`/`sellerId` saem só para o service calcular a direção (e nunca são gravados): o Steam ID da outra parte é o único valor permitido
    for (const value of TRADE_PII.filter((v) => v !== OTHER.steamId)) expect(text).not.toContain(value);
    for (const key of ['buyer"', 'seller"', 'trade_url', 'trade_token', 'inspect_link', 'asset_id', 'stickers', 'keychains']) expect(text).not.toContain(key);
    const tx = mapTransactionsPage({ transactions: [fakeTransaction({ id: 'a', details: { contract_id: '9', fee_amount: '20' } })], count: 1 });
    const txText = JSON.stringify(tx);
    for (const value of ['SESSION-FICTICIO-QA', 'CONNECT-FICTICIO-QA', 'TRANSFER-FICTICIO-QA', 'payment_method']) expect(txText).not.toContain(value);
    expect(tx.transactions[0].transaction).toMatchObject({ externalId: 'a', contractId: '9', feeCents: 20 });
  });

  test('campos essenciais ausentes -> SOURCE_RECORD_INVALID; os tolerantes viram null', () => {
    for (const mutate of [(t) => delete t.id, (t) => delete t.contract_id, (t) => delete t.buyer_id, (t) => delete t.created_at, (t) => delete t.contract.price,
      (t) => delete t.contract.item.market_hash_name, (t) => { t.contract.price = -1; }]) {
      const raw = fakeTrade({ id: '1' });
      mutate(raw);
      expect(mapTrade(raw)).toMatchObject({ ok: false, reason: 'SOURCE_RECORD_INVALID' });
    }
    const loose = fakeTrade({ id: '1', item: { float_value: 7, paint_seed: 5000, phase: 12, def_index: 'x' } });
    delete loose.steam_offer;
    expect(norm(loose)).toMatchObject({ offerState: null, item: { floatValue: null, paintSeed: null, phase: null, defIndex: null } });
  });

  test('página sem trades, count inválido e id repetido -> formato mudou', () => {
    expect(() => mapTradesPage({ count: 1 })).toThrow(expect.objectContaining({ code: 'IMPORT_SOURCE_FORMAT_CHANGED' }));
    expect(() => mapTradesPage({ trades: [], count: -1 })).toThrow(expect.objectContaining({ code: 'IMPORT_SOURCE_FORMAT_CHANGED' }));
    expect(() => mapTradesPage({ trades: [fakeTrade({ id: '1' }), fakeTrade({ id: '1' })], count: 2 })).toThrow(expect.objectContaining({ code: 'IMPORT_SOURCE_FORMAT_CHANGED' }));
    expect(() => mapTransactionsPage({ nope: [] })).toThrow(expect.objectContaining({ code: 'IMPORT_SOURCE_FORMAT_CHANGED' }));
  });

  test('ids: número seguro vira texto; inseguro é inválido; offsets não inteiros invalidam a transação', () => {
    expect(mapTrade(fakeTrade({ id: 123 })).trade.externalId).toBe('123');
    expect(mapTrade({ ...fakeTrade({ id: '1' }), id: 9007199254740993 })).toMatchObject({ ok: false });
    expect(mapTransactionsPage({ transactions: [fakeTransaction({ balanceOffset: 1.5 })], count: 1 }).transactions[0].ok).toBe(false);
    const ok = mapTransactionsPage({ transactions: [fakeTransaction({ balanceOffset: '-1250', details: { float_fee: '32', processor_fee: '0' } })], count: 1 });
    expect(ok.transactions[0].transaction).toMatchObject({ balanceOffsetCents: -1250, feeCents: 32 });
  });
});

describe('tradeClassifier (D294)', () => {
  const trade = (extra = {}) => norm(fakeTrade({ id: '1', ...extra }));

  test('pending + oferta 3 + aceite = importar', () => {
    expect(classify(trade({ state: 'pending' }), 'BUY', null, ctx())).toMatchObject({ kind: 'IMPORT', tracking: 'OPEN' });
  });
  test('verified com aceite importa e fecha', () => {
    expect(classify(trade({ state: 'verified' }), 'BUY', null, ctx())).toMatchObject({ kind: 'IMPORT', tracking: 'SETTLED' });
  });
  test('sem aceite: espera (queued sem oferta, oferta 2); failed sem aceite fecha', () => {
    expect(classify(trade({ state: 'queued', offerState: null, acceptedAt: null }), 'BUY', null, ctx())).toMatchObject({ kind: 'MARK', tracking: 'WAITING_TRANSFER' });
    expect(classify(trade({ state: 'pending', offerState: 2, acceptedAt: null }), 'BUY', null, ctx())).toMatchObject({ tracking: 'WAITING_TRANSFER' });
    expect(classify(trade({ state: 'failed', offerState: 6, acceptedAt: null }), 'BUY', null, ctx())).toMatchObject({ tracking: 'CLOSED_NOT_TRANSFERRED' });
  });
  test('failed/cancelled com aceite e nunca importado: não importa', () => {
    expect(classify(trade({ state: 'cancelled' }), 'BUY', null, ctx())).toMatchObject({ kind: 'MARK', tracking: 'CLOSED_NOT_TRANSFERRED' });
  });
  test('estado ou oferta desconhecidos: UNKNOWN_STATE com entrada', () => {
    expect(classify(trade({ state: 'weird_state' }), 'BUY', null, ctx())).toMatchObject({ tracking: 'UNKNOWN_STATE', entry: { outcome: 'UNKNOWN_STATE' } });
    expect(classify(trade({ offerState: 12 }), 'BUY', null, ctx())).toMatchObject({ tracking: 'UNKNOWN_STATE' });
    expect(classify(trade({ offerState: 1 }), 'BUY', null, ctx())).toMatchObject({ tracking: 'UNKNOWN_STATE' });
  });
  test('corte, venda adiada, enviado a outra pessoa, estorno', () => {
    expect(classify(trade({ createdAt: '2026-10-01T00:00:00.000Z' }), 'BUY', null, ctx())).toMatchObject({ tracking: 'BEFORE_CUTOFF', count: 'beforeCutoff' });
    expect(classify(trade(), 'SELL', null, ctx())).toMatchObject({ tracking: 'DEFERRED', count: 'deferred' });
    expect(classify(trade({ sentToDifferentUser: '7656' }), 'BUY', null, ctx())).toMatchObject({ tracking: 'RETRY', entry: { reasonCode: 'TRADE_SENT_TO_OTHER_USER' } });
    expect(classify(trade(), 'BUY', null, ctx({ refundSignal: true }))).toMatchObject({ tracking: 'CLOSED_NOT_TRANSFERRED' });
  });
  test('já ligado: reverte por falha, por oferta deixar de ser 3 ou por estorno; senão fecha ou mantém aberto', () => {
    const linked = { hasLink: true };
    expect(classify(trade({ state: 'failed', offerState: 3 }), 'BUY', { tracking: 'OPEN' }, ctx(linked))).toMatchObject({ kind: 'LINKED', tracking: 'REVERTED', entry: { outcome: 'REVERTED' } });
    expect(classify(trade({ state: 'pending', offerState: 7 }), 'BUY', { tracking: 'OPEN' }, ctx(linked))).toMatchObject({ tracking: 'REVERTED' });
    expect(classify(trade(), 'BUY', { tracking: 'SETTLED' }, ctx({ ...linked, refundSignal: true }))).toMatchObject({ tracking: 'REVERTED' });
    expect(classify(trade({ state: 'verified' }), 'BUY', { tracking: 'OPEN' }, ctx(linked))).toMatchObject({ tracking: 'SETTLED', count: 'known' });
    expect(classify(trade({ state: 'pending' }), 'BUY', { tracking: 'OPEN' }, ctx(linked))).toMatchObject({ tracking: 'OPEN', count: 'known' });
    expect(classify(trade({ state: 'failed' }), 'BUY', { tracking: 'REVERTED' }, ctx(linked))).toMatchObject({ kind: 'KEEP' }); // não repete a entrada
  });
  test('registros decididos não mudam', () => {
    for (const tracking of ['NEEDS_REVIEW', 'REMOVED_IN_APP', 'IGNORED', 'CLOSED_NOT_TRANSFERRED', 'BEFORE_CUTOFF']) {
      expect(classify(trade(), 'BUY', { tracking }, ctx())).toMatchObject({ kind: 'KEEP', tracking });
    }
  });
  test('settleTracking: fecha depois da folga de 2 dias além da proteção', () => {
    const t = trade({ state: 'pending', protectionEndsAt: '2026-11-10T00:00:00.000Z' });
    expect(settleTracking(t, NOW)).toBe('SETTLED');
    expect(settleTracking(trade({ state: 'pending', protectionEndsAt: '2026-11-27T00:00:00.000Z' }), NOW)).toBe('OPEN');
  });
});

describe('scanPolicy (D295)', () => {
  const base = { page: 0, limit: 50, count: 500, pageSize: 50, maxPages: 200 };
  const day = 86400000;
  test('fim da lista, teto de páginas', () => {
    expect(scanPolicy.shouldStopTrades({ ...base, page: 9, oldestMs: 1, allClosed: false })).toEqual({ stop: true, reason: 'END' });
    expect(scanPolicy.shouldStopTrades({ ...base, pageSize: 0 })).toEqual({ stop: true, reason: 'END' });
    expect(scanPolicy.shouldStopTrades({ ...base, page: 199, count: 99999, oldestMs: 1, allClosed: false })).toEqual({ stop: true, reason: 'LIMIT' });
  });
  test('parada incremental: tudo conhecido e fechado E mais antigo que o horizonte', () => {
    const args = { ...base, oldestMs: 100 * day, horizonMs: 200 * day, allClosed: true };
    expect(scanPolicy.shouldStopTrades(args)).toEqual({ stop: true, reason: 'KNOWN' });
    expect(scanPolicy.shouldStopTrades({ ...args, allClosed: false }).stop).toBe(false);
    expect(scanPolicy.shouldStopTrades({ ...args, oldestMs: 300 * day }).stop).toBe(false);
  });
  test('primeira importação: para quando passa do corte menos a janela', () => {
    const args = { ...base, firstImport: true, cutoffMs: 100 * day, allClosed: false };
    expect(scanPolicy.shouldStopTrades({ ...args, oldestMs: 100 * day - IMPORT_RECHECK_WINDOW_MS - 1 })).toEqual({ stop: true, reason: 'CUTOFF' });
    expect(scanPolicy.shouldStopTrades({ ...args, oldestMs: 100 * day - IMPORT_RECHECK_WINDOW_MS + 1 }).stop).toBe(false);
  });
  test('varredura completa e ordem quebrada desligam as paradas', () => {
    const args = { ...base, oldestMs: 100 * day, horizonMs: 200 * day, allClosed: true };
    expect(scanPolicy.shouldStopTrades({ ...args, fullScan: true }).stop).toBe(false);
    expect(scanPolicy.shouldStopTrades({ ...args, orderBroken: true }).stop).toBe(false);
    expect(scanPolicy.shouldStopTransactions({ ...base, oldestMs: 1, cursorCreatedMs: 100 * day, fullScan: true }).stop).toBe(false);
  });
  test('extrato: cursor menos a janela; sem cursor, o corte menos a janela', () => {
    expect(scanPolicy.shouldStopTransactions({ ...base, oldestMs: 100 * day - IMPORT_RECHECK_WINDOW_MS - 1, cursorCreatedMs: 100 * day })).toEqual({ stop: true, reason: 'KNOWN' });
    expect(scanPolicy.shouldStopTransactions({ ...base, oldestMs: 100 * day, cursorCreatedMs: 100 * day }).stop).toBe(false);
    expect(scanPolicy.shouldStopTransactions({ ...base, oldestMs: 50 * day, cutoffMs: 100 * day }).stop).toBe(true);
  });
  test('horizonte: o mais antigo entre abertos, transações novas e última importação menos a janela', () => {
    expect(scanPolicy.computeHorizon({ openRecordsOldestMs: 50, newTransactionsOldestMs: 70, lastImportMs: 10 * day })).toBe(10 * day - IMPORT_RECHECK_WINDOW_MS < 50 ? 10 * day - IMPORT_RECHECK_WINDOW_MS : 50);
    expect(scanPolicy.computeHorizon({ openRecordsOldestMs: 5 * day, lastImportMs: 100 * day })).toBe(5 * day);
    expect(scanPolicy.computeHorizon({})).toBeNull();
  });
  test('isOrderBroken', () => {
    expect(scanPolicy.isOrderBroken([5, 4, 3])).toBe(false);
    expect(scanPolicy.isOrderBroken([5, 6])).toBe(true);
    expect(scanPolicy.isOrderBroken([3, 2], 2)).toBe(true);
  });
});

describe('externalItemMapper (D297)', () => {
  const entry = (extra) => ({ id: 'x', category: 'SKIN', name: 'AK-47 | Redline', phase: null, ...extra });
  const find = (rows) => (key) => rows.filter((r) => mapperItem.baseNameKey({ marketHashName: r.name, isStattrak: false, isSouvenir: false }) === key || r.name.toLowerCase().replace(/[★™]/g, '').trim() === key);
  const item = (extra = {}) => ({ marketHashName: 'AK-47 | Redline (Field-Tested)', isStattrak: false, isSouvenir: false, isCommodity: false, floatValue: 0.3, paintSeed: 5, phase: null, paintIndex: null, ...extra });

  test('nome base: ★, StatTrak, Souvenir, "Souvenir Package" e desgaste', () => {
    expect(mapperItem.baseNameKey(item({ marketHashName: '★ StatTrak™ Karambit | Doppler (Factory New)', isStattrak: true }))).toBe('karambit | doppler');
    expect(mapperItem.baseNameKey(item({ marketHashName: 'Souvenir AWP | Dragon Lore (Battle-Scarred)', isSouvenir: true }))).toBe('awp | dragon lore');
    expect(mapperItem.baseNameKey(item({ marketHashName: 'Dust 2 Souvenir Package', isSouvenir: false }))).toBe('dust 2 souvenir package');
    expect(mapperItem.baseNameKey(item({ marketHashName: '★ Karambit' }))).toBe('karambit');
  });
  test('fase por texto e por paint_index; sem fase é ambíguo', () => {
    const rows = [entry({ id: 'p1', name: '★ Karambit | Doppler', category: 'FACA', phase: 'Phase 1' }), entry({ id: 'p2', name: '★ Karambit | Doppler', category: 'FACA', phase: 'Phase 2' })];
    const mk = (extra) => item({ marketHashName: '★ Karambit | Doppler (Factory New)', ...extra });
    const lookup = () => rows;
    expect(mapperItem.mapTradeItem(mk({ phase: 'Phase 2' }), { findByNameKeyAnyCategory: lookup }).catalogEntry.id).toBe('p2');
    expect(mapperItem.mapTradeItem(mk({ paintIndex: 418 }), { findByNameKeyAnyCategory: lookup }).catalogEntry.id).toBe('p1');
    expect(mapperItem.mapTradeItem(mk({}), { findByNameKeyAnyCategory: lookup })).toEqual({ ok: false, reason: 'CATALOG_AMBIGUOUS' });
    // fase do catálogo nunca é reenviada
    expect(mapperItem.mapTradeItem(mk({ phase: 'Phase 2' }), { findByNameKeyAnyCategory: lookup }).phase).toBeNull();
  });
  test('não encontrado, OUTRO por prefixo e sufixo, duplicatas idênticas ficam com o menor id', () => {
    const none = () => [];
    expect(mapperItem.mapTradeItem(item({ marketHashName: 'Coisa Nova | X (Factory New)' }), { findByNameKeyAnyCategory: none })).toEqual({ ok: false, reason: 'CATALOG_NOT_FOUND' });
    for (const name of ['Patch | X', 'Sealed Graffiti | X (Brick Red)', 'Music Kit | X', 'StatTrak™ Music Kit | X', 'Foo Case Key']) {
      expect(mapperItem.mapTradeItem(item({ marketHashName: name }), { findByNameKeyAnyCategory: none })).toMatchObject({ ok: true, category: 'OUTRO', name });
    }
    const dup = [entry({ id: 'b', category: 'FACA' }), entry({ id: 'a', category: 'FACA' })];
    expect(mapperItem.pickCandidate(dup, null)).toMatchObject({ kind: 'FOUND', entry: { id: 'a' } });
    expect(mapperItem.pickCandidate([entry({ id: 'a' }), entry({ id: 'b', name: 'Outro' })], null).kind).toBe('AMBIGUOUS');
  });
  test('commodity sem float, atributos só em arma, trade lock com e sem proteção', () => {
    const rows = [entry({ id: 's', category: 'STICKER', name: 'Sticker | X' })];
    const mapped = mapperItem.mapTradeItem(item({ marketHashName: 'Sticker | X', isCommodity: true }), { findByNameKeyAnyCategory: () => rows });
    expect(mapped).toMatchObject({ ok: true, variant: null, floatValue: null, paintSeed: null });
    const weapon = mapperItem.mapTradeItem(item({ isCommodity: true }), { findByNameKeyAnyCategory: () => [entry()] });
    expect(weapon.floatValue).toBeNull();
    const t = norm(fakeTrade({ id: '1', protectionEndsAt: '2026-11-27T10:00:00.000Z' }));
    expect(mapperItem.computeTradeUnlockAt(t)).toBe('2026-11-27T10:00:00.000Z');
    expect(mapperItem.computeTradeUnlockAt({ ...t, protectionEndsAt: null, acceptedAt: '2026-11-20T00:00:00.000Z' })).toBe('2026-11-27T00:00:00.000Z');
    const input = mapperItem.buildPurchaseInput(t, mapperItem.mapTradeItem(item(), { findByNameKeyAnyCategory: () => [entry()] }), { storeId: 1 });
    expect(input).toMatchObject({ catalogId: 'x', acquisitionType: 'COMPRA', purchaseStoreId: 1, purchasePriceCents: 1250, floatValue: 0.3, paintSeed: 5, variant: 'NORMAL' });
    for (const key of ['inspectLink', 'assetId', 'originDetail', 'exterior']) expect(input).not.toHaveProperty(key);
  });
});

describe('manualMatchService (D298)', () => {
  const localDayOf = (iso) => Math.floor(Date.parse(iso) / 86400000);
  const trade = (key, extra = {}) => ({
    key, catalogId: 'c1', category: 'SKIN', nameKey: 'ak', variant: 'NORMAL', phase: null, floatValue: 0.2534, paintSeed: 661, priceCents: 100,
    date: '2026-11-20T12:00:00.000Z', ...extra,
  });
  const cand = (id, extra = {}) => ({
    id, catalogId: 'c1', name: 'AK', category: 'SKIN', variant: 'NORMAL', phase: null, floatValue: 0.2534, paintSeed: 661, purchasePriceCents: 100,
    acquiredAt: '2026-11-20T09:00:00.000Z', ...extra,
  });
  const run = (trades, cands) => matchPurchases(trades, cands, { localDayOf });

  test('float: exato, com menos casas, paintSeed diferente, variante diferente', () => {
    expect(floatsMatch(0.25340012, 0.2534)).toBe(true);
    expect(floatsMatch(0.25340012, 0.2535)).toBe(false);
    expect(run([trade('t')], [cand(1)]).get('t')).toEqual({ kind: 'MATCH', itemId: 1 });
    expect(run([trade('t', { floatValue: 0.25340012 })], [cand(1)]).get('t').kind).toBe('MATCH');
    expect(run([trade('t')], [cand(1, { paintSeed: 1 })]).get('t').kind).toBe('NONE');
    expect(run([trade('t')], [cand(1, { variant: 'STATTRAK' })]).get('t').kind).toBe('NONE');
    expect(run([trade('t')], [cand(1, { catalogId: 'outro' })]).get('t').kind).toBe('NONE');
  });
  test('duas unidades com o mesmo float: a de dia mais próximo decide, senão ambíguo', () => {
    const near = cand(1, { acquiredAt: '2026-11-20T08:00:00.000Z' });
    const far = cand(2, { acquiredAt: '2026-11-10T08:00:00.000Z' });
    expect(run([trade('t')], [near, far]).get('t')).toEqual({ kind: 'MATCH', itemId: 1 });
    const both = run([trade('t')], [cand(1), cand(2)]).get('t');
    expect(both).toEqual({ kind: 'AMBIGUOUS', candidateIds: [1, 2] });
  });
  test('candidato já ligado neste lote sai da lista', () => {
    const res = run([trade('a', { date: '2026-11-20T10:00:00.000Z' }), trade('b', { date: '2026-11-20T11:00:00.000Z' })], [cand(1)]);
    expect(res.get('a')).toEqual({ kind: 'MATCH', itemId: 1 });
    expect(res.get('b').kind).toBe('NONE');
  });
  test('sem float: quantidades iguais ligam em ordem; diferentes viram ambíguos; janela de dia', () => {
    const nf = (key, date) => trade(key, { floatValue: null, paintSeed: null, category: 'STICKER', date });
    const c = (id, at) => cand(id, { category: 'STICKER', floatValue: null, paintSeed: null, acquiredAt: at });
    const same = run([nf('a', '2026-11-20T12:00:00.000Z'), nf('b', '2026-11-20T10:00:00.000Z')], [c(1, '2026-11-20T09:00:00.000Z'), c(2, '2026-11-21T09:00:00.000Z')]);
    expect(same.get('b')).toEqual({ kind: 'MATCH', itemId: 1 });
    expect(same.get('a')).toEqual({ kind: 'MATCH', itemId: 2 });
    const diff = run([nf('a', '2026-11-20T12:00:00.000Z'), nf('b', '2026-11-20T10:00:00.000Z')], [c(1, '2026-11-20T09:00:00.000Z')]);
    expect(diff.get('a')).toEqual({ kind: 'AMBIGUOUS', candidateIds: [1] });
    expect(diff.get('b').kind).toBe('AMBIGUOUS');
    expect(run([nf('a', '2026-11-20T12:00:00.000Z')], [c(1, '2026-11-19T09:00:00.000Z')]).get('a').kind).toBe('MATCH'); // dia vizinho
    expect(run([nf('a', '2026-11-20T12:00:00.000Z')], [c(1, '2026-11-17T09:00:00.000Z')]).get('a').kind).toBe('NONE'); // dois dias ou mais
    expect(run([nf('a', '2026-11-20T12:00:00.000Z')], [{ ...c(1, '2026-11-20T09:00:00.000Z'), purchasePriceCents: 99 }]).get('a').kind).toBe('NONE');
  });
  test('legado sem catálogo casa pelo nome e categoria', () => {
    const legacy = cand(1, { catalogId: null, name: 'Ak', category: 'SKIN' });
    expect(run([trade('t')], [legacy]).get('t').kind).toBe('MATCH');
    expect(run([trade('t', { nameKey: 'outra' })], [legacy]).get('t').kind).toBe('NONE');
  });
});

describe('undo, corte e views (puros)', () => {
  test('assessUndo: bloqueio por venda, avisos por edição e holding, só itens CRIADOS contam', () => {
    const links = [
      { linkKind: 'CREATED', entityType: 'ITEM_PURCHASE', entityId: 1, entityUpdatedAt: 'T0' },
      { linkKind: 'CREATED', entityType: 'ITEM_PURCHASE', entityId: 2, entityUpdatedAt: 'T0' },
      { linkKind: 'MATCHED', entityType: 'ITEM_PURCHASE', entityId: 3, entityUpdatedAt: 'T0' },
    ];
    const items = new Map([
      [1, { id: 1, name: 'A', status: 'VENDIDO', updatedAt: 'T0', offSaleAt: null }],
      [2, { id: 2, name: 'B', status: 'EM_ESTOQUE', updatedAt: 'T1', offSaleAt: 'T1' }],
      [3, { id: 3, name: 'C', status: 'VENDIDO', updatedAt: 'T9', offSaleAt: 'T9' }],
    ]);
    const res = assessUndo(links, items);
    expect(res.blockers).toEqual([{ code: 'ITEM_SOLD_IN_APP', itemId: 1, name: 'A' }]);
    expect(res.warnings.map((w) => w.code)).toEqual(['ITEM_EDITED', 'ITEM_IN_HOLDING']);
    expect(res.counts).toEqual({ itemsToDelete: 2, linksToRemove: 1 });
  });
  test('pickLatest', () => {
    expect(pickLatest([null, '2026-11-05T00:00:00.000Z', '2026-11-08T00:00:00.000Z'])).toBe('2026-11-08T00:00:00.000Z');
    expect(pickLatest([null, null])).toBeNull();
  });
  test('importViews: nome e imagem vêm do catálogo; JSON inválido não quebra', () => {
    const view = importViews.toEntryView(
      { id: 1, batchId: 1, outcome: 'CREATED', displayJson: JSON.stringify({ catalogId: 'c', marketHashName: 'X (FT)', priceCents: 5 }), candidateIds: '[1,2]' },
      new Map([['c', { name: 'X', namePtBr: 'Xis', imageUrl: 'https://i/x.png' }]])
    );
    expect(view).toMatchObject({ candidateIds: [1, 2], display: { name: 'X', namePtBr: 'Xis', imageUrl: 'https://i/x.png', priceCents: 5, currency: 'USD' } });
    expect(importViews.toEntryView({ id: 1, displayJson: '{nope', candidateIds: null }, new Map()).display.name).toBeNull();
  });
});
