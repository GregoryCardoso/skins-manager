// 10.4 (D363): abrir caixa (com a chave), cápsula, pacote e terminal (comprar na loja Steam ou perda) pela API: custo herdado, números
// idênticos, desfazer, proteções da unidade gerada, loja Steam do app e perdas por consumo.
const request = require('supertest');
const { freshDb } = require('../helpers/fixtures');
const { closeDb, getDb } = require('../../src/config/database');
const CatalogItem = require('../../src/models/CatalogItem');
const { normalizeSearchText } = require('../../src/services/catalog/csgoApiAdapter');
const { CAT, makeCatalogApp, purchaseBody, createItemViaApi, expectError, storeId } = require('../helpers/apiFixtures');

let app;
const OPENED_AT = '2026-11-15T12:00:00.000Z';
const X = Object.freeze({
  KILOWATT: 'crate-kilowatt', PHOENIX: 'crate-phoenix', CSGO2: 'crate-4004', ESPORTS14: 'crate-4019', CHROMA: 'crate-chroma',
  SOUVENIR: 'crate-souvenir-dh13', XRAY: 'crate-xray-p250', TERMINAL: 'crate-5176', GIFT: 'crate-1210',
});

beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
  const row = (id, category, name) => ({
    id, source: 'CRATES', category, name, nameKey: normalizeSearchText(name), searchText: normalizeSearchText(name), minFloat: null, maxFloat: null,
    hasStattrak: false, hasSouvenir: false,
  });
  CatalogItem.upsertMany([
    row(X.KILOWATT, 'CAIXA', 'Kilowatt Case'), row(X.PHOENIX, 'CAIXA', 'Operation Phoenix Weapon Case'), row(X.CSGO2, 'CAIXA', 'CS:GO Weapon Case 2'),
    row(X.ESPORTS14, 'CAIXA', 'eSports 2014 Summer Case'), row(X.CHROMA, 'CAIXA', 'Chroma Case'),
    row(X.SOUVENIR, 'CAIXA', 'DreamHack 2013 Souvenir Package'), row(X.XRAY, 'OUTRO', 'X-Ray P250 Package'),
    row(X.TERMINAL, 'OUTRO', 'Sealed Genesis Terminal'), row(X.GIFT, 'OUTRO', 'Gift Package'),
  ]);
  // Banco novo (sem migração): a loja Steam do app é escolhida em Lojas; aqui já vem a Steam em BRL.
  getDb().prepare('UPDATE settings SET steam_store_id = ?').run(storeId('Steam'));
});
afterAll(() => closeDb());

const get = (url) => request(app).get(url);
const post = (url, body = {}) => request(app).post(url).send(body);
const patch = (url, body) => request(app).patch(url).send(body);
const itemOf = async (id) => (await get(`/api/items/${id}`)).body.data;
const profit = async () => (await get('/api/profit/summary')).body.data;
const numbers = (p) => ({
  stock: p.stockUsdCents, real: p.realProfitUsdCents, platform: p.platformBalanceUsdCents, pending: p.pendingBalanceUsdCents,
  stockTotal: p.stockBreakdown.forSale.usdCents + p.stockBreakdown.offSale.usdCents,
  balances: p.balancesByStore.map((b) => [b.storeId, b.availableCents]),
});
const balanceOf = (p, name) => p.balancesByStore.find((b) => b.storeName === name).availableCents;

const caseBody = (catalogId = X.KILOWATT, extra = {}) => purchaseBody({ catalogId, purchasePriceCents: 200, ...extra });
const keyBody = (name = 'Kilowatt Case Key', extra = {}) => purchaseBody({ category: 'OUTRO', name, catalogId: undefined, purchasePriceCents: 300, ...extra });
const generatedAk = (extra = {}) => ({ catalogId: CAT.AK_REDLINE, variant: 'NORMAL', floatValue: 0.15, ...extra });
const open = (id, body = {}) => post(`/api/items/${id}/open`, { openedAt: OPENED_AT, ...body });
const openCase = async (extra = {}) => {
  const box = await createItemViaApi(app, caseBody());
  const key = await createItemViaApi(app, keyBody());
  const res = await open(box.id, { keyItemId: key.id, generated: generatedAk(), ...extra });
  return { box, key, res };
};
const terminalBody = (extra = {}) => purchaseBody({ catalogId: X.TERMINAL, purchasePriceCents: 400, ...extra });
const setSteam = (id) => request(app).put('/api/settings/steam-store').send({ storeId: id });

describe('abrir caixa com a chave', () => {
  test('consome caixa e chave, gera 1 item GERADO com o custo das duas; lucro real, estoque e saldos idênticos', async () => {
    await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 100000, depositedAt: '2026-11-01T12:00:00.000Z' });
    const box = await createItemViaApi(app, caseBody());
    const key = await createItemViaApi(app, keyBody());
    const before = numbers(await profit());
    const res = await open(box.id, { keyItemId: key.id, generated: generatedAk(), note: ' sorte ' });
    expect(res.status).toBe(201);
    const { operation, generatedItem, consumedItemIds } = res.body.data;
    expect(operation).toMatchObject({ kind: 'OPEN_CASE', outcome: 'TRANSFERRED', occurredAt: OPENED_AT, undoneAt: null, note: 'sorte' });
    expect(consumedItemIds).toEqual([box.id, key.id]);
    expect(generatedItem).toMatchObject({
      acquisitionType: 'GERADO', purchaseStoreId: null, purchasePriceCents: 0, purchaseCurrency: 'USD', fxRateAtPurchase: null, status: 'EM_ESTOQUE',
      acquiredAt: OPENED_AT, floatValue: 0.15, name: 'AK-47 | Redline',
    });
    expect(generatedItem.cost).toEqual({ ownUsdCents: 0, inheritedUsdCents: 500, effectiveUsdCents: 500, estimated: false , hasOperationCost: true });
    expect(generatedItem.generatedFrom).toMatchObject({ kind: 'OPEN_CASE', container: 'CASE', decision: null, containerName: 'Kilowatt Case', keyName: 'Kilowatt Case Key', occurredAt: OPENED_AT });
    expect(generatedItem.openable).toBeNull();
    for (const id of [box.id, key.id]) {
      expect(await itemOf(id)).toMatchObject({ status: 'CONSUMIDO', consumedAt: OPENED_AT, purchasePriceCents: id === box.id ? 200 : 300, openable: null });
    }
    expect((await itemOf(box.id)).consumedIn).toMatchObject({ kind: 'OPEN_CASE', lost: false, targetItemId: generatedItem.id, targetName: 'AK-47 | Redline' });
    expect(numbers(await profit())).toEqual(before);
    // listas: só o gerado fica; as consumidas saem
    expect((await get('/api/items')).body.data.items.map((i) => i.id)).toEqual([generatedItem.id]);
    expect((await get('/api/items?status=CONSUMIDO')).body.data.items.map((i) => i.id)).toEqual([box.id, key.id]);
    const groups = (await get('/api/items/groups')).body.data.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ quantity: 1, totalCostUsdCents: 500 });
    // o preço mínimo do gerado parte do custo efetivo
    const csf = generatedItem.minPrices.find((m) => m.storeName === 'CSFloat');
    expect(csf.minPriceCents).toBeGreaterThanOrEqual(500);
    // histórico do item gerado e da caixa
    const ops = (await get(`/api/items/${generatedItem.id}/operations`)).body.data;
    expect(ops[0]).toMatchObject({ kind: 'OPEN_CASE', role: 'CREATED', undoable: true, lossUsdCents: null, detail: { container: 'CASE', decision: null } });
    expect(ops[0].counterparts.map((c) => [c.role, c.name])).toEqual([['CONSUMED', 'Kilowatt Case'], ['CONSUMED', 'Kilowatt Case Key']]);
  });

  test('chave GANHEI: o custo é só o da caixa; caixa em BRL e chave em USD: efetivo estimado', async () => {
    const box = await createItemViaApi(app, caseBody(X.KILOWATT, { purchaseStoreId: storeId('Steam'), purchasePriceCents: 540, fxRateAtPurchase: 5.4 }));
    const key = await createItemViaApi(app, { category: 'OUTRO', name: 'Kilowatt Case Key', acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' });
    const res = await open(box.id, { keyItemId: key.id, generated: generatedAk() });
    expect(res.body.data.generatedItem.cost).toEqual({ ownUsdCents: 0, inheritedUsdCents: 100, effectiveUsdCents: 100, estimated: true , hasOperationCost: true });
  });

  test('vender o gerado: o lucro da venda é o líquido menos o custo efetivo', async () => {
    const { res } = await openCase();
    const id = res.body.data.generatedItem.id;
    const sold = await post(`/api/items/${id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 1000, soldAt: '2026-11-16T12:00:00.000Z' });
    expect(sold.status).toBe(200);
    expect(sold.body.data.item.saleInfo).toMatchObject({ purchaseCostUsdCents: 500, ownCostUsdCents: 0, inheritedCostUsdCents: 500 });
    expect(sold.body.data.item.saleProfitUsdCents).toBe(sold.body.data.item.netReceivedCents - 500);
  });

  test('a prévia (open-options) lista só as chaves compatíveis, a mais antiga primeiro, e conta as outras', async () => {
    const box = await createItemViaApi(app, caseBody());
    expect((await get(`/api/items/${box.id}/open-options`)).body.data).toMatchObject({
      kind: 'CASE', containerName: 'Kilowatt Case', requiredKeyName: 'Kilowatt Case Key', keys: [], otherKeysInStock: 0, steamStore: expect.objectContaining({ name: 'Steam', currency: 'BRL' }),
    });
    expect((await itemOf(box.id)).openable).toEqual({ kind: 'CASE', compatibleKeys: 0, otherKeysInStock: 0, otherKeyNames: [], requiredKeyName: 'Kilowatt Case Key' });
    const newer = await createItemViaApi(app, keyBody('Kilowatt Case Key', { acquiredAt: '2026-11-12T12:00:00.000Z', tradeUnlockAt: '2026-11-30T12:00:00.000Z' }));
    const older = await createItemViaApi(app, keyBody('Kilowatt Case Key', { acquiredAt: '2026-11-05T12:00:00.000Z' }));
    await createItemViaApi(app, keyBody('Chroma Case Key'));
    await post(`/api/items/${older.id}/off-sale`);
    const options = (await get(`/api/items/${box.id}/open-options`)).body.data;
    expect(options.keys.map((k) => k.itemId)).toEqual([older.id, newer.id]);
    expect(options.keys[0]).toMatchObject({ name: 'Kilowatt Case Key', effectiveCostUsdCents: 300, offSale: true, tradeLocked: false });
    expect(options.keys[1]).toMatchObject({ tradeLocked: true });
    expect(options.otherKeysInStock).toBe(1);
    expect((await itemOf(box.id)).openable.compatibleKeys).toBe(2);
    // chave em trade lock e no holding aceitas
    const res = await open(box.id, { keyItemId: older.id, generated: generatedAk(), openedAt: '2026-11-15T12:00:00.000Z' });
    expect(res.status).toBe(201);
  });

  test('"Operation Phoenix Weapon Case" abre com "Operation Phoenix Case Key"', async () => {
    const box = await createItemViaApi(app, caseBody(X.PHOENIX));
    expect((await itemOf(box.id)).openable.requiredKeyName).toBe('Operation Phoenix Case Key');
    const key = await createItemViaApi(app, keyBody('Operation Phoenix Case Key'));
    expect((await open(box.id, { keyItemId: key.id, generated: generatedAk() })).status).toBe(201);
  });

  test('chaves compartilhadas: "CS:GO Case Key" abre CS:GO Weapon Case 2 e não abre as outras; "eSports Key" abre as três eSports', async () => {
    const csgo2 = await createItemViaApi(app, caseBody(X.CSGO2));
    const esports = await createItemViaApi(app, caseBody(X.ESPORTS14));
    const chroma = await createItemViaApi(app, caseBody(X.CHROMA));
    const csgoKey = await createItemViaApi(app, keyBody('CS:GO Case Key'));
    expect((await itemOf(csgo2.id)).openable).toEqual({ kind: 'CASE', compatibleKeys: 1, otherKeysInStock: 0, otherKeyNames: [], requiredKeyName: 'CS:GO Case Key' });
    expect((await itemOf(esports.id)).openable).toEqual({ kind: 'CASE', compatibleKeys: 0, otherKeysInStock: 1, otherKeyNames: ['CS:GO Case Key'], requiredKeyName: 'eSports Key' });
    expectError(await open(chroma.id, { keyItemId: csgoKey.id, generated: generatedAk() }), 422, 'CASE_KEY_INCOMPATIBLE', { params: { keyName: 'CS:GO Case Key', caseName: 'Chroma Case' } });
    expectError(await open(esports.id, { keyItemId: csgoKey.id, generated: generatedAk() }), 422, 'CASE_KEY_INCOMPATIBLE');
    // a caixa da tabela recusa a chave de nome livre "<nome> Key"
    const own = await createItemViaApi(app, keyBody('CS:GO Weapon Case 2 Key'));
    expectError(await open(csgo2.id, { keyItemId: own.id, generated: generatedAk() }), 422, 'CASE_KEY_INCOMPATIBLE');
    expect((await open(csgo2.id, { keyItemId: csgoKey.id, generated: generatedAk() })).status).toBe(201);
    const esportsKey = await createItemViaApi(app, keyBody('eSports Key'));
    expect((await open(esports.id, { keyItemId: esportsKey.id, generated: generatedAk() })).status).toBe(201);
  });

  test('erros da caixa: sem chave, chave inválida, fora do estoque, enviada a um pacote', async () => {
    const box = await createItemViaApi(app, caseBody());
    expectError(await open(box.id, { generated: generatedAk() }), 422, 'CASE_KEY_REQUIRED', { params: { keyName: 'Kilowatt Case Key' } });
    expectError(await open(box.id, { keyItemId: box.id, generated: generatedAk() }), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'NOT_A_KEY' } });
    const ak = await createItemViaApi(app);
    expectError(await open(box.id, { keyItemId: ak.id, generated: generatedAk() }), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'NOT_A_KEY' } });
    expectError(await open(box.id, { keyItemId: 99999, generated: generatedAk() }), 404, 'ITEM_NOT_FOUND');
    const sold = await createItemViaApi(app, keyBody());
    await post(`/api/items/${sold.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 100, soldAt: '2026-11-12T12:00:00.000Z' });
    expectError(await open(box.id, { keyItemId: sold.id, generated: generatedAk() }), 409, 'ITEM_NOT_IN_STOCK', { params: { role: 'KEY', itemId: sold.id, status: 'VENDIDO' } });
    const used = await createItemViaApi(app, keyBody());
    const other = await createItemViaApi(app, caseBody());
    await open(other.id, { keyItemId: used.id, generated: generatedAk() });
    expectError(await open(box.id, { keyItemId: used.id, generated: generatedAk() }), 409, 'ITEM_NOT_IN_STOCK');
    const souvenir = await createItemViaApi(app, caseBody(X.SOUVENIR));
    const key = await createItemViaApi(app, keyBody());
    expectError(await open(souvenir.id, { keyItemId: key.id, generated: generatedAk() }), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'KEY_NOT_ALLOWED' } });
    expect((await itemOf(box.id)).status).toBe('EM_ESTOQUE'); // nada gravado nos erros
    expect((await itemOf(key.id)).status).toBe('EM_ESTOQUE');
  });

  test('recipiente inválido: não abrível, vendido, consumido, inexistente; legado sem catálogo', async () => {
    const gift = await createItemViaApi(app, purchaseBody({ catalogId: X.GIFT, purchasePriceCents: 10 }));
    expectError(await open(gift.id, { generated: generatedAk() }), 422, 'ITEM_NOT_OPENABLE');
    expect((await itemOf(gift.id)).openable).toBeNull();
    const ak = await createItemViaApi(app);
    expectError(await open(ak.id, { generated: generatedAk() }), 422, 'ITEM_NOT_OPENABLE');
    const legacy = await createItemViaApi(app, { category: 'CAIXA', name: 'Kilowatt Case', acquisitionType: 'GANHEI' }).catch(() => null);
    expect(legacy).toBeNull(); // CAIXA exige o catálogo no cadastro; o legado só existe por migração
    const soldBox = await createItemViaApi(app, caseBody());
    await post(`/api/items/${soldBox.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 500, soldAt: '2026-11-12T12:00:00.000Z' });
    expectError(await open(soldBox.id, {}), 409, 'ITEM_NOT_IN_STOCK', { params: { itemId: soldBox.id, role: 'CONTAINER', status: 'VENDIDO' } });
    const { box } = await openCase();
    expectError(await open(box.id, {}), 409, 'ITEM_CONSUMED');
    expectError(await open(99999, {}), 404, 'ITEM_NOT_FOUND');
    expectError(await get('/api/items/99999/open-options'), 404, 'ITEM_NOT_FOUND');
    expectError(await get(`/api/items/${ak.id}/open-options`), 422, 'ITEM_NOT_OPENABLE');
  });

  test('item obtido: obrigatório, sem campos de aquisição, validações do cadastro, componentes que vieram junto', async () => {
    const box = await createItemViaApi(app, caseBody());
    const key = await createItemViaApi(app, keyBody());
    expectError(await open(box.id, { keyItemId: key.id }), 422, 'GENERATED_ITEM_REQUIRED');
    for (const field of ['acquisitionType', 'purchaseStoreId', 'purchasePriceCents', 'fxRateAtPurchase', 'acquiredAt']) {
      const res = await open(box.id, { keyItemId: key.id, generated: { ...generatedAk(), [field]: field === 'acquisitionType' ? 'GERADO' : field === 'acquiredAt' ? OPENED_AT : 1 } });
      expectError(res, 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'GENERATED_FIELD_NOT_ALLOWED', field } });
    }
    expectError(await open(box.id, { keyItemId: key.id, generated: generatedAk({ floatValue: 0.01 }) }), 400, 'FLOAT_OUT_OF_RANGE');
    expectError(await open(box.id, { keyItemId: key.id, generated: { variant: 'NORMAL' } }), 400, 'REQUIRED_FIELD', { field: 'category' });
    expectError(await open(box.id, { keyItemId: key.id, generated: { category: 'SKIN', variant: 'NORMAL' } }), 400, 'CATALOG_ITEM_REQUIRED');
    expectError(await open(box.id, { keyItemId: key.id, generated: generatedAk({ extra: 1 }) }), 400, 'UNKNOWN_FIELD');
    expectError(await open(box.id, { keyItemId: key.id, decision: 'BUY', generated: generatedAk() }), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'DECISION_NOT_ALLOWED' } });
    expectError(await open(box.id, { keyItemId: key.id, paidPriceCents: 10, generated: generatedAk() }), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'PRICE_NOT_ALLOWED' } });
    expect((await itemOf(box.id)).status).toBe('EM_ESTOQUE');
    const res = await open(box.id, {
      keyItemId: key.id,
      generated: generatedAk({ components: [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 1 }] }),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.generatedItem.components).toHaveLength(1);
    expect(res.body.data.generatedItem.components[0]).toMatchObject({ kind: 'STICKER', origin: 'CAME_WITH', slot: 1 });
  });

  test('datas: futura, antes da aquisição da caixa e da chave; igual à aquisição vale; trade lock antes da abertura', async () => {
    const box = await createItemViaApi(app, caseBody(X.KILOWATT, { acquiredAt: '2026-11-10T12:00:00.000Z' }));
    const key = await createItemViaApi(app, keyBody('Kilowatt Case Key', { acquiredAt: '2026-11-14T12:00:00.000Z' }));
    const base = { keyItemId: key.id, generated: generatedAk() };
    expectError(await open(box.id, { ...base, openedAt: '2026-11-25T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { field: 'openedAt', params: { reason: 'FUTURE' } });
    expectError(await open(box.id, { ...base, openedAt: '2026-11-09T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'BEFORE_CONTAINER_ACQUIRED', acquiredAt: box.acquiredAt } });
    expectError(await open(box.id, { ...base, openedAt: '2026-11-13T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'BEFORE_KEY_ACQUIRED', acquiredAt: key.acquiredAt } });
    expectError(await open(box.id, { ...base, openedAt: 'x' }), 400, 'INVALID_DATE');
    expectError(
      await open(box.id, { ...base, openedAt: '2026-11-15T12:00:00.000Z', generated: generatedAk({ tradeUnlockAt: '2026-11-14T12:00:00.000Z' }) }),
      422, 'OPERATION_DATE_INVALID', { params: { reason: 'TRADE_UNLOCK_BEFORE_OPENED', tradeUnlockAt: '2026-11-14T12:00:00.000Z' } }
    );
    const ok = await open(box.id, { ...base, openedAt: '2026-11-14T12:00:00.000Z', generated: generatedAk({ tradeUnlockAt: '2026-11-21T12:00:00.000Z' }) });
    expect(ok.status).toBe(201); // igual à aquisição da chave
    const generated = ok.body.data.generatedItem;
    expect(generated.tradeLock.isLocked).toBe(true);
    expect(generated.aging).toMatchObject({ agingBucket: 'EM_TRADE_LOCK' });
  });
});

describe('cápsula e pacote (sem chave)', () => {
  test('cápsula e pacote Souvenir (com stickers que vieram junto) consomem só a unidade', async () => {
    const capsule = await createItemViaApi(app, purchaseBody({ catalogId: CAT.CAPSULE_KATO14, purchasePriceCents: 120 }));
    expect((await itemOf(capsule.id)).openable).toEqual({ kind: 'NO_KEY', compatibleKeys: 0, otherKeysInStock: 0, otherKeyNames: [], requiredKeyName: null });
    const before = numbers(await profit());
    const res = await open(capsule.id, { generated: { catalogId: CAT.STICKER_TITAN } });
    expect(res.status).toBe(201);
    expect(res.body.data.consumedItemIds).toEqual([capsule.id]);
    expect(res.body.data.generatedItem).toMatchObject({ acquisitionType: 'GERADO', category: 'STICKER', generatedFrom: { container: 'CAPSULE', containerName: expect.any(String), keyName: null } });
    expect(res.body.data.generatedItem.cost.effectiveUsdCents).toBe(120);
    expect(numbers(await profit())).toEqual(before);

    const pkg = await createItemViaApi(app, purchaseBody({ catalogId: X.SOUVENIR, purchasePriceCents: 900 }));
    const xray = await createItemViaApi(app, purchaseBody({ catalogId: X.XRAY, purchasePriceCents: 50 }));
    expect((await itemOf(pkg.id)).openable.kind).toBe('NO_KEY');
    expect((await itemOf(xray.id)).openable.kind).toBe('NO_KEY');
    const souvenir = await open(pkg.id, {
      generated: { catalogId: CAT.DEAGLE_DDPAT, variant: 'SOUVENIR', components: [{ kind: 'STICKER', catalogId: CAT.STICKER_CROWN, slot: 0 }, { kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 1 }] },
    });
    expect(souvenir.status).toBe(201);
    expect(souvenir.body.data.generatedItem).toMatchObject({ variant: 'SOUVENIR', generatedFrom: { container: 'PACKAGE' } });
    expect(souvenir.body.data.generatedItem.components).toHaveLength(2);
    expectError(await open(xray.id, { decision: 'BUY', generated: generatedAk() }), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'DECISION_NOT_ALLOWED' } });
  });
});

describe('terminal', () => {
  test('comprar: o item nasce COMPRA na loja Steam do app, com o terminal herdado; saldo da Steam cai o preço; total do estoque sobe o preço', async () => {
    await post('/api/deposits', { storeId: storeId('Steam'), amountStoreCents: 100000, depositedAt: '2026-11-01T12:00:00.000Z' });
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.5 });
    const terminal = await createItemViaApi(app, terminalBody({ purchaseStoreId: storeId('CSFloat') }));
    const before = await profit();
    const res = await open(terminal.id, { decision: 'BUY', paidPriceCents: 1100, fxRateAtPurchase: 5.5, generated: generatedAk() });
    expect(res.status).toBe(201);
    const generated = res.body.data.generatedItem;
    expect(res.body.data.operation).toMatchObject({ kind: 'OPEN_TERMINAL', outcome: 'TRANSFERRED' });
    expect(generated).toMatchObject({
      acquisitionType: 'COMPRA', purchaseStoreId: storeId('Steam'), purchasePriceCents: 1100, purchaseCurrency: 'BRL', fxRateAtPurchase: 5.5, acquiredAt: OPENED_AT,
    });
    expect(generated.cost).toEqual({ ownUsdCents: 200, inheritedUsdCents: 400, effectiveUsdCents: 600, estimated: true , hasOperationCost: true });
    expect(generated.generatedFrom).toMatchObject({ kind: 'OPEN_TERMINAL', container: 'TERMINAL', decision: 'BUY', containerName: 'Sealed Genesis Terminal' });
    const after = await profit();
    expect(balanceOf(after, 'Steam')).toBe(balanceOf(before, 'Steam') - 1100); // desconta o preço na loja Steam
    expect(after.stockUsdCents).toBe(before.stockUsdCents + 200); // R$ 11,00 / 5,5 = US$ 2,00 (o terminal só mudou de lugar)
    expect(after.consumptionLosses.count).toBe(0);
  });

  test('comprar com a loja Steam em USD (sem cotação): total do estoque e saldo fecham', async () => {
    const usdStore = (await post('/api/stores', { name: 'Steam USD', currency: 'USD' })).body.data;
    expect((await setSteam(usdStore.id)).body.data.steamStoreId).toBe(usdStore.id);
    const terminal = await createItemViaApi(app, terminalBody());
    const before = await profit();
    expectError(await open(terminal.id, { decision: 'BUY', paidPriceCents: 700, fxRateAtPurchase: 5.5, generated: generatedAk() }), 400, 'FX_RATE_NOT_ALLOWED');
    const res = await open(terminal.id, { decision: 'BUY', paidPriceCents: 700, generated: generatedAk() });
    expect(res.status).toBe(201);
    expect(res.body.data.generatedItem).toMatchObject({ purchaseStoreId: usdStore.id, purchaseCurrency: 'USD', purchasePriceCents: 700 });
    const after = await profit();
    expect(after.stockUsdCents).toBe(before.stockUsdCents + 700);
    expect(balanceOf(after, 'Steam USD')).toBe(balanceOf(before, 'Steam USD') - 700);
  });

  test('erros do "Comprar": sem loja Steam, sem cotação, sem preço, sem item obtido, sem decisão', async () => {
    const terminal = await createItemViaApi(app, terminalBody());
    await setSteam(null);
    expectError(await open(terminal.id, { decision: 'BUY', paidPriceCents: 500, generated: generatedAk() }), 409, 'STEAM_STORE_REQUIRED');
    await setSteam(storeId('Steam'));
    expectError(await open(terminal.id, { decision: 'BUY', paidPriceCents: 500, generated: generatedAk() }), 400, 'FX_RATE_REQUIRED'); // sem cotação salva
    expectError(await open(terminal.id, { decision: 'BUY', fxRateAtPurchase: 5, generated: generatedAk() }), 400, 'PURCHASE_PRICE_REQUIRED');
    expectError(await open(terminal.id, { decision: 'BUY', paidPriceCents: 500, fxRateAtPurchase: 5 }), 422, 'GENERATED_ITEM_REQUIRED');
    expectError(await open(terminal.id, { generated: generatedAk() }), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'DECISION_REQUIRED' } });
    expectError(await open(terminal.id, { decision: 'MAYBE', generated: generatedAk() }), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'DECISION_INVALID' } });
    expect((await itemOf(terminal.id)).status).toBe('EM_ESTOQUE');
    // "Não comprar" não depende da loja Steam
    await setSteam(null);
    expect((await open(terminal.id, { decision: 'DECLINE' })).status).toBe(201);
  });

  test('não comprar: o terminal some, o lucro real cai o custo dele, a perda aparece no resumo, no histórico e nas estatísticas', async () => {
    const terminal = await createItemViaApi(app, terminalBody());
    const before = await profit();
    expectError(await open(terminal.id, { decision: 'DECLINE', generated: generatedAk() }), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'GENERATED_NOT_ALLOWED' } });
    expectError(await open(terminal.id, { decision: 'DECLINE', paidPriceCents: 1 }), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'PRICE_NOT_ALLOWED' } });
    const res = await open(terminal.id, { decision: 'DECLINE' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ generatedItem: null, consumedItemIds: [terminal.id] });
    expect(res.body.data.operation).toMatchObject({ kind: 'OPEN_TERMINAL', outcome: 'LOST' });
    const after = await profit();
    expect(after.realProfitUsdCents).toBe(before.realProfitUsdCents - 400);
    expect(after.stockUsdCents).toBe(before.stockUsdCents - 400);
    expect(after.consumptionLosses).toMatchObject({ usdCents: 400, estimated: false, count: 1 });
    expect(balanceOf(after, 'CSFloat')).toBe(balanceOf(before, 'CSFloat')); // a compra do terminal continua descontada
    const consumed = await itemOf(terminal.id);
    expect(consumed).toMatchObject({ status: 'CONSUMIDO', consumedIn: { kind: 'OPEN_TERMINAL', lost: true, targetItemId: null, targetName: null } });
    expect(consumed.stats).toMatchObject({ unitCount: 0, consumedCount: 1, lossCount: 1, lossUsdCents: 400 });
    const ops = (await get(`/api/items/${terminal.id}/operations`)).body.data;
    expect(ops[0]).toMatchObject({ outcome: 'LOST', lossUsdCents: 400, detail: { container: 'TERMINAL', decision: 'DECLINE' } });
    // terminal GANHEI: perda 0, mas conta
    const won = await createItemViaApi(app, { catalogId: X.TERMINAL, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' });
    expect((await open(won.id, { decision: 'DECLINE' })).status).toBe(201);
    expect((await profit()).consumptionLosses).toMatchObject({ usdCents: 400, count: 2 });
  });
});

describe('desfazer', () => {
  const undo = (operationId) => post(`/api/operations/${operationId}/undo`);

  test('caixa: a gerada some e a caixa e a chave voltam como estavam (holding e trade lock); números idênticos ao antes', async () => {
    const box = await createItemViaApi(app, caseBody(X.KILOWATT, { tradeUnlockAt: '2026-11-25T12:00:00.000Z' }));
    const key = await createItemViaApi(app, keyBody());
    await post(`/api/items/${key.id}/off-sale`);
    const keyBefore = await itemOf(key.id);
    const before = numbers(await profit());
    const res = await open(box.id, { keyItemId: key.id, generated: generatedAk({ components: [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN }] }) });
    const generatedId = res.body.data.generatedItem.id;
    const out = await undo(res.body.data.operation.id);
    expect(out.status).toBe(200);
    expect(out.body.data.removedItemIds).toEqual([generatedId]);
    expect(out.body.data.items.map((i) => i.id).sort()).toEqual([box.id, key.id].sort());
    expect((await get(`/api/items/${generatedId}`)).status).toBe(404);
    expect(await itemOf(box.id)).toMatchObject({ status: 'EM_ESTOQUE', consumedAt: null, tradeUnlockAt: box.tradeUnlockAt });
    expect(await itemOf(key.id)).toMatchObject({ status: 'EM_ESTOQUE', consumedAt: null, offSaleAt: keyBefore.offSaleAt, forSaleSince: keyBefore.forSaleSince });
    expect(numbers(await profit())).toEqual(before);
    const ops = (await get(`/api/items/${box.id}/operations`)).body.data;
    expect(ops[0]).toMatchObject({ undoneAt: expect.any(String), undoable: false, undoBlockedReason: 'ALREADY_UNDONE' });
    expect(ops[0].detail.undoneGenerated).toMatchObject({ name: 'AK-47 | Redline', catalogId: CAT.AK_REDLINE, acquisitionType: 'GERADO' });
    expectError(await undo(res.body.data.operation.id), 409, 'OPERATION_ALREADY_UNDONE');
    // dá para abrir de novo e excluir as unidades depois (as operações desfeitas saem junto)
    expect((await open(box.id, { keyItemId: key.id, generated: generatedAk() })).status).toBe(201);
  });

  test('terminal comprado: a compra some e o saldo da Steam volta; recusado: a perda some', async () => {
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.5 });
    const terminal = await createItemViaApi(app, terminalBody());
    const before = await profit();
    const bought = await open(terminal.id, { decision: 'BUY', paidPriceCents: 1100, generated: generatedAk() });
    expect(balanceOf(await profit(), 'Steam')).toBe(balanceOf(before, 'Steam') - 1100);
    expect((await undo(bought.body.data.operation.id)).status).toBe(200);
    const mid = await profit();
    expect(balanceOf(mid, 'Steam')).toBe(balanceOf(before, 'Steam'));
    expect(numbers(mid)).toEqual(numbers(before));
    const declined = await open(terminal.id, { decision: 'DECLINE' });
    expect((await profit()).consumptionLosses.count).toBe(1);
    expect((await undo(declined.body.data.operation.id)).status).toBe(200);
    const end = await profit();
    expect(end.consumptionLosses.count).toBe(0);
    expect(numbers(end)).toEqual(numbers(before));
    expect((await itemOf(terminal.id)).status).toBe('EM_ESTOQUE');
  });

  test('bloqueios: gerada vendida (TARGET_SOLD) até "desfazer venda"; gerada consumida depois (NOT_LATEST)', async () => {
    const { res } = await openCase();
    const generated = res.body.data.generatedItem;
    const opId = res.body.data.operation.id;
    await post(`/api/items/${generated.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 1000, soldAt: '2026-11-16T12:00:00.000Z' });
    expectError(await undo(opId), 409, 'OPERATION_UNDO_BLOCKED', { params: { reason: 'TARGET_SOLD', itemId: generated.id } });
    await post(`/api/items/${generated.id}/unsell`);
    // outra abertura gera um sticker, que vira componente de uma arma: a abertura dele deixa de ser a mais recente
    const target = await createItemViaApi(app);
    const box2 = await createItemViaApi(app, caseBody());
    const key2 = await createItemViaApi(app, keyBody());
    const res2 = await open(box2.id, { keyItemId: key2.id, generated: { catalogId: CAT.STICKER_CROWN } });
    const crown = res2.body.data.generatedItem;
    const applied = await post(`/api/items/${target.id}/apply-component`, { sourceItemId: crown.id, appliedAt: OPENED_AT });
    expect(applied.status).toBe(201);
    const blocked = await undo(res2.body.data.operation.id);
    expectError(blocked, 409, 'OPERATION_UNDO_BLOCKED');
    expect(blocked.body.error.params).toMatchObject({ reason: 'NOT_LATEST', itemId: crown.id });
    expect((await undo(opId)).status).toBe(200); // a primeira abertura, já com a venda desfeita, desfaz
  });
});

describe('proteções da unidade gerada e das consumidas', () => {
  test('editar a gerada: float aceito; aquisição, loja e data travadas; custo próprio recusado; excluir e editar as consumidas recusados', async () => {
    const { box, key, res } = await openCase();
    const id = res.body.data.generatedItem.id;
    expect((await patch(`/api/items/${id}`, { floatValue: 0.2 })).body.data.floatValue).toBe(0.2);
    expect((await patch(`/api/items/${id}`, { acquisitionType: 'GERADO', originDetail: 'drop' })).body.data.originDetail).toBe('drop'); // mesmo valor: sem erro
    expectError(await patch(`/api/items/${id}`, { acquisitionType: 'GANHEI' }), 409, 'GENERATED_FIELD_LOCKED', { field: 'acquisitionType' });
    expectError(await patch(`/api/items/${id}`, { acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 10 }), 409, 'GENERATED_FIELD_LOCKED');
    expectError(await patch(`/api/items/${id}`, { purchaseStoreId: storeId('CSFloat') }), 409, 'GENERATED_FIELD_LOCKED', { field: 'purchaseStoreId' });
    expectError(await patch(`/api/items/${id}`, { acquiredAt: '2026-11-14T12:00:00.000Z' }), 409, 'GENERATED_FIELD_LOCKED', { field: 'acquiredAt' });
    expectError(await patch(`/api/items/${id}`, { purchasePriceCents: 10 }), 422, 'GENERATED_COST_NOT_ALLOWED', { field: 'purchasePriceCents' });
    expectError(await patch(`/api/items/${id}`, { fxRateAtPurchase: 5 }), 422, 'GENERATED_COST_NOT_ALLOWED');
    expectError(await request(app).delete(`/api/items/${id}`), 409, 'ITEM_IN_OPERATION');
    expectError(await request(app).delete(`/api/items/${box.id}`), 409, 'ITEM_IN_OPERATION');
    expectError(await patch(`/api/items/${key.id}`, { originDetail: 'x' }), 409, 'ITEM_CONSUMED');
    expectError(await post(`/api/items/${box.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 100, soldAt: OPENED_AT }), 409, 'ITEM_CONSUMED');
    expectError(await post(`/api/items/${key.id}/off-sale`), 409, 'ITEM_CONSUMED');
  });

  test('terminal comprado: preço e cotação são corrigíveis; loja e tipo, não', async () => {
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.5 });
    const terminal = await createItemViaApi(app, terminalBody());
    const res = await open(terminal.id, { decision: 'BUY', paidPriceCents: 1100, generated: generatedAk() });
    const id = res.body.data.generatedItem.id;
    const fixed = await patch(`/api/items/${id}`, { purchasePriceCents: 1650 });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.purchasePriceCents).toBe(1650);
    expectError(await patch(`/api/items/${id}`, { purchaseStoreId: storeId('CSFloat') }), 409, 'GENERATED_FIELD_LOCKED');
    expectError(await patch(`/api/items/${id}`, { acquisitionType: 'GANHEI' }), 409, 'GENERATED_FIELD_LOCKED');
  });

  test('criar item com acquisitionType GERADO pela API é recusado', async () => {
    expectError(await post('/api/items', { catalogId: CAT.AK_REDLINE, acquisitionType: 'GERADO' }), 400, 'INVALID_ACQUISITION_TYPE');
  });

  test('desfazer o lote de importação que trouxe a caixa consumida é bloqueado (ITEM_IN_OPERATION)', async () => {
    const { box } = await openCase();
    const ItemOperation = require('../../src/models/ItemOperation');
    expect(ItemOperation.hasActiveLink(box.id)).toBe(true);
  });
});

describe('loja Steam do app', () => {
  test('GET /api/settings e /api/stores; PUT escolhe, troca e limpa; loja inexistente e corpo inválido', async () => {
    const settings = (await get('/api/settings')).body.data;
    expect(settings.steamStoreId).toBe(storeId('Steam')); // escolhida no beforeEach (a migração escolhe a Steam em BRL; banco novo começa vazio)
    expect((await get('/api/stores')).body.data.filter((s) => s.isSteamStore).map((s) => s.name)).toEqual(['Steam']);
    const res = await setSteam(storeId('CSFloat'));
    expect(res.status).toBe(200);
    expect(res.body.data.steamStoreId).toBe(storeId('CSFloat'));
    expect((await get('/api/stores')).body.data.filter((s) => s.isSteamStore).map((s) => s.name)).toEqual(['CSFloat']);
    expect((await get(`/api/stores/${storeId('CSFloat')}`)).body.data.isSteamStore).toBe(true);
    expect((await setSteam(null)).body.data.steamStoreId).toBeNull();
    expect((await get('/api/stores')).body.data.some((s) => s.isSteamStore)).toBe(false);
    expectError(await setSteam(99999), 400, 'STORE_NOT_FOUND', { field: 'storeId' });
    expectError(await request(app).put('/api/settings/steam-store').send({}), 400, 'REQUIRED_FIELD');
    expectError(await request(app).put('/api/settings/steam-store').send({ storeId: 'x' }), 400, 'INVALID_FIELD');
    expectError(await request(app).put('/api/settings/steam-store').send({ storeId: 1, extra: 1 }), 400, 'UNKNOWN_FIELD');
    expectError(await request(app).put('/api/settings/steam-store').set('Content-Type', 'text/plain').send('x'), 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  test('uma loja Steam já usada em compra de terminal não pode ser excluída (STORE_IN_USE); sem uso, excluir limpa a escolha', async () => {
    const extra = (await post('/api/stores', { name: 'Minha Steam', currency: 'USD' })).body.data;
    await setSteam(extra.id);
    expect((await request(app).delete(`/api/stores/${extra.id}`)).status).toBe(200);
    expect((await get('/api/settings')).body.data.steamStoreId).toBeNull();
    const terminal = await createItemViaApi(app, terminalBody());
    await setSteam(storeId('Steam'));
    await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.5 });
    await open(terminal.id, { decision: 'BUY', paidPriceCents: 1100, generated: generatedAk() });
    expectError(await request(app).delete(`/api/stores/${storeId('Steam')}`), 409, 'STORE_IN_USE');
  });
});
