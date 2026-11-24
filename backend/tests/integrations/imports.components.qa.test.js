'use strict';

// 10.2 (D361), QA: bordas da importação de componentes (privacidade em todo o banco e nas respostas, limites com aviso, entradas inválidas,
// varredura idempotente, desfazer e equivalência de lucro real/saldo/itemStats/agrupamento com e sem componentes). Fetch falso, banco em memória.
const request = require('supertest');
const { getDb, closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, seedComponentCatalog, CAT_EXTRA } = require('../helpers/catalog');
const { storeId } = require('../helpers/apiFixtures');
const {
  KEY, meBody, fakeTrade, purchaseTx, routedFetch, fakeSticker, DEAGLE_4_STICKERS, GLOCK_WEAR_OFFSET, M4A4_SAME_STICKER_TWICE, M4A1S_DUP_SLOT_WEAR1,
  GLOCK_ST_CHARM, SLAB_HYPOTHETICAL, KNIFE_WITH_STICKER, INVALID_VARIANTS, FAKE_ICON_HOST, TRADE_PII,
} = require('../helpers/csfloatFixtures');

jest.setTimeout(60000);

const JSON_TYPE = 'application/json';
const NOW = new Date('2026-11-22T15:00:00.000Z');
const CUTOFF = '2026-11-01T00:00:00.000Z';

let app;
let state;

async function setup() {
  freshDb();
  importCatalogFixture();
  seedComponentCatalog();
  state = { me: meBody(), trades: [], transactions: [] };
  app = createApp({ now: () => new Date(NOW.getTime()), fetchFn: routedFetch(state), sleepFn: async () => {} });
  const res = await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY });
  expect(res.status).toBe(200);
}
const post = (url, body = {}) => request(app).post(url).set('Content-Type', JSON_TYPE).send(body);
const run = (body = {}) => post('/api/imports/csfloat/run', body);
const firstRun = (extra = {}) => run({ cutoffAt: CUTOFF, ...extra });
const fullScan = () => run({ fullScan: true });
const getItems = async () => (await request(app).get('/api/items')).body.data.items;
const getItem = async (id) => (await request(app).get(`/api/items/${id}`)).body.data;
const rows = (sql, ...params) => getDb().prepare(sql).all(...params);
const buyTrade = (id, preset, extra = {}) => fakeTrade({ id, item: preset.item, reference: preset.reference, createdAt: '2026-11-20T14:00:00.000Z', ...extra });
const slots = (components) => components.map((c) => [c.name, c.slot, c.wear ?? c.pattern]);
const makeLegacy = (itemId) => {
  getDb().prepare('DELETE FROM item_components WHERE item_id = ?').run(itemId);
  getDb().prepare('UPDATE items SET components_imported_at = NULL WHERE id = ?').run(itemId);
};

beforeEach(setup);
afterAll(() => closeDb());

describe('privacidade: nenhum campo proibido chega ao banco, ao display_json nem às respostas', () => {
  const FORBIDDEN = [
    'inspect_link', 'csgo_econ_action_preview', 'asset_id', 'serialized_inspect', 'SERIALIZED-FICTICIO-QA', 'gs_sig', 'GS-SIG-FICTICIO-QA', 'cs2_screenshot',
    'SCREENSHOT-FICTICIO-QA', 'stickerId', 'icon_url', FAKE_ICON_HOST, 'icones-ficticios', 'offset_x', 'offset_y', 'offset_z', 'rotation', 'base_price',
    'predicted_price', 'sticker_overpay', 'keychain_price', 'float_factor', 'sticker_index', 'keychain_index', 'keychain_pattern',
  ];

  test('todos os presets importados de uma vez: banco inteiro e respostas da API limpos', async () => {
    const presets = [DEAGLE_4_STICKERS, GLOCK_WEAR_OFFSET, M4A4_SAME_STICKER_TWICE, M4A1S_DUP_SLOT_WEAR1, GLOCK_ST_CHARM, SLAB_HYPOTHETICAL, KNIFE_WITH_STICKER,
      INVALID_VARIANTS.sevenStickers, INVALID_VARIANTS.twoKeychains];
    state.trades = presets.map((p, i) => buyTrade(String(5000 + i), p));
    const res = await firstRun();
    expect(res.status).toBe(200);
    expect(res.body.data.batch.counts.failed).toBe(0);
    const scan = await fullScan();
    const batches = await request(app).get('/api/imports/batches');
    const items = await request(app).get('/api/items');
    const bodies = JSON.stringify([res.body, scan.body, batches.body, items.body]);
    const tables = rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    const dump = JSON.stringify(tables.map((name) => rows(`SELECT * FROM "${name}"`).map((r) => Object.values(name === 'integrations' ? { ...r, api_key: null } : r))));
    // as colunas manuais `inspect_link` e `asset_id` existem em `items`, mas a importação nunca as preenche
    expect(rows('SELECT COUNT(*) n FROM items WHERE inspect_link IS NOT NULL OR asset_id IS NOT NULL')[0].n).toBe(0);
    for (const text of [bodies, dump]) {
      for (const forbidden of FORBIDDEN) expect(text).not.toContain(forbidden);
      for (const value of TRADE_PII) expect(text).not.toContain(value);
    }
  });

  test('o display_json guarda só as chaves da allowlist em cada componente', async () => {
    state.trades = [buyTrade('5100', GLOCK_ST_CHARM)];
    await firstRun();
    const stored = JSON.parse(rows('SELECT display_json AS d FROM import_batch_entries')[0].d);
    expect(stored.components).toHaveLength(5);
    for (const c of stored.components) expect(Object.keys(c).sort()).toEqual(['from', 'name', 'pattern', 'slot', 'wear']);
    expect(Object.keys(stored).filter((k) => /sticker|keychain|inspect|asset|offset/i.test(k))).toEqual([]);
  });
});

describe('limites e entradas inválidas na compra criada: sempre aviso, nunca FAILED', () => {
  test('7 stickers: 5 gravados, o excedente vira COMPONENT_LIMIT_EXCEEDED e a compra é criada', async () => {
    state.trades = [buyTrade('6001', INVALID_VARIANTS.sevenStickers)];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, failed: 0, componentsSkipped: 1 });
    expect(res.body.data.batch.entries[0].display.componentWarnings).toEqual([{ code: 'COMPONENT_LIMIT_EXCEEDED', name: 'Sticker | Fly High' }]);
    expect((await getItems())[0].components).toHaveLength(5);
  });

  test('2 chaveiros: 1 gravado (o primeiro), o outro com aviso', async () => {
    state.trades = [buyTrade('6002', INVALID_VARIANTS.twoKeychains)];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, failed: 0, componentsSkipped: 1 });
    const [item] = await getItems();
    expect(item.components.map((c) => [c.kind, c.pattern])).toEqual([['CHARM', 1]]);
  });

  test('wear em texto, slot 9 e nome vazio: a compra entra; wear inválido e slot inválido gravam sem eles; nome vazio vira aviso', async () => {
    state.trades = [
      buyTrade('6003', INVALID_VARIANTS.wearText, { createdAt: '2026-11-20T10:00:00.000Z' }),
      buyTrade('6004', INVALID_VARIANTS.slotNine, { createdAt: '2026-11-20T11:00:00.000Z' }),
      buyTrade('6005', INVALID_VARIANTS.emptyName, { createdAt: '2026-11-20T12:00:00.000Z' }),
    ];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 3, failed: 0 });
    const byTrade = Object.fromEntries(res.body.data.batch.entries.map((e) => [e.display.componentWarnings ? 'w' + e.id : e.id, e]));
    expect(Object.keys(byTrade).length).toBe(3);
    const items = await getItems();
    const withSticker = items.filter((i) => i.components.length > 0);
    expect(withSticker).toHaveLength(2);
    for (const item of withSticker) {
      expect(item.components[0]).toMatchObject({ kind: 'STICKER', catalogId: CAT_EXTRA.FLY_HIGH });
      expect(item.components[0].wear === null || item.components[0].wear === 0).toBe(true);
    }
    const nine = withSticker.find((i) => i.acquiredAt === '2026-11-20T11:00:00.000Z') || withSticker.find((i) => i.components[0].slot === null);
    expect(nine.components[0].slot).toBeNull();
    const empty = res.body.data.batch.entries.find((e) => e.display.componentWarnings.length > 0);
    expect(empty.display.componentWarnings).toEqual([{ code: 'COMPONENT_CATALOG_NOT_FOUND', name: null }]);
  });

  test('wear 0.72 grava como fração e wear fora de [0,1] no cru grava sem desgaste (nunca 72 nem 1.5)', async () => {
    const preset = { item: { ...INVALID_VARIANTS.wearText.item, stickers: [fakeSticker(1, 0, 'Sticker | Fly High', { wear: 1.5 }), fakeSticker(2, 1, 'Sticker | Clavis', { wear: 0.72 })] } };
    state.trades = [buyTrade('6006', preset)];
    await firstRun();
    const [item] = await getItems();
    const wears = item.components.map((c) => c.wear);
    expect(wears).toContain(0.72);
    expect(wears.every((w) => w === null || (w >= 0 && w < 1))).toBe(true);
  });

  test('10 nomes fora do catálogo: no máximo 10 avisos por item e componentsSkipped igual a eles', async () => {
    const stickers = Array.from({ length: 10 }, (_, i) => fakeSticker(i, i % 5, `Sticker | Inventado ${i}`));
    state.trades = [buyTrade('6007', { item: { ...INVALID_VARIANTS.wearText.item, stickers } })];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, failed: 0, componentsSkipped: 10 });
    expect(res.body.data.batch.entries[0].display.componentWarnings).toHaveLength(10);
    expect((await getItems())[0].components).toEqual([]);
  });

  test('faca com sticker: item criado, sem componentes, COMPONENTS_NOT_ALLOWED uma vez; a marca de importação fica gravada', async () => {
    state.trades = [buyTrade('6008', KNIFE_WITH_STICKER)];
    const res = await firstRun();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 1, failed: 0, componentsSkipped: 1 });
    const [item] = await getItems();
    expect(item.category).toBe('FACA');
    expect(item.components).toEqual([]);
    expect(rows('SELECT components_imported_at AS at FROM items WHERE id = ?', item.id)[0].at).toBe(NOW.toISOString());
  });

  test('o `display` guarda a lista do trade (com o raspado e o sticker de faca), não a casada: pendência pode recasar depois', async () => {
    state.trades = [buyTrade('6009', M4A1S_DUP_SLOT_WEAR1)];
    const res = await firstRun();
    expect(res.body.data.batch.entries[0].display.components.map((c) => [c.name, c.wear])).toEqual([
      ['Sticker | Scavenger', 1], ['Sticker | Flickshot', 0], ['Sticker | Battlefield Portal', 0],
    ]);
  });

  test('o preço, a loja e o saldo da compra importada não mudam por causa dos componentes', async () => {
    state.trades = [buyTrade('6010', DEAGLE_4_STICKERS)];
    await firstRun();
    const [item] = await getItems();
    expect(item).toMatchObject({ purchasePriceCents: 1250, purchaseCurrency: 'USD', acquisitionType: 'COMPRA' });
    expect(item.components.every((c) => c.source === 'CSFLOAT')).toBe(true);
  });
});

describe('"Varredura completa": idempotência e marca', () => {
  async function legacy(preset, id = '7001') {
    state.trades = [buyTrade(id, preset)];
    state.transactions = [purchaseTx(`9${id}`, 1250)];
    await firstRun();
    const [item] = await getItems();
    makeLegacy(item.id);
    return item;
  }

  test('varrer duas e três vezes dá o mesmo resultado: sem duplicar, sem recontar', async () => {
    const item = await legacy(DEAGLE_4_STICKERS);
    const first = await fullScan();
    expect(first.body.data.batch.counts.componentsFilled).toBe(1);
    const after = rows('SELECT * FROM item_components WHERE item_id = ? ORDER BY id', item.id);
    expect(after).toHaveLength(4);
    for (let i = 0; i < 2; i += 1) {
      const again = await fullScan();
      expect(again.body.data.batch === null || again.body.data.batch.counts.componentsFilled === 0).toBe(true);
    }
    expect(rows('SELECT * FROM item_components WHERE item_id = ? ORDER BY id', item.id)).toEqual(after);
  });

  test('o aviso do raspado/não registrado conta uma vez só: a segunda varredura não o repete', async () => {
    await legacy(M4A1S_DUP_SLOT_WEAR1);
    const first = await fullScan();
    expect(first.body.data.batch.counts).toMatchObject({ componentsFilled: 1, componentsSkipped: 1 });
    const second = await fullScan();
    expect(second.body.data.batch === null || second.body.data.batch.counts.componentsSkipped === 0).toBe(true);
  });

  test('compra sem stickers no trade: só marca, sem preencher nem avisar', async () => {
    state.trades = [fakeTrade({ id: '7002', createdAt: '2026-11-20T14:00:00.000Z' })];
    state.transactions = [purchaseTx('97002', 1250)];
    await firstRun();
    const [item] = await getItems();
    makeLegacy(item.id);
    const res = await fullScan();
    expect(res.body.data.batch.counts).toMatchObject({ componentsFilled: 0, componentsSkipped: 0 });
    expect(rows('SELECT components_imported_at AS at FROM items WHERE id = ?', item.id)[0].at).toBe(NOW.toISOString());
    expect(await getItem(item.id)).toMatchObject({ components: [] });
  });

  test('item com componente manual: nada é gravado, nenhum aviso do trade é contado e `updated_at` não muda', async () => {
    const item = await legacy(M4A1S_DUP_SLOT_WEAR1);
    const manual = [{ kind: 'STICKER', catalogId: CAT_EXTRA.FLY_HIGH, slot: 1, wear: 0.2 }];
    expect((await request(app).patch(`/api/items/${item.id}`).send({ components: manual })).status).toBe(200);
    const updated = rows('SELECT updated_at AS at FROM items WHERE id = ?', item.id)[0].at;
    const res = await fullScan();
    expect(res.body.data.batch.counts).toMatchObject({ componentsFilled: 0, componentsSkipped: 0 });
    const comps = (await getItem(item.id)).components;
    expect(comps).toHaveLength(1);
    expect(comps[0]).toMatchObject({ source: 'MANUAL', wear: 0.2, slot: 1 });
    expect(rows('SELECT updated_at AS at FROM items WHERE id = ?', item.id)[0].at).toBe(updated);
  });

  test('removida à mão a última componente de uma compra preenchida: a varredura não devolve (já marcada)', async () => {
    const item = await legacy(GLOCK_ST_CHARM, '7003');
    await fullScan();
    expect((await getItem(item.id)).components).toHaveLength(5);
    expect((await request(app).patch(`/api/items/${item.id}`).send({ components: [] })).status).toBe(200);
    const again = await fullScan();
    expect(again.body.data.batch === null || again.body.data.batch.counts.componentsFilled === 0).toBe(true);
    expect((await getItem(item.id)).components).toEqual([]);
  });

  test('só as compras CREATED do trade BUY são preenchidas: a varredura não cria nem muda itens (contagem de itens e compras iguais)', async () => {
    await legacy(DEAGLE_4_STICKERS);
    const before = rows('SELECT COUNT(*) n FROM items')[0].n;
    const res = await fullScan();
    expect(res.body.data.batch.counts).toMatchObject({ purchasesCreated: 0, salesCreated: 0, matched: 0 });
    expect(rows('SELECT COUNT(*) n FROM items')[0].n).toBe(before);
  });
});

describe('desfazer o lote', () => {
  test('lote normal com componentes: desfazer exclui o item e os componentes, sem pedir confirmação', async () => {
    state.trades = [buyTrade('8001', DEAGLE_4_STICKERS)];
    state.transactions = [purchaseTx('98001', 1250)];
    const batch = (await firstRun()).body.data.batch;
    expect(rows('SELECT COUNT(*) n FROM item_components')[0].n).toBe(4);
    const preview = await request(app).get(`/api/imports/batches/${batch.id}/undo-preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.warnings).toEqual([]);
    expect((await post(`/api/imports/batches/${batch.id}/undo`, {})).status).toBe(200);
    expect(rows('SELECT COUNT(*) n FROM items')[0].n).toBe(0);
    expect(rows('SELECT COUNT(*) n FROM item_components')[0].n).toBe(0);
  });

  test('editar os componentes depois (edição de verdade) volta a exigir confirmação no desfazer', async () => {
    state.trades = [buyTrade('8002', DEAGLE_4_STICKERS)];
    state.transactions = [purchaseTx('98002', 1250)];
    const batch = (await firstRun()).body.data.batch;
    const [item] = await getItems();
    // `updated_at` anda quando o usuário edita o item; o relógio do app é fixo, então muda-se o campo com outro valor de data
    expect((await request(app).patch(`/api/items/${item.id}`).send({ floatValue: 0.3 })).status).toBe(200);
    getDb().prepare('UPDATE items SET updated_at = ? WHERE id = ?').run('2026-11-23T00:00:00.000Z', item.id); // o relógio do teste é fixo
    const preview = await request(app).get(`/api/imports/batches/${batch.id}/undo-preview`);
    expect(preview.status).toBe(200);
    expect(JSON.stringify(preview.body.data)).toMatch(/edit|ITEM_EDITED/i);
  });

  test('desfazer o lote da varredura não remove o item nem os componentes preenchidos', async () => {
    state.trades = [buyTrade('8003', DEAGLE_4_STICKERS)];
    state.transactions = [purchaseTx('98003', 1250)];
    await firstRun();
    const [item] = await getItems();
    makeLegacy(item.id);
    const scan = (await fullScan()).body.data.batch;
    const undo = await post(`/api/imports/batches/${scan.id}/undo`, {});
    // o preenchimento não conta como "mudou algo" (D361 item 7): o lote da varredura não tem o que desfazer
    expect(undo.status).toBe(409);
    expect(undo.body.error).toMatchObject({ code: 'IMPORT_UNDO_NOT_LATEST', params: { reason: 'NOTHING_TO_UNDO' } });
    expect((await getItem(item.id)).components).toHaveLength(4);
    expect(rows('SELECT COUNT(*) n FROM items')[0].n).toBe(1);
  });
});

describe('lucro real, saldo, itemStats e agrupamento idênticos com e sem componentes', () => {
  const LOCK_OVER = { protectionEndsAt: '2026-11-21T00:00:00.000Z' };
  const bare = (preset) => { const { stickers, keychains, ...item } = preset.item; return { item, reference: preset.reference }; };

  async function scenario(preset) {
    await setup();
    state.trades = [buyTrade('9001', preset, LOCK_OVER), buyTrade('9002', preset, { createdAt: '2026-11-20T15:00:00.000Z', ...LOCK_OVER })];
    state.transactions = [purchaseTx('99001', 1250), purchaseTx('99002', 1250)];
    await firstRun();
    const items = await getItems();
    const sold = await request(app).post(`/api/items/${items[0].id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 2000, soldAt: '2026-11-21T10:00:00.000Z' });
    expect(sold.status).toBe(200);
    const strip = ({ components, componentSummary, ...rest }) => rest;
    const list = (await getItems()).map(strip);
    return {
      profit: (await request(app).get('/api/profit/summary')).body.data,
      balance: (await request(app).get('/api/store-balances/current')).body.data,
      stats: (await request(app).get('/api/items/stats').query({ name: 'Desert Eagle | Trigger Discipline', category: 'SKIN' })).body.data,
      groups: (await request(app).get('/api/items/groups')).body.data,
      items: list,
    };
  }

  test('lucro real, saldo e itens (menos os componentes) são iguais; o preço mínimo e o giro também', async () => {
    const withComponents = await scenario(DEAGLE_4_STICKERS);
    const without = await scenario(bare(DEAGLE_4_STICKERS));
    expect(withComponents.profit).toEqual(without.profit);
    expect(withComponents.balance).toEqual(without.balance);
    expect(withComponents.items).toEqual(without.items);
    expect(withComponents.stats).toEqual(without.stats);
  });

  test('as visões agrupadas somam as mesmas quantidades e custos; só o resumo de componentes aparece a mais', async () => {
    const withComponents = await scenario(DEAGLE_4_STICKERS);
    const without = await scenario(bare(DEAGLE_4_STICKERS));
    const norm = (groups) => JSON.parse(JSON.stringify(groups), (k, v) => (/component|sticker|charm/i.test(k) ? undefined : v));
    expect(norm(withComponents.groups)).toEqual(norm(without.groups));
  });

  test('mesmo item com e sem sticker cai no mesmo grupo (a chave não considera componentes, E-P2-Q3)', async () => {
    await setup();
    const plain = { item: { ...DEAGLE_4_STICKERS.item, stickers: undefined }, reference: DEAGLE_4_STICKERS.reference };
    state.trades = [buyTrade('9101', DEAGLE_4_STICKERS), buyTrade('9102', plain, { createdAt: '2026-11-20T15:00:00.000Z' })];
    await firstRun();
    const groups = (await request(app).get('/api/items/groups')).body.data;
    const list = groups.groups || groups.items || groups;
    const deagle = JSON.stringify(list).match(/Trigger Discipline/g) || [];
    expect(deagle.length).toBeGreaterThan(0);
    const keys = new Set((Array.isArray(list) ? list : []).filter((g) => /Trigger Discipline/.test(JSON.stringify(g))).map((g) => g.key ?? g.name));
    expect(keys.size).toBe(1);
  });
});
