// 10.3 (D362): "Aplicar do estoque" pela API: custo efetivo, números idênticos, remover para sempre, desfazer e proteções.
const request = require('supertest');
const { freshDb } = require('../helpers/fixtures');
const { getDb, closeDb } = require('../../src/config/database');
const CatalogItem = require('../../src/models/CatalogItem');
const { normalizeSearchText } = require('../../src/services/catalog/csgoApiAdapter');
const { CAT, makeCatalogApp, purchaseBody, createItemViaApi, expectError, storeId } = require('../helpers/apiFixtures');

let app;
const APPLIED_AT = '2026-11-15T12:00:00.000Z';

beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
  const row = (id, source, category, name) => ({
    id, source, category, name, nameKey: normalizeSearchText(name), searchText: normalizeSearchText(name), minFloat: null, maxFloat: null,
    hasStattrak: false, hasSouvenir: false,
  });
  CatalogItem.upsertMany([row('patch-1', 'PATCHES', 'PATCH', 'Patch | Crazy Banana'), row('patch-2', 'PATCHES', 'PATCH', 'Patch | The Boss')]);
});
afterAll(() => closeDb());

const get = (url) => request(app).get(url);
const post = (url, body = {}) => request(app).post(url).send(body);
const stickerBody = (extra = {}) => purchaseBody({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 50, ...extra });
const apply = (targetId, sourceItemId, extra = {}) => post(`/api/items/${targetId}/apply-component`, { sourceItemId, appliedAt: APPLIED_AT, ...extra });
const profit = async () => (await get('/api/profit/summary')).body.data;
const itemOf = async (id) => (await get(`/api/items/${id}`)).body.data;
const numbers = (p) => ({
  stock: p.stockUsdCents, real: p.realProfitUsdCents, platform: p.platformBalanceUsdCents, pending: p.pendingBalanceUsdCents,
  stockTotal: p.stockBreakdown.forSale.usdCents + p.stockBreakdown.offSale.usdCents,
  balances: p.balancesByStore.map((b) => [b.storeId, b.availableCents]),
});

describe('aplicar sticker numa arma', () => {
  test('o sticker é consumido, o custo passa para a arma e lucro real, estoque e saldos ficam idênticos', async () => {
    await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 100000, depositedAt: '2026-11-01T12:00:00.000Z' });
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    const before = numbers(await profit());
    const res = await apply(ak.id, sticker.id, { slot: 2, wear: 0.1 });
    expect(res.status).toBe(201);
    expect(res.body.data.operation).toMatchObject({ kind: 'APPLY_COMPONENT', outcome: 'TRANSFERRED', occurredAt: APPLIED_AT, undoneAt: null });
    const target = res.body.data.item;
    expect(target.cost).toEqual({ ownUsdCents: 100, inheritedUsdCents: 50, effectiveUsdCents: 150, estimated: false });
    expect(target.purchasePriceCents).toBe(100); // nunca muda
    expect(target.components).toHaveLength(1);
    expect(target.components[0]).toMatchObject({
      kind: 'STICKER', origin: 'APPLIED_FROM_STOCK', sourceItemId: sticker.id, slot: 2, wear: 0.1, undoable: true, scrapeable: true, name: 'Sticker | Titan | Katowice 2014',
    });
    expect(target.acquiredAt).toBe(ak.acquiredAt); // mantém a aquisição e o giro
    const consumed = await itemOf(sticker.id);
    expect(consumed).toMatchObject({ status: 'CONSUMIDO', consumedAt: APPLIED_AT, purchasePriceCents: 50, canReceiveComponents: false });
    expect(consumed.consumedIn).toMatchObject({ targetItemId: ak.id, occurredAt: APPLIED_AT });
    expect(consumed.aging.agingBucket).toBe('CONSUMIDO');
    expect(consumed.minPrices).toBeNull();
    expect(numbers(await profit())).toEqual(before);
  });

  test('a consumida sai do estoque e das listas; status=CONSUMIDO a traz; grupos e vendas não a contam', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    await apply(ak.id, sticker.id);
    const all = (await get('/api/items')).body.data.items;
    expect(all.map((i) => i.id)).toEqual([ak.id]);
    expect((await get('/api/items?status=EM_ESTOQUE')).body.data.items.map((i) => i.id)).toEqual([ak.id]);
    expect((await get('/api/items?status=CONSUMIDO')).body.data.items.map((i) => i.id)).toEqual([sticker.id]);
    expect((await get('/api/items?stagnantOnly=true')).body.data.items.map((i) => i.id)).not.toContain(sticker.id);
    const groups = (await get('/api/items/groups')).body.data;
    expect(groups.groups).toHaveLength(1);
    expect(groups.groups[0]).toMatchObject({ quantity: 1, totalCostUsdCents: 150, avgCostUsdCents: 150 });
    const stats = (await get('/api/items/stats?name=Sticker%20%7C%20Titan%20%7C%20Katowice%202014&category=STICKER')).body.data;
    expect(stats).toMatchObject({ unitCount: 0, consumedCount: 1, soldCount: 0, avgPurchaseCostUsdCents: null });
  });

  test('chaveiro, Sticker Slab (OUTRO) e patch em agente; tipo errado no alvo é COMPONENTS_NOT_ALLOWED', async () => {
    const ak = await createItemViaApi(app);
    const charm = await createItemViaApi(app, purchaseBody({ catalogId: CAT.CHARM_LIL_AVA, purchasePriceCents: 30 }));
    expect((await apply(ak.id, charm.id, { pattern: 7 })).body.data.item.components[0]).toMatchObject({ kind: 'CHARM', pattern: 7, scrapeable: false, undoable: true });
    const slab = await createItemViaApi(app, purchaseBody({ category: 'OUTRO', name: 'Sticker Slab | Titan | Katowice 2014', catalogId: undefined, purchasePriceCents: 70 }));
    // 2.º pendurado: limite
    expectError(await apply(ak.id, slab.id), 400, 'COMPONENT_LIMIT_EXCEEDED');
    const ak2 = await createItemViaApi(app);
    const applied = await apply(ak2.id, slab.id, { pattern: 3 });
    expect(applied.status).toBe(201);
    expect(applied.body.data.item.components[0]).toMatchObject({ kind: 'STICKER_SLAB', name: 'Sticker Slab | Titan | Katowice 2014', pattern: 3 });

    const agent = await createItemViaApi(app, { catalogId: CAT.AGENT_DARRYL, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' });
    const patch = await createItemViaApi(app, purchaseBody({ catalogId: 'patch-1', purchasePriceCents: 200 }));
    expect(patch.category).toBe('PATCH');
    const sticker = await createItemViaApi(app, stickerBody());
    expectError(await apply(agent.id, sticker.id), 400, 'COMPONENTS_NOT_ALLOWED');
    const res = await apply(agent.id, patch.id, { slot: 0 });
    expect(res.status).toBe(201);
    expect(res.body.data.item.components[0]).toMatchObject({ kind: 'PATCH', name: 'Patch | Crazy Banana', scrapeable: true });
    expect(res.body.data.item.cost.effectiveUsdCents).toBe(200); // GANHEI: custo próprio 0
    const ak3 = await createItemViaApi(app);
    expectError(await apply(ak3.id, patch.id), 409, 'ITEM_NOT_IN_STOCK');
    const patch2 = await createItemViaApi(app, purchaseBody({ catalogId: 'patch-2', purchasePriceCents: 10 }));
    expectError(await apply(ak3.id, patch2.id), 400, 'COMPONENTS_NOT_ALLOWED'); // patch em arma
    const knife = await createItemViaApi(app, { catalogId: CAT.KARAMBIT_FADE, acquisitionType: 'GANHEI' });
    expectError(await apply(knife.id, sticker.id), 400, 'COMPONENTS_NOT_ALLOWED');
  });

  test('limites, slot repetido e campos', async () => {
    const ak = await createItemViaApi(app);
    for (let i = 0; i < 5; i += 1) {
      const s = await createItemViaApi(app, stickerBody());
      expect((await apply(ak.id, s.id, { slot: 0 })).status).toBe(201); // slot repetido vale (D361)
    }
    const sixth = await createItemViaApi(app, stickerBody());
    expectError(await apply(ak.id, sixth.id), 400, 'COMPONENT_LIMIT_EXCEEDED');
    const ak2 = await createItemViaApi(app);
    expectError(await apply(ak2.id, sixth.id, { slot: 9 }), 400, 'INVALID_COMPONENT_FIELD');
    expectError(await apply(ak2.id, sixth.id, { pattern: 1 }), 400, 'INVALID_COMPONENT_FIELD');
    expectError(await apply(ak2.id, sixth.id, { wear: 1 }), 400, 'INVALID_COMPONENT_FIELD');
    expect((await itemOf(sixth.id)).status).toBe('EM_ESTOQUE'); // nada gravado nos erros
    expect((await itemOf(ak.id)).cost.effectiveUsdCents).toBe(100 + 5 * 50);
  });

  test('origem inválida: ela mesma, vendida, consumida, sem catálogo, outra categoria', async () => {
    const ak = await createItemViaApi(app);
    const ak2 = await createItemViaApi(app);
    expectError(await apply(ak.id, ak.id), 422, 'APPLY_SOURCE_NOT_APPLICABLE');
    expectError(await apply(ak.id, ak2.id), 422, 'APPLY_SOURCE_NOT_APPLICABLE');
    const sold = await createItemViaApi(app, stickerBody());
    await post(`/api/items/${sold.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 100, soldAt: '2026-11-12T12:00:00.000Z' });
    expectError(await apply(ak.id, sold.id), 409, 'ITEM_NOT_IN_STOCK');
    const used = await createItemViaApi(app, stickerBody());
    await apply(ak.id, used.id);
    expectError(await apply(ak2.id, used.id), 409, 'ITEM_NOT_IN_STOCK');
    const legacy = await createItemViaApi(app, { category: 'OUTRO', name: 'Chave qualquer', acquisitionType: 'GANHEI' });
    expectError(await apply(ak.id, legacy.id), 422, 'APPLY_SOURCE_NOT_APPLICABLE');
    expectError(await apply(ak.id, 99999), 404, 'ITEM_NOT_FOUND');
    const fresh = await createItemViaApi(app, stickerBody());
    expectError(await apply(ak.id, fresh.id, { appliedAt: 'x' }), 400, 'INVALID_DATE');
    expectError(await post(`/api/items/${ak.id}/apply-component`, { slot: 1 }), 400, 'REQUIRED_FIELD');
    expectError(await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: 1, allowSoldTarget: true }), 400, 'UNKNOWN_FIELD');
  });

  test('o botão comum recusa a arma vendida (ITEM_NOT_IN_STOCK)', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    await post(`/api/items/${ak.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 500, soldAt: '2026-11-16T12:00:00.000Z' });
    expectError(await apply(ak.id, sticker.id), 409, 'ITEM_NOT_IN_STOCK');
    expectError(await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: sticker.id, allowSoldTarget: true }), 400, 'UNKNOWN_FIELD');
    expect((await get(`/api/items/${ak.id}/apply-candidates`)).body.data).toMatchObject({ allowedKinds: [], candidates: [] });
  });

  test('datas: anterior à aquisição de cada uma, futura; igual à aquisição vale; unidade em trade lock e no holding valem', async () => {
    const ak = await createItemViaApi(app, purchaseBody({ acquiredAt: '2026-11-10T12:00:00.000Z' }));
    const late = await createItemViaApi(app, stickerBody({ acquiredAt: '2026-11-14T12:00:00.000Z', tradeUnlockAt: '2026-11-25T12:00:00.000Z' }));
    expectError(await apply(ak.id, late.id, { appliedAt: '2026-11-13T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'BEFORE_SOURCE_ACQUIRED', acquiredAt: late.acquiredAt } });
    expectError(await apply(ak.id, late.id, { appliedAt: '2026-11-09T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID');
    expectError(await apply(ak.id, late.id, { appliedAt: '2026-11-25T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'FUTURE' } });
    await post(`/api/items/${late.id}/off-sale`);
    const holdingBefore = await itemOf(late.id);
    expect((await apply(ak.id, late.id, { appliedAt: '2026-11-14T12:00:00.000Z' })).status).toBe(201); // igual à aquisição; trade lock e holding aceitos
    const undone = await post(`/api/operations/${(await get(`/api/items/${ak.id}/operations`)).body.data[0].id}/undo`);
    expect(undone.status).toBe(200);
    const holdingAfter = await itemOf(late.id);
    expect(holdingAfter).toMatchObject({ status: 'EM_ESTOQUE', consumedAt: null, tradeUnlockAt: holdingBefore.tradeUnlockAt, offSaleAt: holdingBefore.offSaleAt, forSaleSince: holdingBefore.forSaleSince });
  });

  test('compra em BRL aplicada numa arma em USD: custo estimado pela cotação gravada e preço mínimo em loja BRL soma as partes', async () => {
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.5 });
    const ak = await createItemViaApi(app);
    const before = (await itemOf(ak.id)).minPrices;
    const sticker = await createItemViaApi(app, stickerBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 540, fxRateAtPurchase: 5.4 }));
    const res = await apply(ak.id, sticker.id);
    const target = res.body.data.item;
    expect(target.cost).toEqual({ ownUsdCents: 100, inheritedUsdCents: 100, effectiveUsdCents: 200, estimated: true });
    const steam = target.minPrices.find((m) => m.storeName === 'Steam');
    const steamBefore = before.find((m) => m.storeName === 'Steam');
    expect(steam.minPriceCents).toBeGreaterThan(steamBefore.minPriceCents);
    const csf = target.minPrices.find((m) => m.storeName === 'CSFloat');
    expect(csf.minPriceCents).toBeGreaterThan(before.find((m) => m.storeName === 'CSFloat').minPriceCents);
  });

  test('vender a arma: o lucro da venda usa o custo efetivo; resumo de vendas e estatísticas também', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    await apply(ak.id, sticker.id);
    const sold = await post(`/api/items/${ak.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 1000, soldAt: '2026-11-16T12:00:00.000Z' });
    expect(sold.status).toBe(200);
    expect(sold.body.data.item.saleInfo).toMatchObject({ purchaseCostUsdCents: 150, ownCostUsdCents: 100, inheritedCostUsdCents: 50 });
    expect(sold.body.data.item.saleProfitUsdCents).toBe(sold.body.data.item.netReceivedCents - 150);
    const sales = (await get('/api/items/sales')).body.data;
    expect(sales.summary.totalPurchaseCostUsdCents).toBe(150);
    expect(sales.summary.totalProfitUsdCents).toBe(sold.body.data.item.netReceivedCents - 150);
    expect(sales.items[0].stats.avgProfitUsdCents).toBe(sold.body.data.item.netReceivedCents - 150);
  });
});

describe('patches antigos em OUTRO', () => {
  test('com um único patch de mesmo nome no catálogo, o legado vira PATCH vinculado; ambíguo continua OUTRO', async () => {
    const catalogService = require('../../src/services/catalogService');
    const legacy = await createItemViaApi(app, { category: 'OUTRO', name: 'Patch | Crazy Banana', acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' });
    const dup = await createItemViaApi(app, { category: 'OUTRO', name: 'Patch | The Boss', acquisitionType: 'GANHEI' });
    const row = (id) => ({ id, source: 'PATCHES', category: 'PATCH', name: 'Patch | The Boss', nameKey: 'patch | the boss', searchText: 'patch | the boss', minFloat: null, maxFloat: null, hasStattrak: false, hasSouvenir: false });
    CatalogItem.upsertMany([row('patch-2b')]); // 'patch-2' já é "The Boss": agora há dois
    expect(catalogService.linkLegacyItems({ now: new Date('2026-11-19T15:00:00.000Z') })).toBe(1);
    expect(await itemOf(legacy.id)).toMatchObject({ category: 'PATCH', catalogId: 'patch-1', name: 'Patch | Crazy Banana', isLegacy: false });
    expect(await itemOf(dup.id)).toMatchObject({ category: 'OUTRO', catalogId: null });
    const agent = await createItemViaApi(app, { catalogId: CAT.AGENT_DARRYL, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' });
    expectError(await apply(agent.id, dup.id), 422, 'APPLY_SOURCE_NOT_APPLICABLE'); // OUTRO sem casamento não pode ser aplicado
    expect((await apply(agent.id, legacy.id)).status).toBe(201);
  });
});

describe('candidatas', () => {
  test('lista as unidades aplicáveis, mais antigas primeiro, com custo efetivo, trade lock e holding', async () => {
    const ak = await createItemViaApi(app);
    const old = await createItemViaApi(app, stickerBody({ acquiredAt: '2026-11-01T12:00:00.000Z' }));
    const recent = await createItemViaApi(app, stickerBody({ acquiredAt: '2026-11-12T12:00:00.000Z', tradeUnlockAt: '2026-11-25T12:00:00.000Z' }));
    await post(`/api/items/${recent.id}/off-sale`);
    await createItemViaApi(app, purchaseBody({ catalogId: CAT.CHARM_LIL_AVA, purchasePriceCents: 10 }));
    await createItemViaApi(app, purchaseBody({ catalogId: 'patch-1', purchasePriceCents: 10 })); // patch não serve numa arma
    const data = (await get(`/api/items/${ak.id}/apply-candidates`)).body.data;
    expect(data.allowedKinds).toEqual(['STICKER', 'CHARM', 'STICKER_SLAB']);
    expect(data.remaining).toEqual({ stickers: 5, hanging: 1, patches: 3 });
    expect(data.candidates.filter((c) => c.kind === 'STICKER').map((c) => c.itemId)).toEqual([old.id, recent.id]);
    expect(data.candidates.map((c) => c.itemId)).toEqual(data.candidates.slice().sort((a, b) => Date.parse(a.acquiredAt) - Date.parse(b.acquiredAt) || a.itemId - b.itemId).map((c) => c.itemId));
    expect(data.candidates.every((c) => c.kind !== 'PATCH')).toBe(true);
    expect(data.candidates[0]).toMatchObject({ kind: 'STICKER', effectiveCostUsdCents: 50, costEstimated: false, tradeLocked: false, offSale: false });
    expect(data.candidates.find((c) => c.itemId === recent.id)).toMatchObject({ tradeLocked: true, offSale: true });
    expect(data.candidates[0]).toHaveProperty('imageUrl');
    expect((await get('/api/items/99999/apply-candidates')).status).toBe(404);
  });
});

describe('remover para sempre', () => {
  test('sticker aplicado: o componente sai, o custo fica; desfazer recria; chaveiro e o que veio junto são recusados', async () => {
    const ak = await createItemViaApi(app, purchaseBody({ components: [{ kind: 'STICKER', catalogId: CAT.STICKER_CROWN, slot: 0 }] }));
    const sticker = await createItemViaApi(app, stickerBody());
    const charm = await createItemViaApi(app, purchaseBody({ catalogId: CAT.CHARM_LIL_AVA, purchasePriceCents: 30 }));
    const applied = (await apply(ak.id, sticker.id, { slot: 1 })).body.data.item;
    await apply(ak.id, charm.id);
    const current = await itemOf(ak.id);
    const [came, stickerComp, charmComp] = current.components;
    expect(came.origin).toBe('CAME_WITH');
    expectError(await post(`/api/items/${ak.id}/components/${came.id}/scrape-off`), 409, 'COMPONENT_NOT_SCRAPEABLE');
    expectError(await post(`/api/items/${ak.id}/components/${charmComp.id}/scrape-off`), 409, 'COMPONENT_NOT_SCRAPEABLE');
    expectError(await post(`/api/items/${ak.id}/components/99999/scrape-off`), 404, 'COMPONENT_NOT_FOUND');
    expect(applied.components.some((c) => c.id === stickerComp.id)).toBe(true);
    const before = numbers(await profit());
    const res = await post(`/api/items/${ak.id}/components/${stickerComp.id}/scrape-off`, { occurredAt: '2026-11-17T12:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.data.operation).toMatchObject({ kind: 'SCRAPE_OFF', occurredAt: '2026-11-17T12:00:00.000Z' });
    expect(res.body.data.item.components.map((c) => c.kind)).toEqual(['STICKER', 'CHARM']); // o que veio junto + o chaveiro
    expect(res.body.data.item.cost.effectiveUsdCents).toBe(100 + 50 + 30); // o custo continua na arma (E-P2-Q27)
    expect(numbers(await profit())).toEqual(before);
    // o desfazer da aplicação fica atrás do SCRAPE_OFF (NOT_LATEST); desfazendo o SCRAPE_OFF o componente volta
    const ops = (await get(`/api/items/${ak.id}/operations`)).body.data;
    const scrape = ops.find((o) => o.kind === 'SCRAPE_OFF');
    const applyOp = ops.find((o) => o.kind === 'APPLY_COMPONENT' && o.counterparts.some((c) => c.itemId === sticker.id));
    expectError(await post(`/api/operations/${applyOp.id}/undo`), 409, 'OPERATION_UNDO_BLOCKED', { params: { reason: 'NOT_LATEST', operationId: scrape.id, itemId: expect.any(Number) } });
    const undone = await post(`/api/operations/${scrape.id}/undo`);
    expect(undone.status).toBe(200);
    const restored = await itemOf(ak.id);
    expect(restored.components.map((c) => [c.kind, c.origin, c.slot]).sort()).toEqual([['CHARM', 'APPLIED_FROM_STOCK', null], ['STICKER', 'APPLIED_FROM_STOCK', 1], ['STICKER', 'CAME_WITH', 0]]);
  });

  test('alvo vendido ou consumido não aceita; data anterior à aplicação é recusada', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    await apply(ak.id, sticker.id);
    const comp = (await itemOf(ak.id)).components[0];
    expectError(await post(`/api/items/${ak.id}/components/${comp.id}/scrape-off`, { occurredAt: '2026-11-14T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'BEFORE_APPLICATION', acquiredAt: expect.any(String) } });
    expectError(await post(`/api/items/${sticker.id}/components/${comp.id}/scrape-off`), 409, 'ITEM_CONSUMED');
    await post(`/api/items/${ak.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 500, soldAt: '2026-11-16T12:00:00.000Z' });
    expectError(await post(`/api/items/${ak.id}/components/${comp.id}/scrape-off`), 409, 'ITEM_NOT_IN_STOCK');
  });
});

describe('desfazer', () => {
  test('a unidade volta ao estoque, o custo da arma volta e os números ficam idênticos; a operação fica no histórico como desfeita', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    const before = numbers(await profit());
    const applied = await apply(ak.id, sticker.id);
    const opId = applied.body.data.operation.id;
    const res = await post(`/api/operations/${opId}/undo`);
    expect(res.status).toBe(200);
    expect(res.body.data.operation).toMatchObject({ id: opId, undoneAt: expect.any(String) });
    expect(res.body.data.items.map((i) => i.id).sort()).toEqual([ak.id, sticker.id].sort());
    const target = await itemOf(ak.id);
    expect(target.cost).toEqual({ ownUsdCents: 100, inheritedUsdCents: 0, effectiveUsdCents: 100, estimated: false });
    expect(target.components).toEqual([]);
    expect(await itemOf(sticker.id)).toMatchObject({ status: 'EM_ESTOQUE', consumedAt: null });
    expect(numbers(await profit())).toEqual(before);
    const history = (await get(`/api/items/${ak.id}/operations`)).body.data;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: opId, kind: 'APPLY_COMPONENT', role: 'TARGET', undoneAt: expect.any(String), undoable: false, undoBlockedReason: 'ALREADY_UNDONE' });
    expect(history[0].counterparts).toEqual([{ itemId: sticker.id, name: 'Sticker | Titan | Katowice 2014', role: 'CONSUMED', status: 'EM_ESTOQUE' }]);
    expectError(await post(`/api/operations/${opId}/undo`), 409, 'OPERATION_ALREADY_UNDONE');
    expectError(await post('/api/operations/99999/undo'), 404, 'OPERATION_NOT_FOUND');
  });

  test('dois stickers na mesma arma: só o último pode ser desfeito (NOT_LATEST)', async () => {
    const ak = await createItemViaApi(app);
    const a = await createItemViaApi(app, stickerBody());
    const b = await createItemViaApi(app, stickerBody({ purchasePriceCents: 60 }));
    const first = (await apply(ak.id, a.id)).body.data.operation.id;
    const second = (await apply(ak.id, b.id)).body.data.operation.id;
    expectError(await post(`/api/operations/${first}/undo`), 409, 'OPERATION_UNDO_BLOCKED', { params: { reason: 'NOT_LATEST', operationId: second, itemId: expect.any(Number) } });
    expect((await post(`/api/operations/${second}/undo`)).status).toBe(200);
    expect((await post(`/api/operations/${first}/undo`)).status).toBe(200);
  });

  test('arma vendida bloqueia (TARGET_SOLD); depois de desfazer a venda, libera', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    const opId = (await apply(ak.id, sticker.id)).body.data.operation.id;
    await post(`/api/items/${ak.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 500, soldAt: '2026-11-16T12:00:00.000Z' });
    const sold = await itemOf(ak.id);
    expect(sold.components[0].undoable).toBe(false);
    expectError(await post(`/api/operations/${opId}/undo`), 409, 'OPERATION_UNDO_BLOCKED', { params: { reason: 'TARGET_SOLD', itemId: ak.id } });
    await post(`/api/items/${ak.id}/unsell`);
    const back = await itemOf(ak.id);
    expect(back.components).toHaveLength(1); // desfazer a venda mantém os componentes
    expect(back.cost.effectiveUsdCents).toBe(150);
    expect((await post(`/api/operations/${opId}/undo`)).status).toBe(200);
  });
});

describe('proteções', () => {
  test('a unidade consumida não vende, não vai para o holding, não se edita nem se exclui; "desfazer venda" também recusa', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    await apply(ak.id, sticker.id);
    expectError(await post(`/api/items/${sticker.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 100, soldAt: '2026-11-16T12:00:00.000Z' }), 409, 'ITEM_CONSUMED');
    expectError(await post(`/api/items/${sticker.id}/off-sale`), 409, 'ITEM_CONSUMED');
    expectError(await post(`/api/items/${sticker.id}/for-sale`), 409, 'ITEM_CONSUMED');
    expectError(await post(`/api/items/${sticker.id}/unsell`), 409, 'ITEM_CONSUMED');
    expectError(await request(app).patch(`/api/items/${sticker.id}`).send({ originDetail: 'x' }), 409, 'ITEM_CONSUMED');
    expectError(await post('/api/items/bulk/off-sale', { itemIds: [sticker.id] }), 409, 'ITEM_CONSUMED');
    expectError(await request(app).delete(`/api/items/${sticker.id}`), 409, 'ITEM_IN_OPERATION');
    expectError(await request(app).delete(`/api/items/${ak.id}`), 409, 'ITEM_IN_OPERATION');
  });

  test('depois de desfazer, as duas unidades podem ser excluídas (as operações desfeitas são apagadas)', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    const opId = (await apply(ak.id, sticker.id)).body.data.operation.id;
    await post(`/api/operations/${opId}/undo`);
    expect((await request(app).delete(`/api/items/${sticker.id}`)).status).toBe(200);
    expect((await request(app).delete(`/api/items/${ak.id}`)).status).toBe(200);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM item_operations').get().n).toBe(0);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM item_operation_links').get().n).toBe(0);
  });

  test('PATCH do alvo: os aplicados ficam, contam nos limites e só mudam slot/desgaste por id; id alheio é recusado', async () => {
    const ak = await createItemViaApi(app, purchaseBody({ components: [{ kind: 'STICKER', catalogId: CAT.STICKER_CROWN, slot: 0 }] }));
    const sticker = await createItemViaApi(app, stickerBody());
    await apply(ak.id, sticker.id, { slot: 1 });
    const applied = (await itemOf(ak.id)).components.find((c) => c.origin === 'APPLIED_FROM_STOCK');
    const patch = (body) => request(app).patch(`/api/items/${ak.id}`).send(body);
    // trocar a lista dos que vieram junto não apaga o aplicado
    const swapped = await patch({ components: [{ kind: 'CHARM', catalogId: CAT.CHARM_LIL_AVA }] });
    expect(swapped.status).toBe(200);
    expect(swapped.body.data.components.map((c) => [c.kind, c.origin])).toEqual([['STICKER', 'APPLIED_FROM_STOCK'], ['CHARM', 'CAME_WITH']]);
    expect((await patch({ components: [] })).body.data.components.map((c) => c.origin)).toEqual(['APPLIED_FROM_STOCK']);
    // desgaste do aplicado muda pelo id
    const worn = await patch({ components: [{ id: applied.id, wear: 0.4, slot: 3 }] });
    expect(worn.body.data.components[0]).toMatchObject({ id: applied.id, wear: 0.4, slot: 3, origin: 'APPLIED_FROM_STOCK', sourceItemId: sticker.id });
    expectError(await patch({ components: [{ id: applied.id, pattern: 1 }] }), 400, 'INVALID_COMPONENT_FIELD');
    expectError(await patch({ components: [{ id: 99999, wear: 0.1 }] }), 400, 'INVALID_COMPONENT_FIELD', { field: 'components' });
    // os aplicados contam nos limites: 4 que vieram junto + 1 aplicado = 5; o 5.º que veio junto passa de 5
    const five = Array.from({ length: 5 }, () => ({ kind: 'STICKER', catalogId: CAT.STICKER_CROWN }));
    expectError(await patch({ components: five }), 400, 'COMPONENT_LIMIT_EXCEEDED');
    // trocar a categoria com aplicados
    expectError(await patch({ catalogId: CAT.KARAMBIT_FADE }), 400, 'COMPONENTS_NOT_ALLOWED');
  });

  test('mudar a aquisição para depois da operação é recusado; antes vale', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    await apply(ak.id, sticker.id);
    const patch = (body) => request(app).patch(`/api/items/${ak.id}`).send(body);
    expectError(await patch({ acquiredAt: '2026-11-16T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'ACQUIRED_AFTER_OPERATION', operationId: expect.any(Number), occurredAt: APPLIED_AT } });
    expect((await patch({ acquiredAt: '2026-11-09T12:00:00.000Z' })).status).toBe(200);
  });

  test('escritas exigem JSON e Host local', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    expectError(await request(app).post(`/api/items/${ak.id}/apply-component`).set('Content-Type', 'text/plain').send('x'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).post('/api/operations/1/undo').set('Content-Type', 'text/plain').send('x'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).post(`/api/items/${ak.id}/apply-component`).set('Host', 'evil.com').send({ sourceItemId: sticker.id }), 403, 'FORBIDDEN_HOST');
  });
});

describe('sem nenhuma operação os números são os de sempre', () => {
  test('lista, grupo, lucro real e preço mínimo seguem o custo de compra', async () => {
    const ak = await createItemViaApi(app);
    const view = await itemOf(ak.id);
    expect(view.cost).toEqual({ ownUsdCents: 100, inheritedUsdCents: 0, effectiveUsdCents: 100, estimated: false });
    expect(view.consumedIn).toBeNull();
    expect(view.canReceiveComponents).toBe(true);
    expect((await profit()).stockUsdCents).toBe(100);
    expect((await get('/api/items/groups')).body.data.groups[0]).toMatchObject({ totalCostUsdCents: 100 });
  });
});
