'use strict';

// catalogId, nome canônico, categoria derivada, faixa de float e itens legados (D78, D82, D84).
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Item = require('../../src/models/Item');
const { freshDb } = require('../helpers/fixtures');
const { CAT, makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/items').send(body);
const patch = (id, body) => request(app).patch(`/api/items/${id}`).send(body);
const get = async (id) => (await request(app).get(`/api/items/${id}`)).body.data;
const won = (o = {}) => ({ acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z', ...o });
const free = (o = {}) => won({ category: 'OUTRO', name: 'Item livre', ...o });

// Item legado: gravado direto pelo model, sem catalogId, numa categoria que exige catálogo.
function legacyItem(overrides = {}) {
  return Item.create({
    name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'),
    purchasePriceCents: 100, purchaseCurrency: 'USD', acquiredAt: '2026-11-10T12:00:00.000Z', ...overrides,
  });
}

describe('POST com catalogId', () => {
  test('nome canônico, categoria e catalog vêm do catálogo; isLegacy false', async () => {
    const res = await post(purchaseBody());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      catalogId: CAT.AK_REDLINE, name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', phase: null, isLegacy: false,
      catalog: {
        id: CAT.AK_REDLINE, name: 'AK-47 | Redline', namePtBr: 'AK-47 | Linha Vermelha', minFloat: 0.1, maxFloat: 0.7,
        hasStattrak: true, hasSouvenir: false, phase: null, imageUrl: 'https://img.test/skin-ak-redline.png',
      },
    });
  });

  test('a fase do catálogo é derivada; GET e listagem devolvem o mesmo catalog', async () => {
    const item = await createItemViaApi(app, purchaseBody({ catalogId: CAT.KARAMBIT_DOPPLER_P2, variant: 'STATTRAK' }));
    expect(item).toMatchObject({ name: '★ Karambit | Doppler', category: 'FACA', phase: 'Phase 2', catalog: { phase: 'Phase 2' } });
    expect((await get(item.id)).catalog).toEqual(item.catalog);
    const list = (await request(app).get('/api/items')).body.data.items;
    expect(list[0].catalog).toEqual(item.catalog);
    expect(Object.keys(item.catalog).sort()).toEqual(
      ['hasSouvenir', 'hasStattrak', 'id', 'imageUrl', 'maxFloat', 'minFloat', 'name', 'namePtBr', 'phase']
    );
  });

  test.each([
    ['name', { name: 'Outro nome' }],
    ['name null', { name: null }],
    ['category', { category: 'SKIN' }],
    ['category null', { category: null }],
  ])('catalogId + %s -> CATALOG_DERIVED_FIELD', async (_label, extra) => {
    expectError(await post(purchaseBody(extra)), 400, 'CATALOG_DERIVED_FIELD');
  });

  test('phase com entrada que tem fase -> CATALOG_DERIVED_FIELD; com entrada sem fase -> aceito', async () => {
    expectError(await post(purchaseBody({ catalogId: CAT.KARAMBIT_DOPPLER_P1, phase: 'Phase 1' })), 400, 'CATALOG_DERIVED_FIELD');
    const res = await post(purchaseBody({ catalogId: CAT.KARAMBIT_FADE, phase: 'Fade 90%' }));
    expect(res.status).toBe(201);
    expect(res.body.data.phase).toBe('Fade 90%');
  });

  test('catalogId inexistente -> CATALOG_ITEM_NOT_FOUND (400)', async () => {
    expectError(await post(purchaseBody({ catalogId: 'nao-existe' })), 400, 'CATALOG_ITEM_NOT_FOUND');
  });

  test('categoria de catálogo sem catalogId -> CATALOG_ITEM_REQUIRED', async () => {
    const res = await post(purchaseBody({ catalogId: undefined, name: 'AK-47 | Redline', category: 'SKIN' }));
    expectError(res, 400, 'CATALOG_ITEM_REQUIRED');
    expect(res.body.error.message).toBe('Escolha o item no catálogo.');
    expectError(await post(purchaseBody({ catalogId: null, name: 'Caixa', category: 'CAIXA' })), 400, 'CATALOG_ITEM_REQUIRED');
  });

  test('OUTRO e PASSE_BATALHA com nome livre -> 201; OUTRO sem nome -> REQUIRED_FIELD', async () => {
    const outro = await post(free());
    expect(outro.status).toBe(201);
    expect(outro.body.data).toMatchObject({ catalogId: null, name: 'Item livre', category: 'OUTRO', isLegacy: false, catalog: null });
    const passe = await post(free({ category: 'PASSE_BATALHA', name: 'Passe de Batalha Inexistente' }));
    expect(passe.status).toBe(201);
    expect(passe.body.data.isLegacy).toBe(false);
    expectError(await post(free({ name: undefined })), 400, 'REQUIRED_FIELD');
    expectError(await post(free({ name: '   ' })), 400, 'REQUIRED_FIELD');
  });

  test('PASSE_BATALHA livre com nome igual a uma entrada PASSE_BATALHA do catálogo -> CATALOG_ITEM_REQUIRED', async () => {
    const res = await post(free({ category: 'PASSE_BATALHA', name: '  operation RIPTIDE access pass ' }));
    expectError(res, 400, 'CATALOG_ITEM_REQUIRED');
    expect(res.body.error.message).toBe('Este item existe no catálogo: selecione-o na busca.');
    // OUTRO com nome igual não tem essa checagem
    expect((await post(free({ category: 'OUTRO', name: 'Operation Riptide Access Pass' }))).status).toBe(201);
    // e a entrada PASSE_BATALHA do catálogo pode ser usada pelo catalogId
    const viaCatalog = await post(won({ catalogId: CAT.BATTLE_PASS_RIPTIDE }));
    expect(viaCatalog.status).toBe(201);
    expect(viaCatalog.body.data).toMatchObject({ category: 'PASSE_BATALHA', name: 'Operation Riptide Access Pass' });
  });

  test('crate de outro tipo do catálogo vira OUTRO sem atributos de arma', async () => {
    const res = await post(won({ catalogId: CAT.MUSIC_KIT_BOX }));
    expect(res.body.data).toMatchObject({ category: 'OUTRO', name: 'Music Kit Box', variant: null });
  });

  describe('forma do catalogId', () => {
    test.each([[5, 'INVALID_FIELD'], ['', 'INVALID_FIELD'], ['a/b', 'INVALID_FIELD'], ['a b', 'INVALID_FIELD'], [true, 'INVALID_FIELD']])(
      '%p -> %s',
      async (catalogId, code) => {
        expectError(await post(purchaseBody({ catalogId })), 400, code);
        expectError(await patch((await createItemViaApi(app)).id, { catalogId }), 400, code);
      }
    );

    test('101 caracteres -> FIELD_TOO_LONG; 100 caracteres passa na forma (e cai em NOT_FOUND)', async () => {
      expectError(await post(purchaseBody({ catalogId: 'a'.repeat(101) })), 400, 'FIELD_TOO_LONG');
      expectError(await post(purchaseBody({ catalogId: 'a'.repeat(100) })), 400, 'CATALOG_ITEM_NOT_FOUND');
    });
  });

  describe('faixa de float do catálogo (limites inclusivos)', () => {
    test('abaixo e acima -> FLOAT_OUT_OF_RANGE com a faixa na mensagem', async () => {
      const low = await post(purchaseBody({ floatValue: 0.09 }));
      expectError(low, 400, 'FLOAT_OUT_OF_RANGE');
      expect(low.body.error.message).toBe('O float deste item deve estar entre 0,10 e 0,70.');
      expectError(await post(purchaseBody({ floatValue: 0.71 })), 400, 'FLOAT_OUT_OF_RANGE');
    });

    test('igual aos limites é aceito', async () => {
      expect((await post(purchaseBody({ floatValue: 0.1 }))).status).toBe(201);
      expect((await post(purchaseBody({ floatValue: 0.7 }))).status).toBe(201);
      expect((await post(purchaseBody({ catalogId: CAT.KARAMBIT_FADE, floatValue: 0 }))).status).toBe(201);
      expect((await post(purchaseBody({ catalogId: CAT.KARAMBIT_FADE, floatValue: 0.08 }))).status).toBe(201);
      expectError(await post(purchaseBody({ catalogId: CAT.KARAMBIT_FADE, floatValue: 0.081 })), 400, 'FLOAT_OUT_OF_RANGE');
    });

    test('entrada sem faixa ou item sem float: sem checagem', async () => {
      expect((await post(purchaseBody({ catalogId: CAT.GLOCK_NO_RANGE, floatValue: 0.9 }))).status).toBe(201);
      expect((await post(purchaseBody({ catalogId: CAT.KARAMBIT_VANILLA, floatValue: 0.5 }))).status).toBe(201);
      expect((await post(purchaseBody())).status).toBe(201);
    });

    test('PATCH de floatValue fora da faixa -> FLOAT_OUT_OF_RANGE; dentro -> 200', async () => {
      const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.2 }));
      // exterior: null deixa o backend derivar o exterior do novo float
      expectError(await patch(item.id, { floatValue: 0.8, exterior: null }), 400, 'FLOAT_OUT_OF_RANGE');
      expect((await get(item.id)).floatValue).toBe(0.2);
      expect((await patch(item.id, { floatValue: 0.3, exterior: null })).status).toBe(200);
    });
  });
});

describe('PATCH trocando o catalogId (D78 item 5)', () => {
  test('SKIN -> STICKER limpa os atributos de arma (T35)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.2, paintSeed: 10, variant: 'STATTRAK' }));
    const res = await patch(item.id, { catalogId: CAT.STICKER_TITAN });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Sticker | Titan | Katowice 2014', category: 'STICKER', variant: null, floatValue: null, exterior: null, paintSeed: null, phase: null,
    });
  });

  test('SKIN STATTRAK -> LUVA -> INVALID_VARIANT', async () => {
    const item = await createItemViaApi(app, purchaseBody({ variant: 'STATTRAK' }));
    expectError(await patch(item.id, { catalogId: CAT.SPORT_GLOVES_PANDORA }), 400, 'INVALID_VARIANT');
  });

  test('float gravado fora da nova faixa -> FLOAT_OUT_OF_RANGE; novo floatValue ou null no mesmo PATCH resolve', async () => {
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.5 }));
    expectError(await patch(item.id, { catalogId: CAT.KARAMBIT_FADE }), 400, 'FLOAT_OUT_OF_RANGE');
    expect((await get(item.id)).catalogId).toBe(CAT.AK_REDLINE);
    const fixed = await patch(item.id, { catalogId: CAT.KARAMBIT_FADE, floatValue: 0.01, exterior: null });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data).toMatchObject({ category: 'FACA', floatValue: 0.01, exterior: 'FN' });
    const cleared = await patch(item.id, { catalogId: CAT.AWP_DLORE, floatValue: null, exterior: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ name: 'AWP | Dragon Lore', floatValue: null });
  });

  test('a fase antiga não é herdada; fase do catálogo é derivada; fase livre aceita quando o catálogo não tem fase', async () => {
    const item = await createItemViaApi(app, purchaseBody({ catalogId: CAT.KARAMBIT_DOPPLER_P1, variant: 'STATTRAK' }));
    expect(item.phase).toBe('Phase 1');
    const toFade = await patch(item.id, { catalogId: CAT.KARAMBIT_FADE });
    expect(toFade.body.data.phase).toBeNull();
    const toP2 = await patch(item.id, { catalogId: CAT.KARAMBIT_DOPPLER_P2 });
    expect(toP2.body.data.phase).toBe('Phase 2');
    expectError(await patch(item.id, { phase: 'Phase 1' }), 400, 'CATALOG_DERIVED_FIELD');
    const toFadeWithPhase = await patch(item.id, { catalogId: CAT.KARAMBIT_FADE, phase: 'Fade 80%' });
    expect(toFadeWithPhase.body.data.phase).toBe('Fade 80%');
  });

  test('name ou category no PATCH de item do catálogo -> CATALOG_DERIVED_FIELD', async () => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { name: 'X' }), 400, 'CATALOG_DERIVED_FIELD');
    expectError(await patch(item.id, { category: 'CAIXA' }), 400, 'CATALOG_DERIVED_FIELD');
    expectError(await patch(item.id, { catalogId: CAT.AWP_DLORE, name: 'X' }), 400, 'CATALOG_DERIVED_FIELD');
  });

  test('reenviar o mesmo catalogId não conta como mudança (não checa float gravado)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.2 }));
    expect((await patch(item.id, { catalogId: CAT.AK_REDLINE, originDetail: 'x' })).status).toBe(200);
  });

  test('catalogId inexistente -> CATALOG_ITEM_NOT_FOUND', async () => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { catalogId: 'nao-existe' }), 400, 'CATALOG_ITEM_NOT_FOUND');
  });

  test('catalogId: null em SKIN do catálogo -> CATALOG_ITEM_REQUIRED', async () => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { catalogId: null }), 400, 'CATALOG_ITEM_REQUIRED');
    expect((await get(item.id)).catalogId).toBe(CAT.AK_REDLINE);
  });

  test('catalogId: null em item OUTRO do catálogo -> vira nome livre mantendo o nome', async () => {
    const item = await createItemViaApi(app, won({ catalogId: CAT.MUSIC_KIT_BOX }));
    const res = await patch(item.id, { catalogId: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ catalogId: null, name: 'Music Kit Box', category: 'OUTRO', isLegacy: false, catalog: null });
    expect((await patch(item.id, { name: 'Renomeado' })).body.data.name).toBe('Renomeado');
  });

  test('item de nome livre: trocar a categoria exige catálogo; renomear funciona', async () => {
    const item = await createItemViaApi(app, won(free()));
    expectError(await patch(item.id, { category: 'SKIN' }), 400, 'CATALOG_ITEM_REQUIRED');
    expect((await patch(item.id, { name: 'Outro nome' })).body.data.name).toBe('Outro nome');
    const linked = await patch(item.id, { catalogId: CAT.AK_REDLINE });
    expect(linked.body.data).toMatchObject({ category: 'SKIN', name: 'AK-47 | Redline', variant: 'NORMAL' });
  });
});

describe('itens legados (D82)', () => {
  test('GET: isLegacy true, catalog null; listagem inclui o item', async () => {
    const legacy = legacyItem();
    const view = await get(legacy.id);
    expect(view).toMatchObject({ isLegacy: true, catalogId: null, catalog: null, name: 'AK-47 | Redline' });
    expect((await request(app).get('/api/items')).body.data.items[0].isLegacy).toBe(true);
  });

  test('venda, desfazer venda e exclusão funcionam', async () => {
    const legacy = legacyItem();
    const sold = await request(app)
      .post(`/api/items/${legacy.id}/sell`)
      .send({ saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z' });
    expect(sold.status).toBe(200);
    expect(sold.body.data.item.isLegacy).toBe(true);
    expect((await request(app).post(`/api/items/${legacy.id}/unsell`)).status).toBe(200);
    expect((await request(app).delete(`/api/items/${legacy.id}`)).status).toBe(200);
  });

  test('PATCH de outros campos é aceito e o item continua legado', async () => {
    const legacy = legacyItem();
    const res = await patch(legacy.id, { purchasePriceCents: 150, originDetail: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ purchasePriceCents: 150, isLegacy: true, name: 'AK-47 | Redline' });
  });

  test('PATCH com name, category ou catalogId null -> CATALOG_ITEM_REQUIRED', async () => {
    const legacy = legacyItem();
    expectError(await patch(legacy.id, { name: 'Novo' }), 400, 'CATALOG_ITEM_REQUIRED');
    expectError(await patch(legacy.id, { category: 'LUVA' }), 400, 'CATALOG_ITEM_REQUIRED');
    expectError(await patch(legacy.id, { catalogId: null }), 400, 'CATALOG_ITEM_REQUIRED');
  });

  test('PATCH com category OUTRO + name vira item de nome livre', async () => {
    const legacy = legacyItem();
    const res = await patch(legacy.id, { category: 'OUTRO', name: 'Virou livre', variant: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ category: 'OUTRO', name: 'Virou livre', isLegacy: false, variant: null });
  });

  test('PATCH com catalogId vincula (nome canônico, categoria e checagem de float)', async () => {
    const legacy = legacyItem({ name: 'ak redline antigo', floatValue: 0.95, exterior: 'BS' });
    expectError(await patch(legacy.id, { catalogId: CAT.AK_REDLINE }), 400, 'FLOAT_OUT_OF_RANGE');
    const ok = await patch(legacy.id, { catalogId: CAT.AK_REDLINE, floatValue: 0.3, exterior: null });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ isLegacy: false, name: 'AK-47 | Redline', catalog: { id: CAT.AK_REDLINE } });
  });

  test('legado de categoria sem atributos de arma vinculado a SKIN: T35 limpa o que não foi enviado', async () => {
    const legacy = legacyItem({ name: 'Caixa antiga', category: 'CAIXA', variant: null });
    const res = await patch(legacy.id, { catalogId: CAT.CASE_REVOLVER });
    expect(res.body.data).toMatchObject({ category: 'CAIXA', name: 'Revolver Case', isLegacy: false });
  });
});

describe('catálogo que muda depois do cadastro', () => {
  test('entrada removida do catálogo: GET com catalog null; PATCH de outro campo 200; isLegacy continua false', async () => {
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.2 }));
    getDb().prepare('DELETE FROM catalog_items WHERE id = ?').run(CAT.AK_REDLINE);
    expect(await get(item.id)).toMatchObject({ catalogId: CAT.AK_REDLINE, catalog: null, isLegacy: false, name: 'AK-47 | Redline' });
    const res = await patch(item.id, { originDetail: 'ok', floatValue: 0.99, exterior: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ catalog: null, name: 'AK-47 | Redline', floatValue: 0.99 });
  });

  test('atualizar o catálogo não renomeia o item gravado', async () => {
    const item = await createItemViaApi(app);
    getDb().prepare("UPDATE catalog_items SET name = 'AK-47 | Novo Nome' WHERE id = ?").run(CAT.AK_REDLINE);
    const view = await get(item.id);
    expect(view.name).toBe('AK-47 | Redline');
    expect(view.catalog.name).toBe('AK-47 | Novo Nome');
  });
});

describe('estatísticas e preços mínimos', () => {
  test('itemStats agrupa dois itens do mesmo catalogId pelo nome canônico', async () => {
    const a = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 100 }));
    const b = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 300 }));
    for (const it of [a, b]) {
      const sold = await request(app)
        .post(`/api/items/${it.id}/sell`)
        .send({ saleStoreId: storeId('CSFloat'), salePriceCents: 1000, soldAt: '2026-11-18T12:00:00.000Z' });
      expect(sold.status).toBe(200);
    }
    const stats = await request(app).get('/api/items/stats').query({ name: 'AK-47 | Redline', category: 'SKIN' });
    expect(stats.body.data).toMatchObject({ soldCount: 2, avgPurchaseCostUsdCents: 200 });
    expect((await get(a.id)).stats.soldCount).toBe(2);
  });

  test('minPrices[].warningCode: CSMoney sem taxas, Steam sem cotação e sem aviso (D83)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 1000 }));
    const by = (store) => item.minPrices.find((m) => m.storeName === store);
    expect(by('CSMoney')).toMatchObject({ minPriceCents: null, warning: 'taxas não configuradas', warningCode: 'FEES_NOT_CONFIGURED' });
    expect(by('Steam')).toMatchObject({ minPriceCents: null, warning: 'cotação não configurada', warningCode: 'FX_NOT_CONFIGURED' });
    expect(by('CSFloat')).toMatchObject({ warning: null, warningCode: null });
  });

  test('minPrices[].warningCode: valor gigante gravado direto no banco -> PRICE_OVERFLOW', async () => {
    const item = await createItemViaApi(app);
    getDb().prepare('UPDATE items SET purchase_price_cents = ? WHERE id = ?').run(9e15, item.id);
    const view = await get(item.id);
    expect(view.minPrices.find((m) => m.storeName === 'CSFloat')).toMatchObject({
      minPriceCents: null, warningCode: 'PRICE_OVERFLOW',
    });
  });
});
