'use strict';

// 10.2 (D361): componentes (stickers, chaveiro, Sticker Slab) pela importação do CSFloat e pela "Varredura completa". API com fetchFn
// falso roteado, banco em memória e fixtures montadas com a estrutura do exemplo real (anonimizado). Nenhuma chamada real.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, seedComponentCatalog, CAT, CAT_EXTRA } = require('../helpers/catalog');
const { storeId } = require('../helpers/apiFixtures');
const itemService = require('../../src/services/itemService');
const { ValidationError } = require('../../src/errors/AppError');
const {
  KEY, meBody, fakeTrade, fakeTransaction, purchaseTx, routedFetch, DEAGLE_4_STICKERS, GLOCK_WEAR_OFFSET, M4A4_SAME_STICKER_TWICE, M4A1S_DUP_SLOT_WEAR1,
  GLOCK_ST_CHARM, SLAB_HYPOTHETICAL, KNIFE_WITH_STICKER, fakeSticker,
} = require('../helpers/csfloatFixtures');

jest.setTimeout(60000);

const JSON_TYPE = 'application/json';
const NOW = new Date('2026-11-22T15:00:00.000Z');
const CUTOFF = '2026-11-01T00:00:00.000Z';
const SOLD_AT = '2026-11-20T10:00:00.000Z';

let app;
let state;

function useApp() {
  state = { me: meBody(), trades: [], transactions: [] };
  app = createApp({ now: () => new Date(NOW.getTime()), fetchFn: routedFetch(state), sleepFn: async () => {} });
}
const post = (url, body = {}) => request(app).post(url).set('Content-Type', JSON_TYPE).send(body);
const run = (body = {}) => post('/api/imports/csfloat/run', body);
const firstRun = (extra = {}) => run({ cutoffAt: CUTOFF, ...extra });
const fullScan = () => run({ fullScan: true });
const getItems = async () => (await request(app).get('/api/items')).body.data.items;
const getItem = async (id) => (await request(app).get(`/api/items/${id}`)).body.data;
const rows = (sql, ...params) => getDb().prepare(sql).all(...params);
const buyTrade = (id, preset, extra = {}) => fakeTrade({ id, item: preset.item, reference: preset.reference, createdAt: '2026-11-20T14:00:00.000Z', ...extra });
const componentsOf = async (itemId) => (await getItem(itemId)).components;
const slotsOf = (components) => components.map((c) => [c.name, c.slot, c.wear ?? c.pattern]);
const importedAt = (itemId) => rows('SELECT components_imported_at AS at FROM items WHERE id = ?', itemId)[0].at;
const updatedAt = (itemId) => rows('SELECT updated_at AS at FROM items WHERE id = ?', itemId)[0].at;
const linkUpdatedAt = (itemId) => rows("SELECT entity_updated_at AS at FROM external_links WHERE entity_type = 'ITEM_PURCHASE' AND entity_id = ?", itemId)[0].at;

// Simula uma compra importada antes da 10.2: sem componentes e sem a marca de "já preenchido".
function makeLegacy(itemId) {
  getDb().prepare('DELETE FROM item_components WHERE item_id = ?').run(itemId);
  getDb().prepare('UPDATE items SET components_imported_at = NULL WHERE id = ?').run(itemId);
}

beforeEach(async () => {
  freshDb();
  importCatalogFixture();
  seedComponentCatalog();
  useApp();
  const res = await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY });
  expect(res.status).toBe(200);
});
afterAll(() => closeDb());

describe('compra criada pela importação', () => {
  test('Desert Eagle com 4 stickers: componentes CSFLOAT, na ordem, e `components_imported_at` gravado', async () => {
    state.trades = [buyTrade('1001', DEAGLE_4_STICKERS)];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, failed: 0, componentsFilled: 0, componentsSkipped: 0 });
    const [item] = await getItems();
    expect(item).toMatchObject({ catalogId: CAT_EXTRA.DEAGLE_TRIGGER, componentSummary: { stickers: 4, charms: 0 } });
    expect(item.components.map((c) => [c.kind, c.catalogId, c.slot, c.wear, c.source, c.origin])).toEqual([
      ['STICKER', 'sticker-big-rmr', 0, 0, 'CSFLOAT', 'CAME_WITH'],
      ['STICKER', 'sticker-heroic-rmr', 1, 0, 'CSFLOAT', 'CAME_WITH'],
      ['STICKER', 'sticker-nip-rmr', 2, 0, 'CSFLOAT', 'CAME_WITH'],
      ['STICKER', 'sticker-flit-rio', 3, 0, 'CSFLOAT', 'CAME_WITH'],
    ]);
    expect(importedAt(item.id)).toBe(NOW.toISOString());
    // nada novo no esquema de dinheiro: o custo é só o preço do trade
    expect(item).toMatchObject({ purchasePriceCents: 1250, purchaseCurrency: 'USD' });
  });

  test('desgaste 0.72 e slots fora de ordem (3 e 2) são gravados como vieram', async () => {
    state.trades = [buyTrade('1002', GLOCK_WEAR_OFFSET)];
    await firstRun();
    const [item] = await getItems();
    expect(slotsOf(item.components)).toEqual([['Sticker | Clavis', 3, 0], ['Sticker | Boom | 2020 RMR', 2, 0.72]]);
  });

  test('o mesmo sticker nos slots 4 e 3 (posicionamento livre): os dois são gravados', async () => {
    state.trades = [buyTrade('1003', M4A4_SAME_STICKER_TWICE)];
    await firstRun();
    const [item] = await getItems();
    expect(slotsOf(item.components)).toEqual([['Sticker | Fly High', 4, 0], ['Sticker | Fly High', 3, 0]]);
  });

  test('dois stickers no mesmo slot e um raspado (wear 1): 2 gravados; o raspado vira aviso COMPONENT_FULLY_SCRAPED no resumo', async () => {
    state.trades = [buyTrade('1004', M4A1S_DUP_SLOT_WEAR1)];
    const res = await firstRun();
    const batch = res.body.data.batch;
    expect(batch.counts).toMatchObject({ purchasesCreated: 1, failed: 0, componentsSkipped: 1 });
    const [item] = await getItems();
    expect(slotsOf(item.components)).toEqual([['Sticker | Flickshot', 4, 0], ['Sticker | Battlefield Portal', 0, 0]]);
    expect(batch.entries[0]).toMatchObject({ outcome: 'CREATED', display: { componentWarnings: [{ code: 'COMPONENT_FULLY_SCRAPED', name: 'Sticker | Scavenger' }] } });
    // o display guarda a lista do trade (nome, slot, desgaste), não a casada com o catálogo
    expect(batch.entries[0].display.components).toHaveLength(3);
  });

  test('StatTrak com 4 stickers e o chaveiro: pendurado CHARM com o pattern', async () => {
    state.trades = [buyTrade('1005', GLOCK_ST_CHARM)];
    await firstRun();
    const [item] = await getItems();
    expect(item).toMatchObject({ variant: 'STATTRAK', componentSummary: { stickers: 4, charms: 1 } });
    expect(item.components.at(-1)).toMatchObject({ kind: 'CHARM', catalogId: CAT_EXTRA.LIL_TEACUP, slot: 0, pattern: 84492, wear: null, name: "Charm | Lil' Teacup" });
  });

  test('Sticker Slab (hipótese): vira STICKER_SLAB com o sticker de dentro e o pattern', async () => {
    state.trades = [buyTrade('1006', SLAB_HYPOTHETICAL)];
    await firstRun();
    const [item] = await getItems();
    expect(item.components).toHaveLength(1);
    expect(item.components[0]).toMatchObject({ kind: 'STICKER_SLAB', catalogId: CAT_EXTRA.FLY_HIGH, name: 'Sticker Slab | Fly High', pattern: 321, wear: null });
  });

  test('sticker fora do catálogo: a compra é criada (nunca bloqueia) e o aviso fica no display', async () => {
    const preset = { item: { stickers: [fakeSticker(1, 0, 'Sticker | Inventado'), fakeSticker(2, 1, 'Sticker | Fly High')] } };
    state.trades = [buyTrade('1007', preset)];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, failed: 0, componentsSkipped: 1 });
    expect(res.body.data.batch.entries[0]).toMatchObject({
      outcome: 'CREATED', display: { componentWarnings: [{ code: 'COMPONENT_CATALOG_NOT_FOUND', name: 'Sticker | Inventado' }] },
    });
    const [item] = await getItems();
    expect(slotsOf(item.components)).toEqual([['Sticker | Fly High', 1, 0]]);
  });

  test('faca com sticker no trade: a compra é criada sem componentes e com COMPONENTS_NOT_ALLOWED', async () => {
    state.trades = [buyTrade('1008', KNIFE_WITH_STICKER)];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, failed: 0, componentsSkipped: 1 });
    expect(res.body.data.batch.entries[0].display.componentWarnings).toEqual([{ code: 'COMPONENTS_NOT_ALLOWED', name: null }]);
    const [item] = await getItems();
    expect(item.components).toEqual([]);
  });

  test('sem stickers: `components_imported_at` é gravado mesmo assim (a varredura não volta a ela)', async () => {
    state.trades = [fakeTrade({ id: '1009' })];
    await firstRun();
    const [item] = await getItems();
    expect(item.components).toEqual([]);
    expect(importedAt(item.id)).toBe(NOW.toISOString());
  });

  test('o display de uma compra sem componentes não ganha as chaves novas no banco', async () => {
    state.trades = [fakeTrade({ id: '1010' })];
    await firstRun();
    const stored = JSON.parse(rows('SELECT display_json AS d FROM import_batch_entries')[0].d);
    expect(stored).not.toHaveProperty('components');
    expect(stored).not.toHaveProperty('componentWarnings');
  });

  test('erro de componente nunca vira FAILED: se o item recusar os componentes, a compra entra sem eles, com aviso', async () => {
    const spy = jest.spyOn(itemService, 'createItem');
    spy.mockImplementationOnce(() => { throw new ValidationError('limite', 'COMPONENT_LIMIT_EXCEEDED', { field: 'components' }); });
    state.trades = [buyTrade('1011', DEAGLE_4_STICKERS)];
    const res = await firstRun();
    spy.mockRestore();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, failed: 0, componentsSkipped: 1 });
    expect(res.body.data.batch.entries[0].display.componentWarnings).toEqual([{ code: 'COMPONENT_CATALOG_NOT_FOUND', name: null }]);
    expect((await getItems())[0].components).toEqual([]);
  });

  test('privacidade: nem o domínio fictício, nem `stickerId`, nem os preços de referência chegam ao banco', async () => {
    state.trades = [buyTrade('1012', GLOCK_ST_CHARM)];
    await firstRun();
    const tables = rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    const dump = JSON.stringify(tables.map((name) => rows(`SELECT * FROM "${name}"`).map((r) => (name === 'integrations' ? { ...r, api_key: null } : r))));
    for (const forbidden of ['icones-ficticios', 'stickerId', 'offset_x', 'offset_y', 'offset_z', 'rotation', 'base_price', 'predicted_price', 'sticker_overpay', 'keychain_price', 'float_factor',
      'csgo_econ_action_preview', 'serialized_inspect', 'SERIALIZED-FICTICIO-QA', 'GS-SIG-FICTICIO-QA', 'SCREENSHOT-FICTICIO-QA']) {
      expect(dump).not.toContain(forbidden);
    }
  });
});

describe('compra ligada a um lançamento manual (MATCHED)', () => {
  test('não ganha componentes nem a marca: ligar não altera o manual', async () => {
    const manual = (await request(app).post('/api/items').send({
      catalogId: CAT_EXTRA.DEAGLE_TRIGGER, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 1250,
      acquiredAt: '2026-11-20T09:00:00.000Z', floatValue: 0.2534, paintSeed: 661,
    })).body.data;
    state.trades = [buyTrade('2001', DEAGLE_4_STICKERS)];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ matched: 1, purchasesCreated: 0 });
    expect((await getItem(manual.id)).components).toEqual([]);
    expect(importedAt(manual.id)).toBeNull();
    // nem a varredura completa preenche um item ligado (só os criados pela importação)
    const scan = await fullScan();
    expect(scan.body.data.batch.counts.componentsFilled).toBe(0);
    expect((await getItem(manual.id)).components).toEqual([]);
  });
});

describe('"Varredura completa": preenche as compras já importadas, uma única vez', () => {
  async function importedLegacy(preset, id = '3001', extra = {}) {
    state.trades = [buyTrade(id, preset, extra)];
    state.transactions = [purchaseTx(`9${id}`, 1250)];
    await firstRun();
    const [item] = await getItems();
    makeLegacy(item.id);
    return item;
  }

  test('preenche a compra legada com os componentes CSFLOAT, marca e conta em componentsFilled', async () => {
    const item = await importedLegacy(DEAGLE_4_STICKERS);
    expect(await componentsOf(item.id)).toEqual([]);
    const res = await fullScan();
    expect(res.body.data.batch).toMatchObject({ fullScan: true, counts: { componentsFilled: 1, componentsSkipped: 0, purchasesCreated: 0 } });
    const comps = await componentsOf(item.id);
    expect(comps.map((c) => [c.catalogId, c.slot, c.source])).toEqual([
      ['sticker-big-rmr', 0, 'CSFLOAT'], ['sticker-heroic-rmr', 1, 'CSFLOAT'], ['sticker-nip-rmr', 2, 'CSFLOAT'], ['sticker-flit-rio', 3, 'CSFLOAT'],
    ]);
    expect(importedAt(item.id)).toBe(NOW.toISOString());
  });

  test('não repete: depois de remover um sticker à mão, a varredura seguinte não o devolve', async () => {
    const item = await importedLegacy(DEAGLE_4_STICKERS);
    await fullScan();
    const comps = await componentsOf(item.id);
    const kept = comps.slice(0, 3).map(({ kind, catalogId, slot, wear }) => ({ kind, catalogId, slot, wear }));
    const edited = await request(app).patch(`/api/items/${item.id}`).send({ components: kept });
    expect(edited.status).toBe(200);
    const again = await fullScan();
    expect(again.body.data.batch.counts.componentsFilled).toBe(0);
    expect((await componentsOf(item.id)).map((c) => c.slot)).toEqual([0, 1, 2]);
  });

  test('não sobrescreve componentes registrados à mão: só marca', async () => {
    const item = await importedLegacy(DEAGLE_4_STICKERS);
    const manual = [{ kind: 'STICKER', catalogId: CAT.STICKER_TITAN, slot: 0, wear: 0.3 }];
    expect((await request(app).patch(`/api/items/${item.id}`).send({ components: manual })).status).toBe(200);
    const res = await fullScan();
    expect(res.body.data.batch.counts.componentsFilled).toBe(0);
    const comps = await componentsOf(item.id);
    expect(comps).toHaveLength(1);
    expect(comps[0]).toMatchObject({ catalogId: CAT.STICKER_TITAN, source: 'MANUAL', wear: 0.3 });
    expect(importedAt(item.id)).toBe(NOW.toISOString());
  });

  test('a importação normal (sem varredura) não preenche compras antigas', async () => {
    const item = await importedLegacy(DEAGLE_4_STICKERS);
    const res = await run({});
    expect(res.body.data.batch === null || res.body.data.batch.counts.componentsFilled === 0).toBe(true);
    expect(await componentsOf(item.id)).toEqual([]);
    expect(importedAt(item.id)).toBeNull();
  });

  test('usa a categoria ATUAL do item no app: virou faca, não ganha componentes (aviso), e fica marcada', async () => {
    const item = await importedLegacy(DEAGLE_4_STICKERS);
    getDb().prepare("UPDATE items SET category = 'FACA' WHERE id = ?").run(item.id);
    const res = await fullScan();
    expect(res.body.data.batch.counts).toMatchObject({ componentsFilled: 0, componentsSkipped: 1 });
    expect(await componentsOf(item.id)).toEqual([]);
    expect(importedAt(item.id)).toBe(NOW.toISOString());
  });

  test('preenche também a unidade já vendida (histórico)', async () => {
    const item = await importedLegacy(DEAGLE_4_STICKERS, '3002', { protectionEndsAt: '2026-11-21T00:00:00.000Z' });
    const sold = await request(app).post(`/api/items/${item.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 2000, soldAt: '2026-11-22T10:00:00.000Z' });
    expect(sold.status).toBe(200);
    const res = await fullScan();
    expect(res.body.data.batch.counts.componentsFilled).toBe(1);
    expect(await componentsOf(item.id)).toHaveLength(4);
  });

  test('o desgaste do sticker legado e os avisos entram no resumo (componentsSkipped), sem criar entrada no lote', async () => {
    const item = await importedLegacy(M4A1S_DUP_SLOT_WEAR1);
    const res = await fullScan();
    expect(res.body.data.batch.counts).toMatchObject({ componentsFilled: 1, componentsSkipped: 1 });
    expect(slotsOf(await componentsOf(item.id))).toEqual([['Sticker | Flickshot', 4, 0], ['Sticker | Battlefield Portal', 0, 0]]);
    expect(res.body.data.batch.entries.filter((e) => e.outcome === 'CREATED')).toEqual([]);
  });

  test('não muda `updated_at` do item nem o `entityUpdatedAt` do vínculo (preencher não é editar)', async () => {
    const item = await importedLegacy(DEAGLE_4_STICKERS);
    const before = { item: updatedAt(item.id), link: linkUpdatedAt(item.id) };
    await fullScan();
    expect(updatedAt(item.id)).toBe(before.item);
    expect(linkUpdatedAt(item.id)).toBe(before.link);
  });

  test('lucro real, saldo da loja, giro e itemStats idênticos antes e depois da varredura', async () => {
    const item = await importedLegacy(DEAGLE_4_STICKERS);
    const snapshot = async () => ({
      profit: (await request(app).get('/api/profit/summary')).body.data,
      balance: (await request(app).get('/api/store-balances/current')).body.data,
      item: (({ components, componentSummary, componentsImportedAt, ...rest }) => rest)(await getItem(item.id)),
    });
    const before = await snapshot();
    await fullScan();
    expect(await snapshot()).toEqual(before);
  });

  test('desfazer o lote original depois do preenchimento: sem confirmação por edição; item e componentes saem', async () => {
    state.trades = [buyTrade('3003', DEAGLE_4_STICKERS)];
    state.transactions = [purchaseTx('93003', 1250)];
    const first = await firstRun();
    const batchId = first.body.data.batch.id;
    const [item] = await getItems();
    makeLegacy(item.id);
    expect((await fullScan()).status).toBe(200);
    expect(await componentsOf(item.id)).toHaveLength(4);
    const preview = await request(app).get(`/api/imports/batches/${batchId}/undo-preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.warnings).toEqual([]);
    const undo = await post(`/api/imports/batches/${batchId}/undo`, {});
    expect(undo.status).toBe(200);
    expect(rows('SELECT COUNT(*) AS n FROM items')[0].n).toBe(0);
    expect(rows('SELECT COUNT(*) AS n FROM item_components')[0].n).toBe(0);
  });

  test('o lote guarda as contagens novas (e a lista de lotes também)', async () => {
    const item = await importedLegacy(M4A1S_DUP_SLOT_WEAR1);
    const scan = await fullScan();
    expect(item.id).toBeGreaterThan(0);
    const stored = rows('SELECT components_filled_count AS f, components_skipped_count AS s FROM import_batches WHERE id = ?', scan.body.data.batch.id)[0];
    expect(stored).toEqual({ f: 1, s: 1 });
    const list = (await request(app).get('/api/imports/batches')).body.data.batches;
    expect(list[0].counts).toMatchObject({ componentsFilled: 1, componentsSkipped: 1 });
  });
});

describe('"Lançar compra", "Foi drop" e "Criar mesmo assim"', () => {
  const sale = (id, preset, extra = {}) => fakeTrade({
    id, direction: 'SELL', state: 'verified', protectionEndsAt: null, price: 1500, createdAt: SOLD_AT, item: preset.item, reference: preset.reference, ...extra,
  });
  const credit = (id) => fakeTransaction({
    id: `tx-sold-${id}`, type: 'contract_sold', pendingOffset: 1470, createdAt: '2026-11-20T10:00:05.000Z', details: { contract_id: `9${id}`, fee_amount: '30' },
  });
  const purchase = (extra = {}) => ({
    purchaseStoreId: storeId('CSMoney'), purchasePriceCents: 900, acquiredAt: '2026-10-01T12:00:00.000Z', tradeUnlockAt: '2026-10-08T12:00:00.000Z', ...extra,
  });
  const withoutPurchase = async (trades, transactions) => {
    state.trades = trades;
    state.transactions = transactions;
    const batch = (await firstRun()).body.data.batch;
    return batch.entries.filter((e) => e.reasonCode === 'PURCHASE_NOT_FOUND');
  };
  const resolve = (id, body) => post(`/api/imports/entries/${id}/resolve`, body);
  const soldItemId = () => rows("SELECT entity_id AS id FROM external_links WHERE entity_type = 'ITEM_SALE'")[0].id;
  const preset = { item: { ...DEAGLE_4_STICKERS.item, market_hash_name: 'AK-47 | Redline (Field-Tested)', item_name: 'Redline', float_value: 0.2534 }, reference: DEAGLE_4_STICKERS.reference };

  test('a pendência guarda os componentes do trade e a visão os expõe', async () => {
    const [entry] = await withoutPurchase([sale('4001', preset)], [credit('4001')]);
    expect(entry.display.components.map((c) => c.name)).toEqual(DEAGLE_4_STICKERS.item.stickers.map((s) => s.name));
    expect(entry.display.components[0]).toEqual({ from: 'STICKER', name: 'Sticker | BIG (Holo) | 2020 RMR', slot: 0, wear: 0, pattern: null });
  });

  test('"Lançar compra": o item nasce com os stickers (CSFLOAT) e já marcado como preenchido', async () => {
    const [entry] = await withoutPurchase([sale('4002', preset)], [credit('4002')]);
    expect((await resolve(entry.id, { action: 'CREATE_PURCHASE', purchase: purchase() })).status).toBe(200);
    const id = soldItemId();
    const item = await getItem(id);
    expect(item).toMatchObject({ status: 'VENDIDO', purchasePriceCents: 900 });
    expect(item.components.map((c) => [c.catalogId, c.slot, c.source])).toEqual([
      ['sticker-big-rmr', 0, 'CSFLOAT'], ['sticker-heroic-rmr', 1, 'CSFLOAT'], ['sticker-nip-rmr', 2, 'CSFLOAT'], ['sticker-flit-rio', 3, 'CSFLOAT'],
    ]);
    expect(importedAt(id)).toBe(NOW.toISOString());
  });

  test('"Foi drop (ganhei)": o item GANHEI nasce com os stickers', async () => {
    const [entry] = await withoutPurchase([sale('4003', preset)], [credit('4003')]);
    expect((await resolve(entry.id, { action: 'MARK_WON' })).status).toBe(200);
    const item = await getItem(soldItemId());
    expect(item).toMatchObject({ acquisitionType: 'GANHEI', purchasePriceCents: 0 });
    expect(item.components).toHaveLength(4);
  });

  test('"Salvar só a compra" (sem o crédito no extrato): a compra nasce com os stickers e a pendência continua aberta', async () => {
    const [entry] = await withoutPurchase([sale('4004', preset)], []);
    const res = await resolve(entry.id, { action: 'CREATE_PURCHASE', purchase: purchase(), purchaseOnly: true });
    expect(res.status).toBe(200);
    const items = await getItems();
    expect(items).toHaveLength(1);
    expect(items[0].components).toHaveLength(4);
  });

  test('pendência antiga (sem `components` no display): o item nasce sem componentes, sem erro', async () => {
    const [entry] = await withoutPurchase([sale('4005', preset)], [credit('4005')]);
    const stored = JSON.parse(rows('SELECT display_json AS d FROM import_batch_entries WHERE id = ?', entry.id)[0].d);
    delete stored.components;
    getDb().prepare('UPDATE import_batch_entries SET display_json = ? WHERE id = ?').run(JSON.stringify(stored), entry.id);
    const res = await resolve(entry.id, { action: 'MARK_WON' });
    expect(res.status).toBe(200);
    expect(res.body.data.display).toMatchObject({ components: [], componentWarnings: [] });
    expect((await getItem(soldItemId())).components).toEqual([]);
  });

  test('componente que deixou de casar com o catálogo só some: não bloqueia o lançamento', async () => {
    const [entry] = await withoutPurchase([sale('4006', preset)], [credit('4006')]);
    getDb().prepare("DELETE FROM catalog_items WHERE id = 'sticker-heroic-rmr'").run();
    expect((await resolve(entry.id, { action: 'MARK_WON' })).status).toBe(200);
    expect((await getItem(soldItemId())).components.map((c) => c.slot)).toEqual([0, 2, 3]);
  });

  test('"Criar mesmo assim" (possível duplicado de compra): o item nasce com os stickers', async () => {
    const manual = (extra = {}) => request(app).post('/api/items').send({
      catalogId: CAT.AK_REDLINE, acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 1250,
      acquiredAt: '2026-11-20T09:00:00.000Z', floatValue: 0.2534, paintSeed: 661, ...extra,
    });
    expect((await manual()).status).toBe(201);
    expect((await manual()).status).toBe(201);
    state.trades = [buyTrade('4007', preset)];
    const res = await firstRun();
    const entry = res.body.data.batch.entries[0];
    expect(entry.outcome).toBe('POSSIBLE_DUPLICATE');
    expect(entry.display.components).toHaveLength(4);
    expect((await post(`/api/imports/entries/${entry.id}/resolve`, { action: 'CREATE' })).status).toBe(200);
    const created = (await getItems()).find((i) => i.components.length > 0);
    expect(created.components.map((c) => c.source)).toEqual(['CSFLOAT', 'CSFLOAT', 'CSFLOAT', 'CSFLOAT']);
    expect(importedAt(created.id)).toBe(NOW.toISOString());
    expect((await getItems()).filter((i) => i.components.length === 0)).toHaveLength(2);
  });
});
