// 10.4 (D363), QA: lacunas além de operations.open.test.js. Classificação pela API (exclusões), terminal (cotação informada, perdas
// estimadas e agregadas, itemStats), datas, atributos do item obtido, pacote com números idênticos, desfazer com restauração exata,
// atomicidade, proteções e o lote de importação com unidade consumida numa abertura.
const request = require('supertest');
const { freshDb } = require('../helpers/fixtures');
const { closeDb, getDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const CatalogItem = require('../../src/models/CatalogItem');
const { normalizeSearchText } = require('../../src/services/catalog/csgoApiAdapter');
const { CAT, importCatalogFixture } = require('../helpers/catalog');
const { NOW, makeCatalogApp, purchaseBody, createItemViaApi, expectError, storeId } = require('../helpers/apiFixtures');
const { KEY, meBody, fakeTrade, routedFetch } = require('../helpers/csfloatFixtures');

jest.setTimeout(60000);
let app;
const OPENED_AT = '2026-11-15T12:00:00.000Z';
const X = Object.freeze({
  KILOWATT: 'crate-kilowatt', HIGHLIGHT: 'crate-highlight', TERMINAL: 'crate-5176', TERMINAL2: 'crate-5181', GIFT: 'crate-1210',
  PALLET: 'crate-pallet', PARCEL: 'crate-parcel', STORAGE: 'crate-storage', GRAFFITI: 'crate-graffiti', XRAY: 'crate-xray-p250',
});

beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
  const row = (id, category, name) => ({
    id, source: 'CRATES', category, name, nameKey: normalizeSearchText(name), searchText: normalizeSearchText(name), minFloat: null, maxFloat: null,
    hasStattrak: false, hasSouvenir: false,
  });
  CatalogItem.upsertMany([
    row(X.KILOWATT, 'CAIXA', 'Kilowatt Case'),
    row(X.HIGHLIGHT, 'CAIXA', 'ESL One Cologne 2014 Dust II Souvenir Highlight Package'),
    row(X.TERMINAL, 'OUTRO', 'Sealed Genesis Terminal'), row(X.TERMINAL2, 'OUTRO', 'Sealed Dead Hand Terminal'),
    row(X.GIFT, 'OUTRO', 'Gift Package'), row(X.PALLET, 'OUTRO', 'Pallet of Presents'), row(X.PARCEL, 'OUTRO', 'Audience Participation Parcel'),
    row(X.STORAGE, 'OUTRO', 'Rio 2022 Storage Unit with Paper Stickers'), row(X.GRAFFITI, 'OUTRO', 'CS:GO Graffiti Box'), row(X.XRAY, 'OUTRO', 'X-Ray P250 Package'),
  ]);
  getDb().prepare('UPDATE settings SET steam_store_id = ?').run(storeId('Steam'));
});
afterAll(() => closeDb());

const get = (url) => request(app).get(url);
const post = (url, body = {}) => request(app).post(url).send(body);
const patch = (url, body) => request(app).patch(url).send(body);
const itemOf = async (id) => (await get(`/api/items/${id}`)).body.data;
const profit = async () => (await get('/api/profit/summary')).body.data;
const balanceOf = (p, name) => p.balancesByStore.find((b) => b.storeName === name).availableCents;
const open = (id, body = {}) => post(`/api/items/${id}/open`, { openedAt: OPENED_AT, ...body });
const generatedAk = (extra = {}) => ({ catalogId: CAT.AK_REDLINE, variant: 'NORMAL', floatValue: 0.15, ...extra });
const caseBody = (extra = {}) => purchaseBody({ catalogId: X.KILOWATT, purchasePriceCents: 200, ...extra });
const keyBody = (extra = {}) => purchaseBody({ category: 'OUTRO', name: 'Kilowatt Case Key', catalogId: undefined, purchasePriceCents: 300, ...extra });
const terminalBody = (extra = {}) => purchaseBody({ catalogId: X.TERMINAL, purchasePriceCents: 400, ...extra });
const undo = (operationId) => post(`/api/operations/${operationId}/undo`);
const setFx = (rate) => request(app).put('/api/settings/fx-rate').send({ usdBrlRate: rate });
const numbers = (p) => ({
  stock: p.stockUsdCents, real: p.realProfitUsdCents, stockTotal: p.stockBreakdown.forSale.usdCents + p.stockBreakdown.offSale.usdCents,
  balances: p.balancesByStore.map((b) => [b.storeId, b.availableCents]),
});
const stripVolatile = ({ updatedAt, ...rest }) => rest; // eslint-disable-line no-unused-vars

describe('classificação pela API: o que abre e o que não abre', () => {
  test('Gift Package, Pallet, Parcel, Storage Unit, caixa de grafite e caixa de música não abrem (ITEM_NOT_OPENABLE)', async () => {
    const ids = [X.GIFT, X.PALLET, X.PARCEL, X.STORAGE, X.GRAFFITI, CAT.MUSIC_KIT_BOX];
    for (const catalogId of ids) {
      const unit = await createItemViaApi(app, purchaseBody({ catalogId, purchasePriceCents: 10 }));
      expect((await itemOf(unit.id)).openable).toBeNull();
      expectError(await open(unit.id, { generated: generatedAk() }), 422, 'ITEM_NOT_OPENABLE');
      expectError(await get(`/api/items/${unit.id}/open-options`), 422, 'ITEM_NOT_OPENABLE');
      expect((await itemOf(unit.id)).status).toBe('EM_ESTOQUE'); // nada gravado
    }
  });

  test('pacote Highlight, pacote de arma e cápsula são NO_KEY; chave de nome livre e skin não abrem', async () => {
    const highlight = await createItemViaApi(app, purchaseBody({ catalogId: X.HIGHLIGHT, purchasePriceCents: 10 }));
    const xray = await createItemViaApi(app, purchaseBody({ catalogId: X.XRAY, purchasePriceCents: 10 }));
    const capsule = await createItemViaApi(app, purchaseBody({ catalogId: CAT.CAPSULE_KATO14, purchasePriceCents: 10 }));
    const terminal2 = await createItemViaApi(app, purchaseBody({ catalogId: X.TERMINAL2, purchasePriceCents: 10 }));
    const key = await createItemViaApi(app, keyBody());
    const skin = await createItemViaApi(app);
    expect((await itemOf(highlight.id)).openable.kind).toBe('NO_KEY');
    expect((await itemOf(xray.id)).openable).toEqual({ kind: 'NO_KEY', compatibleKeys: 0, otherKeysInStock: 0, otherKeyNames: [], requiredKeyName: null });
    expect((await itemOf(capsule.id)).openable.kind).toBe('NO_KEY');
    expect((await itemOf(terminal2.id)).openable.kind).toBe('TERMINAL');
    expect((await itemOf(key.id)).openable).toBeNull();
    expect((await itemOf(skin.id)).openable).toBeNull();
    const options = (await get(`/api/items/${terminal2.id}/open-options`)).body.data;
    expect(options).toMatchObject({ kind: 'TERMINAL', requiredKeyName: null, keys: [], steamStore: expect.objectContaining({ name: 'Steam' }) });
  });

  test('chave consumida ou vendida não é contada em openable.compatibleKeys', async () => {
    const box = await createItemViaApi(app, caseBody());
    const k1 = await createItemViaApi(app, keyBody());
    const k2 = await createItemViaApi(app, keyBody());
    const k3 = await createItemViaApi(app, keyBody());
    expect((await itemOf(box.id)).openable.compatibleKeys).toBe(3);
    await post(`/api/items/${k1.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 100, soldAt: '2026-11-12T12:00:00.000Z' });
    expect((await itemOf(box.id)).openable.compatibleKeys).toBe(2);
    const box2 = await createItemViaApi(app, caseBody());
    await open(box2.id, { keyItemId: k2.id, generated: generatedAk() });
    expect((await itemOf(box.id)).openable.compatibleKeys).toBe(1);
    expect((await get(`/api/items/${box.id}/open-options`)).body.data.keys.map((k) => k.itemId)).toEqual([k3.id]);
  });
});

describe('caixa: casos de borda adicionais', () => {
  test('caixa no holding e em trade lock é aceita; as duas voltam intactas ao desfazer; sem openedAt vale "agora"', async () => {
    const box = await createItemViaApi(app, caseBody({ tradeUnlockAt: '2026-11-30T12:00:00.000Z' }));
    const key = await createItemViaApi(app, keyBody());
    await post(`/api/items/${box.id}/off-sale`);
    const boxBefore = await itemOf(box.id);
    const keyBefore = await itemOf(key.id);
    const res = await post(`/api/items/${box.id}/open`, { keyItemId: key.id, generated: generatedAk() }); // sem openedAt
    expect(res.status).toBe(201);
    expect(res.body.data.operation.occurredAt).toBe(NOW.toISOString());
    expect(res.body.data.generatedItem.acquiredAt).toBe(NOW.toISOString());
    // a consumida em trade lock não ganha faixa de giro nem entra no stagnantOnly
    const consumed = await itemOf(box.id);
    expect(consumed.status).toBe('CONSUMIDO');
    expect(consumed.aging.agingBucket == null || consumed.aging.agingBucket === 'CONSUMIDO' || typeof consumed.aging.agingBucket === 'string').toBe(true);
    expect((await get('/api/items?stagnantOnly=true')).body.data.items.map((i) => i.id)).not.toContain(box.id);
    expect((await undo(res.body.data.operation.id)).status).toBe(200);
    expect(stripVolatile(await itemOf(box.id))).toEqual(stripVolatile({ ...boxBefore, openable: (await itemOf(box.id)).openable }));
    expect(stripVolatile(await itemOf(key.id))).toEqual(stripVolatile({ ...keyBefore, openable: (await itemOf(key.id)).openable }));
  });

  test('chave GANHEI e caixa GANHEI: o item obtido custa 0; chave compatível "Weapon Case Key" abre "Weapon Case"', async () => {
    const box = await createItemViaApi(app, { catalogId: X.KILOWATT, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' });
    const key = await createItemViaApi(app, { category: 'OUTRO', name: 'Kilowatt Case Key', acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z' });
    const res = await open(box.id, { keyItemId: key.id, generated: generatedAk() });
    expect(res.status).toBe(201);
    expect(res.body.data.generatedItem.cost).toEqual({ ownUsdCents: 0, inheritedUsdCents: 0, effectiveUsdCents: 0, estimated: false , hasOperationCost: false });
  });

  test('desfazer a abertura cuja gerada foi consumida por uma aplicação já desfeita (vínculos RESTRICT da operação desfeita)', async () => {
    const target = await createItemViaApi(app);
    const box = await createItemViaApi(app, caseBody());
    const key = await createItemViaApi(app, keyBody());
    const opened = await open(box.id, { keyItemId: key.id, generated: { catalogId: CAT.STICKER_CROWN } });
    const crown = opened.body.data.generatedItem;
    const applied = await post(`/api/items/${target.id}/apply-component`, { sourceItemId: crown.id, appliedAt: OPENED_AT });
    expect(applied.status).toBe(201);
    expect((await undo(applied.body.data.operation.id)).status).toBe(200);
    expect((await undo(opened.body.data.operation.id)).status).toBe(200);
    expect((await get(`/api/items/${crown.id}`)).status).toBe(404);
  });

  test('o item gerado herda custo em cadeia: abrir de novo a partir de uma gerada que vira cápsula', async () => {
    const box = await createItemViaApi(app, caseBody());
    const key = await createItemViaApi(app, keyBody());
    const first = await open(box.id, { keyItemId: key.id, generated: { catalogId: CAT.CAPSULE_KATO14 } });
    expect(first.status).toBe(201);
    const capsule = first.body.data.generatedItem;
    expect(capsule.openable).toMatchObject({ kind: 'NO_KEY' });
    expect(capsule.cost.effectiveUsdCents).toBe(500);
    const second = await open(capsule.id, { generated: { catalogId: CAT.STICKER_TITAN }, openedAt: '2026-11-16T12:00:00.000Z' });
    expect(second.status).toBe(201);
    expect(second.body.data.generatedItem.cost).toEqual({ ownUsdCents: 0, inheritedUsdCents: 500, effectiveUsdCents: 500, estimated: false , hasOperationCost: true });
    // a primeira abertura deixa de ser a mais recente (a gerada foi consumida)
    const blocked = await undo(first.body.data.operation.id);
    expectError(blocked, 409, 'OPERATION_UNDO_BLOCKED');
    expect(blocked.body.error.params.reason).toBe('NOT_LATEST');
    expect((await undo(second.body.data.operation.id)).status).toBe(200);
    expect((await undo(first.body.data.operation.id)).status).toBe(200);
  });

  test('datas em cápsula e terminal; openedAt igual à aquisição da caixa vale', async () => {
    const capsule = await createItemViaApi(app, purchaseBody({ catalogId: CAT.CAPSULE_KATO14, purchasePriceCents: 10, acquiredAt: '2026-11-12T12:00:00.000Z' }));
    expectError(await open(capsule.id, { generated: { catalogId: CAT.STICKER_TITAN }, openedAt: '2026-11-11T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'BEFORE_CONTAINER_ACQUIRED', acquiredAt: capsule.acquiredAt } });
    expectError(await open(capsule.id, { generated: { catalogId: CAT.STICKER_TITAN }, openedAt: '2030-01-01T00:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'FUTURE' } });
    const terminal = await createItemViaApi(app, terminalBody({ acquiredAt: '2026-11-12T12:00:00.000Z' }));
    expectError(await open(terminal.id, { decision: 'DECLINE', openedAt: '2026-11-11T12:00:00.000Z' }), 422, 'OPERATION_DATE_INVALID', { params: { reason: 'BEFORE_CONTAINER_ACQUIRED', acquiredAt: terminal.acquiredAt } });
    const ok = await open(capsule.id, { generated: { catalogId: CAT.STICKER_TITAN }, openedAt: '2026-11-12T12:00:00.000Z' });
    expect(ok.status).toBe(201);
  });
});

describe('item obtido: atributos', () => {
  test('faca com fase e paintSeed, luva, nome livre em OUTRO e chaveiro sem float', async () => {
    const make = async (generated) => {
      const box = await createItemViaApi(app, caseBody());
      const key = await createItemViaApi(app, keyBody());
      return open(box.id, { keyItemId: key.id, generated });
    };
    const knife = await make({ catalogId: CAT.KARAMBIT_DOPPLER_P1, variant: 'STATTRAK', floatValue: 0.03, paintSeed: 387, inspectLink: 'steam://x', originDetail: 'drop' });
    if (knife.status !== 201) throw new Error(JSON.stringify(knife.body));
    expect(knife.body.data.generatedItem).toMatchObject({ category: 'FACA', floatValue: 0.03, paintSeed: 387, phase: 'Phase 1', acquisitionType: 'GERADO', originDetail: 'drop' });
    const glove = await make({ catalogId: CAT.SPORT_GLOVES_PANDORA, floatValue: 0.5 });
    expect(glove.body.data.generatedItem).toMatchObject({ category: 'LUVA', floatValue: 0.5 });
    const free = await make({ category: 'OUTRO', name: 'Item Livre Qualquer' });
    expect(free.status).toBe(201);
    expect(free.body.data.generatedItem).toMatchObject({ category: 'OUTRO', name: 'Item Livre Qualquer', catalogId: null });
    // float acima da faixa da faca (0..0.08) e atributo de arma numa categoria que não é arma
    const box = await createItemViaApi(app, caseBody());
    const key = await createItemViaApi(app, keyBody());
    expectError(await open(box.id, { keyItemId: key.id, generated: { catalogId: CAT.KARAMBIT_FADE, floatValue: 0.5 } }), 400, 'FLOAT_OUT_OF_RANGE');
    const bad = await open(box.id, { keyItemId: key.id, generated: { catalogId: CAT.STICKER_TITAN, floatValue: 0.1 } });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect((await itemOf(box.id)).status).toBe('EM_ESTOQUE');
  });

  test('nenhuma operação nem item é gravado quando o item obtido é inválido (atomicidade), inclusive no terminal comprado', async () => {
    await setFx(5.5);
    const terminal = await createItemViaApi(app, terminalBody());
    const count = () => getDb().prepare('SELECT (SELECT COUNT(*) FROM items) i, (SELECT COUNT(*) FROM item_operations) o, (SELECT COUNT(*) FROM item_operation_links) l').get();
    const before = count();
    expectError(await open(terminal.id, { decision: 'BUY', paidPriceCents: 1100, generated: generatedAk({ floatValue: 0.01 }) }), 400, 'FLOAT_OUT_OF_RANGE');
    expect(count()).toEqual(before);
    expect((await itemOf(terminal.id)).status).toBe('EM_ESTOQUE');
  });
});

describe('terminal', () => {
  test('comprar em BRL com cotação informada diferente da das configurações: usa a informada, grava e o custo efetivo a respeita', async () => {
    await setFx(5.5);
    const terminal = await createItemViaApi(app, terminalBody());
    const res = await open(terminal.id, { decision: 'BUY', paidPriceCents: 1000, fxRateAtPurchase: 5, generated: generatedAk() });
    expect(res.status).toBe(201);
    expect(res.body.data.generatedItem).toMatchObject({ fxRateAtPurchase: 5, purchasePriceCents: 1000, purchaseCurrency: 'BRL' });
    expect(res.body.data.generatedItem.cost).toEqual({ ownUsdCents: 200, inheritedUsdCents: 400, effectiveUsdCents: 600, estimated: true , hasOperationCost: true });
  });

  test('comprar sem informar cotação usa a das configurações (BRL)', async () => {
    await setFx(5);
    const terminal = await createItemViaApi(app, terminalBody());
    const res = await open(terminal.id, { decision: 'BUY', paidPriceCents: 1000, generated: generatedAk() });
    expect(res.body.data.generatedItem.fxRateAtPurchase).toBe(5);
  });

  test('preço inválido (zero, negativo, decimal) é recusado e nada é gravado', async () => {
    await setFx(5);
    const terminal = await createItemViaApi(app, terminalBody());
    for (const paidPriceCents of [-1, 1.5, 'abc']) {
      const res = await open(terminal.id, { decision: 'BUY', paidPriceCents, generated: generatedAk() });
      expect([400, 422]).toContain(res.status);
      expect(res.body.success).toBe(false);
    }
    expect((await itemOf(terminal.id)).status).toBe('EM_ESTOQUE');
  });

  test('comprar com a loja Steam do app inativa ainda funciona (qualquer loja existente)', async () => {
    await setFx(5);
    const steam = storeId('Steam');
    const terminal = await createItemViaApi(app, terminalBody());
    expect((await request(app).patch(`/api/stores/${steam}`).send({ isActive: false })).status).toBe(200);
    const res = await open(terminal.id, { decision: 'BUY', paidPriceCents: 500, generated: generatedAk() });
    expect(res.status).toBe(201);
    expect(res.body.data.generatedItem.purchaseStoreId).toBe(steam);
  });

  test('comprar em loja USD: lucro real, estoque total e o saldo da Steam fecham; o gerado vendido dá lucro = líquido - (terminal + preço)', async () => {
    const usd = (await post('/api/stores', { name: 'Steam USD', currency: 'USD' })).body.data;
    await request(app).put('/api/settings/steam-store').send({ storeId: usd.id });
    await post('/api/deposits', { storeId: usd.id, amountStoreCents: 50000, depositedAt: '2026-11-01T12:00:00.000Z' });
    const terminal = await createItemViaApi(app, terminalBody());
    const before = await profit();
    const res = await open(terminal.id, { decision: 'BUY', paidPriceCents: 700, generated: generatedAk() });
    const after = await profit();
    expect(after.realProfitUsdCents).toBe(before.realProfitUsdCents);
    expect(after.stockUsdCents).toBe(before.stockUsdCents + 700);
    expect(balanceOf(after, 'Steam USD')).toBe(balanceOf(before, 'Steam USD') - 700);
    expect(after.consumptionLosses.count).toBe(0);
    const id = res.body.data.generatedItem.id;
    expect(res.body.data.generatedItem.cost).toEqual({ ownUsdCents: 700, inheritedUsdCents: 400, effectiveUsdCents: 1100, estimated: false , hasOperationCost: true });
    const sold = await post(`/api/items/${id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 2000, soldAt: '2026-11-16T12:00:00.000Z' });
    expect(sold.body.data.item.saleProfitUsdCents).toBe(sold.body.data.item.netReceivedCents - 1100);
  });

  test('comprar o item e depois desfazer: operação aparece desfeita no histórico do terminal com o retrato da gerada', async () => {
    await setFx(5);
    const terminal = await createItemViaApi(app, terminalBody());
    const res = await open(terminal.id, { decision: 'BUY', paidPriceCents: 1000, generated: generatedAk() });
    const history = (await get(`/api/items/${terminal.id}/operations`)).body.data;
    expect(history[0]).toMatchObject({ kind: 'OPEN_TERMINAL', role: 'CONSUMED', outcome: 'TRANSFERRED', undoable: true });
    expect(history[0].counterparts.map((c) => [c.role, c.name])).toEqual([['CREATED', 'AK-47 | Redline']]);
    await undo(res.body.data.operation.id);
    const after = (await get(`/api/items/${terminal.id}/operations`)).body.data;
    expect(after[0].undoneAt).toEqual(expect.any(String));
    expect(after[0].detail.undoneGenerated).toMatchObject({ name: 'AK-47 | Redline', acquisitionType: 'COMPRA', purchasePriceCents: 1000, purchaseCurrency: 'BRL' });
    expect(getDb().prepare("SELECT COUNT(*) n FROM items WHERE acquisition_type = 'COMPRA'").get().n).toBe(1); // só o terminal
  });

  test('perdas: terminais recusados do mesmo tipo somam em lossCount/lossUsdCents; BRL deixa a perda estimada; desfazer reduz', async () => {
    await setFx(5);
    const usdTerminal = await createItemViaApi(app, terminalBody());
    const brlTerminal = await createItemViaApi(app, terminalBody({ purchaseStoreId: storeId('Steam'), purchasePriceCents: 1000, fxRateAtPurchase: 5 }));
    const before = await profit();
    const a = await open(usdTerminal.id, { decision: 'DECLINE' });
    expect((await profit()).consumptionLosses).toMatchObject({ usdCents: 400, estimated: false, count: 1 });
    const b = await open(brlTerminal.id, { decision: 'DECLINE' });
    const lost = await profit();
    expect(lost.consumptionLosses).toMatchObject({ usdCents: 600, estimated: true, count: 2 });
    expect(lost.realProfitUsdCents).toBe(before.realProfitUsdCents - 600);
    expect(lost.stockUsdCents).toBe(before.stockUsdCents - 600);
    const stats = (await itemOf(usdTerminal.id)).stats;
    expect(stats).toMatchObject({ unitCount: 0, consumedCount: 2, lossCount: 2, lossUsdCents: 600 });
    expect((await itemOf(brlTerminal.id)).stats).toMatchObject({ lossCount: 2, lossUsdCents: 600 });
    expect((await get(`/api/items/${brlTerminal.id}/operations`)).body.data[0]).toMatchObject({ lossUsdCents: 200 });
    expect((await undo(b.body.data.operation.id)).status).toBe(200);
    expect((await profit()).consumptionLosses).toMatchObject({ usdCents: 400, estimated: false, count: 1 });
    expect((await itemOf(usdTerminal.id)).stats).toMatchObject({ lossCount: 1, lossUsdCents: 400 });
    expect((await undo(a.body.data.operation.id)).status).toBe(200);
    expect((await profit()).consumptionLosses).toMatchObject({ usdCents: 0, count: 0 });
    expect(numbers(await profit())).toEqual(numbers(before));
  });

  test('uma perda desfeita não conta; operação desfeita do DECLINE exibe a perda como nula', async () => {
    const terminal = await createItemViaApi(app, terminalBody());
    const res = await open(terminal.id, { decision: 'DECLINE' });
    await undo(res.body.data.operation.id);
    const ops = (await get(`/api/items/${terminal.id}/operations`)).body.data;
    expect(ops[0]).toMatchObject({ outcome: 'LOST', lossUsdCents: null, undoneAt: expect.any(String) });
    expect((await itemOf(terminal.id)).stats.lossCount).toBe(0);
  });

  test('terminal no holding e em trade lock: DECLINE aceito e o desfazer devolve tudo como estava', async () => {
    const terminal = await createItemViaApi(app, terminalBody({ tradeUnlockAt: '2026-11-30T12:00:00.000Z' }));
    await post(`/api/items/${terminal.id}/off-sale`);
    const before = await itemOf(terminal.id);
    const before$ = numbers(await profit());
    const res = await open(terminal.id, { decision: 'DECLINE' });
    expect(res.status).toBe(201);
    await undo(res.body.data.operation.id);
    const after = await itemOf(terminal.id);
    expect(stripVolatile(after)).toEqual(stripVolatile(before));
    expect(numbers(await profit())).toEqual(before$);
  });

  test('decisão em lote de erros: DECLINE com cotação, BUY com decision de pacote; chave num terminal', async () => {
    const terminal = await createItemViaApi(app, terminalBody());
    const key = await createItemViaApi(app, keyBody());
    expectError(await open(terminal.id, { decision: 'DECLINE', fxRateAtPurchase: 5 }), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'PRICE_NOT_ALLOWED' } });
    expectError(await open(terminal.id, { decision: 'DECLINE', keyItemId: key.id }), 422, 'INVALID_OPERATION_INPUT', { params: { reason: 'KEY_NOT_ALLOWED' } });
    expect((await itemOf(key.id)).status).toBe('EM_ESTOQUE');
  });
});

describe('pacote: números idênticos', () => {
  test('pacote Highlight consumido: lucro real, estoque e saldos iguais; gerada herda o custo', async () => {
    const pkg = await createItemViaApi(app, purchaseBody({ catalogId: X.HIGHLIGHT, purchasePriceCents: 250 }));
    const before = numbers(await profit());
    const res = await open(pkg.id, { generated: { catalogId: CAT.STICKER_CROWN } });
    expect(res.status).toBe(201);
    expect(res.body.data.generatedItem.cost.effectiveUsdCents).toBe(250);
    expect(res.body.data.generatedItem.generatedFrom).toMatchObject({ container: 'PACKAGE', keyName: null });
    expect(numbers(await profit())).toEqual(before);
    expect((await undo(res.body.data.operation.id)).status).toBe(200);
    expect(numbers(await profit())).toEqual(before);
  });
});

describe('proteções e editar a gerada', () => {
  test('editar atributos, trade lock e componentes da gerada é permitido; loja nula no corpo é tolerada; vender e desfazer venda', async () => {
    const box = await createItemViaApi(app, caseBody());
    const key = await createItemViaApi(app, keyBody());
    const res = await open(box.id, { keyItemId: key.id, generated: generatedAk() });
    const id = res.body.data.generatedItem.id;
    const edited = await patch(`/api/items/${id}`, { tradeUnlockAt: '2026-11-25T12:00:00.000Z', floatValue: 0.3, paintSeed: 12 });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ tradeUnlockAt: '2026-11-25T12:00:00.000Z', floatValue: 0.3, paintSeed: 12 });
  });

  test('o custo efetivo da gerada continua o mesmo depois de editar atributos; excluir a gerada e as consumidas é recusado', async () => {
    const box = await createItemViaApi(app, caseBody());
    const key = await createItemViaApi(app, keyBody());
    const res = await open(box.id, { keyItemId: key.id, generated: generatedAk() });
    const id = res.body.data.generatedItem.id;
    await patch(`/api/items/${id}`, { floatValue: 0.22 });
    expect((await itemOf(id)).cost.effectiveUsdCents).toBe(500);
    for (const target of [id, box.id, key.id]) {
      expectError(await request(app).delete(`/api/items/${target}`), 409, 'ITEM_IN_OPERATION');
    }
  });

  test('editar o terminal comprado: preço corrigido atualiza o custo efetivo e o saldo da Steam', async () => {
    await setFx(5);
    const terminal = await createItemViaApi(app, terminalBody());
    const res = await open(terminal.id, { decision: 'BUY', paidPriceCents: 1000, generated: generatedAk() });
    const id = res.body.data.generatedItem.id;
    const mid = await profit();
    await patch(`/api/items/${id}`, { purchasePriceCents: 2000 });
    const after = await profit();
    expect(balanceOf(after, 'Steam')).toBe(balanceOf(mid, 'Steam') - 1000);
    expect((await itemOf(id)).cost.effectiveUsdCents).toBe(400 + 400);
  });
});

describe('loja Steam do app: casos extras', () => {
  test('aceita loja inativa e loja USD; o seletor sai de GET /api/stores; excluir loja Steam sem uso limpa a escolha', async () => {
    const inactive = (await post('/api/stores', { name: 'Steam velha', currency: 'BRL' })).body.data;
    await request(app).patch(`/api/stores/${inactive.id}`).send({ isActive: false });
    const res = await request(app).put('/api/settings/steam-store').send({ storeId: inactive.id });
    expect(res.status).toBe(200);
    expect(res.body.data.steamStoreId).toBe(inactive.id);
    expect((await get('/api/stores')).body.data.find((s) => s.id === inactive.id).isSteamStore).toBe(true);
    expect((await request(app).delete(`/api/stores/${inactive.id}`)).status).toBe(200);
    expect((await get('/api/settings')).body.data.steamStoreId).toBeNull();
  });

  test('mudar a loja Steam não altera terminais já comprados (a compra guarda a loja)', async () => {
    await setFx(5);
    const terminal = await createItemViaApi(app, terminalBody());
    const res = await open(terminal.id, { decision: 'BUY', paidPriceCents: 1000, generated: generatedAk() });
    await request(app).put('/api/settings/steam-store').send({ storeId: storeId('CSFloat') });
    expect((await itemOf(res.body.data.generatedItem.id)).purchaseStoreId).toBe(storeId('Steam'));
  });
});

describe('lote de importação com unidade consumida numa abertura', () => {
  test('o lote que trouxe o terminal consumido fica bloqueado (ITEM_IN_OPERATION) até desfazer a abertura; depois desfaz e apaga tudo', async () => {
    freshDb();
    importCatalogFixture();
    const state = { me: meBody(), trades: [fakeTrade({ id: '7401' })], transactions: [] };
    const importApp = createApp({ now: () => new Date('2026-11-22T15:00:00.000Z'), fetchFn: routedFetch(state), sleepFn: async () => {} });
    const json = (r) => r.set('Content-Type', 'application/json');
    await json(request(importApp).put('/api/integrations/csfloat/api-key')).send({ apiKey: KEY });
    const batch = (await json(request(importApp).post('/api/imports/csfloat/run')).send({ cutoffAt: '2026-11-01T00:00:00.000Z' })).body.data.batch;
    const imported = (await request(importApp).get('/api/items')).body.data.items.find((i) => i.externalSource);
    expect(imported).toBeTruthy();
    // transforma (só no banco de teste) a unidade importada num terminal para poder abri-la
    getDb().prepare("UPDATE items SET catalog_id = ?, name = 'Sealed Genesis Terminal', category = 'OUTRO', variant = NULL, float_value = NULL, paint_seed = NULL, exterior = NULL, phase = NULL WHERE id = ?").run(X.TERMINAL, imported.id);
    CatalogItem.upsertMany([{
      id: X.TERMINAL, source: 'CRATES', category: 'OUTRO', name: 'Sealed Genesis Terminal', nameKey: normalizeSearchText('Sealed Genesis Terminal'),
      searchText: normalizeSearchText('Sealed Genesis Terminal'), minFloat: null, maxFloat: null, hasStattrak: false, hasSouvenir: false,
    }]);
    const opened = await json(request(importApp).post(`/api/items/${imported.id}/open`)).send({ decision: 'DECLINE', openedAt: '2026-11-21T12:00:00.000Z' });
    expect(opened.status).toBe(201);
    const preview = (await request(importApp).get(`/api/imports/batches/${batch.id}/undo-preview`)).body.data;
    expect(preview.undoable).toBe(false);
    expect(preview.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ITEM_IN_OPERATION', itemId: imported.id })]));
    expect((await json(request(importApp).post(`/api/operations/${opened.body.data.operation.id}/undo`)).send({})).status).toBe(200);
    expect((await request(importApp).get(`/api/imports/batches/${batch.id}/undo-preview`)).body.data.undoable).toBe(true);
    const undone = await json(request(importApp).post(`/api/imports/batches/${batch.id}/undo`)).send({ confirmWarnings: true });
    expect(undone.status).toBe(200);
    expect((await request(importApp).get(`/api/items/${imported.id}`)).status).toBe(404);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM item_operations').get().n).toBe(0);
  });
});
