'use strict';

// 9.3 (D299, D312): funções puras da importação de vendas. Sem banco nem rede.
const { pickSoldUnit, matchSales } = require('../../src/services/imports/manualMatchService');
const { computeSaleRelease, releaseInstantOf, splitStoreSales } = require('../../src/services/saleHoldService');
const { assessUndo } = require('../../src/services/imports/undoService');
const { toDisplay } = require('../../src/services/imports/importViews');

const unit = (id, extra = {}) => ({
  id, status: 'EM_ESTOQUE', catalogId: 'skin-ak', name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', phase: null,
  floatValue: null, paintSeed: null, acquiredAt: '2026-11-05T10:00:00.000Z', offSaleAt: null, ...extra,
});
const trade = (extra = {}) => ({
  key: 't1', catalogId: 'skin-ak', category: 'SKIN', nameKey: 'ak-47 | redline', variant: 'NORMAL', phase: null, floatValue: null,
  paintSeed: null, priceCents: 1500, date: '2026-11-20T10:00:00.000Z', ...extra,
});

describe('pickSoldUnit', () => {
  test('com float: a unidade de float igual (inclusive digitada com menos casas); seed diferente não serve', () => {
    const units = [unit(1, { floatValue: 0.31 }), unit(2, { floatValue: 0.253412, paintSeed: 661 }), unit(3, { floatValue: 0.2534121, paintSeed: 9 })];
    expect(pickSoldUnit(trade({ floatValue: 0.25341213, paintSeed: 661 }), units)).toEqual({ kind: 'UNIT', itemId: 2 });
  });
  test('com float: duas unidades iguais -> AMBIGUOUS; nenhuma igual e sem unidade sem float -> NONE', () => {
    const units = [unit(1, { floatValue: 0.25 }), unit(2, { floatValue: 0.25 })];
    expect(pickSoldUnit(trade({ floatValue: 0.25 }), units)).toEqual({ kind: 'AMBIGUOUS', candidateIds: [1, 2] });
    expect(pickSoldUnit(trade({ floatValue: 0.4 }), units)).toEqual({ kind: 'NONE' });
  });
  test('com float sem unidade igual: vale a unidade lançada sem float (regra sem float)', () => {
    const units = [unit(1, { floatValue: 0.6 }), unit(2, { acquiredAt: '2026-11-06T00:00:00.000Z' }), unit(3, { acquiredAt: '2026-11-04T00:00:00.000Z' })];
    expect(pickSoldUnit(trade({ floatValue: 0.25 }), units)).toEqual({ kind: 'UNIT', itemId: 3 });
  });
  test('sem float: à venda antes do holding; dentro do grupo a mais antiga; depois, a mais antiga do holding', () => {
    const units = [
      unit(1, { acquiredAt: '2026-11-01T00:00:00.000Z', offSaleAt: '2026-11-02T00:00:00.000Z' }),
      unit(2, { acquiredAt: '2026-11-04T00:00:00.000Z' }),
      unit(3, { acquiredAt: '2026-11-03T00:00:00.000Z' }),
      unit(4, { acquiredAt: '2026-10-20T00:00:00.000Z', offSaleAt: '2026-11-02T00:00:00.000Z' }),
    ];
    expect(pickSoldUnit(trade(), units)).toEqual({ kind: 'UNIT', itemId: 3 });
    expect(pickSoldUnit(trade(), units.filter((u) => u.offSaleAt))).toEqual({ kind: 'UNIT', itemId: 4 });
  });
  test('ignora unidades vendidas, compradas depois da venda, de outro item, de outra variante ou de outra fase', () => {
    const units = [
      unit(1, { status: 'VENDIDO' }),
      unit(2, { acquiredAt: '2026-11-21T00:00:00.000Z' }),
      unit(3, { catalogId: 'skin-awp' }),
      unit(4, { variant: 'STATTRAK' }),
      unit(5, { phase: 'Phase 2' }),
    ];
    expect(pickSoldUnit(trade(), units)).toEqual({ kind: 'NONE' });
    expect(pickSoldUnit(trade({ variant: 'STATTRAK' }), units)).toEqual({ kind: 'UNIT', itemId: 4 });
    expect(pickSoldUnit(trade({ phase: 'Phase 2' }), units)).toEqual({ kind: 'UNIT', itemId: 5 });
  });
  test('legado (sem catálogo) casa pelo nome e categoria; categorias sem variante (adesivo) ignoram a variante', () => {
    expect(pickSoldUnit(trade(), [unit(7, { catalogId: null })])).toEqual({ kind: 'UNIT', itemId: 7 });
    const st = { catalogId: 'st-1', category: 'STICKER', nameKey: 'sticker | titan', variant: null };
    expect(pickSoldUnit(trade(st), [unit(8, { catalogId: 'st-1', category: 'STICKER', name: 'Sticker | Titan', variant: null })])).toEqual({ kind: 'UNIT', itemId: 8 });
  });
});

describe('matchSales', () => {
  const sale = (id, extra = {}) => ({ ...unit(id), status: 'VENDIDO', salePriceCents: 1500, soldAt: '2026-11-20T09:00:00.000Z', ...extra });
  test('casa pelo preço e pela data da venda (não pela compra)', () => {
    const res = matchSales([trade()], [sale(1, { acquiredAt: '2026-01-01T00:00:00.000Z' })]);
    expect(res.get('t1')).toEqual({ kind: 'MATCH', itemId: 1 });
  });
  test('preço ou dia diferentes não casam; quantidades diferentes ficam ambíguas', () => {
    expect(matchSales([trade()], [sale(1, { salePriceCents: 1400 })]).get('t1')).toEqual({ kind: 'NONE' });
    expect(matchSales([trade()], [sale(1, { soldAt: '2026-11-15T09:00:00.000Z' })]).get('t1')).toEqual({ kind: 'NONE' });
    expect(matchSales([trade()], [sale(1), sale(2)]).get('t1')).toMatchObject({ kind: 'AMBIGUOUS' });
  });
});

describe('liberação da venda (D312)', () => {
  const sold = (extra = {}) => ({ status: 'VENDIDO', saleStoreId: 1, soldAt: '2026-11-20T10:00:00.000Z', saleHoldDaysApplied: 7, netReceivedCents: 100, ...extra });
  test('sem saleReleaseAt: soldAt + retenção; com ele, a data real', () => {
    expect(computeSaleRelease(sold(), new Date('2026-11-22T00:00:00.000Z'))).toEqual({ releasesAt: '2026-11-27T10:00:00.000Z', isHeld: true });
    expect(computeSaleRelease(sold({ saleReleaseAt: '2026-11-21T00:00:00.000Z' }), new Date('2026-11-22T00:00:00.000Z')))
      .toEqual({ releasesAt: '2026-11-21T00:00:00.000Z', isHeld: false });
    expect(releaseInstantOf(sold({ saleReleaseAt: '2026-11-29T00:00:00.000Z' }))).toBe(Date.parse('2026-11-29T00:00:00.000Z'));
    // sem retenção registrada (venda antiga), mas com a liberação real: vale a real
    expect(computeSaleRelease(sold({ saleHoldDaysApplied: null, saleReleaseAt: '2026-11-25T00:00:00.000Z' }), new Date('2026-11-22T00:00:00.000Z')).isHeld).toBe(true);
  });
  test('saldo: pendente até a liberação real', () => {
    const sales = [sold({ saleReleaseAt: '2026-11-29T00:00:00.000Z' }), sold({ saleReleaseAt: '2026-11-21T00:00:00.000Z' })];
    const { released, pending } = splitStoreSales({ storeId: 1, sales, at: new Date('2026-11-22T00:00:00.000Z') });
    expect(released).toEqual({ cents: 100, count: 1 });
    expect(pending).toEqual({ cents: 100, count: 1, nextReleaseAt: '2026-11-29T00:00:00.000Z' });
  });
});

describe('assessUndo com vendas', () => {
  const T0 = '2026-11-22T15:00:00.000Z';
  const T1 = '2026-11-23T15:00:00.000Z';
  test('venda criada em item já existente: desfaz a venda; editado depois avisa', () => {
    const links = [{ linkKind: 'CREATED', entityType: 'ITEM_SALE', entityId: 1, entityUpdatedAt: T0 }];
    const items = new Map([[1, { id: 1, name: 'A', status: 'VENDIDO', updatedAt: T1, offSaleAt: null }]]);
    expect(assessUndo(links, items)).toEqual({
      blockers: [], warnings: [{ code: 'ITEM_EDITED', itemId: 1, name: 'A' }], counts: { itemsToDelete: 0, linksToRemove: 0, salesToUndo: 1, transfersToDelete: 0 },
    });
  });
  test('compra e venda do mesmo item no lote: sem bloqueio, só o item a excluir', () => {
    const links = [
      { linkKind: 'CREATED', entityType: 'ITEM_PURCHASE', entityId: 1, entityUpdatedAt: T0 },
      { linkKind: 'CREATED', entityType: 'ITEM_SALE', entityId: 1, entityUpdatedAt: T1 },
    ];
    const items = new Map([[1, { id: 1, name: 'A', status: 'VENDIDO', updatedAt: T1, offSaleAt: null }]]);
    expect(assessUndo(links, items)).toEqual({ blockers: [], warnings: [], counts: { itemsToDelete: 1, linksToRemove: 0, salesToUndo: 0, transfersToDelete: 0 } });
  });
  test('venda manual ligada (MATCHED) só desliga', () => {
    const links = [{ linkKind: 'MATCHED', entityType: 'ITEM_SALE', entityId: 1, entityUpdatedAt: T0 }];
    expect(assessUndo(links, new Map()).counts).toEqual({ itemsToDelete: 0, linksToRemove: 1, salesToUndo: 0, transfersToDelete: 0 });
  });
});

test('toDisplay leva as taxas do FEE_MISMATCH (e nulas quando não há)', () => {
  expect(toDisplay(JSON.stringify({ feeCents: 20, expectedFeeCents: 30 }), new Map())).toMatchObject({ feeCents: 20, expectedFeeCents: 30 });
  expect(toDisplay('{}', new Map())).toMatchObject({ feeCents: null, expectedFeeCents: null });
});
