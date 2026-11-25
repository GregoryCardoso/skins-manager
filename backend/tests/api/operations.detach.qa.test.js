// 10.7 (D366), QA: lacunas além de operations.detach.test.js. Proporção (cache desatualizado, falta de preço, Doppler sem fase, 0 %/100 %),
// SPLIT/RETURN completos, desfazer (mais recente, venda, restauração exata), números idênticos sem separação (lucro real, saldos, itemStats,
// vendas, grupos, preço mínimo e valor de mercado) e a divisão do custo depois de aplicar sticker e de abrir caixa.
// Banco em memória; nenhuma rede.
const request = require('supertest');
const { freshDb } = require('../helpers/fixtures');
const { getDb, closeDb } = require('../../src/config/database');
const MarketPrice = require('../../src/models/MarketPrice');
const CatalogItem = require('../../src/models/CatalogItem');
const { normalizeSearchText } = require('../../src/services/catalog/csgoApiAdapter');
const { ACTIVE_VALUATION_SOURCE } = require('../../src/services/valuation/valuationSources');
const { CAT, makeCatalogApp, purchaseBody, createItemViaApi, expectError, storeId, NOW } = require('../helpers/apiFixtures');

jest.setTimeout(60000);
let app;
const AT = '2026-11-15T12:00:00.000Z';
const DETACH_AT = '2026-11-17T12:00:00.000Z';
const AK_KEY = 'AK-47 | Redline (Field-Tested)|';
const CHARM_KEY = "Charm | Lil' Ava|";
const HOUR = 3600000;

beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const get = (url) => request(app).get(url);
const post = (url, body = {}) => request(app).post(url).send(body);
const patch = (url, body) => request(app).patch(url).send(body);
const charm = (extra = {}) => ({ kind: 'CHARM', catalogId: CAT.CHARM_LIL_AVA, pattern: 42, ...extra });
const akBody = (extra = {}) => purchaseBody({ exterior: 'FT', floatValue: 0.2, components: [charm()], ...extra });
const priceAt = (priceKey, cents, pricedAt, status = 'OK') =>
  MarketPrice.upsertResult({
    source: ACTIVE_VALUATION_SOURCE, priceKey, marketHashName: priceKey.replace(/\|$/, ''), paintIndex: null, status,
    basePriceCents: cents, referenceQuantity: 3, sourceUpdatedAt: null,
  }, pricedAt);
const price = (priceKey, cents) => priceAt(priceKey, cents, new Date(NOW.getTime() - HOUR));
const itemOf = async (id) => (await get(`/api/items/${id}`)).body.data;
const preview = (itemId, componentId, query = '') => get(`/api/items/${itemId}/components/${componentId}/detach-preview${query}`);
const detach = (itemId, componentId, body = {}) => post(`/api/items/${itemId}/components/${componentId}/detach`, { detachedAt: DETACH_AT, ...body });
const undo = (operationId) => post(`/api/operations/${operationId}/undo`);
const profit = async () => (await get('/api/profit/summary')).body.data;
const numbers = (p) => ({
  stock: p.stockUsdCents, real: p.realProfitUsdCents, platform: p.platformBalanceUsdCents, pending: p.pendingBalanceUsdCents,
  breakdown: [p.stockBreakdown.forSale.usdCents, p.stockBreakdown.offSale.usdCents], balances: p.balancesByStore.map((b) => [b.storeId, b.availableCents, b.pendingCents]),
});
const hangingOf = (item) => item.components.find((c) => c.kind === 'CHARM' || c.kind === 'STICKER_SLAB');
const blocked = (res, status, code, params) => {
  expectError(res, status, code);
  expect(res.body.error.params).toMatchObject(params);
};
const opRow = (id) => getDb().prepare('SELECT * FROM item_operations WHERE id = ?').get(id);
const detailOf = (id) => JSON.parse(opRow(id).detail_json);

describe('proporção pelos preços do cache', () => {
  test('cache desatualizado (dias) vale: a prévia mostra as datas e isStale; a data mais antiga é a do conjunto', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1000 }));
    const olderBase = new Date(NOW.getTime() - 72 * HOUR);
    const newerHanging = new Date(NOW.getTime() - 30 * HOUR);
    priceAt(AK_KEY, 7500, olderBase);
    priceAt(CHARM_KEY, 2500, newerHanging);
    const prev = (await preview(ak.id, hangingOf(ak).id)).body.data;
    expect(prev.suggestion).toMatchObject({
      hangingShareBp: 2500, basePriceCents: 7500, hangingPriceCents: 2500, isStale: true,
      basePricedAt: olderBase.toISOString(), hangingPricedAt: newerHanging.toISOString(), pricedAt: olderBase.toISOString(),
    });
    expect(prev.valuedTotalUsdCents).toBe(10000);
    expect(prev.appliedShareBp).toBe(2500);
    expect(prev.result).toEqual({ weaponUsdCents: 750, detachedUsdCents: 250 });
    const res = await detach(ak.id, hangingOf(ak).id);
    expect(res.status).toBe(201);
    expect(detailOf(res.body.data.operation.id).share).toMatchObject({
      hangingShareBp: 2500, basis: 'MARKET_CACHE', basePricedAt: olderBase.toISOString(), hangingPricedAt: newerHanging.toISOString(), pricedAt: olderBase.toISOString(),
    });
  });

  test('falta de um preço: só a arma (HANGING_NO_PRICE) ou só o pendurado (WEAPON_NO_PRICE) exige a porcentagem', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1000 }));
    price(AK_KEY, 9000);
    let prev = (await preview(ak.id, hangingOf(ak).id)).body.data;
    expect(prev).toMatchObject({ suggestion: null, suggestionUnavailableReason: 'HANGING_NO_PRICE', valuedTotalUsdCents: null, result: null });
    expectError(await detach(ak.id, hangingOf(ak).id), 422, 'SPLIT_SHARE_REQUIRED', { field: 'hangingShareBp' });

    getDb().prepare('DELETE FROM market_prices').run();
    price(CHARM_KEY, 1000);
    prev = (await preview(ak.id, hangingOf(ak).id)).body.data;
    expect(prev).toMatchObject({ suggestion: null, suggestionUnavailableReason: 'WEAPON_NO_PRICE', result: null });
    expectError(await detach(ak.id, hangingOf(ak).id), 422, 'SPLIT_SHARE_REQUIRED');

    // nada foi gravado pelas recusas
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM item_operations WHERE kind = 'DETACH_COMPONENT'").get().n).toBe(0);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM items WHERE acquisition_type = 'GERADO'").get().n).toBe(0);
    expect(hangingOf(await itemOf(ak.id))).toBeTruthy();

    // informando a porcentagem a separação sai, marcada como manual (sem preços gravados no detalhe)
    const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 4000 });
    expect(res.status).toBe(201);
    expect(detailOf(res.body.data.operation.id).share).toMatchObject({ hangingShareBp: 4000, basis: 'MANUAL' });
  });

  test('preço do pendurado "não encontrado" (sem preço antigo) e cache vazio: porcentagem obrigatória', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1000 }));
    price(AK_KEY, 9000);
    priceAt(CHARM_KEY, null, new Date(NOW.getTime() - HOUR), 'NOT_FOUND');
    expect((await preview(ak.id, hangingOf(ak).id)).body.data.suggestionUnavailableReason).toBe('HANGING_NO_PRICE');
    expectError(await detach(ak.id, hangingOf(ak).id), 422, 'SPLIT_SHARE_REQUIRED');
  });

  test('arma sem exterior ou Doppler sem fase não tem preço: WEAPON_NOT_PRICEABLE e a porcentagem é obrigatória, mesmo com o chaveiro cotado', async () => {
    price(CHARM_KEY, 1000);
    price(AK_KEY, 9000);
    const noExterior = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 1000, components: [charm()] }));
    let prev = (await preview(noExterior.id, hangingOf(noExterior).id)).body.data;
    expect(prev).toMatchObject({ suggestion: null, suggestionUnavailableReason: 'WEAPON_NOT_PRICEABLE', result: null });
    expectError(await detach(noExterior.id, hangingOf(noExterior).id), 422, 'SPLIT_SHARE_REQUIRED');

    // arma Gamma Doppler sem fase (D365 B1): não é avaliável
    const doppler = await createItemViaApi(app, akBody({ purchasePriceCents: 1000 }));
    getDb().prepare("UPDATE items SET name = 'Glock-18 | Gamma Doppler', exterior = 'FN', phase = NULL, catalog_id = NULL WHERE id = ?").run(doppler.id);
    prev = (await preview(doppler.id, hangingOf(doppler).id)).body.data;
    expect(prev).toMatchObject({ suggestion: null, suggestionUnavailableReason: 'WEAPON_NOT_PRICEABLE' });
    expectError(await detach(doppler.id, hangingOf(doppler).id), 422, 'SPLIT_SHARE_REQUIRED');
    const manual = await detach(doppler.id, hangingOf(doppler).id, { hangingShareBp: 2000 });
    expect(manual.status).toBe(201);
    expect(manual.body.data.item.cost.effectiveUsdCents).toBe(800);
    expect(manual.body.data.detachedItem.cost.effectiveUsdCents).toBe(200);
  });

  test('chaveiro sem catalogId é recusado (COMPONENT_CATALOG_REQUIRED) mesmo com a porcentagem', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1000 }));
    getDb().prepare('UPDATE item_components SET catalog_id = NULL WHERE item_id = ?').run(ak.id);
    const res = await detach(ak.id, hangingOf(await itemOf(ak.id)).id, { hangingShareBp: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('COMPONENT_CATALOG_REQUIRED');
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM items WHERE acquisition_type = 'GERADO'").get().n).toBe(0);
    expect((await itemOf(ak.id)).components).toHaveLength(1);
  });

  test('0 % e 100 % com sugestão disponível são manuais; igual à sugestão fica MARKET_CACHE; soma sempre igual ao custo', async () => {
    price(AK_KEY, 9000);
    price(CHARM_KEY, 1000);
    for (const [bp, weapon, generated, basis] of [[0, 777, 0, 'MANUAL'], [10000, 0, 777, 'MANUAL'], [1000, 700, 77, 'MARKET_CACHE'], [1001, 700, 77, 'MANUAL']]) {
      const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 777 }));
      const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: bp });
      expect(res.status).toBe(201);
      const w = res.body.data.item.cost.effectiveUsdCents;
      const g = res.body.data.detachedItem.cost.effectiveUsdCents;
      expect(w + g).toBe(777);
      expect([w, g]).toEqual([weapon, generated]);
      expect(detailOf(res.body.data.operation.id).share.basis).toBe(basis);
    }
  });

  test('os dois preços zerados: sem sugestão (não divide por zero) e porcentagem obrigatória', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1000 }));
    price(AK_KEY, 0);
    price(CHARM_KEY, 0);
    const res = await preview(ak.id, hangingOf(ak).id);
    expect(res.status).toBe(200);
    expect(res.body.data.suggestion).toBeNull();
    expectError(await detach(ak.id, hangingOf(ak).id), 422, 'SPLIT_SHARE_REQUIRED');
  });

  test('a prévia com porcentagem informada usa a informada e continua mostrando a sugestão; a prévia nunca grava nada', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1000 }));
    price(AK_KEY, 9000);
    price(CHARM_KEY, 1000);
    const before = JSON.stringify(await itemOf(ak.id));
    const prev = (await preview(ak.id, hangingOf(ak).id, '?hangingShareBp=5000')).body.data;
    expect(prev.suggestion.hangingShareBp).toBe(1000);
    expect(prev.appliedShareBp).toBe(5000);
    expect(prev.result).toEqual({ weaponUsdCents: 500, detachedUsdCents: 500 });
    expectError(await preview(ak.id, hangingOf(ak).id, '?hangingShareBp=10001'), 422, 'INVALID_OPERATION_INPUT');
    expect((await preview(ak.id, hangingOf(ak).id, '?hangingShareBp=1.5')).status).toBe(400);
    expect(JSON.stringify(await itemOf(ak.id))).toBe(before);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM item_operations').get().n).toBe(0);
  });

  test('hangingShareBp nulo no corpo equivale a não informar; texto e lista são recusados', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1000 }));
    price(AK_KEY, 9000);
    price(CHARM_KEY, 1000);
    expect((await detach(ak.id, hangingOf(ak).id, { hangingShareBp: '10' })).status).toBe(400);
    expect((await detach(ak.id, hangingOf(ak).id, { hangingShareBp: [1] })).status).toBe(400);
    const ok = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: null });
    expect(ok.status).toBe(201);
    expect(ok.body.data.detachedItem.cost.effectiveUsdCents).toBe(100);
  });
});

describe('custo dividido depois de outras operações', () => {
  test('depois de aplicar sticker do estoque, a divisão leva o custo do sticker junto; depois de separar, outro sticker soma só na arma', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1000 }));
    const s1 = await createItemViaApi(app, purchaseBody({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 100 }));
    const s2 = await createItemViaApi(app, purchaseBody({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 50 }));
    expect((await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: s1.id, appliedAt: AT })).status).toBe(201);
    expect((await itemOf(ak.id)).cost.effectiveUsdCents).toBe(1100);
    const split = await detach(ak.id, hangingOf(await itemOf(ak.id)).id, { hangingShareBp: 2500 });
    expect(split.body.data.item.cost.effectiveUsdCents).toBe(825);
    expect(split.body.data.detachedItem.cost.effectiveUsdCents).toBe(275);
    expect((await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: s2.id, appliedAt: '2026-11-18T12:00:00.000Z' })).status).toBe(201);
    expect((await itemOf(ak.id)).cost.effectiveUsdCents).toBe(875);
    expect((await itemOf(split.body.data.detachedItem.id)).cost.effectiveUsdCents).toBe(275);
    // a separação não pode mais ser desfeita (a arma tem uma operação mais recente); desfazer a aplicação do sticker libera
    blocked(await undo(split.body.data.operation.id), 409, 'OPERATION_UNDO_BLOCKED', { reason: 'NOT_LATEST' });
  });

  test('separação antes de outra aplicação e a aplicação desfeita depois: os centavos do sticker seguem a ordem das operações', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1001 }));
    const s1 = await createItemViaApi(app, purchaseBody({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 33 }));
    const split = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 3333 }); // 668 e 333
    expect(split.body.data.item.cost.effectiveUsdCents).toBe(668);
    const applied = await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: s1.id, appliedAt: '2026-11-18T12:00:00.000Z' });
    expect((await itemOf(ak.id)).cost.effectiveUsdCents).toBe(701);
    expect((await undo(applied.body.data.operation.id)).status).toBe(200);
    expect((await itemOf(ak.id)).cost.effectiveUsdCents).toBe(668);
    expect((await undo(split.body.data.operation.id)).status).toBe(200);
    expect((await itemOf(ak.id)).cost.effectiveUsdCents).toBe(1001);
  });

  test('arma obtida de caixa (custo herdado da caixa e da chave) com chaveiro posto à mão: divide o custo efetivo inteiro', async () => {
    const row = (id, category, name) => ({
      id, source: 'CRATES', category, name, nameKey: normalizeSearchText(name), searchText: normalizeSearchText(name), minFloat: null, maxFloat: null,
      hasStattrak: false, hasSouvenir: false,
    });
    CatalogItem.upsertMany([row('crate-kilowatt', 'CAIXA', 'Kilowatt Case')]);
    const box = await createItemViaApi(app, purchaseBody({ catalogId: 'crate-kilowatt', purchasePriceCents: 200 }));
    const key = await createItemViaApi(app, purchaseBody({ category: 'OUTRO', name: 'Kilowatt Case Key', catalogId: undefined, purchasePriceCents: 301 }));
    const opened = await post(`/api/items/${box.id}/open`, {
      openedAt: AT, keyItemId: key.id, generated: { catalogId: CAT.AK_REDLINE, variant: 'NORMAL', floatValue: 0.15, exterior: 'FT' },
    });
    expect(opened.status).toBe(201);
    const weapon = opened.body.data.generatedItem;
    expect(weapon.cost.effectiveUsdCents).toBe(501);
    const withCharm = await patch(`/api/items/${weapon.id}`, { components: [charm()] });
    expect(withCharm.status).toBe(200);
    const before = numbers(await profit());
    const res = await detach(weapon.id, hangingOf(withCharm.body.data).id, { hangingShareBp: 5000, detachedAt: '2026-11-16T12:00:00.000Z' });
    expect(res.status).toBe(201);
    // 501 * 50 % = 250,5: empate, o centavo vai para a arma (menor id)
    expect(res.body.data.item.cost.effectiveUsdCents).toBe(251);
    expect(res.body.data.detachedItem.cost.effectiveUsdCents).toBe(250);
    expect(numbers(await profit())).toEqual(before);
    // a abertura da caixa não pode mais ser desfeita (a arma tem uma operação mais recente); desfazer a separação libera
    blocked(await undo(opened.body.data.operation.id), 409, 'OPERATION_UNDO_BLOCKED', { reason: 'NOT_LATEST' });
    expect((await undo(res.body.data.operation.id)).status).toBe(200);
    expect((await itemOf(weapon.id)).cost.effectiveUsdCents).toBe(501);
    expect((await undo(opened.body.data.operation.id)).status).toBe(200);
  });

  test('compra em BRL com chaveiro: arma e separada "≈"; o preço mínimo da arma usa a parte nativa em BRL escalada e cai', async () => {
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5 });
    const ak = await createItemViaApi(app, akBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 1000, fxRateAtPurchase: 5 }));
    const minOf = (item) => item.minPrices.map((m) => [m.storeName, m.minPriceCents]);
    const before = minOf(await itemOf(ak.id));
    const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 5000 });
    const after = minOf(res.body.data.item);
    expect(after.find(([n]) => n === 'Steam')[1]).toBeLessThan(before.find(([n]) => n === 'Steam')[1]);
    expect(after.find(([n]) => n === 'CSFloat')[1]).toBeLessThan(before.find(([n]) => n === 'CSFloat')[1]);
    const genMins = Object.fromEntries(minOf(res.body.data.detachedItem));
    expect(genMins.Steam).toBeGreaterThan(0);
    expect(genMins.CSFloat).toBeGreaterThan(0);
    expect(res.body.data.detachedItem.cost.estimated).toBe(true);
    await undo(res.body.data.operation.id);
    expect(minOf(await itemOf(ak.id))).toEqual(before);
  });
});

describe('números idênticos sem separação e conservação do custo', () => {
  const scenario = async () => {
    await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 100000, depositedAt: '2026-11-01T12:00:00.000Z' });
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1001 }));
    const ak2 = await createItemViaApi(app, akBody({ purchasePriceCents: 2000, components: [] }));
    const sticker = await createItemViaApi(app, purchaseBody({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 50 }));
    await post(`/api/items/${ak2.id}/apply-component`, { sourceItemId: sticker.id, appliedAt: AT });
    const sold = await createItemViaApi(app, purchaseBody({ purchasePriceCents: 400 }));
    await post(`/api/items/${sold.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 900, soldAt: '2026-11-18T12:00:00.000Z' });
    price(AK_KEY, 9000);
    price(CHARM_KEY, 1000);
    return { ak, ak2, sold };
  };
  // `id` do componente (recriado no desfazer) e `componentsImportedAt` (marcado na separação para a varredura não recolocar) mudam de propósito.
  const strip = (value) => JSON.parse(JSON.stringify(value, (k, v) => (['updatedAt', 'componentsImportedAt'].includes(k) ? undefined : v)));
  const noComponentIds = (snap) => JSON.parse(JSON.stringify(snap, (k, v) => (k === 'components' ? v.map(({ id, ...rest }) => rest) : v))); // eslint-disable-line no-unused-vars
  const snapshot = async () => ({
    profit: await profit(),
    items: strip((await get('/api/items')).body.data),
    groups: strip((await get('/api/items/groups')).body.data),
    sales: strip((await get('/api/items/sales')).body.data),
    stats: strip((await get('/api/items/stats').query({ name: 'AK-47 | Redline', category: 'SKIN' })).body.data),
    market: strip((await get('/api/market-values/summary')).body.data),
  });

  test('separar e desfazer devolve exatamente os mesmos números (lucro real, saldos, estoque, itemStats, vendas, grupos, preço mínimo, valor de mercado)', async () => {
    const { ak } = await scenario();
    const before = await snapshot();
    const res = await detach(ak.id, hangingOf(ak).id);
    expect(res.status).toBe(201);
    expect(numbers((await snapshot()).profit)).toEqual(numbers(before.profit)); // total e saldos iguais com a separação ativa
    expect((await undo(res.body.data.operation.id)).status).toBe(200);
    const after = await snapshot();
    expect(noComponentIds(after)).toEqual(noComponentIds(before));
  });

  test('com a separação ativa: itemStats e grupos mostram as duas chaves, o preço mínimo e o valor de mercado seguem o novo custo', async () => {
    const { ak } = await scenario();
    const before = await snapshot();
    const res = await detach(ak.id, hangingOf(ak).id); // 10 % para o chaveiro: 901 e 100
    const gen = res.body.data.detachedItem;
    expect(res.body.data.item.cost.effectiveUsdCents).toBe(901);

    // itemStats do AK: a compra de 1001 virou 901 na unidade; chave do pingente nova com a unidade gerada
    const statsAk = (await get('/api/items/stats').query({ name: 'AK-47 | Redline', category: 'SKIN' })).body.data;
    const statsCharm = (await get('/api/items/stats').query({ name: "Charm | Lil' Ava", category: 'PINGENTE' })).body.data;
    expect(statsAk).toEqual(before.stats); // as unidades vendidas da chave do AK não mudam
    expect(statsCharm).toMatchObject({ key: "charm | lil' ava|PINGENTE|||", unitCount: 1, soldCount: 0, avgPurchaseCostUsdCents: 100 });

    // grupos: um grupo novo do chaveiro com custo 100; o do AK com custo menor
    const groups = (await get('/api/items/groups')).body.data.groups;
    const charmGroup = groups.find((g) => g.category === 'PINGENTE');
    expect(charmGroup).toBeTruthy();
    expect(charmGroup.quantity).toBe(1);
    expect(charmGroup.totalCostUsdCents).toBe(100);
    const akGroupBefore = before.groups.groups.find((g) => g.category === 'SKIN');
    const akGroupAfter = groups.find((g) => g.category === 'SKIN');
    expect(akGroupBefore.totalCostUsdCents - akGroupAfter.totalCostUsdCents).toBe(100);

    // preço mínimo: a arma mais barata
    const minBefore = before.items.items.find((i) => i.id === ak.id).minPrices[0].minPriceCents;
    expect(res.body.data.item.minPrices[0].minPriceCents).toBeLessThan(minBefore);

    // valor de mercado: a arma vale só a base e a gerada, o preço do chaveiro; não realizado muda com o custo
    expect(res.body.data.item.marketValue).toMatchObject({ status: 'OK', marketValueUsdCents: 9000, costUsdCents: 901 });
    const genView = await itemOf(gen.id);
    expect(genView.marketValue).toMatchObject({ status: 'OK', marketValueUsdCents: 1000, costUsdCents: 100, unrealizedUsdCents: 900 });
    const marketAfter = (await get('/api/market-values/summary')).body.data;
    expect(marketAfter.totals.marketValueUsdCents).toBe(before.market.totals.marketValueUsdCents);
    expect(marketAfter.totals.unitCount).toBe(before.market.totals.unitCount + 1);

    // vender a separada: lucro da venda = líquido - 100; lucro real total muda só pelo lucro da venda
    const sold = await post(`/api/items/${gen.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 500, soldAt: '2026-11-18T12:00:00.000Z' });
    expect(sold.status).toBe(200);
    expect(sold.body.data.item.saleProfitUsdCents).toBe(sold.body.data.item.netReceivedCents - 100);
    const salesList = (await get('/api/items/sales')).body.data;
    expect(JSON.stringify(salesList)).toContain('Lil');
  });

  test('o mesmo cenário com GANHEI e arma sem custo: 0 e 0, sem divisão por zero, e o lucro real não muda', async () => {
    const won = await createItemViaApi(app, akBody({ acquisitionType: 'GANHEI', purchaseStoreId: undefined, purchasePriceCents: undefined }));
    const before = numbers(await profit());
    const res = await detach(won.id, hangingOf(won).id, { hangingShareBp: 3333 });
    expect(res.body.data.item.cost.effectiveUsdCents).toBe(0);
    expect(res.body.data.detachedItem.cost.effectiveUsdCents).toBe(0);
    expect(numbers(await profit())).toEqual(before);
  });
});

describe('SPLIT completo', () => {
  test('arma no holding, chaveiro com trade lock futuro: a separada nasce à venda, o giro conta do trade lock e a arma segue no holding', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 500 }));
    await post(`/api/items/${ak.id}/off-sale`);
    const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 1000, tradeUnlockAt: '2026-11-24T12:00:00.000Z' });
    const gen = res.body.data.detachedItem;
    expect(res.body.data.item.saleState).toBe('OFF_SALE');
    expect(gen).toMatchObject({ saleState: 'FOR_SALE', acquisitionType: 'GERADO', status: 'EM_ESTOQUE' });
    expect(gen.aging.agingBucket).toBe('EM_TRADE_LOCK');
    expect(gen.forSaleSince ?? DETACH_AT).toBe(DETACH_AT);
    // a gerada entra no estoque "à venda" do lucro real, e a arma no "holding"
    const p = await profit();
    expect(p.stockBreakdown.forSale.usdCents).toBe(gen.cost.effectiveUsdCents);
    expect(p.stockBreakdown.offSale.usdCents).toBe(res.body.data.item.cost.effectiveUsdCents);
  });

  test('datas: igual à aquisição e igual a "agora" valem; o dia seguinte (São Paulo) e antes da aquisição são recusados', async () => {
    const ak = await createItemViaApi(app, akBody());
    const component = hangingOf(ak);
    const future = '2026-11-20T03:00:00.000Z'; // a regra de "futura" é por dia de São Paulo: 1 ms depois de agora ainda é hoje
    blocked(await detach(ak.id, component.id, { hangingShareBp: 1000, detachedAt: future }), 422, 'OPERATION_DATE_INVALID', { reason: 'FUTURE' });
    const before = new Date(Date.parse(ak.acquiredAt) - 1).toISOString();
    blocked(await detach(ak.id, component.id, { hangingShareBp: 1000, detachedAt: before }), 422, 'OPERATION_DATE_INVALID', { reason: 'BEFORE_TARGET_ACQUIRED' });
    expect((await detach(ak.id, component.id, { hangingShareBp: 1000, detachedAt: 'ontem' })).status).toBe(400);
    const now = await detach(ak.id, component.id, { hangingShareBp: 1000, detachedAt: NOW.toISOString() });
    expect(now.status).toBe(201);
    expect(now.body.data.detachedItem.acquiredAt).toBe(NOW.toISOString());
    const at = await createItemViaApi(app, akBody());
    const exact = await detach(at.id, hangingOf(at).id, { hangingShareBp: 1000, detachedAt: at.acquiredAt });
    expect(exact.status).toBe(201);
  });

  test('sem detachedAt usa o relógio do app; trade lock igual à separação vale', async () => {
    const ak = await createItemViaApi(app, akBody());
    const res = await post(`/api/items/${ak.id}/components/${hangingOf(ak).id}/detach`, { hangingShareBp: 1000, tradeUnlockAt: NOW.toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.data.operation.occurredAt).toBe(NOW.toISOString());
    expect(res.body.data.detachedItem.tradeUnlockAt).toBe(NOW.toISOString());
  });

  test('arma vendida, consumida ou inexistente; componente de outra arma; recusas não gravam nada', async () => {
    const ak = await createItemViaApi(app, akBody());
    const component = hangingOf(ak);
    await post(`/api/items/${ak.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 500, soldAt: '2026-11-18T12:00:00.000Z' });
    expectError(await detach(ak.id, component.id, { hangingShareBp: 1000 }), 409, 'ITEM_NOT_IN_STOCK');
    expectError(await preview(ak.id, component.id), 409, 'ITEM_NOT_IN_STOCK');
    // consumida: o chaveiro avulso foi aplicado em outra arma
    const unit = await createItemViaApi(app, purchaseBody({ catalogId: CAT.CHARM_LIL_AVA, purchasePriceCents: 50 }));
    const other = await createItemViaApi(app, akBody({ components: [] }));
    await post(`/api/items/${other.id}/apply-component`, { sourceItemId: unit.id, appliedAt: AT });
    expectError(await detach(unit.id, component.id), 409, 'ITEM_CONSUMED');
    expectError(await detach(99999, component.id), 404, 'ITEM_NOT_FOUND');
    expectError(await detach(other.id, 99999), 404, 'COMPONENT_NOT_FOUND');
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM item_operations WHERE kind = 'DETACH_COMPONENT'").get().n).toBe(0);
    // desvendida, a arma volta a aceitar a separação
    await post(`/api/items/${ak.id}/unsell`);
    expect((await detach(ak.id, component.id, { hangingShareBp: 1000 })).status).toBe(201);
  });

  test('sticker aplicado do estoque também não é separável (e o botão some: detachable false)', async () => {
    const ak = await createItemViaApi(app, akBody({ components: [] }));
    const sticker = await createItemViaApi(app, purchaseBody({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 50 }));
    const applied = await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: sticker.id, appliedAt: AT });
    const component = applied.body.data.item.components[0];
    expect(component).toMatchObject({ kind: 'STICKER', origin: 'APPLIED_FROM_STOCK', detachable: false });
    expectError(await detach(ak.id, component.id), 409, 'COMPONENT_NOT_DETACHABLE');
    expectError(await preview(ak.id, component.id), 409, 'COMPONENT_NOT_DETACHABLE');
  });

  test('Sticker Slab: o nome "Sticker Slab | X" não duplica o prefixo e o histórico guarda o pattern; desfazer devolve o slab com o pattern', async () => {
    const ak = await createItemViaApi(app, purchaseBody({ exterior: 'FT', purchasePriceCents: 400, components: [{ kind: 'STICKER_SLAB', catalogId: CAT.STICKER_TITAN, pattern: 9 }] }));
    const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 5000 });
    expect(res.body.data.detachedItem.name).toBe('Sticker Slab | Titan | Katowice 2014');
    expect(detailOf(res.body.data.operation.id).component).toMatchObject({ kind: 'STICKER_SLAB', pattern: 9, origin: 'CAME_WITH' });
    expect((await undo(res.body.data.operation.id)).status).toBe(200);
    expect(hangingOf(await itemOf(ak.id))).toMatchObject({ kind: 'STICKER_SLAB', pattern: 9, catalogId: CAT.STICKER_TITAN });
  });

  test('observação longa é recusada e nada é gravado; observação vazia vira nula', async () => {
    const ak = await createItemViaApi(app, akBody());
    expect((await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 1000, note: 'x'.repeat(501) })).status).toBe(422);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM item_operations').get().n).toBe(0);
    const ok = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 1000, note: '   ' });
    expect(ok.status).toBe(201);
    expect(opRow(ok.body.data.operation.id).note).toBeNull();
  });

  test('sem Content-Type JSON o POST é recusado e nada muda', async () => {
    const ak = await createItemViaApi(app, akBody());
    const res = await request(app).post(`/api/items/${ak.id}/components/${hangingOf(ak).id}/detach`).set('Content-Type', 'text/plain').send('{"hangingShareBp":1000}');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect((await itemOf(ak.id)).components).toHaveLength(1);
  });
});

describe('RETURN completo', () => {
  async function applied({ unitExtra = {}, offSale = true } = {}) {
    const ak = await createItemViaApi(app, akBody({ components: [], purchasePriceCents: 1000 }));
    const unit = await createItemViaApi(app, purchaseBody({ catalogId: CAT.CHARM_LIL_AVA, purchasePriceCents: 301, ...unitExtra }));
    if (offSale) await post(`/api/items/${unit.id}/off-sale`);
    const ap = await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: unit.id, appliedAt: AT, pattern: 5 });
    expect(ap.status).toBe(201);
    return { ak, unit, applyOpId: ap.body.data.operation.id, component: hangingOf(ap.body.data.item) };
  }

  test('a unidade estava no holding na aplicação: volta à venda; giro recomeça na data; a arma no holding continua lá', async () => {
    const { ak, unit, component } = await applied();
    await post(`/api/items/${ak.id}/off-sale`);
    const res = await detach(ak.id, component.id);
    expect(res.body.data.item.saleState).toBe('OFF_SALE');
    expect(res.body.data.detachedItem).toMatchObject({ id: unit.id, saleState: 'FOR_SALE', forSaleSince: DETACH_AT, offSaleAt: null });
    expect(res.body.data.detachedItem.cost.effectiveUsdCents).toBe(301);
    // giro conta da data da separação (3 dias até o relógio do app) e não da compra
    expect(res.body.data.detachedItem.aging.daysForSale ?? res.body.data.detachedItem.aging.daysInStock).toBeLessThanOrEqual(3);
  });

  test('trade lock informado menor que o atual é ignorado (o anterior fica); maior substitui e o desfazer restaura o original', async () => {
    const { ak, unit, component } = await applied({ unitExtra: { tradeUnlockAt: '2026-11-22T12:00:00.000Z' } });
    const lower = await detach(ak.id, component.id, { tradeUnlockAt: '2026-11-21T12:00:00.000Z' });
    expect(lower.body.data.detachedItem.tradeUnlockAt).toBe('2026-11-22T12:00:00.000Z');
    expect(detailOf(lower.body.data.operation.id).previous).toMatchObject({ tradeUnlockAt: '2026-11-22T12:00:00.000Z' });
    await undo(lower.body.data.operation.id);

    const again = await detach(ak.id, hangingOf(await itemOf(ak.id)).id, { tradeUnlockAt: '2026-11-30T12:00:00.000Z' });
    expect(again.body.data.detachedItem.tradeUnlockAt).toBe('2026-11-30T12:00:00.000Z');
    expect((await undo(again.body.data.operation.id)).status).toBe(200);
    expect(await itemOf(unit.id)).toMatchObject({ status: 'CONSUMIDO', tradeUnlockAt: '2026-11-22T12:00:00.000Z' });
  });

  test('data igual à da aplicação vale; um milissegundo antes é BEFORE_APPLIED; futura é FUTURE', async () => {
    const { ak, component } = await applied();
    blocked(await detach(ak.id, component.id, { detachedAt: new Date(Date.parse(AT) - 1).toISOString() }), 422, 'OPERATION_DATE_INVALID', { reason: 'BEFORE_APPLIED' });
    blocked(await detach(ak.id, component.id, { detachedAt: '2026-12-31T00:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { reason: 'FUTURE' });
    expect((await detach(ak.id, component.id, { detachedAt: AT })).status).toBe(201);
  });

  test('a devolvida vendida bloqueia o desfazer (TARGET_SOLD) e "desfazer venda" libera; a arma com outra operação mais recente (NOT_LATEST)', async () => {
    const { ak, unit, component } = await applied();
    const res = await detach(ak.id, component.id);
    const opId = res.body.data.operation.id;
    await post(`/api/items/${unit.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 900, soldAt: '2026-11-18T12:00:00.000Z' });
    blocked(await undo(opId), 409, 'OPERATION_UNDO_BLOCKED', { reason: 'TARGET_SOLD', itemId: unit.id });
    await post(`/api/items/${unit.id}/unsell`);
    // outra aplicação na arma torna a separação não-mais-recente
    const sticker = await createItemViaApi(app, purchaseBody({ catalogId: CAT.STICKER_TITAN, purchasePriceCents: 10 }));
    const second = await post(`/api/items/${ak.id}/apply-component`, { sourceItemId: sticker.id, appliedAt: '2026-11-18T12:00:00.000Z' });
    blocked(await undo(opId), 409, 'OPERATION_UNDO_BLOCKED', { reason: 'NOT_LATEST' });
    await undo(second.body.data.operation.id);
    expect((await undo(opId)).status).toBe(200);
  });

  test('a aplicação encerrada fica no histórico da unidade e da arma; desfazer a aplicação encerrada recusa; depois da devolução a unidade aplica de novo e o histórico guarda as duas', async () => {
    const { ak, unit, applyOpId, component } = await applied();
    const res = await detach(ak.id, component.id);
    const unitOps = (await get(`/api/items/${unit.id}/operations`)).body.data;
    expect(unitOps.map((o) => o.kind)).toEqual(expect.arrayContaining(['APPLY_COMPONENT', 'DETACH_COMPONENT']));
    expect(unitOps.find((o) => o.id === applyOpId)).toMatchObject({ undoable: false, undoBlockedReason: 'DETACHED' });
    expect(unitOps.find((o) => o.kind === 'DETACH_COMPONENT').detail.detach).toMatchObject({ mode: 'RETURN' });
    const other = await createItemViaApi(app, akBody({ components: [], purchasePriceCents: 10 }));
    const second = await post(`/api/items/${other.id}/apply-component`, { sourceItemId: unit.id, appliedAt: DETACH_AT });
    expect(second.status).toBe(201);
    // a separação anterior ficou sem desfazer (a unidade tem aplicação mais recente)
    blocked(await undo(res.body.data.operation.id), 409, 'OPERATION_UNDO_BLOCKED', { reason: 'NOT_LATEST' });
    expect((await undo(second.body.data.operation.id)).status).toBe(200);
    expect((await undo(res.body.data.operation.id)).status).toBe(200);
    expect((await undo(applyOpId)).status).toBe(200);
  });

  test('RETURN: arma com outro pendurado à mão depois do desfazer da separação é HANGING_OCCUPIED e nada é alterado', async () => {
    const { ak, unit, component } = await applied();
    const res = await detach(ak.id, component.id);
    await patch(`/api/items/${ak.id}`, { components: [charm({ pattern: 3 })] });
    const stateBefore = JSON.stringify([await itemOf(unit.id), await itemOf(ak.id)]);
    blocked(await undo(res.body.data.operation.id), 409, 'OPERATION_UNDO_BLOCKED', { reason: 'HANGING_OCCUPIED', itemId: ak.id });
    expect(JSON.stringify([await itemOf(unit.id), await itemOf(ak.id)])).toBe(stateBefore);
    expect(opRow(res.body.data.operation.id).undone_at).toBeNull();
  });
});

describe('cadeia separar, aplicar em outra arma e devolver', () => {
  test('chaveiro e slab separados (custo dividido) aplicados em outra arma e devolvidos: o custo da separada se conserva e as duas armas voltam ao próprio', async () => {
    const w1 = await createItemViaApi(app, akBody({ purchasePriceCents: 1000 }));
    const slabWeapon = await createItemViaApi(app, purchaseBody({ exterior: 'FT', purchasePriceCents: 400, components: [{ kind: 'STICKER_SLAB', catalogId: CAT.STICKER_TITAN, pattern: 9 }] }));
    const w2 = await createItemViaApi(app, akBody({ components: [], purchasePriceCents: 500 }));
    const before = numbers(await profit());
    const charmGen = (await detach(w1.id, hangingOf(w1).id, { hangingShareBp: 2000 })).body.data.detachedItem;
    const slabGen = (await detach(slabWeapon.id, hangingOf(slabWeapon).id, { hangingShareBp: 2500 })).body.data.detachedItem;
    expect(numbers(await profit()).stock).toBe(before.stock);
    for (const [gen, expected] of [[charmGen, 200], [slabGen, 100]]) {
      const applied = await post(`/api/items/${w2.id}/apply-component`, { sourceItemId: gen.id, appliedAt: '2026-11-18T12:00:00.000Z' });
      expect(applied.status).toBe(201);
      expect((await itemOf(w2.id)).cost.effectiveUsdCents).toBe(500 + expected);
      expect(numbers(await profit()).stock).toBe(before.stock);
      const component = hangingOf(applied.body.data.item);
      expect(component).toMatchObject({ origin: 'APPLIED_FROM_STOCK', detachable: true });
      const back = await detach(w2.id, component.id, { detachedAt: '2026-11-19T12:00:00.000Z' });
      expect(back.status).toBe(201);
      expect(back.body.data.item.cost.effectiveUsdCents).toBe(500);
      expect(back.body.data.detachedItem).toMatchObject({ id: gen.id, status: 'EM_ESTOQUE' });
      expect(back.body.data.detachedItem.cost.effectiveUsdCents).toBe(expected);
      expect(numbers(await profit()).stock).toBe(before.stock);
    }
    // o desfazer das separações originais ficou NOT_LATEST: as unidades têm operações mais recentes
    const ops = getDb().prepare("SELECT id FROM item_operations WHERE kind = 'DETACH_COMPONENT' ORDER BY id").all();
    blocked(await undo(ops[0].id), 409, 'OPERATION_UNDO_BLOCKED', { reason: 'NOT_LATEST' });
  });
});

describe('desfazer', () => {
  test('já desfeita (OPERATION_ALREADY_UNDONE) e inexistente; desfazer duas vezes não duplica o chaveiro nem altera nada', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1001 }));
    const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 3333 });
    const opId = res.body.data.operation.id;
    expect((await undo(opId)).status).toBe(200);
    expectError(await undo(opId), 409, 'OPERATION_ALREADY_UNDONE');
    expectError(await undo(99999), 404, 'OPERATION_NOT_FOUND');
    expect((await itemOf(ak.id)).components).toHaveLength(1);
  });

  test('histórico guarda o retrato da gerada e o desfeito sai do custo; separar de novo depois do desfazer funciona', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1001 }));
    const first = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 3333 });
    await undo(first.body.data.operation.id);
    const history = (await get(`/api/items/${ak.id}/operations`)).body.data;
    const entry = history.find((o) => o.id === first.body.data.operation.id);
    expect(entry).toMatchObject({ undoable: false });
    expect(entry.undoneAt).toBeTruthy();
    expect(detailOf(entry.id).undoneGenerated).toMatchObject({ category: 'PINGENTE', acquisitionType: 'GERADO' });
    const second = await detach(ak.id, hangingOf(await itemOf(ak.id)).id, { hangingShareBp: 5000 });
    expect(second.status).toBe(201);
    expect(second.body.data.item.cost.effectiveUsdCents).toBe(501);
    expect(second.body.data.detachedItem.cost.effectiveUsdCents).toBe(500);
  });

  test('a separada pode ir para o holding antes do desfazer e o desfazer a remove; a arma vendida bloqueia (TARGET_SOLD) e desvender libera', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 800 }));
    const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 2500 });
    const gen = res.body.data.detachedItem;
    await post(`/api/items/${gen.id}/off-sale`);
    await post(`/api/items/${ak.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 900, soldAt: '2026-11-18T12:00:00.000Z' });
    blocked(await undo(res.body.data.operation.id), 409, 'OPERATION_UNDO_BLOCKED', { reason: 'TARGET_SOLD', itemId: ak.id });
    await post(`/api/items/${ak.id}/unsell`);
    const done = await undo(res.body.data.operation.id);
    expect(done.status).toBe(200);
    expect((await get(`/api/items/${gen.id}`)).status).toBe(404);
    expect((await itemOf(ak.id)).cost.effectiveUsdCents).toBe(800);
  });

  test('a separada com uma venda desfeita no histórico some junto no desfazer (sem sobrar operação presa ao item removido)', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 800 }));
    const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 2500 });
    const gen = res.body.data.detachedItem;
    const other = await createItemViaApi(app, akBody({ components: [], purchasePriceCents: 20 }));
    const applied = await post(`/api/items/${other.id}/apply-component`, { sourceItemId: gen.id, appliedAt: DETACH_AT });
    await undo(applied.body.data.operation.id);
    expect((await undo(res.body.data.operation.id)).status).toBe(200);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM item_operation_links WHERE item_id = ?').get(gen.id).n).toBe(0);
    expect(getDb().pragma('foreign_key_check')).toEqual([]);
  });
});

describe('proteções da gerada, da devolvida e da arma', () => {
  test('gerada: tipo, loja, data, custo e exclusão protegidos; nome/preço-alvo livres; a arma e a gerada não podem ser excluídas com a separação ativa', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1000 }));
    const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 1000 });
    const gen = res.body.data.detachedItem;
    for (const body of [{ acquisitionType: 'COMPRA' }, { purchaseStoreId: storeId('CSFloat') }, { acquiredAt: '2026-11-18T12:00:00.000Z' }]) {
      expectError(await patch(`/api/items/${gen.id}`, body), 409, 'GENERATED_FIELD_LOCKED');
    }
    expectError(await patch(`/api/items/${gen.id}`, { purchasePriceCents: 10 }), 422, 'GENERATED_COST_NOT_ALLOWED');
    expectError(await request(app).delete(`/api/items/${gen.id}`), 409, 'ITEM_IN_OPERATION');
    expectError(await request(app).delete(`/api/items/${ak.id}`), 409, 'ITEM_IN_OPERATION');
    // editar outras coisas na arma continua livre e não mexe no custo
    const edited = await patch(`/api/items/${ak.id}`, { floatValue: 0.21 });
    expect(edited.status).toBe(200);
    expect(edited.body.data.cost.effectiveUsdCents).toBe(900);
    // depois de desfazer, a arma pode ser excluída
    await undo(res.body.data.operation.id);
    expect((await request(app).delete(`/api/items/${ak.id}`)).status).toBe(200);
  });

  test('editar a arma depois de separar para trocar o chaveiro à mão não toca na gerada; trocar o preço de compra da arma muda só a arma na ordem da dobra', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1000 }));
    const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 2000 });
    const gen = res.body.data.detachedItem;
    const edited = await patch(`/api/items/${ak.id}`, { purchasePriceCents: 2000 });
    expect(edited.status).toBe(200);
    // a divisão é calculada na hora sobre o custo corrente da arma: 2000 * 20 % para a gerada
    expect(edited.body.data.cost.effectiveUsdCents).toBe(1600);
    expect((await itemOf(gen.id)).cost.effectiveUsdCents).toBe(400);
  });
});

describe('bulk e estados de venda com a separada', () => {
  test('a separada e a devolvida entram no estoque à venda e podem ir para o holding e voltar sem mudar o custo', async () => {
    const ak = await createItemViaApi(app, akBody({ purchasePriceCents: 1000 }));
    const res = await detach(ak.id, hangingOf(ak).id, { hangingShareBp: 1000 });
    const gen = res.body.data.detachedItem;
    const before = numbers(await profit());
    expect((await post(`/api/items/${gen.id}/off-sale`)).status).toBe(200);
    expect((await post(`/api/items/${gen.id}/for-sale`)).status).toBe(200);
    const after = numbers(await profit());
    expect(after.stock).toBe(before.stock);
    expect((await itemOf(gen.id)).cost.effectiveUsdCents).toBe(100);
  });
});
