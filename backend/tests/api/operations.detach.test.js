// 10.7 (D366): separar o chaveiro ou o Sticker Slab da arma. Custo efetivo inteiro dividido pelos valores avaliados (E-P2-Q59/Q62),
// devolução da unidade aplicada do estoque, desfazer, proteções e números idênticos. Banco em memória; sem rede.
const request = require('supertest');
const { freshDb } = require('../helpers/fixtures');
const { getDb, closeDb } = require('../../src/config/database');
const MarketPrice = require('../../src/models/MarketPrice');
const { ACTIVE_VALUATION_SOURCE } = require('../../src/services/valuation/valuationSources');
const { buildCostIndex, splitPool } = require('../../src/services/operations/costService');
const { CAT, makeCatalogApp, purchaseBody, createItemViaApi, expectError, storeId, NOW } = require('../helpers/apiFixtures');

let app;
const AT = '2026-11-15T12:00:00.000Z';
const DETACH_AT = '2026-11-17T12:00:00.000Z';
const AK_KEY = 'AK-47 | Redline (Field-Tested)|';
const CHARM_KEY = "Charm | Lil' Ava|";

beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const get = (url) => request(app).get(url);
const post = (url, body = {}) => request(app).post(url).send(body);
const charm = (extra = {}) => ({ kind: 'CHARM', catalogId: CAT.CHARM_LIL_AVA, pattern: 42, ...extra });
const akBody = (extra = {}) => purchaseBody({ exterior: 'FT', floatValue: 0.2, components: [charm()], ...extra });
const price = (priceKey, cents, marketHashName = priceKey.replace(/\|$/, '')) =>
  MarketPrice.upsertResult({
    source: ACTIVE_VALUATION_SOURCE, priceKey, marketHashName, paintIndex: null, status: 'OK', basePriceCents: cents, referenceQuantity: 3, sourceUpdatedAt: null,
  }, new Date(NOW.getTime() - 3600000));
const itemOf = async (id) => (await get(`/api/items/${id}`)).body.data;
const preview = (itemId, componentId, query = '') => get(`/api/items/${itemId}/components/${componentId}/detach-preview${query}`);
const detach = (itemId, componentId, body = {}) => post(`/api/items/${itemId}/components/${componentId}/detach`, { detachedAt: DETACH_AT, ...body });
const profit = async () => (await get('/api/profit/summary')).body.data;
const numbers = (p) => ({
  stock: p.stockUsdCents, real: p.realProfitUsdCents, platform: p.platformBalanceUsdCents, pending: p.pendingBalanceUsdCents,
  balances: p.balancesByStore.map((b) => [b.storeId, b.availableCents]),
});
const hangingOf = (item) => item.components.find((c) => c.kind === 'CHARM' || c.kind === 'STICKER_SLAB');

describe('separar o chaveiro que veio junto (SPLIT)', () => {
  test('prévia e separação pelos preços do cache: soma exata, centavo na maior fração, números idênticos e desfazer', async () => {
    await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 100000, depositedAt: '2026-11-01T12:00:00.000Z' });
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1001 }));
    price(AK_KEY, 9000);
    price(CHARM_KEY, 1000);
    const before = numbers(await profit());
    const component = hangingOf(ak);
    expect(component).toMatchObject({ detachable: true, origin: 'CAME_WITH' });

    const prev = (await preview(ak.id, component.id)).body.data;
    expect(prev).toMatchObject({
      mode: 'SPLIT', suggestionUnavailableReason: null, valuedTotalUsdCents: 10000,
      suggestion: { hangingShareBp: 1000, basePriceCents: 9000, hangingPriceCents: 1000, isStale: false },
      weapon: { effectiveUsdCents: 1001, estimated: false },
      result: { weaponUsdCents: 901, detachedUsdCents: 100 },
      detached: { category: 'PINGENTE', name: "Charm | Lil' Ava", catalogId: CAT.CHARM_LIL_AVA },
    });
    expect(prev.suggestion.pricedAt).toBe(new Date(NOW.getTime() - 3600000).toISOString());

    const res = await detach(ak.id, component.id, { note: 'separado' });
    expect(res.status).toBe(201);
    const { operation, item: weapon, detachedItem } = res.body.data;
    expect(operation).toMatchObject({ kind: 'DETACH_COMPONENT', outcome: 'TRANSFERRED', occurredAt: DETACH_AT });
    expect(weapon.components).toEqual([]);
    expect(weapon.cost).toMatchObject({ ownUsdCents: 1001, effectiveUsdCents: 901, inheritedUsdCents: -100 });
    expect(weapon.purchasePriceCents).toBe(1001); // nunca muda
    expect(detachedItem).toMatchObject({
      category: 'PINGENTE', name: "Charm | Lil' Ava", catalogId: CAT.CHARM_LIL_AVA, status: 'EM_ESTOQUE', acquisitionType: 'GERADO',
      purchaseStoreId: null, acquiredAt: DETACH_AT, saleState: 'FOR_SALE', tradeUnlockAt: null,
    });
    expect(detachedItem.cost).toMatchObject({ effectiveUsdCents: 100 });
    expect(detachedItem.detachedFrom).toMatchObject({ operationId: operation.id, mode: 'SPLIT', weaponItemId: ak.id, pattern: 42 });
    expect(detachedItem.generatedFrom).toBeNull();
    // Custo conservado: lucro real, estoque e saldos idênticos.
    expect(numbers(await profit())).toEqual(before);

    // Histórico com porcentagem, base e preços usados.
    const ops = (await get(`/api/items/${ak.id}/operations`)).body.data;
    expect(ops[0]).toMatchObject({ kind: 'DETACH_COMPONENT', undoable: true });
    expect(ops[0].detail.detach).toMatchObject({
      mode: 'SPLIT', share: { hangingShareBp: 1000, basis: 'MARKET_CACHE', basePriceCents: 9000, hangingPriceCents: 1000 },
    });
    const stored = JSON.parse(getDb().prepare('SELECT detail_json FROM item_operations WHERE id = ?').get(operation.id).detail_json);
    expect(stored.share).toMatchObject({ hangingShareBp: 1000, basis: 'MARKET_CACHE', basePricedAt: expect.any(String), hangingPricedAt: expect.any(String) });
    const links = getDb().prepare('SELECT item_id, role, cost_share_bp FROM item_operation_links WHERE operation_id = ? ORDER BY id').all(operation.id);
    expect(links).toEqual([{ item_id: ak.id, role: 'TARGET', cost_share_bp: 9000 }, { item_id: detachedItem.id, role: 'CREATED', cost_share_bp: 1000 }]);

    // Desfazer: a unidade some, o chaveiro volta para a arma e os números voltam.
    const undone = await post(`/api/operations/${operation.id}/undo`);
    expect(undone.status).toBe(200);
    expect(undone.body.data.removedItemIds).toEqual([detachedItem.id]);
    const back = await itemOf(ak.id);
    expect(back.cost.effectiveUsdCents).toBe(1001);
    expect(hangingOf(back)).toMatchObject({ kind: 'CHARM', catalogId: CAT.CHARM_LIL_AVA, pattern: 42, origin: 'CAME_WITH', detachable: true });
    expect(numbers(await profit())).toEqual(before);
    expect((await get(`/api/items/${detachedItem.id}`)).status).toBe(404);
  });

  test('porcentagem informada (0 %, 100 %, 33,33 %) e sem preço: SPLIT_SHARE_REQUIRED; valores inválidos são recusados', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1001 }));
    const component = hangingOf(ak);
    const prev = (await preview(ak.id, component.id)).body.data;
    expect(prev).toMatchObject({ suggestion: null, suggestionUnavailableReason: 'WEAPON_NO_PRICE', result: null });
    expectError(await detach(ak.id, component.id), 422, 'SPLIT_SHARE_REQUIRED', { field: 'hangingShareBp' });
    expectError(await detach(ak.id, component.id, { hangingShareBp: 10001 }), 422, 'INVALID_OPERATION_INPUT', { field: 'hangingShareBp', params: { reason: 'SHARE_INVALID', max: 10000 } });
    expectError(await detach(ak.id, component.id, { hangingShareBp: -1 }), 422, 'INVALID_OPERATION_INPUT');
    expect((await detach(ak.id, component.id, { hangingShareBp: 12.5 })).status).toBe(400);
    expect(JSON.stringify((await itemOf(ak.id)).components)).toContain('Lil');

    // prévia com a porcentagem informada (sem sugestão)
    const manual = (await preview(ak.id, component.id, '?hangingShareBp=3333')).body.data;
    expect(manual.result).toEqual({ weaponUsdCents: 668, detachedUsdCents: 333 });
    // 1001 * 3333 / 10000 = 333,63 -> piso 333; 1001 * 6667 / 10000 = 667,37 -> piso 667; sobra 1 vai para a maior fração (a arma)
    const res = await detach(ak.id, component.id, { hangingShareBp: 3333 });
    expect(res.status).toBe(201);
    expect(res.body.data.item.cost.effectiveUsdCents).toBe(668);
    expect(res.body.data.detachedItem.cost.effectiveUsdCents).toBe(333);
    const detail = JSON.parse(getDb().prepare("SELECT detail_json FROM item_operations WHERE kind = 'DETACH_COMPONENT'").get().detail_json);
    expect(detail.share).toMatchObject({ hangingShareBp: 3333, basis: 'MANUAL', basePriceCents: null, hangingPriceCents: null });

    const second = await createItemViaApi(app, akBody({ purchasePriceCents: 500 }));
    expect((await detach(second.id, hangingOf(second).id, { hangingShareBp: 0 })).body.data.detachedItem.cost.effectiveUsdCents).toBe(0);
    const third = await createItemViaApi(app, akBody({ purchasePriceCents: 500 }));
    const all = await detach(third.id, hangingOf(third).id, { hangingShareBp: 10000 });
    expect(all.body.data.item.cost.effectiveUsdCents).toBe(0);
    expect(all.body.data.detachedItem.cost.effectiveUsdCents).toBe(500);
  });

  test('o custo efetivo inteiro entra na divisão, inclusive o herdado de sticker aplicado do estoque; arma GANHEI vira 0 e 0', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 100 }));
    const sticker = await createItemViaApi(app, purchaseBody({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 50 }));
    expect((await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: sticker.id, appliedAt: AT })).status).toBe(201);
    const withSticker = await itemOf(ak.id);
    expect(withSticker.cost.effectiveUsdCents).toBe(150);
    price(AK_KEY, 9000);
    price(CHARM_KEY, 1000);
    const res = await detach(ak.id, hangingOf(withSticker).id);
    expect(res.body.data.item.cost.effectiveUsdCents).toBe(135);
    expect(res.body.data.detachedItem.cost.effectiveUsdCents).toBe(15);
    // o sticker continua aplicado na arma
    expect(res.body.data.item.components.map((c) => c.kind)).toEqual(['STICKER']);

    const won = await createItemViaApi(app, akBody({ acquisitionType: 'GANHEI', purchaseStoreId: undefined, purchasePriceCents: undefined }));
    const split = await detach(won.id, hangingOf(won).id, { hangingShareBp: 5000 });
    expect(split.body.data.item.cost.effectiveUsdCents).toBe(0);
    expect(split.body.data.detachedItem.cost.effectiveUsdCents).toBe(0);
  });

  test('compra em BRL: as duas ficam estimadas e a parte nativa de cada preço mínimo é escalada; vender a separada tira a parte dela do lucro', async () => {
    const brl = await createItemViaApi(app, akBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 1000, fxRateAtPurchase: 5 }));
    expect(brl.cost).toMatchObject({ effectiveUsdCents: 200, estimated: true });
    const res = await detach(brl.id, hangingOf(brl).id, { hangingShareBp: 2500 });
    expect(res.body.data.item.cost).toMatchObject({ effectiveUsdCents: 150, estimated: true });
    expect(res.body.data.detachedItem.cost).toMatchObject({ effectiveUsdCents: 50, estimated: true });
    const gen = res.body.data.detachedItem;
    const sold = await post(`/api/items/${gen.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 200, soldAt: '2026-11-18T12:00:00.000Z' });
    expect(sold.status).toBe(200);
    expect(sold.body.data.item.saleProfitUsdCents).toBe(sold.body.data.item.netReceivedCents - 50);
  });

  test('trade lock opcional da separada: o giro conta dele; data antes da aquisição, futura e trade lock antes da separação são recusados', async () => {
    const ak = await createItemViaApi(app, akBody());
    const component = hangingOf(ak);
    expectError(await detach(ak.id, component.id, { hangingShareBp: 1000, detachedAt: '2026-11-01T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'BEFORE_TARGET_ACQUIRED', acquiredAt: ak.acquiredAt } });
    expectError(await detach(ak.id, component.id, { hangingShareBp: 1000, detachedAt: '2026-12-01T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'FUTURE' } });
    expectError(await detach(ak.id, component.id, { hangingShareBp: 1000, tradeUnlockAt: '2026-11-16T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { field: 'tradeUnlockAt' });
    const res = await detach(ak.id, component.id, { hangingShareBp: 1000, tradeUnlockAt: '2026-11-24T12:00:00.000Z' });
    expect(res.status).toBe(201);
    expect(res.body.data.detachedItem).toMatchObject({ tradeUnlockAt: '2026-11-24T12:00:00.000Z', saleState: 'FOR_SALE' });
    expect(res.body.data.detachedItem.tradeLock.isLocked).toBe(true);
    expect(res.body.data.detachedItem.aging.agingBucket).toBe('EM_TRADE_LOCK');
  });

  test('a separada nasce à venda mesmo com a arma no holding; a arma continua onde estava', async () => {
    const ak = await createItemViaApi(app, akBody());
    await post(`/api/items/${ak.id}/off-sale`);
    const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 1000 });
    expect(res.body.data.item.saleState).toBe('OFF_SALE');
    expect(res.body.data.detachedItem.saleState).toBe('FOR_SALE');
  });

  test('Sticker Slab vira OUTRO "Sticker Slab | X" e pode ser aplicado de novo em outra arma', async () => {
    const ak = await createItemViaApi(app, purchaseBody({ exterior: 'FT', floatValue: 0.2, purchasePriceCents: 400, components: [{ kind: 'STICKER_SLAB', catalogId: CAT.STICKER_TITAN, pattern: 9 }] }));
    const slab = hangingOf(ak);
    expect(slab).toMatchObject({ kind: 'STICKER_SLAB', detachable: true });
    const res = await detach(ak.id, slab.id, { hangingShareBp: 2500 });
    expect(res.status).toBe(201);
    const gen = res.body.data.detachedItem;
    expect(gen).toMatchObject({ category: 'OUTRO', name: 'Sticker Slab | Titan | Katowice 2014', acquisitionType: 'GERADO' });
    expect(gen.detachedFrom).toMatchObject({ pattern: 9 });
    expect(gen.cost.effectiveUsdCents).toBe(100);
    const other = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 200 }));
    const applied = await post(`/api/items/${other.id}/apply-component`, { sourceItemId: gen.id, appliedAt: DETACH_AT });
    expect(applied.status).toBe(201);
    expect(applied.body.data.item.cost.effectiveUsdCents).toBe(300);
    // a separada aplicada em outra arma: desfazer a separação fica bloqueado (NOT_LATEST)
    const blocked = await post(`/api/operations/${res.body.data.operation.id}/undo`);
    expectError(blocked, 409, 'OPERATION_UNDO_BLOCKED');
    expect(blocked.body.error.params.reason).toBe('NOT_LATEST');
  });
});

describe('devolver o pendurado aplicado do estoque (RETURN)', () => {
  async function applied() {
    const ak = await createItemViaApi(app, akBody({ components: [], purchasePriceCents: 1000 }));
    const unit = await createItemViaApi(app, purchaseBody({ catalogId: CAT.CHARM_LIL_AVA, purchasePriceCents: 300, tradeUnlockAt: '2026-11-12T12:00:00.000Z' }));
    await post(`/api/items/${unit.id}/off-sale`);
    const ap = await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: unit.id, appliedAt: AT, pattern: 5 });
    expect(ap.status).toBe(201);
    return { ak, unit, applyOpId: ap.body.data.operation.id, component: hangingOf(ap.body.data.item) };
  }

  test('a unidade original volta à venda com o custo dela e o giro recomeça; a aplicação fica encerrada', async () => {
    await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 100000, depositedAt: '2026-11-01T12:00:00.000Z' });
    const { ak, unit, applyOpId, component } = await applied();
    const before = numbers(await profit());
    expect(component).toMatchObject({ origin: 'APPLIED_FROM_STOCK', detachable: true, undoable: true });
    const prev = (await preview(ak.id, component.id)).body.data;
    expect(prev).toMatchObject({ mode: 'RETURN', suggestion: null, weapon: { effectiveUsdCents: 1300 }, result: { weaponUsdCents: 1000, detachedUsdCents: 300 } });
    expectError(await preview(ak.id, component.id, '?hangingShareBp=100'), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'SHARE_NOT_ALLOWED' } });
    expectError(await detach(ak.id, component.id, { hangingShareBp: 100 }), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'SHARE_NOT_ALLOWED' } });
    expectError(await detach(ak.id, component.id, { detachedAt: '2026-11-14T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'BEFORE_APPLIED', acquiredAt: AT } });

    const res = await detach(ak.id, component.id);
    expect(res.status).toBe(201);
    expect(res.body.data.item.components).toEqual([]);
    expect(res.body.data.item.cost.effectiveUsdCents).toBe(1000);
    const back = res.body.data.detachedItem;
    expect(back).toMatchObject({
      id: unit.id, status: 'EM_ESTOQUE', consumedAt: null, saleState: 'FOR_SALE', offSaleAt: null, forSaleSince: DETACH_AT,
      tradeUnlockAt: '2026-11-12T12:00:00.000Z', purchasePriceCents: 300,
    });
    expect(back.cost.effectiveUsdCents).toBe(300);
    expect(back.detachedFrom).toMatchObject({ mode: 'RETURN', weaponItemId: ak.id });
    expect(back.consumedIn).toBeNull();
    expect(numbers(await profit())).toEqual(before);

    // a aplicação continua no histórico, encerrada e sem desfazer
    const ops = (await get(`/api/items/${unit.id}/operations`)).body.data;
    const apply = ops.find((o) => o.id === applyOpId);
    expect(apply).toMatchObject({ undoable: false, undoBlockedReason: 'DETACHED', endedBy: { operationId: res.body.data.operation.id } });
    expectError(await post(`/api/operations/${applyOpId}/undo`), 409, 'OPERATION_UNDO_BLOCKED', { params: { reason: 'DETACHED', operationId: res.body.data.operation.id } });
    // excluir a unidade ou a arma com a separação ativa
    expect((await request(app).delete(`/api/items/${unit.id}`)).body.error.code).toBe('ITEM_IN_OPERATION');
    expect((await request(app).delete(`/api/items/${ak.id}`)).body.error.code).toBe('ITEM_IN_OPERATION');

    // desfazer a separação restaura tudo, e a aplicação volta a ser desfazível
    const undone = await post(`/api/operations/${res.body.data.operation.id}/undo`);
    expect(undone.status).toBe(200);
    const unitAgain = await itemOf(unit.id);
    expect(unitAgain).toMatchObject({ status: 'CONSUMIDO', consumedAt: AT, saleState: null, tradeUnlockAt: '2026-11-12T12:00:00.000Z' });
    expect(unitAgain.offSaleAt).not.toBeNull();
    expect(unitAgain.forSaleSince).toBeNull();
    const akAgain = await itemOf(ak.id);
    expect(hangingOf(akAgain)).toMatchObject({ origin: 'APPLIED_FROM_STOCK', sourceItemId: unit.id, operationId: applyOpId, pattern: 5, undoable: true });
    expect(akAgain.cost.effectiveUsdCents).toBe(1300);
    expect(numbers(await profit())).toEqual(before);
    expect((await post(`/api/operations/${applyOpId}/undo`)).status).toBe(200);
  });

  test('a unidade devolvida pode ser aplicada de novo em outra arma; o trade lock maior substitui o atual', async () => {
    const { ak, unit, component } = await applied();
    const res = await detach(ak.id, component.id, { tradeUnlockAt: '2026-11-25T12:00:00.000Z' });
    expect(res.body.data.detachedItem.tradeUnlockAt).toBe('2026-11-25T12:00:00.000Z');
    const other = await createItemViaApi(app, akBody({ components: [], purchasePriceCents: 100 }));
    const again = await post(`/api/items/${other.id}/apply-component`, { sourceItemId: unit.id, appliedAt: DETACH_AT });
    expect(again.status).toBe(201);
    expect(again.body.data.item.cost.effectiveUsdCents).toBe(400);
  });
});

describe('recusas e proteções', () => {
  test('sticker não é separável; arma vendida e componente de outra arma; unidade gerada não muda tipo/loja/data', async () => {
    const ak = await createItemViaApi(app, akBody({ components: [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 0 }, charm()] }));
    const sticker = ak.components.find((c) => c.kind === 'STICKER');
    expect(sticker.detachable).toBe(false);
    expectError(await detach(ak.id, sticker.id), 409, 'COMPONENT_NOT_DETACHABLE');
    const other = await createItemViaApi(app, akBody());
    expectError(await detach(other.id, hangingOf(ak).id), 404, 'COMPONENT_NOT_FOUND');
    expectError(await detach(99999, 1), 404, 'ITEM_NOT_FOUND');

    const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 1000 });
    const gen = res.body.data.detachedItem;
    expect((await request(app).patch(`/api/items/${gen.id}`).send({ acquisitionType: 'GANHEI' })).body.error.code).toBe('GENERATED_FIELD_LOCKED');
    expect((await request(app).delete(`/api/items/${gen.id}`)).body.error.code).toBe('ITEM_IN_OPERATION');

    const sold = await createItemViaApi(app, akBody());
    await post(`/api/items/${sold.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 200, soldAt: '2026-11-18T12:00:00.000Z' });
    const soldComponent = (await itemOf(sold.id)).components[0];
    expect(soldComponent.detachable).toBe(false);
    expectError(await detach(sold.id, soldComponent.id), 409, 'ITEM_NOT_IN_STOCK');
  });

  test('desfazer: gerada vendida bloqueia (TARGET_SOLD) e "desfazer venda" libera; arma com outro pendurado à mão (HANGING_OCCUPIED)', async () => {
    const ak = await createItemViaApi(app, akBody());
    const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 1000 });
    const opId = res.body.data.operation.id;
    const gen = res.body.data.detachedItem;
    await post(`/api/items/${gen.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 200, soldAt: '2026-11-18T12:00:00.000Z' });
    expectError(await post(`/api/operations/${opId}/undo`), 409, 'OPERATION_UNDO_BLOCKED', { params: { reason: 'TARGET_SOLD', itemId: gen.id } });
    await post(`/api/items/${gen.id}/unsell`);

    // outro chaveiro colocado à mão na arma
    const patched = await request(app).patch(`/api/items/${ak.id}`).send({ components: [charm({ pattern: 7 })] });
    expect(patched.status).toBe(200);
    const history = (await get(`/api/items/${ak.id}/operations`)).body.data;
    expect(history.find((o) => o.id === opId)).toMatchObject({ undoable: false, undoBlockedReason: 'HANGING_OCCUPIED' });
    expectError(await post(`/api/operations/${opId}/undo`), 409, 'OPERATION_UNDO_BLOCKED', { params: { reason: 'HANGING_OCCUPIED', itemId: ak.id } });
    // separar de novo o segundo chaveiro (duas separações seguidas)
    const second = await detach(ak.id, hangingOf(patched.body.data).id, { hangingShareBp: 5000 });
    expect(second.status).toBe(201);
    expect(second.body.data.item.cost.effectiveUsdCents).toBeLessThan(res.body.data.item.cost.effectiveUsdCents);
  });

  test('a "Varredura completa" não recoloca o pendurado separado (componentsImportedAt marcado)', async () => {
    const ak = await createItemViaApi(app, akBody());
    expect((await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 1000 })).status).toBe(201);
    expect(getDb().prepare('SELECT components_imported_at AS at FROM items WHERE id = ?').get(ak.id).at).toBe(DETACH_AT);
  });

  test('o corpo só aceita os campos conhecidos', async () => {
    const ak = await createItemViaApi(app, akBody());
    expect((await detach(ak.id, hangingOf(ak).id, { extra: 1 })).status).toBe(400);
    expect((await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 'x' })).status).toBe(400);
    expect((await get(`/api/items/${ak.id}/components/${hangingOf(ak).id}/detach-preview?hangingShareBp=abc`)).status).toBe(400);
  });
});

describe('costService: números sem separação e divisão pura', () => {
  const item = (id, extra = {}) => ({ id, acquisitionType: 'COMPRA', purchasePriceCents: 1001, purchaseCurrency: 'USD', fxRateAtPurchase: null, ...extra });
  test('sem separação o índice é o de sempre; com separação a soma é exata e o empate vai para o menor id', () => {
    const weapon = item(1);
    const gen = item(2, { acquisitionType: 'GERADO', purchasePriceCents: 0 });
    const operations = [{ id: 10, kind: 'DETACH_COMPONENT', undoneAt: null, endedByOperationId: null }];
    const links = [
      { operationId: 10, itemId: 1, role: 'TARGET', costShareBp: 5000 },
      { operationId: 10, itemId: 2, role: 'CREATED', costShareBp: 5000 },
    ];
    const index = buildCostIndex({ itemsById: new Map([[1, weapon], [2, gen]]), operations, links });
    expect(index.effectiveUsdCents(weapon)).toBe(501);
    expect(index.effectiveUsdCents(gen)).toBe(500);
    expect(splitPool(1001, [{ id: 1, bp: 5000 }, { id: 2, bp: 5000 }]).get(1)).toBe(501);
    // a separação encerrada ou desfeita não conta
    const ended = buildCostIndex({ itemsById: new Map([[1, weapon], [2, gen]]), operations: [{ ...operations[0], endedByOperationId: 11 }], links });
    expect(ended.effectiveUsdCents(weapon)).toBe(1001);
    const none = buildCostIndex();
    expect(none.effectiveUsdCents(weapon)).toBe(1001);
  });
});
