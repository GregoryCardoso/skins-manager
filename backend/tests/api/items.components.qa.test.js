// 10.1 (D343, D344, D345, D353, D355a, D359, D360): QA dos componentes aplicados. Mistura de limites, categorias, transação,
// neutralidade (custo, giro, itemStats, lucro, saldo), visão agrupada, segurança (Content-Type e Host).
const request = require('supertest');
const { freshDb } = require('../helpers/fixtures');
const { getDb, closeDb } = require('../../src/config/database');
const ItemComponent = require('../../src/models/ItemComponent');
const { CAT, NOW, makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/items').send(body);
const patch = (id, body) => request(app).patch(`/api/items/${id}`).send(body);
const get = (path) => request(app).get(path);
const sticker = (slot, catalogId = CAT.STICKER_TITAN, extra = {}) => ({ kind: 'STICKER', catalogId, slot, ...extra });
const stickers = (n) => Array.from({ length: n }, (_, i) => sticker(i));
const charm = { kind: 'CHARM', catalogId: CAT.CHARM_LIL_AVA, pattern: 42 };
const slab = { kind: 'STICKER_SLAB', catalogId: CAT.STICKER_CROWN, pattern: 7 };
const rowCount = () => getDb().prepare('SELECT COUNT(*) n FROM item_components').get().n;
const sell = (id) => request(app).post(`/api/items/${id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 200, soldAt: '2026-11-18T12:00:00.000Z' });

describe('limites e slots', () => {
  test('5 stickers + 1 chaveiro e 5 stickers + 1 slab valem', async () => {
    const a = await post(purchaseBody({ components: [...stickers(5), charm] }));
    expect(a.status).toBe(201);
    expect(a.body.data.componentSummary).toEqual({ stickers: 5, charms: 1 });
    const b = await post(purchaseBody({ components: [...stickers(5), slab] }));
    expect(b.status).toBe(201);
    expect(b.body.data.components.map((c) => c.kind)).toEqual(['STICKER', 'STICKER', 'STICKER', 'STICKER', 'STICKER', 'STICKER_SLAB']);
  });

  test('5 stickers + 2 pendurados e 6 stickers: COMPONENT_LIMIT_EXCEEDED e nada gravado', async () => {
    expectError(await post(purchaseBody({ components: [...stickers(5), charm, slab] })), 400, 'COMPONENT_LIMIT_EXCEEDED');
    expectError(await post(purchaseBody({ components: [...stickers(5), charm, charm] })), 400, 'COMPONENT_LIMIT_EXCEEDED');
    expectError(await post(purchaseBody({ components: stickers(6) })), 400, 'COMPONENT_LIMIT_EXCEEDED');
    expect(rowCount()).toBe(0);
    expect((await get('/api/items')).body.data.items).toHaveLength(0);
  });

  test('slot repetido vale (D361): entre tipos diferentes e entre stickers, e os dois são gravados', async () => {
    const ok = await post(purchaseBody({ components: [sticker(0), { ...charm, slot: 0 }] }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.components.map((c) => [c.kind, c.slot])).toEqual([['STICKER', 0], ['CHARM', 0]]);
    const twice = await post(purchaseBody({ components: [sticker(3), sticker(3, CAT.STICKER_CROWN)] }));
    expect(twice.status).toBe(201);
    expect(twice.body.data.components.map((c) => [c.catalogId, c.slot])).toEqual([[CAT.STICKER_TITAN, 3], [CAT.STICKER_CROWN, 3]]);
  });

  test('slot fora da faixa: sticker 5 e pendurado 1 são INVALID_COMPONENT_FIELD; slot nulo repete livre', async () => {
    expectError(await post(purchaseBody({ components: [sticker(5)] })), 400, 'INVALID_COMPONENT_FIELD', { field: 'components', params: { index: 0, field: 'slot', max: 4 } });
    expectError(await post(purchaseBody({ components: [{ ...charm, slot: 1 }] })), 400, 'INVALID_COMPONENT_FIELD');
    expectError(await post(purchaseBody({ components: [sticker(-1)] })), 400, 'INVALID_COMPONENT_FIELD');
    expectError(await post(purchaseBody({ components: [sticker(1.5)] })), 400, 'INVALID_COMPONENT_FIELD');
    const ok = await post(purchaseBody({ components: [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN }, { kind: 'STICKER', catalogId: CAT.STICKER_TITAN }] }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.components.map((c) => c.slot)).toEqual([null, null]);
  });

  test('wear nos limites: 0 e 0.9999 valem; 1, negativo e NaN-like são recusados; pattern 0 e 999999 valem', async () => {
    const ok = await post(purchaseBody({ components: [sticker(0, CAT.STICKER_TITAN, { wear: 0 }), sticker(1, CAT.STICKER_TITAN, { wear: 0.9999 }), { ...charm, pattern: 0 }] }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.components.map((c) => c.wear ?? c.pattern)).toEqual([0, 0.9999, 0]);
    expectError(await post(purchaseBody({ components: [sticker(0, CAT.STICKER_TITAN, { wear: 1 })] })), 400, 'INVALID_COMPONENT_FIELD');
    expectError(await post(purchaseBody({ components: [sticker(0, CAT.STICKER_TITAN, { wear: -0.1 })] })), 400, 'INVALID_COMPONENT_FIELD');
    expect((await post(purchaseBody({ components: [{ ...charm, pattern: 999999 }] }))).status).toBe(201);
    expectError(await post(purchaseBody({ components: [{ ...charm, pattern: 1000000 }] })), 400, 'INVALID_COMPONENT_FIELD');
    expectError(await post(purchaseBody({ components: [{ ...charm, pattern: 1.5 }] })), 400, 'INVALID_COMPONENT_FIELD');
    expectError(await post(purchaseBody({ components: [{ ...slab, wear: 0.1 }] })), 400, 'INVALID_COMPONENT_FIELD');
  });

  test('kind inválido ou ausente é INVALID_COMPONENT_FIELD com params.index', async () => {
    expectError(await post(purchaseBody({ components: [{ kind: 'AGENT', catalogId: CAT.STICKER_TITAN }] })), 400, 'INVALID_COMPONENT_FIELD', { params: { index: 0, field: 'kind' } });
    expectError(await post(purchaseBody({ components: [{ catalogId: CAT.STICKER_TITAN }] })), 400, 'INVALID_COMPONENT_FIELD');
  });
});

describe('catálogo do componente', () => {
  test('slab aponta para um sticker do catálogo e o chaveiro para um PINGENTE; o nome do slab é derivado', async () => {
    const res = await post(purchaseBody({ components: [charm, ...[]] }));
    expect(res.body.data.components[0]).toMatchObject({ catalogId: CAT.CHARM_LIL_AVA, name: "Charm | Lil' Ava", namePtBr: "Pingente | Lil' Ava" });
    const res2 = await post(purchaseBody({ components: [slab] }));
    expect(res2.status).toBe(201);
    expect(res2.body.data.components[0].catalogId).toBe(CAT.STICKER_CROWN);
    expect(res2.body.data.components[0].name).toMatch(/^Sticker Slab \| /);
    expect(res2.body.data.components[0].imageUrl).toBeTruthy();
  });

  test('chaveiro apontando para sticker e slab apontando para PINGENTE ou skin: COMPONENT_CATALOG_MISMATCH', async () => {
    expectError(await post(purchaseBody({ components: [{ kind: 'CHARM', catalogId: CAT.STICKER_TITAN }] })), 400, 'COMPONENT_CATALOG_MISMATCH');
    expectError(await post(purchaseBody({ components: [{ kind: 'STICKER_SLAB', catalogId: CAT.CHARM_LIL_AVA }] })), 400, 'COMPONENT_CATALOG_MISMATCH');
    expectError(await post(purchaseBody({ components: [{ kind: 'STICKER', catalogId: CAT.CHARM_LIL_AVA }] })), 400, 'COMPONENT_CATALOG_MISMATCH');
    expectError(await post(purchaseBody({ components: [{ kind: 'CHARM', catalogId: CAT.AK_REDLINE }] })), 400, 'COMPONENT_CATALOG_MISMATCH');
  });

  test('catalogId inexistente ou nulo: COMPONENT_CATALOG_REQUIRED; formato inválido: INVALID_COMPONENT_FIELD', async () => {
    expectError(await post(purchaseBody({ components: [{ kind: 'STICKER', catalogId: 'nao-existe' }] })), 400, 'COMPONENT_CATALOG_REQUIRED');
    expectError(await post(purchaseBody({ components: [{ kind: 'STICKER', catalogId: null }] })), 400, 'COMPONENT_CATALOG_REQUIRED');
    const empty = await post(purchaseBody({ components: [{ kind: 'STICKER', catalogId: '' }] })); // '' hoje cai no validador de formato
    expect(empty.status).toBe(400);
    expect(['COMPONENT_CATALOG_REQUIRED', 'INVALID_COMPONENT_FIELD']).toContain(empty.body.error.code);
    expectError(await post(purchaseBody({ components: [{ kind: 'STICKER', catalogId: 'a b/../c' }] })), 400, 'INVALID_COMPONENT_FIELD');
  });
});

describe('categorias do item', () => {
  test('PATCH de componentes em SKIN funciona (adiciona, troca, limpa)', async () => {
    const item = await createItemViaApi(app);
    const added = await patch(item.id, { components: [sticker(0), charm] });
    expect(added.status).toBe(200);
    expect(added.body.data.componentSummary).toEqual({ stickers: 1, charms: 1 });
    expect((await patch(item.id, { components: [sticker(2, CAT.STICKER_CROWN)] })).body.data.components.map((c) => c.slot)).toEqual([2]);
  });

  test('PERSONAGEM: sticker e chaveiro recusados; patch com item de outra categoria do catálogo recusado (MISMATCH); [] vale', async () => {
    const agent = await createItemViaApi(app, { catalogId: CAT.AGENT_DARRYL, acquisitionType: 'GANHEI' });
    expectError(await patch(agent.id, { components: [sticker(0)] }), 400, 'COMPONENTS_NOT_ALLOWED');
    expectError(await patch(agent.id, { components: [charm] }), 400, 'COMPONENTS_NOT_ALLOWED');
    expectError(await patch(agent.id, { components: [{ kind: 'PATCH', catalogId: CAT.AGENT_DARRYL }] }), 400, 'COMPONENT_CATALOG_MISMATCH');
    expectError(await patch(agent.id, { components: [{ kind: 'PATCH' }] }), 400, 'COMPONENT_CATALOG_REQUIRED');
    const ok = await patch(agent.id, { components: [] });
    expect(ok.status).toBe(200);
    expect(rowCount()).toBe(0);
  });

  test('FACA, LUVA, CAIXA, CAPSULA, STICKER e PINGENTE recusam sticker/chaveiro/slab; PATCH em SKIN também', async () => {
    const targets = [CAT.KARAMBIT_FADE, CAT.SPORT_GLOVES_PANDORA, CAT.CASE_REVOLVER, CAT.CAPSULE_KATO14, CAT.STICKER_TITAN, CAT.CHARM_LIL_AVA];
    for (const catalogId of targets) {
      for (const component of [sticker(0), charm, slab]) {
        expectError(await post({ catalogId, acquisitionType: 'GANHEI', components: [component] }), 400, 'COMPONENTS_NOT_ALLOWED');
      }
    }
    expectError(await post(purchaseBody({ components: [{ kind: 'PATCH', catalogId: CAT.AGENT_DARRYL }] })), 400, 'COMPONENTS_NOT_ALLOWED');
    expect(rowCount()).toBe(0);
  });

  test('FACA/LUVA com components: [] é aceito e não grava nada', async () => {
    const res = await post({ catalogId: CAT.KARAMBIT_FADE, acquisitionType: 'GANHEI', components: [] });
    expect(res.status).toBe(201);
    expect(res.body.data.components).toEqual([]);
  });

  test('troca de categoria: com componentes e sem components é recusada; com components: [] limpa; PATCH sem catálogo novo também preserva', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: [sticker(0), charm] }));
    expectError(await patch(item.id, { catalogId: CAT.SPORT_GLOVES_PANDORA }), 400, 'COMPONENTS_NOT_ALLOWED');
    expect((await get(`/api/items/${item.id}`)).body.data).toMatchObject({ catalogId: CAT.AK_REDLINE });
    expect(rowCount()).toBe(2);
    // trocar a categoria e mandar uma lista que a nova categoria não aceita também é recusado
    expectError(await patch(item.id, { catalogId: CAT.KARAMBIT_FADE, components: [sticker(0)] }), 400, 'COMPONENTS_NOT_ALLOWED');
    expect(rowCount()).toBe(2);
    const ok = await patch(item.id, { catalogId: CAT.SPORT_GLOVES_PANDORA, components: [] });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ category: 'LUVA', components: [], componentSummary: { stickers: 0, charms: 0 } });
    expect(rowCount()).toBe(0);
  });

  test('trocar skin por skin (outra arma) sem components preserva a lista', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: [sticker(0), charm] }));
    const res = await patch(item.id, { catalogId: CAT.AWP_DLORE });
    expect(res.status).toBe(200);
    expect(res.body.data.components).toHaveLength(2);
  });
});

describe('PATCH sem components preserva; erro em um componente não grava nada', () => {
  test('PATCH de outros campos (custo, origem, datas) preserva ids, ordem e conteúdo da lista', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: [sticker(0, CAT.STICKER_TITAN, { wear: 0.2 }), sticker(1, CAT.STICKER_CROWN), charm] }));
    const res = await patch(item.id, { purchasePriceCents: 777, originDetail: 'novo' });
    expect(res.status).toBe(200);
    expect(res.body.data.components).toEqual(item.components);
    expect(res.body.data.purchasePriceCents).toBe(777);
  });

  test('componente inválido no PATCH: item e lista antiga intactos (nenhum campo do item muda)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: [sticker(0), charm] }));
    const res = await patch(item.id, { purchasePriceCents: 999, originDetail: 'mudou', components: [sticker(0), { kind: 'STICKER', catalogId: CAT.AK_REDLINE, slot: 1 }] });
    expectError(res, 400, 'COMPONENT_CATALOG_MISMATCH', { params: { index: 1, kind: 'STICKER' } });
    const after = (await get(`/api/items/${item.id}`)).body.data;
    expect(after.purchasePriceCents).toBe(item.purchasePriceCents);
    expect(after.originDetail).toBe(item.originDetail);
    expect(after.updatedAt).toBe(item.updatedAt);
    expect(after.components).toEqual(item.components);
  });

  test('falha ao gravar a lista no PATCH (erro de banco): rollback, o item não é alterado e a lista antiga fica', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: [sticker(0), charm] }));
    jest.spyOn(ItemComponent, 'replaceCameWithForItem').mockImplementation((id) => {
      getDb().prepare('DELETE FROM item_components WHERE item_id = ?').run(id); // metade do trabalho feita antes de falhar
      throw new Error('falha simulada');
    });
    const res = await patch(item.id, { purchasePriceCents: 4321, components: [sticker(3)] });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    jest.restoreAllMocks();
    const after = (await get(`/api/items/${item.id}`)).body.data;
    expect(after.purchasePriceCents).toBe(item.purchasePriceCents);
    expect(after.components).toEqual(item.components);
  });

  test('falha ao gravar a lista no POST: o item não é criado', async () => {
    jest.spyOn(ItemComponent, 'insertMany').mockImplementation(() => { throw new Error('falha simulada'); });
    const res = await post(purchaseBody({ components: [sticker(0)] }));
    expect(res.status).toBe(500);
    jest.restoreAllMocks();
    expect((await get('/api/items')).body.data.items).toHaveLength(0);
  });

  test('POST sem components não chama o model de componentes para gravar', async () => {
    const spy = jest.spyOn(ItemComponent, 'insertMany');
    expect((await post(purchaseBody())).status).toBe(201);
    expect((await post(purchaseBody({ components: [] }))).status).toBe(201);
    expect(spy).not.toHaveBeenCalled();
  });

  test('o erro de validação do item vem antes do erro de componentes quando os dois existem (ordem documentada)', async () => {
    const res = await post(purchaseBody({ purchasePriceCents: -5, components: [{ kind: 'STICKER' }] }));
    expectError(res, 400, 'INVALID_AMOUNT');
  });
});

describe('ciclo de vida e visões', () => {
  test('vender e desfazer a venda preservam a lista (mesmos ids); item vendido aparece com componentes nas vendas', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: [sticker(0), charm] }));
    const sold = (await sell(item.id)).body.data.item;
    expect(sold.components).toEqual(item.components);
    const sales = (await get('/api/items/sales')).body.data.items;
    expect(sales[0].components).toEqual(item.components);
    const back = (await request(app).post(`/api/items/${item.id}/unsell`).send({})).body.data;
    expect(back.components).toEqual(item.components);
    expect(rowCount()).toBe(2);
  });

  test('PATCH de componentes num item vendido é aceito e a venda não muda', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: [sticker(0)] }));
    const sold = (await sell(item.id)).body.data.item;
    const res = await patch(item.id, { components: [] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'VENDIDO', netReceivedCents: sold.netReceivedCents, salePriceCents: sold.salePriceCents, components: [] });
  });

  test('tirar da venda e voltar para a venda preservam a lista', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: [sticker(0), slab] }));
    const off = (await request(app).post(`/api/items/${item.id}/off-sale`).send({})).body.data.item;
    expect(off.components).toEqual(item.components);
    const on = (await request(app).post(`/api/items/${item.id}/for-sale`).send({})).body.data.item;
    expect(on.components).toEqual(item.components);
  });

  test('exclusão em cascata: só os componentes do item excluído somem; os dos outros ficam', async () => {
    const a = await createItemViaApi(app, purchaseBody({ components: [sticker(0), charm] }));
    const b = await createItemViaApi(app, purchaseBody({ components: [sticker(0)] }));
    expect((await request(app).delete(`/api/items/${a.id}`)).status).toBe(200);
    expect(rowCount()).toBe(1);
    expect((await get(`/api/items/${b.id}`)).body.data.components).toHaveLength(1);
  });

  test('o componentUnits do agrupado conta unidades em estoque (à venda, fora de venda) e não conta vendidas nem as sem componentes', async () => {
    const forSale = await createItemViaApi(app, purchaseBody({ components: [sticker(0)] }));
    const offSale = await createItemViaApi(app, purchaseBody({ components: [charm] }));
    const soldOne = await createItemViaApi(app, purchaseBody({ components: [sticker(1)] }));
    await createItemViaApi(app);
    await request(app).post(`/api/items/${offSale.id}/off-sale`).send({});
    await sell(soldOne.id);
    const all = (await get('/api/items/groups')).body.data.groups;
    expect(all).toHaveLength(1);
    expect(all[0].componentUnits).toBe(2);
    // a aba (saleState) mostra só parte das unidades, mas componentUnits continua sendo do estoque inteiro do grupo
    const offTab = (await get('/api/items/groups?saleState=OFF_SALE')).body.data.groups;
    expect(offTab[0].units).toHaveLength(1);
    expect(offTab[0].componentUnits).toBe(2);
    const forTab = (await get('/api/items/groups?saleState=FOR_SALE')).body.data.groups;
    expect(forTab[0].componentUnits).toBe(2);
    expect(forTab[0].units.find((u) => u.id === forSale.id).components).toHaveLength(1);
  });

  test('grupo sem nenhuma unidade com componentes: componentUnits 0', async () => {
    await createItemViaApi(app);
    expect((await get('/api/items/groups')).body.data.groups[0].componentUnits).toBe(0);
  });

  test('a chave do agrupamento não muda: com e sem componentes caem no mesmo grupo e mesmo groupKey', async () => {
    const a = await createItemViaApi(app);
    const b = await createItemViaApi(app, purchaseBody({ components: [...stickers(4), charm] }));
    const groups = (await get('/api/items/groups')).body.data.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].units.map((u) => u.id).sort()).toEqual([a.id, b.id].sort());
    const before = groups[0].groupKey ?? groups[0].key;
    await patch(b.id, { components: [] });
    const again = (await get('/api/items/groups')).body.data.groups[0];
    expect(again.groupKey ?? again.key).toBe(before);
  });
});

describe('componentes não alteram custo, giro, preço mínimo, itemStats, lucro nem saldo', () => {
  const tradeLocked = (extra = {}) => purchaseBody({ tradeUnlockAt: new Date(NOW.getTime() + 3 * 86400000).toISOString(), ...extra });

  test('item com e sem componentes: mesma visão em tudo, menos os campos de componentes', async () => {
    const plain = await createItemViaApi(app, tradeLocked());
    const rich = await createItemViaApi(app, tradeLocked({ components: [...stickers(5), charm] }));
    const strip = ({ id, createdAt, updatedAt, components, componentSummary, ...rest }) => rest; // eslint-disable-line no-unused-vars
    expect({ ...strip(rich), stats: null }).toEqual({ ...strip(plain), stats: null }); // stats: unitCount depende de quando foi criado
    const list = (await get('/api/items')).body.data.items;
    const [a, b] = [list.find((i) => i.id === plain.id), list.find((i) => i.id === rich.id)];
    expect(strip(b)).toEqual(strip(a));
  });

  test('o histórico (itemStats), as vendas e o resumo de vendas não mudam ao adicionar componentes', async () => {
    const a = await createItemViaApi(app);
    const b = await createItemViaApi(app);
    await sell(a.id);
    await sell(b.id);
    const stats = async () => (await get(`/api/items/${a.id}/stats`)).body.data;
    const sales = async () => (await get('/api/items/sales')).body.data.summary;
    const [s1, m1] = [await stats(), await sales()];
    await patch(a.id, { components: [...stickers(3), charm] }).then((r) => expect(r.status).toBe(200));
    await patch(b.id, { components: [slab] });
    expect(await stats()).toEqual(s1);
    expect(await sales()).toEqual(m1);
  });

  test('lucro real e saldo das lojas ficam idênticos ao criar, editar e limpar componentes', async () => {
    const item = await createItemViaApi(app);
    await createItemViaApi(app, purchaseBody({ purchasePriceCents: 500 }));
    await sell(item.id);
    const snapshot = async () => ({
      profit: (await get('/api/profit/summary')).body.data,
      balances: (await get('/api/store-balances/current')).body.data,
    });
    const before = await snapshot();
    const rich = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 500, components: [...stickers(2), charm] }));
    await request(app).delete(`/api/items/${rich.id}`); // mesmo custo que o item sem componentes já contado
    const afterDelete = await snapshot();
    expect(afterDelete).toEqual(before);
    const other = (await get('/api/items')).body.data.items.find((i) => i.status === 'EM_ESTOQUE');
    await patch(other.id, { components: [...stickers(5), charm] });
    expect(await snapshot()).toEqual(before);
    await patch(other.id, { components: [] });
    expect(await snapshot()).toEqual(before);
  });

  test('stagnantOnly, sortBy e filtros continuam funcionando com itens que têm componentes', async () => {
    await createItemViaApi(app, purchaseBody({ acquiredAt: '2026-09-01T00:00:00.000Z', components: [sticker(0)] }));
    await createItemViaApi(app, purchaseBody({ acquiredAt: '2026-11-18T00:00:00.000Z', components: [charm] }));
    const stagnant = (await get('/api/items?stagnantOnly=true')).body.data.items;
    expect(stagnant).toHaveLength(1);
    expect(stagnant[0].components[0].kind).toBe('STICKER');
    const sorted = (await get('/api/items?sortBy=age&order=desc')).body.data.items;
    expect(sorted).toHaveLength(2);
  });
});

describe('segurança das rotas alteradas', () => {
  test('POST e PATCH com components sem Content-Type JSON: 415 e nada gravado', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: [sticker(0)] }));
    const body = JSON.stringify({ ...purchaseBody(), components: [sticker(1)] });
    expectError(await request(app).post('/api/items').set('Content-Type', 'text/plain').send(body), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).patch(`/api/items/${item.id}`).set('Content-Type', 'text/plain').send(JSON.stringify({ components: [] })), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expectError(await request(app).patch(`/api/items/${item.id}`).send('components=[]'), 415, 'UNSUPPORTED_MEDIA_TYPE');
    expect(rowCount()).toBe(1);
    expect((await get('/api/items')).body.data.items).toHaveLength(1);
  });

  test('Host estranho: 403 FORBIDDEN_HOST em POST, PATCH e GET; nada gravado', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: [sticker(0)] }));
    const evil = (req) => req.set('Host', 'evil.com');
    expectError(await evil(request(app).post('/api/items')).send(purchaseBody({ components: [sticker(0)] })), 403, 'FORBIDDEN_HOST');
    expectError(await evil(request(app).patch(`/api/items/${item.id}`)).send({ components: [] }), 403, 'FORBIDDEN_HOST');
    expectError(await evil(request(app).get('/api/items/groups')), 403, 'FORBIDDEN_HOST');
    expect(rowCount()).toBe(1);
  });

  test('corpo com components e um campo desconhecido no nível do item: UNKNOWN_FIELD; campos de componente estranhos (price, id, origin, source) são recusados', async () => {
    expectError(await post(purchaseBody({ components: [sticker(0)], foo: 1 })), 400, 'UNKNOWN_FIELD');
    for (const extra of [{ id: 9 }, { origin: 'APPLIED_FROM_STOCK' }, { source: 'CSFLOAT' }, { sourceItemId: 3 }, { operationId: 1 }, { purchaseReferenceCents: 1 }]) {
      expectError(await post(purchaseBody({ components: [{ ...sticker(0), ...extra }] })), 400, 'UNKNOWN_FIELD');
    }
    expect(rowCount()).toBe(0);
  });

  test('os componentes criados pela API sempre saem como MANUAL e CAME_WITH', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: [sticker(0), charm] }));
    expect(item.components.every((c) => c.source === 'MANUAL' && c.origin === 'CAME_WITH')).toBe(true);
    const raw = getDb().prepare('SELECT source, origin, source_item_id, operation_id, purchase_reference_cents FROM item_components').all();
    expect(raw.every((r) => r.source === 'MANUAL' && r.origin === 'CAME_WITH' && r.source_item_id === null && r.operation_id === null && r.purchase_reference_cents === null)).toBe(true);
  });

  test('a resposta de componentes não vaza campos internos (item_id, timestamps, referência de compra)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ components: [sticker(0)] }));
    expect(Object.keys(item.components[0]).sort()).toEqual(
      ['catalogId', 'id', 'imageUrl', 'kind', 'name', 'namePtBr', 'operationId', 'origin', 'pattern', 'scrapeable', 'slot', 'source', 'sourceItemId', 'undoable', 'wear'].sort()
    );
  });
});
