'use strict';

// 10.3 (D362): custo efetivo (puro), regras de desfazer, giro da unidade consumida, patches no catálogo e blocos do desfazer da importação.
const { buildCostIndex, EMPTY_COST_INDEX, splitPool, ownCostParts } = require('../../src/services/operations/costService');
const { assessUndo } = require('../../src/services/operations/operationContext');
const { assessUndo: assessImportUndo } = require('../../src/services/imports/undoService');
const { getAging, isInTradeLock, filterStagnant } = require('../../src/services/inventoryAgingService');
const { minPriceForStore, minPricesForItem } = require('../../src/services/pricingService');
const { computeStats } = require('../../src/services/itemStatsService');
const { summarizeGroupCost } = require('../../src/services/inventoryGroupService');
const { estimateStockUsd, splitStockUsd, computeSaleProfitUsdCents, buildSaleInfo } = require('../../src/services/profitService');
const { mapPatches, mapCatalog } = require('../../src/services/catalog/csgoApiAdapter');
const { maybeAppliedFromStock } = require('../../src/services/imports/componentImport');
const { mapTradeItem, mapComponents } = require('../../src/services/imports/externalItemMapper');

const unit = (id, extra = {}) => ({
  id, status: 'EM_ESTOQUE', acquisitionType: 'COMPRA', purchasePriceCents: 100, purchaseCurrency: 'USD', fxRateAtPurchase: null,
  acquiredAt: '2026-11-01T00:00:00.000Z', tradeUnlockAt: null, offSaleAt: null, forSaleSince: null, ...extra,
});
const op = (id, extra = {}) => ({ id, kind: 'APPLY_COMPONENT', outcome: 'TRANSFERRED', occurredAt: '2026-11-05T00:00:00.000Z', undoneAt: null, ...extra });
const link = (operationId, itemId, role, costShareBp = null) => ({ operationId, itemId, role, costShareBp });
const byId = (...items) => new Map(items.map((i) => [i.id, i]));

describe('buildCostIndex', () => {
  test('sem operação: custo próprio, sem memória por id (itens sem id também valem)', () => {
    expect(EMPTY_COST_INDEX.effectiveOf({ purchasePriceCents: 250, purchaseCurrency: 'USD' })).toMatchObject({ effectiveUsdCents: 250, inheritedUsdCents: 0, estimated: false });
    expect(EMPTY_COST_INDEX.effectiveOf({ purchasePriceCents: 540, purchaseCurrency: 'BRL', fxRateAtPurchase: 5.4 })).toMatchObject({ effectiveUsdCents: 100, estimated: true });
    expect(EMPTY_COST_INDEX.effectiveOf({ purchasePriceCents: 500, purchaseCurrency: 'BRL', fxRateAtPurchase: null }).effectiveUsdCents).toBeNull();
  });

  test('a unidade recebe o custo efetivo da consumida; GANHEI e GERADO não têm custo próprio', () => {
    const target = unit(1, { purchasePriceCents: 1000 });
    const sticker = unit(2, { purchasePriceCents: 200 });
    const won = unit(3, { acquisitionType: 'GANHEI', purchasePriceCents: 0 });
    const index = buildCostIndex({
      itemsById: byId(target, sticker, won), operations: [op(1)], links: [link(1, 2, 'CONSUMED'), link(1, 1, 'TARGET')],
    });
    expect(index.effectiveOf(target)).toMatchObject({ ownUsdCents: 1000, inheritedUsdCents: 200, effectiveUsdCents: 1200 });
    expect(index.effectiveOf(sticker).effectiveUsdCents).toBe(200); // a consumida mantém o próprio (sai do estoque pelo status)
    expect(index.effectiveOf(won).effectiveUsdCents).toBe(0);
    expect(ownCostParts(unit(9, { acquisitionType: 'GERADO' }))).toEqual([]);
  });

  test('operação desfeita é ignorada; recursivo (a consumida também recebeu custo); BRL marca estimado e achata as partes nativas', () => {
    const a = unit(1, { purchasePriceCents: 1000 });
    const b = unit(2, { purchasePriceCents: 540, purchaseCurrency: 'BRL', fxRateAtPurchase: 5.4 }); // 100 USD
    const c = unit(3, { purchasePriceCents: 50 });
    const index = buildCostIndex({
      itemsById: byId(a, b, c),
      operations: [op(1), op(2), op(3, { undoneAt: '2026-11-06T00:00:00.000Z' })],
      links: [link(1, 3, 'CONSUMED'), link(1, 2, 'TARGET'), link(2, 2, 'CONSUMED'), link(2, 1, 'TARGET'), link(3, 3, 'CONSUMED'), link(3, 1, 'TARGET')],
    });
    // c -> b (50) ; b (540 BRL + 50) -> a ; a recebe b inteiro; a operação 3 foi desfeita
    expect(index.effectiveOf(b)).toMatchObject({ ownUsdCents: 100, inheritedUsdCents: 50, effectiveUsdCents: 150, estimated: true });
    expect(index.effectiveOf(a)).toMatchObject({ ownUsdCents: 1000, inheritedUsdCents: 150, effectiveUsdCents: 1150, estimated: true });
    expect(index.costParts(a)).toEqual([
      { cents: 1000, currency: 'USD', fxRate: null }, { cents: 540, currency: 'BRL', fxRate: 5.4 }, { cents: 50, currency: 'USD', fxRate: null },
    ]);
  });

  test('ciclo é erro interno; unidade consumida não carregada também', () => {
    const a = unit(1);
    const b = unit(2);
    const cyclic = buildCostIndex({ itemsById: byId(a, b), operations: [op(1), op(2)], links: [link(1, 2, 'CONSUMED'), link(1, 1, 'TARGET'), link(2, 1, 'CONSUMED'), link(2, 2, 'TARGET')] });
    expect(() => cyclic.effectiveOf(a)).toThrow('OPERATION_CYCLE');
    const missing = buildCostIndex({ itemsById: byId(a), operations: [op(1)], links: [link(1, 2, 'CONSUMED'), link(1, 1, 'TARGET')] });
    expect(() => missing.effectiveOf(a)).toThrow(/não carregada/);
  });

  test('divisão por pontos-base: o centavo do arredondamento vai para a maior fração, no empate para o menor id', () => {
    expect([...splitPool(101, [{ id: 1, bp: 5000 }, { id: 2, bp: 5000 }])]).toEqual([[1, 51], [2, 50]]);
    expect([...splitPool(100, [{ id: 7, bp: 3333 }, { id: 5, bp: 6667 }])]).toEqual([[7, 33], [5, 67]]);
    expect([...splitPool(10, [{ id: 3, bp: 10000 }])]).toEqual([[3, 10]]);
    const a = unit(1, { purchasePriceCents: 0 });
    const b = unit(2, { purchasePriceCents: 0 });
    const source = unit(3, { purchasePriceCents: 101 });
    const index = buildCostIndex({
      itemsById: byId(a, b, source), operations: [op(1)], links: [link(1, 3, 'CONSUMED'), link(1, 1, 'CREATED', 5000), link(1, 2, 'CREATED', 5000)],
    });
    expect(index.inheritedUsdCents(a) + index.inheritedUsdCents(b)).toBe(101);
    expect(index.inheritedUsdCents(a)).toBe(51);
  });
});

describe('consumidores do custo efetivo', () => {
  const target = unit(1, { purchasePriceCents: 1000 });
  const sticker = unit(2, { purchasePriceCents: 200 });
  const index = buildCostIndex({ itemsById: byId(target, sticker), operations: [op(1)], links: [link(1, 2, 'CONSUMED'), link(1, 1, 'TARGET')] });
  const consumed = { ...sticker, status: 'CONSUMIDO', consumedAt: '2026-11-05T00:00:00.000Z' };

  test('estoque: a consumida sai e o total se conserva; à venda x holding soma o mesmo', () => {
    const before = estimateStockUsd([target, sticker]);
    const after = estimateStockUsd([target, consumed], { costIndex: index });
    expect(after.totalUsdCents).toBe(before.totalUsdCents);
    const split = splitStockUsd([{ ...target, offSaleAt: '2026-11-02T00:00:00.000Z' }, consumed], { costIndex: index });
    expect(split.offSale.totalUsdCents + split.forSale.totalUsdCents).toBe(1200);
    expect(split.forSale.count).toBe(0);
  });

  test('custo médio do grupo e itemStats usam o efetivo; a consumida não é unidade', () => {
    expect(summarizeGroupCost([target], 5, { costIndex: index })).toMatchObject({ quantity: 1, totalCostUsdCents: 1200, avgCostUsdCents: 1200 });
    expect(computeStats([target, consumed], { costIndex: index })).toMatchObject({ unitCount: 1, consumedCount: 1, avgPurchaseCostUsdCents: 1200 });
    expect(computeStats([consumed], { costIndex: index })).toMatchObject({ unitCount: 0, consumedCount: 1, avgPurchaseCostUsdCents: null, soldCount: 0 });
  });

  test('lucro e informações da venda', () => {
    const sold = {
      ...target, status: 'VENDIDO', salePriceCents: 2000, saleCurrency: 'USD', fxRateAtSale: null, netReceivedCents: 1900, soldAt: '2026-11-10T00:00:00.000Z',
    };
    expect(computeSaleProfitUsdCents(sold)).toBe(900);
    expect(computeSaleProfitUsdCents(sold, { inheritedUsdCents: 200 })).toBe(700);
    expect(buildSaleInfo(sold, 5, { inheritedUsdCents: 200 })).toMatchObject({ purchaseCostUsdCents: 1200, ownCostUsdCents: 1000, inheritedCostUsdCents: 200, approx: { profit: 3500 } });
  });

  test('preço mínimo: partes na moeda da loja somam com CEIL; uma parte só é o cálculo de sempre', () => {
    const store = { id: 1, name: 'Steam', currency: 'BRL', isActive: true, saleFeeType: 'DEDUCTED', saleFeeRate: 0, saleFeeRounding: 'CEIL', saleMinFeeCents: null, saleFixedFeeCents: 0 };
    const settings = { usdBrlRate: 5 };
    const single = minPriceForStore({ costCents: 100, costCurrency: 'USD', costFxRate: null, store, settings });
    const asParts = minPriceForStore({ costParts: [{ cents: 100, currency: 'USD', fxRate: null }], store, settings });
    expect(asParts).toEqual(single);
    const two = minPriceForStore({ costParts: [{ cents: 101, currency: 'USD', fxRate: null }, { cents: 333, currency: 'BRL', fxRate: 5.3 }], store, settings });
    expect(two.minPriceCents).toBe(505 + 333); // 101 USD x 5 = 505 (CEIL); a parte BRL fica nativa
    const noRate = minPriceForStore({ costParts: [{ cents: 100, currency: 'USD', fxRate: null }], store, settings: { usdBrlRate: null } });
    expect(noRate).toMatchObject({ minPriceCents: null, warningCode: 'FX_NOT_CONFIGURED' });
    expect(minPricesForItem({ item: target, stores: [store], settings, costParts: index.costParts(target) })[0].minPriceCents).toBe(1200 * 5);
  });
});

describe('giro da unidade consumida', () => {
  const thresholds = { fastTurnoverDays: 7, slowItemDays: 21 };
  const consumed = unit(2, { status: 'CONSUMIDO', consumedAt: '2026-11-11T00:00:00.000Z', tradeUnlockAt: '2026-12-31T00:00:00.000Z', offSaleAt: '2026-11-02T00:00:00.000Z' });
  const now = new Date('2026-12-30T00:00:00.000Z');

  test('sem faixa, fora do trade lock e de parados; os dias vão até o consumo', () => {
    expect(getAging(consumed, { thresholds, now })).toEqual({ daysInInventory: 10, daysForSale: null, agingBucket: 'CONSUMIDO' });
    expect(isInTradeLock(consumed, now)).toBe(false);
    expect(filterStagnant([consumed], thresholds, now)).toEqual([]);
  });
});

describe('desfazer: regras puras', () => {
  const target = unit(1);
  const sticker = { ...unit(2), status: 'CONSUMIDO', consumedAt: '2026-11-05T00:00:00.000Z' };
  const ctx = (extra = {}) => ({
    itemsById: byId(target, sticker),
    linksByOperation: new Map([[1, [link(1, 2, 'CONSUMED'), link(1, 1, 'TARGET')]]]),
    latestOpIdByItem: new Map([[1, 1], [2, 1]]),
    ...extra,
  });

  test('vale na mais recente com o alvo em estoque', () => {
    expect(assessUndo(op(1), ctx())).toEqual({ undoable: true, reason: null, params: {} });
  });

  test('já desfeita, não é a mais recente, alvo vendido ou fora do estoque', () => {
    expect(assessUndo(op(1, { undoneAt: 'x' }), ctx())).toMatchObject({ undoable: false, reason: 'ALREADY_UNDONE' });
    expect(assessUndo(op(1), ctx({ latestOpIdByItem: new Map([[1, 4], [2, 1]]) }))).toMatchObject({ undoable: false, reason: 'NOT_LATEST', params: { operationId: 4, itemId: 1 } });
    expect(assessUndo(op(1), ctx({ itemsById: byId({ ...target, status: 'VENDIDO' }, sticker) }))).toMatchObject({ reason: 'TARGET_SOLD' });
    expect(assessUndo(op(1), ctx({ itemsById: byId({ ...target, status: 'CONSUMIDO' }, sticker) }))).toMatchObject({ reason: 'TARGET_NOT_IN_STOCK' });
  });
});

describe('desfazer a importação', () => {
  const links = [{ linkKind: 'CREATED', entityType: 'ITEM_PURCHASE', entityId: 7, entityUpdatedAt: 'x', recordId: 1 }];

  test('item criado pelo lote que está em operação ativa vira bloqueio ITEM_IN_OPERATION', () => {
    const item = { ...unit(7), updatedAt: 'x', name: 'Sticker' };
    expect(assessImportUndo(links, new Map([[7, item]]), new Set([7])).blockers).toEqual([{ code: 'ITEM_IN_OPERATION', itemId: 7, name: 'Sticker' }]);
    expect(assessImportUndo(links, new Map([[7, item]])).blockers).toEqual([]);
  });
});

describe('patches no catálogo (CSGO-API)', () => {
  const raw = [{ id: 'patch-4550', name: 'Patch | Crazy Banana', image: 'https://img.test/p.png', rarity: { name: 'Remarkable' } }, { name: 'sem id' }];

  test('mapPatches vira PATCH com a fonte PATCHES; entrada inválida é ignorada; pt-BR é opcional', () => {
    const { rows, skipped } = mapPatches(raw, null);
    expect(skipped).toBe(1);
    expect(rows[0]).toMatchObject({ id: 'patch-4550', source: 'PATCHES', category: 'PATCH', name: 'Patch | Crazy Banana', namePtBr: null, nameKey: 'patch | crazy banana' });
    const mapped = mapCatalog({ en: { PATCHES: raw }, ptBr: { PATCHES: [{ id: 'patch-4550', name: 'Patch | Banana Maluca' }] } });
    expect(mapped.rows.find((r) => r.source === 'PATCHES')).toMatchObject({ namePtBr: 'Patch | Banana Maluca' });
    expect(mapCatalog({ en: {} }).rows).toEqual([]);
  });
});

describe('aviso de componente possivelmente aplicado do estoque', () => {
  test('sem componentes no trade ou em categoria que não aceita: nenhum aviso (sem consultar o banco)', () => {
    expect(maybeAppliedFromStock([], { id: 1, category: 'SKIN' })).toEqual([]);
    expect(maybeAppliedFromStock(null, { id: 1, category: 'SKIN' })).toEqual([]);
    expect(maybeAppliedFromStock([{ name: 'Sticker | X', from: 'STICKER' }], { id: 1, category: 'FACA' })).toEqual([]);
  });
});

describe('importação: "Patch | X" procura o catálogo antes do nome livre', () => {
  const patchEntry = { id: 'patch-1', category: 'PATCH', name: 'Patch | Crazy Banana', phase: null };
  const tradeItem = { marketHashName: 'Patch | Crazy Banana', isStattrak: false, isSouvenir: false, isCommodity: true, floatValue: null, paintSeed: null, phase: null, paintIndex: null };

  test('com o patch no catálogo vira PATCH vinculado; sem ele cai em OUTRO de nome livre', () => {
    expect(mapTradeItem(tradeItem, { findByNameKeyAnyCategory: () => [patchEntry] })).toMatchObject({ ok: true, category: 'PATCH', catalogEntry: patchEntry });
    expect(mapTradeItem(tradeItem, { findByNameKeyAnyCategory: () => [] })).toMatchObject({ ok: true, category: 'OUTRO', catalogEntry: null, name: 'Patch | Crazy Banana' });
  });

  test('componente "Patch | X" num agente casa com o catálogo; em arma é COMPONENTS_NOT_ALLOWED', () => {
    const raw = [{ name: 'Patch | Crazy Banana', from: 'STICKER', slot: 0 }];
    const find = () => [patchEntry];
    expect(mapComponents(raw, { category: 'PERSONAGEM', findByNameKeyAnyCategory: find }).components).toEqual([{ kind: 'PATCH', catalogId: 'patch-1', slot: 0 }]);
    expect(mapComponents(raw, { category: 'SKIN', findByNameKeyAnyCategory: find }).warnings).toEqual([{ code: 'COMPONENTS_NOT_ALLOWED', name: null }]);
  });
});
