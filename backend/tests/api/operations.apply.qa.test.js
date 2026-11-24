// 10.3 (D362), QA: lacunas da cobertura inicial. Holding x à venda, números idênticos com compra em BRL, datas do alvo, desfazer em cadeia,
// itens CONSUMIDO fora do giro e das listas padrão, exclusão e `sort`.
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
  const name = 'Patch | Crazy Banana';
  CatalogItem.upsertMany([{
    id: 'patch-1', source: 'PATCHES', category: 'PATCH', name, nameKey: normalizeSearchText(name), searchText: normalizeSearchText(name),
    minFloat: null, maxFloat: null, hasStattrak: false, hasSouvenir: false,
  }]);
});
afterAll(() => closeDb());

const get = (url) => request(app).get(url);
const post = (url, body = {}) => request(app).post(url).send(body);
const stickerBody = (extra = {}) => purchaseBody({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 50, ...extra });
const apply = (targetId, sourceItemId, extra = {}) => post(`/api/items/${targetId}/apply-component`, { sourceItemId, appliedAt: APPLIED_AT, ...extra });
const profit = async () => (await get('/api/profit/summary')).body.data;
const itemOf = async (id) => (await get(`/api/items/${id}`)).body.data;
const breakdown = (p) => ({ forSale: p.stockBreakdown.forSale.usdCents, offSale: p.stockBreakdown.offSale.usdCents, total: p.stockUsdCents });

describe('estoque à venda x holding', () => {
  test('sticker à venda aplicado em arma no holding: o custo dele passa para o holding; a soma não muda; desfazer devolve', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    await post(`/api/items/${ak.id}/off-sale`); // alvo no holding
    const before = breakdown(await profit());
    expect(before).toMatchObject({ forSale: 50, offSale: 100, total: 150 });
    const opId = (await apply(ak.id, sticker.id)).body.data.operation.id;
    expect(breakdown(await profit())).toEqual({ forSale: 0, offSale: 150, total: 150 });
    expect((await itemOf(ak.id)).saleState).toBe('OFF_SALE'); // continua no holding e com o giro intacto
    await post(`/api/operations/${opId}/undo`);
    expect(breakdown(await profit())).toEqual(before);
  });

  test('sticker no holding aplicado em arma à venda: o custo dele passa para o estoque à venda', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    await post(`/api/items/${sticker.id}/off-sale`);
    const before = breakdown(await profit());
    expect(before).toMatchObject({ forSale: 100, offSale: 50, total: 150 });
    await apply(ak.id, sticker.id);
    expect(breakdown(await profit())).toEqual({ forSale: 150, offSale: 0, total: 150 });
    const counts = (await get("/api/items")).body.data.meta?.saleStateCounts;
    expect(counts).toEqual({ forSale: 1, offSale: 0 }); // a consumida não conta em nenhuma aba
  });

  test('trade lock do alvo continua: aplicar não altera tradeUnlockAt, acquiredAt nem o giro do alvo', async () => {
    const ak = await createItemViaApi(app, purchaseBody({ acquiredAt: '2026-10-01T12:00:00.000Z', tradeUnlockAt: '2026-11-25T12:00:00.000Z' }));
    const sticker = await createItemViaApi(app, stickerBody());
    const before = await itemOf(ak.id);
    const after = (await apply(ak.id, sticker.id)).body.data.item;
    expect(after.tradeUnlockAt).toBe(before.tradeUnlockAt);
    expect(after.acquiredAt).toBe(before.acquiredAt);
    expect(after.aging).toEqual(before.aging);
    expect(after.isInTradeLock ?? true).toBe(before.isInTradeLock ?? true);
  });
});

describe('números idênticos com compra em BRL', () => {
  test('lucro real, estoque e saldo de cada loja não mudam ao aplicar, remover para sempre e desfazer; centavos com arredondamento', async () => {
    await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 100000, depositedAt: '2026-11-01T12:00:00.000Z' });
    await post('/api/deposits', { storeId: storeId('Steam'), amountStoreCents: 50000, depositedAt: '2026-11-01T12:00:00.000Z' });
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 777, fxRateAtPurchase: 5.43 }));
    const snap = async () => {
      const p = await profit();
      return { stock: p.stockUsdCents, real: p.realProfitUsdCents, balances: p.balancesByStore.map((b) => [b.storeId, b.availableCents]), est: p.stockEstimated };
    };
    const before = await snap();
    const opId = (await apply(ak.id, sticker.id)).body.data.operation.id;
    expect(await snap()).toEqual(before);
    const comp = (await itemOf(ak.id)).components[0];
    // 777 / 5,43 = 143,09 -> 143 (ROUND); a parte entra uma vez só no custo efetivo
    expect((await itemOf(ak.id)).cost).toEqual({ ownUsdCents: 100, inheritedUsdCents: 143, effectiveUsdCents: 243, estimated: true });
    const scrape = await post(`/api/items/${ak.id}/components/${comp.id}/scrape-off`, { occurredAt: '2026-11-17T12:00:00.000Z' });
    expect(scrape.status).toBe(200);
    expect(await snap()).toEqual(before);
    await post(`/api/operations/${scrape.body.data.operation.id}/undo`);
    expect(await snap()).toEqual(before);
    expect((await post(`/api/operations/${opId}/undo`)).status).toBe(200);
    expect(await snap()).toEqual(before);
  });
});

describe('datas do alvo e da operação', () => {
  test('data antes da aquisição do ALVO é recusada (BEFORE_TARGET_ACQUIRED ou equivalente); igual à do alvo vale', async () => {
    const sticker = await createItemViaApi(app, stickerBody({ acquiredAt: '2026-11-01T12:00:00.000Z' }));
    const ak = await createItemViaApi(app, purchaseBody({ acquiredAt: '2026-11-12T12:00:00.000Z' }));
    const res = await apply(ak.id, sticker.id, { appliedAt: '2026-11-11T12:00:00.000Z' });
    expectError(res, 422, 'OPERATION_DATE_INVALID');
    expect((await itemOf(sticker.id)).status).toBe('EM_ESTOQUE');
    expect((await apply(ak.id, sticker.id, { appliedAt: '2026-11-12T12:00:00.000Z' })).status).toBe(201);
  });

  test('data futura no dia seguinte (São Paulo) é recusada; "agora" e o dia de hoje valem', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    expectError(await apply(ak.id, sticker.id, { appliedAt: '2026-11-20T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'FUTURE' } });
    expect((await apply(ak.id, sticker.id, { appliedAt: '2026-11-19T12:00:00.000Z' })).status).toBe(201);
  });

  test('sem appliedAt a data padrão é agora (relógio fixo) e a consumida marca consumedAt igual', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    const res = await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: sticker.id });
    expect(res.status).toBe(201);
    expect(res.body.data.operation.occurredAt).toBe('2026-11-19T15:00:00.000Z');
    expect((await itemOf(sticker.id)).consumedAt).toBe('2026-11-19T15:00:00.000Z');
  });
});

describe('desfazer em cadeia e remover para sempre', () => {
  test('desfazer o SCRAPE_OFF e depois a aplicação: nenhum componente sobra e a unidade volta', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    const applyOp = (await apply(ak.id, sticker.id)).body.data.operation.id;
    const comp = (await itemOf(ak.id)).components[0];
    const scrape = (await post(`/api/items/${ak.id}/components/${comp.id}/scrape-off`, { occurredAt: '2026-11-17T12:00:00.000Z' })).body.data.operation.id;
    expect((await itemOf(ak.id)).components).toEqual([]);
    expect((await post(`/api/operations/${scrape}/undo`)).status).toBe(200);
    expect((await itemOf(ak.id)).components).toHaveLength(1);
    expect((await post(`/api/operations/${applyOp}/undo`)).status).toBe(200);
    expect((await itemOf(ak.id)).components).toEqual([]);
    expect(await itemOf(sticker.id)).toMatchObject({ status: 'EM_ESTOQUE', consumedAt: null });
    expect((await itemOf(ak.id)).cost.effectiveUsdCents).toBe(100);
  });

  test('depois do SCRAPE_OFF o alvo tem operação ativa: excluir é recusado; depois de tudo desfeito, exclui', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    await apply(ak.id, sticker.id);
    const comp = (await itemOf(ak.id)).components[0];
    const scrape = (await post(`/api/items/${ak.id}/components/${comp.id}/scrape-off`, { occurredAt: '2026-11-17T12:00:00.000Z' })).body.data.operation.id;
    expectError(await request(app).delete(`/api/items/${ak.id}`), 409, 'ITEM_IN_OPERATION');
    await post(`/api/operations/${scrape}/undo`);
    const applyOp = (await get(`/api/items/${ak.id}/operations`)).body.data.find((o) => o.kind === 'APPLY_COMPONENT').id;
    await post(`/api/operations/${applyOp}/undo`);
    expect((await request(app).delete(`/api/items/${ak.id}`)).status).toBe(200);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM item_operations').get().n).toBe(0);
  });

  test('remover para sempre um patch aplicado em agente: custo fica, e a segunda remoção do mesmo componente é 404', async () => {
    const agent = await createItemViaApi(app, { catalogId: CAT.AGENT_DARRYL, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' });
    const patch = await createItemViaApi(app, purchaseBody({ catalogId: 'patch-1', purchasePriceCents: 200 }));
    await apply(agent.id, patch.id);
    const comp = (await itemOf(agent.id)).components[0];
    expect(comp).toMatchObject({ kind: 'PATCH', scrapeable: true });
    const res = await post(`/api/items/${agent.id}/components/${comp.id}/scrape-off`, { occurredAt: '2026-11-17T12:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.data.item.cost.effectiveUsdCents).toBe(200);
    expectError(await post(`/api/items/${agent.id}/components/${comp.id}/scrape-off`), 404, 'COMPONENT_NOT_FOUND');
  });

  test('limite de 3 patches: o 4.º é recusado, e depois de remover um para sempre ainda contam os demais (4.º continua recusado se os 3 restam)', async () => {
    const agent = await createItemViaApi(app, { catalogId: CAT.AGENT_DARRYL, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' });
    const patches = [];
    for (let i = 0; i < 4; i += 1) patches.push(await createItemViaApi(app, purchaseBody({ catalogId: 'patch-1', purchasePriceCents: 10 })));
    for (let i = 0; i < 3; i += 1) expect((await apply(agent.id, patches[i].id, { slot: i })).status).toBe(201);
    expectError(await apply(agent.id, patches[3].id), 400, 'COMPONENT_LIMIT_EXCEEDED');
    expect((await get(`/api/items/${agent.id}/apply-candidates`)).body.data.remaining).toMatchObject({ patches: 0 });
    expect((await itemOf(agent.id)).cost.effectiveUsdCents).toBe(30);
  });
});

describe('itens CONSUMIDO fora das listas padrão e do giro', () => {
  const OLD = '2026-01-01T12:00:00.000Z';

  test('consumida antiga não é parada: fora de stagnantOnly, de sortBy=age, das abas e do saleStateCounts; com status=CONSUMIDO os dias vão até o consumo', async () => {
    const ak = await createItemViaApi(app, purchaseBody({ acquiredAt: OLD }));
    const sticker = await createItemViaApi(app, stickerBody({ acquiredAt: OLD }));
    await apply(ak.id, sticker.id, { appliedAt: '2026-01-11T12:00:00.000Z' });
    const stag = (await get('/api/items?stagnantOnly=true')).body.data.items.map((i) => i.id);
    expect(stag).toEqual([ak.id]); // o alvo (parado) continua; a consumida nunca
    expect((await get('/api/items?sortBy=age&order=desc')).body.data.items.map((i) => i.id)).toEqual([ak.id]);
    expect((await get('/api/items?saleState=FOR_SALE')).body.data.items.map((i) => i.id)).toEqual([ak.id]);
    expect((await get('/api/items?saleState=OFF_SALE')).body.data.items).toEqual([]);
    expect((await get("/api/items")).body.data.meta?.saleStateCounts).toEqual({ forSale: 1, offSale: 0 });
    const consumed = (await get('/api/items?status=CONSUMIDO&stagnantOnly=true')).body.data.items;
    expect(consumed).toEqual([]); // nunca "agarrada"
    const only = (await get('/api/items?status=CONSUMIDO')).body.data.items;
    expect(only).toHaveLength(1);
    expect(only[0].aging).toMatchObject({ agingBucket: 'CONSUMIDO', daysForSale: null, daysInInventory: 10 });
    expect(only[0].isInTradeLock).toBeFalsy();
    expect(only[0].saleState).toBeNull();
    expectError(await get('/api/items?status=CONSUMIDO&saleState=FOR_SALE'), 400, 'INVALID_QUERY');
  });

  test('limite de giro personalizado não classifica a consumida; o alvo velho continua classificado', async () => {
    await request(app).put('/api/settings/thresholds').send({ fastTurnoverDays: 3, slowItemDays: 5 });
    const ak = await createItemViaApi(app, purchaseBody({ acquiredAt: OLD }));
    const sticker = await createItemViaApi(app, stickerBody({ acquiredAt: OLD }));
    await apply(ak.id, sticker.id, { appliedAt: '2026-11-18T12:00:00.000Z' });
    const consumed = (await get('/api/items?status=CONSUMIDO')).body.data.items[0];
    expect(consumed.aging.agingBucket).toBe('CONSUMIDO');
    expect((await get('/api/items?stagnantOnly=true')).body.data.items.map((i) => i.id)).toEqual([ak.id]);
  });

  test('/api/items/sales não lista a consumida e o resumo de vendas só soma a arma vendida', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    await apply(ak.id, sticker.id);
    expect((await get('/api/items/sales')).body.data.items).toEqual([]);
    await post(`/api/items/${ak.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 1000, soldAt: '2026-11-16T12:00:00.000Z' });
    const sales = (await get('/api/items/sales')).body.data;
    expect(sales.items.map((i) => i.id)).toEqual([ak.id]);
    expect(sales.summary.totalPurchaseCostUsdCents).toBe(150);
  });

  test('itemStats do sticker com outra unidade em estoque: a consumida sai de unitCount e do custo médio, entra em consumedCount', async () => {
    const ak = await createItemViaApi(app);
    const used = await createItemViaApi(app, stickerBody({ purchasePriceCents: 50 }));
    await createItemViaApi(app, stickerBody({ purchasePriceCents: 90 }));
    await apply(ak.id, used.id);
    const stats = (await get('/api/items/stats?name=Sticker%20%7C%20Titan%20%7C%20Katowice%202014&category=STICKER')).body.data;
    expect(stats).toMatchObject({ unitCount: 1, consumedCount: 1, avgPurchaseCostUsdCents: 90 });
  });
});

describe('proteções extras', () => {
  test('alvo vendido: remover para sempre, aplicar e editar componentes aplicados recusados; PATCH de campos comuns segue permitido', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    await apply(ak.id, sticker.id);
    await post(`/api/items/${ak.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 500, soldAt: '2026-11-16T12:00:00.000Z' });
    const comp = (await itemOf(ak.id)).components[0];
    expectError(await post(`/api/items/${ak.id}/components/${comp.id}/scrape-off`), 409, 'ITEM_NOT_IN_STOCK');
    expectError(await request(app).delete(`/api/items/${ak.id}`), 409, 'ITEM_IN_OPERATION');
  });

  test('uma consumida não pode ser alvo nem origem de nova aplicação; sua lista de candidatas e histórico respondem', async () => {
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    await apply(ak.id, sticker.id);
    const ak2 = await createItemViaApi(app);
    expectError(await apply(sticker.id, ak2.id), 409, 'ITEM_CONSUMED');
    const cand = await get(`/api/items/${sticker.id}/apply-candidates`);
    expect(cand.status).toBe(200);
    expect(cand.body.data.candidates).toEqual([]);
    const hist = (await get(`/api/items/${sticker.id}/operations`)).body.data;
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ kind: 'APPLY_COMPONENT', role: 'CONSUMED', undoable: true });
  });

  test('id inválido na rota de operações e corpo com campos desconhecidos', async () => {
    expectError(await post('/api/operations/abc/undo'), 400, 'INVALID_ID');
    expectError(await get('/api/items/abc/operations'), 400, 'INVALID_ID');
    const ak = await createItemViaApi(app);
    const sticker = await createItemViaApi(app, stickerBody());
    expectError(await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: sticker.id, foo: 1 }), 400, 'UNKNOWN_FIELD');
    expect((await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: 'x' })).status).toBe(400);
  });
});
