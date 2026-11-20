'use strict';

// Lacunas de D86 na identidade do item (D78, D82), T33/T35 e agrupamento de estatísticas.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Item = require('../../src/models/Item');
const CatalogItem = require('../../src/models/CatalogItem');
const catalogService = require('../../src/services/catalogService');
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

function legacyItem(overrides = {}) {
  return Item.create({
    name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'),
    purchasePriceCents: 100, purchaseCurrency: 'USD', acquiredAt: '2026-11-10T12:00:00.000Z', ...overrides,
  });
}

describe('POST: campos derivados (chave presente, qualquer valor)', () => {
  test.each([
    ['name: null', { name: null }],
    ['name: ""', { name: '' }],
    ['name igual ao canônico', { name: 'AK-47 | Redline' }],
    ['category: null', { category: null }],
    ['category igual à do catálogo', { category: 'SKIN' }],
    ['category inválida', { category: 'XYZ' }],
    ['name e category', { name: 'x', category: 'CAIXA' }],
  ])('catalogId + %s -> CATALOG_DERIVED_FIELD e nada é gravado', async (_n, extra) => {
    expectError(await post(purchaseBody(extra)), 400, 'CATALOG_DERIVED_FIELD');
    expect(Item.findAll()).toHaveLength(0);
  });

  test.each([
    ['phase: null', { phase: null }],
    ['phase: ""', { phase: '' }],
    ['phase igual à do catálogo', { phase: 'Phase 1' }],
    ['phase diferente', { phase: 'Phase 2' }],
  ])('entrada com fase + %s -> CATALOG_DERIVED_FIELD', async (_n, extra) => {
    expectError(await post(purchaseBody({ catalogId: CAT.KARAMBIT_DOPPLER_P1, variant: 'NORMAL', ...extra })), 400, 'CATALOG_DERIVED_FIELD');
  });

  test('DERIVED_FIELD vem antes de CATALOG_ITEM_NOT_FOUND e de erros de aquisição', async () => {
    expectError(await post(purchaseBody({ catalogId: 'nao-existe', name: 'x' })), 400, 'CATALOG_DERIVED_FIELD');
    expectError(await post({ catalogId: CAT.AK_REDLINE, name: 'x', acquisitionType: 'XYZ' }), 400, 'CATALOG_DERIVED_FIELD');
  });

  test('catalogId null explícito + name/category no corpo vira item de nome livre (não é derivado)', async () => {
    const res = await post(free({ catalogId: null }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ catalogId: null, name: 'Item livre', category: 'OUTRO', isLegacy: false, catalog: null });
  });
});

describe('POST: nome livre (OUTRO e PASSE_BATALHA)', () => {
  test('nome com 200 caracteres passa; 201 -> FIELD_TOO_LONG; só espaços ou null -> REQUIRED_FIELD', async () => {
    expect((await post(free({ name: 'x'.repeat(200) }))).status).toBe(201);
    expectError(await post(free({ name: 'x'.repeat(201) })), 400, 'FIELD_TOO_LONG');
    expectError(await post(free({ name: '   ' })), 400, 'REQUIRED_FIELD');
    expectError(await post(free({ name: null })), 400, 'REQUIRED_FIELD');
    const { name, ...semNome } = free();
    expectError(await post(semNome), 400, 'REQUIRED_FIELD');
  });

  test('nome livre é aparado', async () => {
    expect((await post(free({ name: '  Meu item  ' }))).body.data.name).toBe('Meu item');
  });

  test('sem catalogId e sem category -> REQUIRED_FIELD; category inválida -> INVALID_CATEGORY', async () => {
    expectError(await post(won({ name: 'x' })), 400, 'REQUIRED_FIELD');
    expectError(await post(won({ name: 'x', category: 'XYZ' })), 400, 'INVALID_CATEGORY');
  });

  test.each(['SKIN', 'FACA', 'LUVA', 'CAIXA', 'CAPSULA', 'STICKER', 'PINGENTE', 'PERSONAGEM'])(
    '%s com nome livre e sem catalogId -> CATALOG_ITEM_REQUIRED',
    async (category) => {
      expectError(await post(won({ name: 'Qualquer', category })), 400, 'CATALOG_ITEM_REQUIRED');
      expectError(await post(won({ name: 'Qualquer', category, catalogId: null })), 400, 'CATALOG_ITEM_REQUIRED');
    }
  );

  test('OUTRO com atributo de arma -> ATTRIBUTES_NOT_ALLOWED', async () => {
    expectError(await post(free({ floatValue: 0.1 })), 400, 'ATTRIBUTES_NOT_ALLOWED');
    expectError(await post(free({ variant: 'NORMAL' })), 400, 'ATTRIBUTES_NOT_ALLOWED');
  });

  test('PASSE_BATALHA livre: nome igual ao do catálogo (maiúsculas, acento, espaços) -> CATALOG_ITEM_REQUIRED', async () => {
    for (const name of ['Operation Riptide Access Pass', 'operation   RIPTÍDE access pass', '  OPERATION RIPTIDE ACCESS PASS ']) {
      expectError(await post(won({ category: 'PASSE_BATALHA', name })), 400, 'CATALOG_ITEM_REQUIRED');
    }
  });

  test('PASSE_BATALHA livre com nome que só existe em OUTRO, ou nome parecido, é aceito', async () => {
    expect((await post(won({ category: 'PASSE_BATALHA', name: 'Music Kit Box' }))).status).toBe(201);
    expect((await post(won({ category: 'PASSE_BATALHA', name: 'Operation Riptide Access Pass 2' }))).status).toBe(201);
  });

  test('OUTRO livre com nome igual a um PASSE_BATALHA do catálogo é aceito (checagem só para PASSE_BATALHA)', async () => {
    expect((await post(free({ name: 'Operation Riptide Access Pass' }))).status).toBe(201);
  });

  test('catalogId de PASSE_BATALHA do catálogo cria item PASSE_BATALHA com nome canônico', async () => {
    const res = await post(won({ catalogId: CAT.BATTLE_PASS_RIPTIDE }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ category: 'PASSE_BATALHA', name: 'Operation Riptide Access Pass', isLegacy: false });
  });
});

describe('POST: catalogId e atributos', () => {
  test('catalogId de categoria sem arma com atributo de arma -> ATTRIBUTES_NOT_ALLOWED', async () => {
    expectError(await post(won({ catalogId: CAT.STICKER_TITAN, floatValue: 0.1 })), 400, 'ATTRIBUTES_NOT_ALLOWED');
    expectError(await post(won({ catalogId: CAT.CASE_REVOLVER, variant: 'STATTRAK' })), 400, 'ATTRIBUTES_NOT_ALLOWED');
    expectError(await post(won({ catalogId: CAT.CAPSULE_KATO14, paintSeed: 1 })), 400, 'ATTRIBUTES_NOT_ALLOWED');
  });

  test('hasStattrak/hasSouvenir do catálogo NÃO são validados no backend (D78 item 2)', async () => {
    const stat = await post(purchaseBody({ catalogId: CAT.GLOCK_NO_RANGE, variant: 'STATTRAK' })); // hasStattrak = 0
    expect(stat.status).toBe(201);
    expect(stat.body.data.variant).toBe('STATTRAK');
    expect((await post(purchaseBody({ catalogId: CAT.GLOCK_NO_RANGE, variant: 'SOUVENIR' }))).status).toBe(201);
  });

  test('regras de variant de 2.2 continuam: faca SOUVENIR e luva STATTRAK -> INVALID_VARIANT', async () => {
    expectError(await post(purchaseBody({ catalogId: CAT.KARAMBIT_FADE, variant: 'SOUVENIR' })), 400, 'INVALID_VARIANT');
    expectError(await post(purchaseBody({ catalogId: CAT.SPORT_GLOVES_PANDORA, variant: 'STATTRAK' })), 400, 'INVALID_VARIANT');
    expect((await post(purchaseBody({ catalogId: CAT.KARAMBIT_FADE, variant: 'STATTRAK' }))).status).toBe(201);
  });

  test('float nos limites exatos de luva (0.06 e 0.80) é aceito; fora, não', async () => {
    const body = (floatValue) => purchaseBody({ catalogId: CAT.SPORT_GLOVES_PANDORA, floatValue });
    expect((await post(body(0.06))).status).toBe(201);
    expect((await post(body(0.8))).status).toBe(201);
    expectError(await post(body(0.0599)), 400, 'FLOAT_OUT_OF_RANGE');
    expectError(await post(body(0.8001)), 400, 'FLOAT_OUT_OF_RANGE');
  });

  test('AWP (faixa 0..0.70): float 0 é aceito; 1 e 0.7000001 não; float > 1 -> INVALID_FLOAT', async () => {
    const body = (floatValue) => purchaseBody({ catalogId: CAT.AWP_DLORE, floatValue });
    expect((await post(body(0))).status).toBe(201);
    expectError(await post(body(1)), 400, 'FLOAT_OUT_OF_RANGE');
    expectError(await post(body(0.7000001)), 400, 'FLOAT_OUT_OF_RANGE');
    expectError(await post(body(1.5)), 400, 'INVALID_FLOAT');
  });

  test('exterior incoerente é checado antes da faixa (EXTERIOR_MISMATCH)', async () => {
    expectError(await post(purchaseBody({ floatValue: 0.2, exterior: 'FN' })), 400, 'EXTERIOR_MISMATCH');
  });

  test('FLOAT_OUT_OF_RANGE não grava nada', async () => {
    expectError(await post(purchaseBody({ floatValue: 0.01 })), 400, 'FLOAT_OUT_OF_RANGE');
    expect(Item.findAll()).toHaveLength(0);
  });

  test('catalogId que aponta para entrada removida depois: POST -> NOT_FOUND', async () => {
    getDb().prepare('DELETE FROM catalog_items WHERE id = ?').run(CAT.AK_REDLINE);
    expectError(await post(purchaseBody()), 400, 'CATALOG_ITEM_NOT_FOUND');
  });
});

describe('PATCH: troca de catalogId (bordas)', () => {
  test('float gravado exatamente no limite da nova faixa passa; um pouco fora, não', async () => {
    const item = await createItemViaApi(app, purchaseBody({ catalogId: CAT.KARAMBIT_FADE, floatValue: 0.08 }));
    // AK vai de 0.10 a 0.70: 0.08 fica fora
    expectError(await patch(item.id, { catalogId: CAT.AK_REDLINE }), 400, 'FLOAT_OUT_OF_RANGE');
    const other = await createItemViaApi(app, purchaseBody({ floatValue: 0.1 }));
    expect((await patch(other.id, { catalogId: CAT.KARAMBIT_FADE, floatValue: 0.08, exterior: null })).status).toBe(200);
    const edge = await createItemViaApi(app, purchaseBody({ catalogId: CAT.AWP_DLORE, floatValue: 0.7, exterior: 'BS' }));
    expect((await patch(edge.id, { catalogId: CAT.AK_REDLINE })).status).toBe(200); // 0.7 = limite superior do AK
    const edge2 = await createItemViaApi(app, purchaseBody({ catalogId: CAT.AWP_DLORE, floatValue: 0.1, exterior: 'MW' }));
    expect((await patch(edge2.id, { catalogId: CAT.AK_REDLINE })).status).toBe(200); // 0.1 = limite inferior
  });

  test('SKIN -> FACA com SOUVENIR gravado -> INVALID_VARIANT; troca entre armas não limpa float/seed', async () => {
    const souvenir = await createItemViaApi(app, purchaseBody({ catalogId: CAT.DEAGLE_DDPAT, variant: 'SOUVENIR' }));
    expectError(await patch(souvenir.id, { catalogId: CAT.KARAMBIT_VANILLA }), 400, 'INVALID_VARIANT');
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.2, paintSeed: 77, variant: 'STATTRAK' }));
    const res = await patch(item.id, { catalogId: CAT.M4A1S_PRINTSTREAM });
    expect(res.body.data).toMatchObject({ variant: 'STATTRAK', floatValue: 0.2, paintSeed: 77, exterior: 'FT', category: 'SKIN' });
  });

  test('SKIN -> categoria sem atributos: cada atributo de arma não nulo no corpo -> ATTRIBUTES_NOT_ALLOWED; null é aceito', async () => {
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.2, paintSeed: 5 }));
    for (const extra of [{ variant: 'NORMAL' }, { floatValue: 0.1 }, { exterior: 'FN' }, { paintSeed: 3 }, { phase: 'x' }]) {
      expectError(await patch(item.id, { catalogId: CAT.CAPSULE_KATO14, ...extra }), 400, 'ATTRIBUTES_NOT_ALLOWED');
    }
    const ok = await patch(item.id, { catalogId: CAT.CAPSULE_KATO14, paintSeed: null, exterior: null, phase: null });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ category: 'CAPSULA', variant: null, floatValue: null, exterior: null, paintSeed: null, phase: null });
  });

  test('troca SKIN -> OUTRO do catálogo (Music Kit Box) também limpa atributos', async () => {
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.2, paintSeed: 5 }));
    const res = await patch(item.id, { catalogId: CAT.MUSIC_KIT_BOX });
    expect(res.body.data).toMatchObject({ category: 'OUTRO', name: 'Music Kit Box', variant: null, floatValue: null, paintSeed: null });
  });

  test('T35: após limpar, voltar a SKIN dá variant NORMAL e atributos nulos; item sem float não dispara faixa', async () => {
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.2, variant: 'STATTRAK' }));
    await patch(item.id, { catalogId: CAT.CASE_REVOLVER });
    const back = await patch(item.id, { catalogId: CAT.AK_REDLINE });
    expect(back.status).toBe(200);
    expect(back.body.data).toMatchObject({ variant: 'NORMAL', floatValue: null, exterior: null, paintSeed: null });
  });

  test('T35: o corpo com floatValue null na troca para categoria sem arma não causa erro e atributos continuam nulos', async () => {
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.2 }));
    const res = await patch(item.id, { catalogId: CAT.STICKER_CROWN, floatValue: null, variant: null });
    expect(res.status).toBe(200);
    expect(res.body.data.floatValue).toBeNull();
  });

  test('legado de categoria sem arma (CAIXA) vinculado a SKIN do catálogo fica com variant NORMAL', async () => {
    const legacy = legacyItem({ name: 'Nome antigo', category: 'CAIXA', variant: null });
    const res = await patch(legacy.id, { catalogId: CAT.AK_REDLINE });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ category: 'SKIN', name: 'AK-47 | Redline', variant: 'NORMAL', isLegacy: false });
  });

  test('trocar o catalogId de item VENDIDO: nome/categoria mudam e a venda continua igual', async () => {
    const item = await createItemViaApi(app);
    const sold = await request(app).post(`/api/items/${item.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 1000, soldAt: '2026-11-15T12:00:00.000Z' });
    expect(sold.status).toBe(200);
    const res = await patch(item.id, { catalogId: CAT.AWP_DLORE });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'AWP | Dragon Lore', status: 'VENDIDO', salePriceCents: 1000, netReceivedCents: sold.body.data.item.netReceivedCents });
  });

  test('fase: catálogo com fase + PATCH da mesma entrada com phase -> DERIVED_FIELD; sem phase mantém a do catálogo', async () => {
    const item = await createItemViaApi(app, purchaseBody({ catalogId: CAT.KARAMBIT_DOPPLER_P1, variant: 'NORMAL' }));
    expectError(await patch(item.id, { catalogId: CAT.KARAMBIT_DOPPLER_P1, phase: 'Phase 1' }), 400, 'CATALOG_DERIVED_FIELD');
    expectError(await patch(item.id, { phase: null }), 400, 'CATALOG_DERIVED_FIELD');
    expect((await patch(item.id, { originDetail: 'ok' })).body.data.phase).toBe('Phase 1');
  });

  test('fase livre (entrada sem fase): enviar, trocar e limpar com null; reenviar o mesmo catalogId mantém a fase', async () => {
    const item = await createItemViaApi(app, purchaseBody({ catalogId: CAT.KARAMBIT_FADE, variant: 'NORMAL', phase: 'Fade 90%' }));
    expect(item.phase).toBe('Fade 90%');
    expect((await patch(item.id, { catalogId: CAT.KARAMBIT_FADE, originDetail: 'x' })).body.data.phase).toBe('Fade 90%');
    expect((await patch(item.id, { phase: 'Fade 80%' })).body.data.phase).toBe('Fade 80%');
    expect((await patch(item.id, { phase: null })).body.data.phase).toBeNull();
  });

  test('catalogId de PATCH com forma inválida', async () => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { catalogId: 5 }), 400, 'INVALID_FIELD');
    expectError(await patch(item.id, { catalogId: '' }), 400, 'INVALID_FIELD');
    expectError(await patch(item.id, { catalogId: 'a/b' }), 400, 'INVALID_FIELD');
    expectError(await patch(item.id, { catalogId: 'x'.repeat(101) }), 400, 'FIELD_TOO_LONG');
    expect((await get(item.id)).catalogId).toBe(CAT.AK_REDLINE);
  });

  test('erro no PATCH não grava parcialmente (nome e categoria ficam)', async () => {
    const item = await createItemViaApi(app, purchaseBody({ floatValue: 0.5 }));
    expectError(await patch(item.id, { catalogId: CAT.KARAMBIT_FADE, originDetail: 'não grava' }), 400, 'FLOAT_OUT_OF_RANGE');
    expect(await get(item.id)).toMatchObject({ name: 'AK-47 | Redline', category: 'SKIN', originDetail: null });
  });

  test('entrada removida do catálogo: PATCH com name/category continua recusado (item segue vinculado)', async () => {
    const item = await createItemViaApi(app);
    getDb().prepare('DELETE FROM catalog_items WHERE id = ?').run(CAT.AK_REDLINE);
    expectError(await patch(item.id, { name: 'X' }), 400, 'CATALOG_DERIVED_FIELD');
    expectError(await patch(item.id, { category: 'OUTRO' }), 400, 'CATALOG_DERIVED_FIELD');
    expect((await patch(item.id, { floatValue: 0.01, exterior: null })).status).toBe(200); // sem entrada, sem checagem de faixa
    expect((await get(item.id)).catalogId).toBe(CAT.AK_REDLINE);
  });
});

describe('PATCH: catalogId null e nome livre (bordas)', () => {
  test('catalogId null em entrada PASSE_BATALHA do catálogo mantendo o nome -> CATALOG_ITEM_REQUIRED (D78 item 1)', async () => {
    const item = await createItemViaApi(app, won({ catalogId: CAT.BATTLE_PASS_RIPTIDE }));
    const res = await patch(item.id, { catalogId: null });
    // D78 item 1: PASSE_BATALHA de nome livre cujo nome existe no catálogo -> CATALOG_ITEM_REQUIRED.
    expectError(res, 400, 'CATALOG_ITEM_REQUIRED');
  });

  test('desvincular entrada PASSE_BATALHA já renomeando para um nome livre diferente funciona', async () => {
    const item = await createItemViaApi(app, won({ catalogId: CAT.BATTLE_PASS_RIPTIDE }));
    const res = await patch(item.id, { catalogId: null, name: 'Passe antigo' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ catalogId: null, name: 'Passe antigo', category: 'PASSE_BATALHA', isLegacy: false });
  });

  test('desvincular com name igual ao nome do catálogo (PASSE_BATALHA) -> CATALOG_ITEM_REQUIRED', async () => {
    const item = await createItemViaApi(app, won({ catalogId: CAT.BATTLE_PASS_RIPTIDE }));
    expectError(await patch(item.id, { catalogId: null, name: 'operation riptide access pass' }), 400, 'CATALOG_ITEM_REQUIRED');
  });

  test('item OUTRO livre: renomear para vazio/null -> REQUIRED_FIELD; 201 caracteres -> FIELD_TOO_LONG', async () => {
    const item = await createItemViaApi(app, free());
    expectError(await patch(item.id, { name: '  ' }), 400, 'REQUIRED_FIELD');
    expectError(await patch(item.id, { name: null }), 400, 'REQUIRED_FIELD');
    expectError(await patch(item.id, { name: 'x'.repeat(201) }), 400, 'FIELD_TOO_LONG');
    expect((await get(item.id)).name).toBe('Item livre');
  });

  test('OUTRO livre -> PASSE_BATALHA mantendo o nome: só passa se o nome não existe no catálogo', async () => {
    const plain = await createItemViaApi(app, free({ name: 'Algo qualquer' }));
    expect((await patch(plain.id, { category: 'PASSE_BATALHA' })).body.data.category).toBe('PASSE_BATALHA');
    const clash = await createItemViaApi(app, free({ name: 'Operation Riptide Access Pass' }));
    expectError(await patch(clash.id, { category: 'PASSE_BATALHA' }), 400, 'CATALOG_ITEM_REQUIRED');
  });

  test('PASSE_BATALHA livre renomeado para o nome do catálogo -> CATALOG_ITEM_REQUIRED', async () => {
    const item = await createItemViaApi(app, won({ category: 'PASSE_BATALHA', name: 'Passe qualquer' }));
    expectError(await patch(item.id, { name: 'Operation Riptide Access Pass' }), 400, 'CATALOG_ITEM_REQUIRED');
    expect((await patch(item.id, { name: 'Outro passe' })).status).toBe(200);
  });

  test('item livre vinculado a entrada do catálogo (catalogId) troca name/category pela entrada', async () => {
    const item = await createItemViaApi(app, free());
    const res = await patch(item.id, { catalogId: CAT.CASE_REVOLVER });
    expect(res.body.data).toMatchObject({ name: 'Revolver Case', category: 'CAIXA', catalogId: CAT.CASE_REVOLVER });
  });

  test('OUTRO livre com atributo de arma no PATCH -> ATTRIBUTES_NOT_ALLOWED', async () => {
    const item = await createItemViaApi(app, free());
    expectError(await patch(item.id, { floatValue: 0.1 }), 400, 'ATTRIBUTES_NOT_ALLOWED');
  });
});

describe('legado (D82): bordas', () => {
  test('PATCH de legado com catalogId: null explícito -> CATALOG_ITEM_REQUIRED', async () => {
    expectError(await patch(legacyItem().id, { catalogId: null }), 400, 'CATALOG_ITEM_REQUIRED');
  });

  test('PATCH de legado só com category (sem nome/catálogo) em categoria de catálogo -> CATALOG_ITEM_REQUIRED; OUTRO -> vira livre', async () => {
    const it = legacyItem();
    expectError(await patch(it.id, { category: 'FACA' }), 400, 'CATALOG_ITEM_REQUIRED');
    const res = await patch(it.id, { category: 'OUTRO' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ category: 'OUTRO', name: 'AK-47 | Redline', isLegacy: false, variant: null });
  });

  test('legado vinculado a catalogId inexistente -> NOT_FOUND e continua legado', async () => {
    const it = legacyItem();
    expectError(await patch(it.id, { catalogId: 'nao-existe' }), 400, 'CATALOG_ITEM_NOT_FOUND');
    expect((await get(it.id)).isLegacy).toBe(true);
  });

  test('legado vinculado com float fora da faixa -> FLOAT_OUT_OF_RANGE; com float novo dentro da faixa -> vincula', async () => {
    const it = legacyItem({ floatValue: 0.01, exterior: 'FN' });
    expectError(await patch(it.id, { catalogId: CAT.AK_REDLINE }), 400, 'FLOAT_OUT_OF_RANGE');
    const ok = await patch(it.id, { catalogId: CAT.AK_REDLINE, floatValue: 0.2, exterior: null });
    expect(ok.body.data).toMatchObject({ isLegacy: false, catalogId: CAT.AK_REDLINE, floatValue: 0.2, exterior: 'FT' });
  });

  test('item legado aparece com isLegacy true na listagem junto com não legados e filtros continuam', async () => {
    legacyItem();
    await createItemViaApi(app, free());
    await createItemViaApi(app);
    const list = (await request(app).get('/api/items')).body.data.items;
    expect(list.map((i) => i.isLegacy)).toEqual([true, false, false]);
    const outros = (await request(app).get('/api/items').query({ category: 'OUTRO' })).body.data.items;
    expect(outros).toHaveLength(1);
  });

  test('legado em categoria de arma: PATCH de float sem catálogo funciona e não checa faixa', async () => {
    const it = legacyItem();
    const res = await patch(it.id, { floatValue: 0.01, exterior: null });
    expect(res.status).toBe(200);
    expect(res.body.data.isLegacy).toBe(true);
  });
});

describe('vínculo automático via API (refresh e boot)', () => {
  test('refresh com fetch simulado informa linkedLegacyItems e o item deixa de ser legado', async () => {
    const it = legacyItem();
    const fetchFn = async (url) => {
      const rel = url.split('/api/')[1];
      const [lang, file] = rel.split('/');
      const fs = require('fs');
      const path = require('path');
      const body = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'csgo-api', lang, file), 'utf8');
      return { ok: true, status: 200, text: async () => body };
    };
    const appWithFetch = makeCatalogApp(undefined, { fetchFn });
    const res = await request(appWithFetch).post('/api/catalog/refresh').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.linkedLegacyItems).toBe(1);
    const view = (await request(appWithFetch).get(`/api/items/${it.id}`)).body.data;
    expect(view).toMatchObject({ isLegacy: false, catalogId: CAT.AK_REDLINE, catalog: { id: CAT.AK_REDLINE } });
  });

  test('empate por fase: legado "Karambit | Doppler" com fase vincula à fase certa; sem fase fica legado', async () => {
    const withPhase = legacyItem({ name: 'Karambit | Doppler', category: 'FACA', phase: 'Phase 2' });
    const noPhase = legacyItem({ name: 'Karambit | Doppler', category: 'FACA' });
    expect(catalogService.linkLegacyItems({ now: new Date() })).toBe(1);
    expect((await get(withPhase.id)).catalogId).toBe(CAT.KARAMBIT_DOPPLER_P2);
    expect((await get(noPhase.id)).isLegacy).toBe(true);
  });

  test('facas com nome duplicado no catálogo não vinculam', async () => {
    const it = legacyItem({ name: 'Bayonet | Blue Steel', category: 'FACA' });
    expect(catalogService.linkLegacyItems({ now: new Date() })).toBe(0);
    expect((await get(it.id)).isLegacy).toBe(true);
  });

  test('float fora da faixa não vincula; no limite vincula', async () => {
    const out = legacyItem({ floatValue: 0.0999, exterior: 'MW' });
    const edge = legacyItem({ floatValue: 0.1, exterior: 'MW' });
    catalogService.linkLegacyItems({ now: new Date() });
    expect((await get(out.id)).isLegacy).toBe(true);
    expect((await get(edge.id)).isLegacy).toBe(false);
  });
});

describe('itemStats agrupa pelo nome canônico', () => {
  const stats = (q) => request(app).get('/api/items/stats').query(q);

  test('itens vinculados à mesma entrada somam, mesmo que o nome gravado antigo seja outro', async () => {
    const a = await createItemViaApi(app, purchaseBody());
    // legado com nome diferente é vinculado: passa a usar o nome canônico
    const legacy = legacyItem({ name: 'ak-47   |  redline' });
    catalogService.linkLegacyItems({ now: new Date() });
    const view = await get(legacy.id);
    expect(view.name).toBe('AK-47 | Redline');
    expect(view.stats.soldCount).toBe(0);
    const res = await stats({ name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL' });
    expect(res.status).toBe(200);
    expect(res.body.data.avgPurchaseCostUsdCents).toBe(100);
    expect(a.id).toBeDefined();
  });

  test('stats com variantes e categorias diferentes ficam separados (mesmo nome canônico)', async () => {
    await createItemViaApi(app, purchaseBody({ variant: 'STATTRAK', purchasePriceCents: 300 }));
    await createItemViaApi(app, purchaseBody({ variant: 'NORMAL', purchasePriceCents: 100 }));
    const normal = await stats({ name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL' });
    const stat = await stats({ name: 'AK-47 | Redline', category: 'SKIN', variant: 'STATTRAK' });
    expect(normal.body.data.avgPurchaseCostUsdCents).toBe(100);
    expect(stat.body.data.avgPurchaseCostUsdCents).toBe(300);
  });

  test('trocar o catalogId de um item move-o de grupo nas estatísticas', async () => {
    const a = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 100 }));
    await createItemViaApi(app, purchaseBody({ purchasePriceCents: 300 }));
    const before = await stats({ name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL' });
    expect(before.body.data.avgPurchaseCostUsdCents).toBe(200);
    await patch(a.id, { catalogId: CAT.AWP_DLORE });
    const after = await stats({ name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL' });
    expect(after.body.data.avgPurchaseCostUsdCents).toBe(300);
    const awp = await stats({ name: 'AWP | Dragon Lore', category: 'SKIN', variant: 'NORMAL' });
    expect(awp.body.data.avgPurchaseCostUsdCents).toBe(100);
  });

  test('renomear a entrada no catálogo não separa itens já gravados (usam o nome gravado)', async () => {
    const a = await createItemViaApi(app, purchaseBody());
    CatalogItem.upsertMany([{ id: CAT.AK_REDLINE, source: 'SKINS', category: 'SKIN', name: 'AK-47 | Redline Novo', nameKey: 'ak-47 | redline novo', searchText: 'ak-47 | redline novo' }]);
    const b = await createItemViaApi(app, purchaseBody());
    expect(a.name).toBe('AK-47 | Redline');
    expect(b.name).toBe('AK-47 | Redline Novo');
    const old = await stats({ name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL' });
    expect(old.body.data.avgPurchaseCostUsdCents).toBe(100);
  });
});

describe('T33 e T35 com catálogo (bordas)', () => {
  test('T33: GANHEI com loja gravada vira COMPRA só com o preço; loja continua a gravada', async () => {
    const item = await createItemViaApi(app, won({ catalogId: CAT.AK_REDLINE, purchaseStoreId: storeId('CSFloat') }));
    const res = await patch(item.id, { acquisitionType: 'COMPRA', purchasePriceCents: 250 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 250, purchaseCurrency: 'USD', fxRateAtPurchase: null });
  });

  test('T33: preço 0 em GANHEI -> COMPRA é aceito (preço informado, não nulo); null -> PURCHASE_PRICE_REQUIRED', async () => {
    const item = await createItemViaApi(app, won({ catalogId: CAT.AK_REDLINE, purchaseStoreId: storeId('CSFloat') }));
    expectError(await patch(item.id, { acquisitionType: 'COMPRA', purchasePriceCents: null }), 400, 'PURCHASE_PRICE_REQUIRED');
    expectError(await patch(item.id, { acquisitionType: 'COMPRA' }), 400, 'PURCHASE_PRICE_REQUIRED');
    const ok = await patch(item.id, { acquisitionType: 'COMPRA', purchasePriceCents: 0 });
    expect(ok.status).toBe(200);
  });

  test('T33: GANHEI sem loja -> COMPRA sem loja no corpo -> PURCHASE_STORE_REQUIRED; com loja nova no corpo funciona', async () => {
    const item = await createItemViaApi(app, won({ catalogId: CAT.AK_REDLINE }));
    expectError(await patch(item.id, { acquisitionType: 'COMPRA', purchasePriceCents: 100 }), 400, 'PURCHASE_STORE_REQUIRED');
    expect((await patch(item.id, { acquisitionType: 'COMPRA', purchasePriceCents: 100, purchaseStoreId: storeId('CSFloat') })).status).toBe(200);
  });

  test('T33 junto com troca de catálogo no mesmo PATCH', async () => {
    const item = await createItemViaApi(app, won({ catalogId: CAT.AK_REDLINE, purchaseStoreId: storeId('CSFloat') }));
    const res = await patch(item.id, { acquisitionType: 'COMPRA', purchasePriceCents: 500, catalogId: CAT.AWP_DLORE });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'AWP | Dragon Lore', acquisitionType: 'COMPRA', purchasePriceCents: 500 });
  });

  test('T35 (b): COMPRA -> GANHEI zera custo e aceita fxRateAtPurchase null; valor não nulo -> FX_RATE_NOT_ALLOWED', async () => {
    const item = await createItemViaApi(app);
    expectError(await patch(item.id, { acquisitionType: 'GANHEI', fxRateAtPurchase: 5 }), 400, 'FX_RATE_NOT_ALLOWED');
    const res = await patch(item.id, { acquisitionType: 'GANHEI', fxRateAtPurchase: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ acquisitionType: 'GANHEI', purchasePriceCents: 0, purchaseCurrency: 'USD', fxRateAtPurchase: null });
  });

  test('GANHEI: purchasePriceCents presente (inclusive 0 e null) -> GANHEI_COST_NOT_ALLOWED', async () => {
    for (const v of [0, 100, null]) {
      expectError(await post(won({ catalogId: CAT.AK_REDLINE, purchasePriceCents: v })), 400, 'GANHEI_COST_NOT_ALLOWED');
    }
  });

  test('origem GANHEI sem preço -> custo 0 USD sem cotação (e loja informativa opcional)', async () => {
    const res = await post(won({ catalogId: CAT.AK_REDLINE }));
    expect(res.body.data).toMatchObject({ purchasePriceCents: 0, purchaseCurrency: 'USD', fxRateAtPurchase: null, purchaseStoreId: null });
  });
});
