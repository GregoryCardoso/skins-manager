'use strict';

// QA 9.2 (D294, D295, D297, D298): matrizes e bordas das funções puras que o imports.pure.test.js não cobre. `now` fixo.
const { classify, settleTracking } = require('../../src/services/imports/tradeClassifier');
const scanPolicy = require('../../src/services/imports/scanPolicy');
const mapperItem = require('../../src/services/imports/externalItemMapper');
const { matchPurchases, floatsMatch, localDayNumber } = require('../../src/services/imports/manualMatchService');
const { mapTrade, mapTransaction, parseCentsString } = require('../../src/services/imports/adapters/csfloatMapper');
const { fakeTrade, fakeTransaction, OTHER } = require('../helpers/csfloatFixtures');
const { IMPORT_RECHECK_WINDOW_MS, IMPORT_OPEN_GRACE_MS, CSFLOAT_MAX_PAGES } = require('../../src/config/constants');

const NOW = new Date('2026-11-22T15:00:00.000Z');
const CUTOFF = Date.parse('2026-11-01T00:00:00.000Z');
const norm = (raw) => mapTrade(raw).trade;
const trade = (extra = {}) => norm(fakeTrade({ id: '1', ...extra }));
const ctx = (extra = {}) => ({ now: NOW, cutoffMs: CUTOFF, ...extra });

describe('tradeClassifier: matriz estado x oferta (compra, nunca importada)', () => {
  test.each([
    // [state, offerState, acceptedAt?, kind, tracking]
    ['pending', 3, 'yes', 'IMPORT', 'OPEN'],
    ['queued', 3, 'yes', 'IMPORT', 'OPEN'],
    ['verified', 3, 'yes', 'IMPORT', 'SETTLED'],
    ['pending', 3, 'no', 'MARK', 'WAITING_TRANSFER'],
    ['pending', 2, 'yes', 'MARK', 'WAITING_TRANSFER'],
    ['pending', 9, 'yes', 'MARK', 'WAITING_TRANSFER'],
    ['pending', 11, 'yes', 'MARK', 'WAITING_TRANSFER'],
    ['queued', 4, 'no', 'MARK', 'WAITING_TRANSFER'],
    ['queued', 5, 'no', 'MARK', 'WAITING_TRANSFER'],
    ['queued', 6, 'no', 'MARK', 'WAITING_TRANSFER'],
    ['queued', 7, 'no', 'MARK', 'WAITING_TRANSFER'],
    ['queued', 8, 'no', 'MARK', 'WAITING_TRANSFER'],
    ['queued', 10, 'no', 'MARK', 'WAITING_TRANSFER'],
    ['queued', null, 'no', 'MARK', 'WAITING_TRANSFER'],
    ['pending', 1, 'yes', 'MARK', 'UNKNOWN_STATE'],
    ['pending', 12, 'yes', 'MARK', 'UNKNOWN_STATE'],
    ['strange', 3, 'yes', 'MARK', 'UNKNOWN_STATE'],
    ['strange', null, 'no', 'MARK', 'UNKNOWN_STATE'],
    ['failed', 6, 'no', 'MARK', 'CLOSED_NOT_TRANSFERRED'],
    ['cancelled', null, 'no', 'MARK', 'CLOSED_NOT_TRANSFERRED'],
    ['failed', 3, 'yes', 'MARK', 'CLOSED_NOT_TRANSFERRED'],
    ['cancelled', 3, 'yes', 'MARK', 'CLOSED_NOT_TRANSFERRED'],
  ])('state=%s offer=%s aceite=%s -> %s/%s', (state, offerState, accepted, kind, tracking) => {
    const raw = fakeTrade({ id: '1', state, offerState, acceptedAt: accepted === 'yes' ? '2026-11-20T14:00:00.000Z' : null });
    expect(classify(norm(raw), 'BUY', null, ctx())).toMatchObject({ kind, tracking });
  });

  test('só estado desconhecido e oferta desconhecida geram entrada; espera e fechamento não', () => {
    expect(classify(trade({ state: 'strange' }), 'BUY', null, ctx()).entry).toMatchObject({ outcome: 'UNKNOWN_STATE' });
    expect(classify(trade({ state: 'pending', offerState: 2, acceptedAt: null }), 'BUY', null, ctx()).entry).toBeUndefined();
    expect(classify(trade({ state: 'failed', offerState: 6, acceptedAt: null }), 'BUY', null, ctx()).entry).toBeUndefined();
  });

  test('9.3: venda aceita é importada (IMPORT) em qualquer estado aceito e sem falha; venda falhada sem aceite não', () => {
    for (const state of ['pending', 'verified', 'queued']) {
      expect(classify(trade({ state, direction: 'SELL' }), 'SELL', null, ctx())).toMatchObject({ kind: 'IMPORT' });
    }
    expect(classify(trade({ state: 'failed', direction: 'SELL', offerState: null, acceptedAt: null }), 'SELL', null, ctx())).toMatchObject({ tracking: 'CLOSED_NOT_TRANSFERRED' });
  });

  test('antes do corte vence qualquer outro tratamento (inclusive aceito e verified); o corte é por sold_at', () => {
    const old = trade({ state: 'verified', createdAt: '2026-11-10T10:00:00.000Z', soldAt: '2026-10-31T23:59:59.999Z' });
    expect(classify(old, 'BUY', null, ctx())).toMatchObject({ kind: 'MARK', tracking: 'BEFORE_CUTOFF' });
    const onCutoff = trade({ state: 'verified', createdAt: '2026-10-01T10:00:00.000Z', soldAt: '2026-11-01T00:00:00.000Z' });
    expect(classify(onCutoff, 'BUY', null, ctx())).toMatchObject({ kind: 'IMPORT' });
  });

  test('registros decididos nunca são reavaliados sem vínculo', () => {
    for (const tracking of ['REMOVED_IN_APP', 'IGNORED', 'NEEDS_REVIEW', 'REVERTED', 'BEFORE_CUTOFF', 'CLOSED_NOT_TRANSFERRED']) {
      expect(classify(trade({ state: 'verified' }), 'BUY', { tracking }, ctx())).toMatchObject({ kind: 'KEEP', tracking, count: 'known' });
    }
    // WAITING_TRANSFER, RETRY, UNKNOWN_STATE e DEFERRED são reavaliados
    for (const tracking of ['WAITING_TRANSFER', 'RETRY', 'UNKNOWN_STATE']) {
      expect(classify(trade({ state: 'verified' }), 'BUY', { tracking }, ctx())).toMatchObject({ kind: 'IMPORT' });
    }
  });

  test('ligado: reverte por failed, cancelled, oferta != 3 ou estorno; oferta nula sem falha não reverte; estado novo vira UNKNOWN_STATE', () => {
    const linked = (extra, c = {}) => classify(trade(extra), 'BUY', { tracking: 'OPEN' }, ctx({ hasLink: true, ...c }));
    expect(linked({ state: 'failed', offerState: 6 })).toMatchObject({ tracking: 'REVERTED', count: 'reverted' });
    expect(linked({ state: 'cancelled' })).toMatchObject({ tracking: 'REVERTED' });
    expect(linked({ state: 'pending', offerState: 5 })).toMatchObject({ tracking: 'REVERTED' });
    expect(linked({ state: 'verified', offerState: 7 })).toMatchObject({ tracking: 'REVERTED' });
    expect(linked({ state: 'pending' }, { refundSignal: true })).toMatchObject({ tracking: 'REVERTED' });
    expect(linked({ state: 'pending' })).toMatchObject({ tracking: 'OPEN', count: 'known' });
    expect(linked({ state: 'strange' })).toMatchObject({ tracking: 'UNKNOWN_STATE', count: 'unknownState' });
    // REVERTED / REMOVED_IN_APP / IGNORED ligados não geram entrada repetida
    for (const tracking of ['REVERTED', 'REMOVED_IN_APP', 'IGNORED']) {
      expect(classify(trade({ state: 'failed' }), 'BUY', { tracking }, ctx({ hasLink: true }))).toMatchObject({ kind: 'KEEP', tracking });
    }
  });

  test('settleTracking: aberto até max(proteção, verify_sale_at) + folga; verified fecha sempre; sem datas fica aberto', () => {
    const edge = Date.parse('2026-11-20T00:00:00.000Z') + IMPORT_OPEN_GRACE_MS;
    const at = (ms) => new Date(ms);
    const t = (extra) => ({ rawState: 'pending', protectionEndsAt: '2026-11-20T00:00:00.000Z', verifySaleAt: null, ...extra });
    expect(settleTracking(t({}), at(edge))).toBe('OPEN');
    expect(settleTracking(t({}), at(edge + 1))).toBe('SETTLED');
    expect(settleTracking(t({ verifySaleAt: '2026-11-25T00:00:00.000Z' }), at(edge + 1))).toBe('OPEN');
    expect(settleTracking(t({ protectionEndsAt: null }), NOW)).toBe('OPEN');
    expect(settleTracking(t({ rawState: 'VERIFIED', protectionEndsAt: null }), NOW)).toBe('SETTLED');
  });
});

describe('scanPolicy: bordas', () => {
  const base = { page: 0, limit: 50, count: 1000, pageSize: 50 };

  test('teto de páginas: a página 199 (a 200a) para com LIMIT; END tem prioridade quando a lista acaba na mesma página', () => {
    expect(scanPolicy.shouldStopTrades({ ...base, page: CSFLOAT_MAX_PAGES - 2, count: 100000, oldestMs: 1 })).toEqual({ stop: false, reason: null });
    expect(scanPolicy.shouldStopTrades({ ...base, page: CSFLOAT_MAX_PAGES - 1, count: 100000, oldestMs: 1 })).toEqual({ stop: true, reason: 'LIMIT' });
    expect(scanPolicy.shouldStopTrades({ ...base, page: CSFLOAT_MAX_PAGES - 1, count: CSFLOAT_MAX_PAGES * 50, oldestMs: 1 })).toEqual({ stop: true, reason: 'END' });
    expect(scanPolicy.shouldStopTransactions({ ...base, page: CSFLOAT_MAX_PAGES - 1, count: 100000, oldestMs: 1 })).toEqual({ stop: true, reason: 'LIMIT' });
  });

  test('o teto vale mesmo na varredura completa; a varredura completa ignora as paradas incrementais', () => {
    expect(scanPolicy.shouldStopTrades({ ...base, page: 3, count: 100000, oldestMs: 0, allClosed: true, horizonMs: 10, fullScan: true })).toEqual({ stop: false, reason: null });
    expect(scanPolicy.shouldStopTrades({ ...base, page: CSFLOAT_MAX_PAGES - 1, count: 100000, oldestMs: 0, fullScan: true }).reason).toBe('LIMIT');
    expect(scanPolicy.shouldStopTransactions({ ...base, oldestMs: 0, cursorCreatedMs: 10_000_000_000, fullScan: true })).toEqual({ stop: false, reason: null });
  });

  test('parada pelo horizonte exige TUDO fechado; um único registro aberto na página mantém a leitura', () => {
    const args = { ...base, oldestMs: 100, horizonMs: 1000 };
    expect(scanPolicy.shouldStopTrades({ ...args, allClosed: true })).toEqual({ stop: true, reason: 'KNOWN' });
    expect(scanPolicy.shouldStopTrades({ ...args, allClosed: false })).toEqual({ stop: false, reason: null });
    expect(scanPolicy.shouldStopTrades({ ...args, allClosed: true, oldestMs: 1000 })).toEqual({ stop: false, reason: null }); // não é "anterior"
    expect(scanPolicy.shouldStopTrades({ ...args, allClosed: true, horizonMs: null })).toEqual({ stop: false, reason: null });
  });

  test('janela do extrato: para só quando a transação mais antiga é anterior ao cursor menos 2 dias', () => {
    const cursor = Date.parse('2026-11-20T00:00:00.000Z');
    const limit = cursor - IMPORT_RECHECK_WINDOW_MS;
    expect(scanPolicy.shouldStopTransactions({ ...base, oldestMs: limit, cursorCreatedMs: cursor }).stop).toBe(false);
    expect(scanPolicy.shouldStopTransactions({ ...base, oldestMs: limit - 1, cursorCreatedMs: cursor })).toEqual({ stop: true, reason: 'KNOWN' });
  });

  test('ordem quebrada atravessando páginas é detectada pelo último trade da página anterior', () => {
    expect(scanPolicy.isOrderBroken([5, 4], 6)).toBe(false);
    expect(scanPolicy.isOrderBroken([7, 4], 6)).toBe(true);
    expect(scanPolicy.isOrderBroken([5, 5, 5], null)).toBe(false);
  });
});

describe('externalItemMapper.buildPurchaseInput (D297)', () => {
  const finder = (list) => ({ findByNameKeyAnyCategory: () => list });
  const skin = { id: 'skin-x', category: 'SKIN', name: 'AK-47 | Redline', phase: null };

  test('acquiredAt é sold_at, o custo é contract.price e nada de inspectLink/assetId/originDetail vai no corpo', () => {
    const t = trade({ createdAt: '2026-11-18T10:00:00.000Z', soldAt: '2026-11-20T16:30:00.000Z', price: 777 });
    const mapped = mapperItem.mapTradeItem(t.item, finder([skin]));
    const input = mapperItem.buildPurchaseInput(t, mapped, { storeId: 9 });
    expect(input).toMatchObject({ acquisitionType: 'COMPRA', purchaseStoreId: 9, purchasePriceCents: 777, acquiredAt: '2026-11-20T16:30:00.000Z', tradeUnlockAt: '2026-11-27T14:00:00.000Z', catalogId: 'skin-x' });
    for (const key of ['inspectLink', 'assetId', 'originDetail']) expect(input).not.toHaveProperty(key);
    expect(JSON.stringify(input)).not.toContain(OTHER.steamId);
  });

  test('sem sold_at cai no aceite, depois na criação; trade lock sem proteção = aceite + 7 dias; sem aceite, nulo', () => {
    const base = { priceCents: 1, protectionEndsAt: null };
    const mapped = { catalogEntry: skin, category: 'SKIN', name: skin.name, variant: 'NORMAL', floatValue: null, paintSeed: null, phase: null };
    const make = (extra) => mapperItem.buildPurchaseInput({ ...base, soldAt: null, acceptedAt: null, createdAt: '2026-11-18T10:00:00.000Z', ...extra }, mapped, { storeId: 1 });
    expect(make({}).acquiredAt).toBe('2026-11-18T10:00:00.000Z');
    expect(make({ acceptedAt: '2026-11-19T10:00:00.000Z' }).acquiredAt).toBe('2026-11-19T10:00:00.000Z');
    expect(make({ acceptedAt: '2026-11-19T10:00:00.000Z' }).tradeUnlockAt).toBe('2026-11-26T10:00:00.000Z');
    expect(make({}).tradeUnlockAt).toBeNull();
  });

  test('item fora do catálogo vira OUTRO só para prefixos/sufixos livres; arma sem catálogo nunca vira OUTRO', () => {
    expect(mapperItem.mapTradeItem(trade({ item: { market_hash_name: 'Patch | Teste', type: 'patch', is_commodity: true } }).item, finder([]))).toMatchObject({ ok: true, category: 'OUTRO', catalogEntry: null });
    expect(mapperItem.mapTradeItem(trade({ item: { market_hash_name: 'Glock-18 | Inventada (Factory New)' } }).item, finder([]))).toEqual({ ok: false, reason: 'CATALOG_NOT_FOUND' });
  });
});

describe('manualMatchService: bordas', () => {
  const dayShift = (iso, days) => new Date(Date.parse(iso) + days * 86400000).toISOString();
  const candidate = (extra = {}) => ({
    id: 1, catalogId: 'skin-x', name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', phase: null, floatValue: 0.25, paintSeed: 7,
    purchasePriceCents: 100, acquiredAt: '2026-11-20T15:00:00.000Z', ...extra,
  });
  const tradeIn = (extra = {}) => ({
    key: 't1', catalogId: 'skin-x', category: 'SKIN', nameKey: 'ak-47 | redline', variant: 'NORMAL', phase: null, floatValue: 0.25, paintSeed: 7,
    priceCents: 100, date: '2026-11-20T15:00:00.000Z', ...extra,
  });
  const only = (map, key = 't1') => map.get(key);

  test('floatsMatch: tolerância de 1e-7 e arredondamento a 6 casas', () => {
    expect(floatsMatch(0.25, 0.25)).toBe(true);
    expect(floatsMatch(0.2500000999, 0.25)).toBe(true);
    expect(floatsMatch(0.250001, 0.25)).toBe(false);
    expect(floatsMatch(0.2534000123, 0.2534)).toBe(true);
    expect(floatsMatch(0.2534006, 0.2534)).toBe(false);
  });

  test('com float: variante, fase ou paintSeed diferentes nunca casam; paintSeed ausente de um lado não impede', () => {
    expect(only(matchPurchases([tradeIn({ variant: 'STATTRAK' })], [candidate()])).kind).toBe('NONE');
    expect(only(matchPurchases([tradeIn({ phase: 'Phase 1' })], [candidate()])).kind).toBe('NONE');
    expect(only(matchPurchases([tradeIn({ paintSeed: 8 })], [candidate()])).kind).toBe('NONE');
    expect(only(matchPurchases([tradeIn({ paintSeed: null })], [candidate()]))).toEqual({ kind: 'MATCH', itemId: 1 });
    expect(only(matchPurchases([tradeIn()], [candidate({ paintSeed: null })]))).toEqual({ kind: 'MATCH', itemId: 1 });
  });

  test('duas unidades iguais: a de 0 dia vence a de 3 dias; duas a menos de 1 dia são ambíguas; uma a 1 dia e outra a 2 dias resolve', () => {
    const a = candidate({ id: 1, acquiredAt: '2026-11-20T15:00:00.000Z' });
    const far = candidate({ id: 2, acquiredAt: dayShift('2026-11-20T15:00:00.000Z', -3) });
    expect(only(matchPurchases([tradeIn()], [far, a]))).toEqual({ kind: 'MATCH', itemId: 1 });
    const sameDay = candidate({ id: 3, acquiredAt: '2026-11-20T16:00:00.000Z' });
    expect(only(matchPurchases([tradeIn()], [a, sameDay])).kind).toBe('AMBIGUOUS');
    const oneDay = candidate({ id: 4, acquiredAt: dayShift('2026-11-20T15:00:00.000Z', -1) });
    const twoDays = candidate({ id: 5, acquiredAt: dayShift('2026-11-20T15:00:00.000Z', -2) });
    expect(only(matchPurchases([tradeIn()], [twoDays, oneDay]))).toEqual({ kind: 'MATCH', itemId: 4 });
  });

  test('sem float: preço diferente, item diferente e dia a 2 dias de distância não casam; dia vizinho casa', () => {
    const noFloat = (extra) => ({ floatValue: null, paintSeed: null, category: 'STICKER', ...extra });
    const t = tradeIn(noFloat({}));
    expect(only(matchPurchases([t], [candidate(noFloat({ purchasePriceCents: 101 }))])).kind).toBe('NONE');
    expect(only(matchPurchases([t], [candidate(noFloat({ catalogId: 'other' }))])).kind).toBe('NONE');
    expect(only(matchPurchases([t], [candidate(noFloat({ acquiredAt: dayShift(t.date, -2) }))])).kind).toBe('NONE');
    expect(only(matchPurchases([t], [candidate(noFloat({ acquiredAt: dayShift(t.date, -1) }))]))).toEqual({ kind: 'MATCH', itemId: 1 });
    expect(only(matchPurchases([t], [candidate(noFloat({ acquiredAt: dayShift(t.date, 1) }))]))).toEqual({ kind: 'MATCH', itemId: 1 });
  });

  test('sem float: 1 trade e 2 candidatos no dia = ambíguo para o trade; 3 trades e 2 candidatos = todos ambíguos e nenhum candidato "consumido"', () => {
    const noFloat = (extra) => ({ floatValue: null, paintSeed: null, category: 'STICKER', ...extra });
    const cs = [candidate(noFloat({ id: 1 })), candidate(noFloat({ id: 2, acquiredAt: '2026-11-20T16:00:00.000Z' }))];
    expect(only(matchPurchases([tradeIn(noFloat({}))], cs))).toEqual({ kind: 'AMBIGUOUS', candidateIds: [1, 2] });
    const trades = ['a', 'b', 'c'].map((key, i) => tradeIn(noFloat({ key, date: `2026-11-20T1${i}:00:00.000Z` })));
    const result = matchPurchases(trades, cs);
    for (const key of ['a', 'b', 'c']) expect(result.get(key).kind).toBe('AMBIGUOUS');
  });

  test('o dia local usa o fuso do sistema (a mesma função usada para o dia do lançamento manual)', () => {
    const iso = '2026-11-20T15:00:00.000Z';
    const date = new Date(iso);
    expect(localDayNumber(iso)).toBe(Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000));
  });
});

describe('csfloatMapper: números do CSFloat', () => {
  test('parseCentsString: textos e números do formato real', () => {
    expect(parseCentsString('20')).toBe(20);
    expect(parseCentsString(20)).toBe(20);
    expect(parseCentsString('0')).toBe(0);
    expect(parseCentsString('0.32')).not.toBe(32);
    expect(parseCentsString('-1')).not.toBe(1);
    for (const bad of ['abc', '', null, undefined, NaN, {}]) expect([null, undefined, NaN]).toContainEqual(parseCentsString(bad) ?? null);
  });

  test('transação: fee_amount como texto vira centavos; offsets não inteiros invalidam; compra tem balance_offset negativo', () => {
    const ok = mapTransaction(fakeTransaction({ id: 'tx-1', type: 'contract_sold', pendingOffset: 1470, details: { contract_id: '91', fee_amount: '30' } }));
    expect(ok.ok).toBe(true);
    expect(ok.transaction).toMatchObject({ type: 'contract_sold', pendingOffsetCents: 1470, feeCents: 30, contractId: '91' });
    const bad = mapTransaction({ ...fakeTransaction({ id: 'tx-2' }), balance_offset: 1.5 });
    expect(bad.ok).toBe(false);
  });

  test('o trade normalizado traz só os campos da allowlist (sem comprador, vendedor, URLs nem tokens)', () => {
    const t = trade({});
    const text = JSON.stringify(t);
    for (const secret of [OTHER.username, OTHER.avatar, OTHER.tradeUrl, OTHER.tradeToken, OTHER.contractToken, 'steam://']) expect(text).not.toContain(secret);
    expect(t).toMatchObject({ externalId: '1', priceCents: 1250, rawState: 'pending', offerState: 3 });
  });
});
