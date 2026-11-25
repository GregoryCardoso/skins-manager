'use strict';

// QA 11.5 (D369): bordas dos nomes dos itens nos idiomas. Refresh (erros, JSON quebrado, ids desconhecidos, timeout, 404 preservando nomes),
// localizedName por idioma, busca (chinês, acento, mistura, sem duplicar), snapshot (v1/v2, nomes inválidos, sync idempotente) e fumaça com o
// snapshot real do repositório. Sem rede; banco :memory:.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const CatalogItem = require('../../src/models/CatalogItem');
const Setting = require('../../src/models/Setting');
const svc = require('../../src/services/catalogService');
const { CATALOG_BASE_URL, CATALOG_SNAPSHOT_PATH } = require('../../src/config/constants');
const { freshDb } = require('../helpers/fixtures');
const { CAT, importCatalogFixture } = require('../helpers/catalog');
const { makeCatalogApp } = require('../helpers/apiFixtures');

const API_FIX = path.join(__dirname, '..', 'fixtures', 'csgo-api');
const NOW = new Date('2026-11-25T12:00:00.000Z');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-catnames-qa-')); });
afterAll(() => {
  closeDb();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
beforeEach(() => freshDb());

const ok = (body) => ({ ok: true, status: 200, text: async () => body });
const notFound = { ok: false, status: 404, text: async () => '[]' };

function makeFetch(extra = {}) {
  return async (url, opts) => {
    const rel = url.slice(CATALOG_BASE_URL.length);
    if (Object.prototype.hasOwnProperty.call(extra, rel)) {
      const value = extra[rel];
      return typeof value === 'function' ? value(url, opts) : value;
    }
    const [folder, file] = rel.split('/');
    if (!['en', 'pt-BR'].includes(folder)) return notFound;
    return ok(fs.readFileSync(path.join(API_FIX, folder, file), 'utf8'));
  };
}

const snapshotOfDb = () => ({
  items: getDb().prepare('SELECT * FROM catalog_items ORDER BY id').all(),
  names: getDb().prepare('SELECT * FROM catalog_item_names ORDER BY catalog_id, language').all(),
  settings: Setting.get().catalogUpdatedAt,
});

describe('refresh: erro em idioma opcional vira aviso (D369, 11.5)', () => {
  beforeEach(() => importCatalogFixture());

  const seedJa = () => CatalogItem.upsertMany([{
    id: CAT.AK_REDLINE, source: 'SKINS', category: 'SKIN', name: 'AK-47 | Redline', names: { 'zh-CN': 'AK-47 | 旧名' }, nameKey: 'ak-47 | redline',
    searchText: 'ak-47 | redline', imageUrl: null, minFloat: 0.1, maxFloat: 0.7, hasStattrak: 1, hasSouvenir: 0, phase: null, rarity: null,
  }], { now: NOW });

  test.each([
    ['JSON quebrado', { 'zh-CN/stickers.json': ok('[{"id":') }, 'CATALOG_INVALID_FORMAT'],
    ['não é lista', { 'zh-CN/skins.json': ok('{"a":1}') }, 'CATALOG_INVALID_FORMAT'],
    ['500', { 'zh-CN/skins.json': { ok: false, status: 500, text: async () => '' } }, 'CATALOG_FETCH_FAILED'],
    ['erro de rede', { 'zh-CN/crates.json': () => { throw new Error('ECONNRESET'); } }, 'CATALOG_FETCH_FAILED'],
  ])('zh-CN %s: ignora o idioma, mantém os nomes gravados e avisa', async (_label, extra, reason) => {
    seedJa();
    const result = await svc.refreshCatalog({ fetchFn: makeFetch(extra), now: NOW });
    expect(result.skippedLanguages).toEqual([{ language: 'zh-CN', reason }]);
    expect(CatalogItem.findNames([CAT.AK_REDLINE], 'zh-CN')).toEqual([{ catalogId: CAT.AK_REDLINE, name: 'AK-47 | 旧名' }]);
    expect(CatalogItem.findNames([CAT.AK_REDLINE], 'pt-BR')).toHaveLength(1);
    expect(Setting.get().catalogUpdatedAt).toBe(NOW.toISOString());
    expect(svc.isCatalogRefreshInProgress()).toBe(false);
  });

  test('sem erro: skippedLanguages vazia (404 não é aviso)', async () => {
    const result = await svc.refreshCatalog({ fetchFn: makeFetch(), now: NOW });
    expect(result.skippedLanguages).toEqual([]);
  });

  test('erro em dois idiomas: os dois avisos, e o en continua gravado', async () => {
    const extra = {
      'zh-CN/skins.json': { ok: false, status: 500, text: async () => '' },
      'ja/skins.json': ok('{nao e json'),
    };
    const result = await svc.refreshCatalog({ fetchFn: makeFetch(extra), now: NOW });
    expect(result.skippedLanguages.map((s) => s.language).sort()).toEqual(['ja', 'zh-CN']);
    expect(CatalogItem.findById(CAT.AK_REDLINE)).toBeTruthy();
  });
});

describe('refresh: falhas não gravam nada', () => {
  beforeEach(() => importCatalogFixture());

  test.each([
    ['en 404', { 'en/skins.json': notFound }],
    ['en 500', { 'en/stickers.json': { ok: false, status: 500, text: async () => '' } }],
    ['en erro de rede', { 'en/crates.json': () => { throw new Error('ECONNRESET'); } }],
    ['en JSON quebrado', { 'en/agents.json': ok('{nao e json') }],
  ])('%s: erro tipado e o banco fica exatamente como estava', async (_label, extra) => {
    const before = snapshotOfDb();
    await expect(svc.refreshCatalog({ fetchFn: makeFetch(extra), now: NOW })).rejects.toMatchObject({
      code: expect.stringMatching(/^CATALOG_(FETCH_FAILED|INVALID_FORMAT)$/),
    });
    expect(snapshotOfDb()).toEqual(before);
    expect(svc.isCatalogRefreshInProgress()).toBe(false);
  });

  test('timeout num idioma opcional vira aviso, grava o resto e libera o refresh seguinte', async () => {
    const hang = (_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const result = await svc.refreshCatalog({ fetchFn: makeFetch({ 'ja/stickers.json': hang }), now: NOW, timeoutMs: 100 });
    expect(result.skippedLanguages).toEqual([{ language: 'ja', reason: 'CATALOG_FETCH_FAILED' }]);
    await expect(svc.refreshCatalog({ fetchFn: makeFetch(), now: NOW })).resolves.toBeDefined();
  });
});

describe('refresh: conteúdo estranho em idioma opcional não corrompe o catálogo', () => {
  const run = (extra) => svc.refreshCatalog({ fetchFn: makeFetch(extra), now: NOW });

  test('lista vazia, ids desconhecidos, nomes vazios/espaços/não string e entradas sem id: só ignora', async () => {
    const weird = JSON.stringify([
      { id: 'nao-existe-no-en', name: '陌生' },
      { id: 'sticker-1', name: '   ' },
      { id: 'sticker-2', name: 42 },
      { name: 'sem id' },
      null,
      'texto',
      { id: 'sticker-3' },
    ]);
    await run({ 'zh-CN/stickers.json': ok(weird), 'zh-CN/skins.json': ok('[]'), 'zh-CN/crates.json': ok('null'.replace('null', '[]')) });
    const names = getDb().prepare("SELECT * FROM catalog_item_names WHERE language = 'zh-CN'").all();
    expect(names).toEqual([]);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM catalog_items WHERE id = 'nao-existe-no-en'").get().n).toBe(0);
    expect(getDb().pragma('foreign_key_check')).toEqual([]);
    expect(svc.searchCatalog({ q: 'titan' }).items.length).toBeGreaterThan(0);
  });

  test('nome com espaços nas pontas é aparado; nome em branco não substitui o gravado', async () => {
    await run({ 'zh-CN/stickers.json': ok(JSON.stringify([{ id: 'sticker-1', name: '  印花 | 泰坦  ' }])) });
    expect(CatalogItem.findNames(['sticker-1'], 'zh-CN')).toEqual([{ catalogId: 'sticker-1', name: '印花 | 泰坦' }]);
    await run({ 'zh-CN/stickers.json': ok(JSON.stringify([{ id: 'sticker-1', name: '   ' }])) });
    expect(CatalogItem.findNames(['sticker-1'], 'zh-CN')).toEqual([{ catalogId: 'sticker-1', name: '印花 | 泰坦' }]);
  });

  test('o idioma que voltou a trazer um nome diferente atualiza; 404 depois disso preserva o novo valor', async () => {
    await run({ 'zh-CN/stickers.json': ok(JSON.stringify([{ id: 'sticker-1', name: 'v1' }])) });
    await run({ 'zh-CN/stickers.json': ok(JSON.stringify([{ id: 'sticker-1', name: 'v2' }])) });
    await run({});
    expect(CatalogItem.findNames(['sticker-1'], 'zh-CN')).toEqual([{ catalogId: 'sticker-1', name: 'v2' }]);
  });

  test('nome traduzido igual ao inglês não é guardado nem apaga o que já estava gravado', async () => {
    await run({});
    const english = getDb().prepare("SELECT name FROM catalog_items WHERE id = 'sticker-1'").get().name;
    await run({ 'zh-CN/stickers.json': ok(JSON.stringify([{ id: 'sticker-1', name: 'antigo' }])) });
    await run({ 'zh-CN/stickers.json': ok(JSON.stringify([{ id: 'sticker-1', name: english }])) });
    expect(CatalogItem.findNames(['sticker-1'], 'zh-CN')).toEqual([{ catalogId: 'sticker-1', name: 'antigo' }]);
  });

  test('o catálogo do inglês não perde linhas por causa dos idiomas (mesmas contagens com e sem zh-CN)', async () => {
    await run({});
    const without = getDb().prepare('SELECT COUNT(*) AS n FROM catalog_items').get().n;
    await run({ 'zh-CN/stickers.json': ok(JSON.stringify([{ id: 'sticker-1', name: 'x' }])) });
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM catalog_items').get().n).toBe(without);
  });
});

describe('localizedName por idioma das configurações', () => {
  beforeEach(() => {
    importCatalogFixture();
    const ins = getDb().prepare('INSERT INTO catalog_item_names (catalog_id, language, name) VALUES (?, ?, ?)');
    ins.run(CAT.AK_REDLINE, 'zh-CN', 'AK-47 | 红线');
    ins.run(CAT.STICKER_TITAN, 'zh-CN', '印花 | 泰坦 | 2014');
  });
  const nameIn = (language, id = CAT.AK_REDLINE) => {
    Setting.update({ language });
    return svc.getCatalogItem(id).localizedName;
  };

  test('en: nulo; pt-BR e zh-CN: o nome do idioma; ja (sem nomes): nulo; o canônico nunca muda', () => {
    expect(nameIn('en')).toBeNull();
    expect(nameIn('pt-BR')).toBe('AK-47 | Linha Vermelha');
    expect(nameIn('zh-CN')).toBe('AK-47 | 红线');
    expect(nameIn('ja')).toBeNull();
    expect(svc.getCatalogItem(CAT.AK_REDLINE).name).toBe('AK-47 | Redline');
  });

  test('trocar o idioma muda a resposta na hora (busca, por ids e exato)', () => {
    Setting.update({ language: 'pt-BR' });
    expect(svc.searchCatalog({ q: 'redline' }).items[0].localizedName).toBe('AK-47 | Linha Vermelha');
    Setting.update({ language: 'zh-CN' });
    expect(svc.searchCatalog({ q: 'redline' }).items[0].localizedName).toBe('AK-47 | 红线');
    expect(svc.getCatalogItemsByIds([CAT.AK_REDLINE])[0].localizedName).toBe('AK-47 | 红线');
    expect(svc.findExactMatch({ name: 'AK-47 | Redline', category: 'SKIN' }).localizedName).toBe('AK-47 | 红线');
    expect(svc.findExactMatches(['AK-47 | Redline'], 'SKIN').get('ak-47 | redline').localizedName).toBe('AK-47 | 红线');
    Setting.update({ language: 'en' });
    expect(svc.getCatalogItemsByIds([CAT.AK_REDLINE])[0].localizedName).toBeNull();
  });

  test('idioma fora do registro gravado direto no banco não quebra nada (localizedName nulo)', async () => {
    getDb().prepare("UPDATE settings SET language = 'xx-YY'").run();
    expect(svc.getCatalogItem(CAT.AK_REDLINE).localizedName).toBeNull();
    expect(svc.searchCatalog({ q: 'redline' }).items.length).toBeGreaterThan(0);
    const app = makeCatalogApp();
    expect((await request(app).get('/api/catalog/search?q=redline')).status).toBe(200);
    expect((await request(app).get(`/api/catalog/${CAT.AK_REDLINE}`)).body.data.localizedName).toBeNull();
    expect((await request(app).get('/api/items')).status).toBe(200);
  });

  test('item apagado do catálogo: nomes somem junto; getCatalogItem devolve nulo; ids em lote ignoram o apagado', () => {
    getDb().prepare('DELETE FROM catalog_items WHERE id = ?').run(CAT.AK_REDLINE);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM catalog_item_names WHERE catalog_id = ?').get(CAT.AK_REDLINE).n).toBe(0);
    expect(svc.getCatalogItem(CAT.AK_REDLINE)).toBeNull();
    expect(svc.getCatalogItemsByIds([CAT.AK_REDLINE, CAT.STICKER_TITAN]).map((i) => i.id)).toEqual([CAT.STICKER_TITAN]);
  });

  test('o localizedName chega nos itens, nos componentes e nas candidatas (API)', async () => {
    const { createItemViaApi, purchaseBody } = require('../helpers/apiFixtures');
    const app = makeCatalogApp();
    const item = await createItemViaApi(app, purchaseBody());
    Setting.update({ language: 'zh-CN' });
    const got = (await request(app).get(`/api/items/${item.id}`)).body.data;
    expect(got.catalog.localizedName).toBe('AK-47 | 红线');
    expect(got.name).toBe('AK-47 | Redline');
    Setting.update({ language: 'ja' });
    expect((await request(app).get(`/api/items/${item.id}`)).body.data.catalog.localizedName).toBeNull();
    // item com catalogId sumido do catálogo continua legível
    getDb().prepare('DELETE FROM catalog_items WHERE id = ?').run(CAT.AK_REDLINE);
    const orphan = await request(app).get(`/api/items/${item.id}`);
    expect(orphan.status).toBe(200);
    expect(orphan.body.data.name).toBe('AK-47 | Redline');
    expect((await request(app).get('/api/items')).status).toBe(200);
  });
});

describe('busca', () => {
  beforeEach(() => {
    const { buildSearchText } = require('../../src/services/catalog/csgoApiAdapter');
    const names = { 'zh-CN': 'AK-47 | 红线', 'pt-BR': 'AK-47 | Linha Vermelha', fr: 'AK-47 | Ligne rouge' };
    CatalogItem.upsertMany([
      { id: 'a', source: 'SKINS', category: 'SKIN', name: 'AK-47 | Redline', names, nameKey: 'ak-47 | redline',
        searchText: buildSearchText('ak-47 | redline', names), imageUrl: null, minFloat: 0, maxFloat: 1, hasStattrak: 0, hasSouvenir: 0, phase: null, rarity: null },
    ], { now: NOW });
  });

  test.each([
    ['chinês', '红线'], ['inglês', 'redline'], ['maiúsculas', 'REDLINE'], ['misto', 'ak-47 红线'], ['acento/caixa no francês', 'LIGNE ROUGE'],
    ['pt sem acento', 'vermelha'], ['pt com acento digitado', 'Vérmélha'],
  ])('acha por %s (%s) e sem duplicar', (_l, q) => {
    const { items, meta } = svc.searchCatalog({ q });
    expect(items.map((i) => i.id)).toEqual(['a']);
    expect(meta.total).toBe(1);
  });

  test('termo que não bate em nenhum idioma não acha', () => {
    expect(svc.searchCatalog({ q: 'xyzzy' }).items).toEqual([]);
  });

  test('curinga LIKE no termo traduzido é tratado como texto', () => {
    expect(svc.searchCatalog({ q: '红%' }).items).toEqual([]);
    expect(svc.searchCatalog({ q: '_ _' }).items).toEqual([]);
  });
});

describe('snapshot (bordas)', () => {
  const row = (id, name, names = {}) => ({
    id, source: 'SKINS', category: 'SKIN', name, names, imageUrl: null, minFloat: null, maxFloat: null, hasStattrak: 0, hasSouvenir: 0, phase: null, rarity: null,
  });
  const base = () => JSON.parse(svc.serializeSnapshot([row('a', 'Alpha')], { now: NOW }));

  test('v2: nomes só com espaços são descartados; com espaços nas pontas são aparados; idioma com formato errado recusa', () => {
    const snap = base();
    snap.rows[0][4] = { 'pt-BR': '  Alfa  ', ja: '   ', 'zh-CN': '' };
    expect(svc.parseSnapshot(snap).rows[0].names).toEqual({ 'pt-BR': 'Alfa' });
    for (const bad of [{ '': 'x' }, { p: 'x' }, { 'pt_BR': 'x' }, { 'abcd': 'x' }, { 'pt-BR': null }, { 'pt-BR': ['x'] }, { 'pt-BR': {} }, 5, true, [], [['pt-BR', 'x']]]) {
      const s = base();
      s.rows[0][4] = bad;
      expect(() => svc.parseSnapshot(s)).toThrow(expect.objectContaining({ code: 'CATALOG_INVALID_FORMAT' }));
    }
  });

  test('colunas e versão: v1 com coluna names, v2 com coluna namePtBr e versão 3 são recusados', () => {
    const v1Wrong = base(); v1Wrong.formatVersion = 1;
    expect(() => svc.parseSnapshot(v1Wrong)).toThrow(expect.objectContaining({ code: 'CATALOG_INVALID_FORMAT' }));
    const v2Wrong = base(); v2Wrong.columns[4] = 'namePtBr';
    expect(() => svc.parseSnapshot(v2Wrong)).toThrow(expect.objectContaining({ code: 'CATALOG_INVALID_FORMAT' }));
    const v3 = base(); v3.formatVersion = 3;
    expect(() => svc.parseSnapshot(v3)).toThrow(expect.objectContaining({ code: 'CATALOG_INVALID_FORMAT' }));
  });

  test('v1: namePtBr não string é recusado; vazio vira sem nome', () => {
    const v1 = base(); v1.formatVersion = 1; v1.columns[4] = 'namePtBr';
    v1.rows[0][4] = 5;
    expect(() => svc.parseSnapshot(v1)).toThrow(expect.objectContaining({ code: 'CATALOG_INVALID_FORMAT' }));
    v1.rows[0][4] = '  ';
    expect(svc.parseSnapshot(v1).rows[0].names).toEqual({});
  });

  test('importSnapshot e syncBundledCatalog são idempotentes e preservam nomes que o snapshot não tem', () => {
    const file = path.join(tmpRoot, 'snap-idem.json');
    fs.writeFileSync(file, svc.serializeSnapshot([row('a', 'Alpha', { 'zh-CN': '阿尔法' }), row('b', 'Beta')], { now: new Date('2026-12-01T00:00:00.000Z') }));
    getDb().prepare("INSERT INTO catalog_items (id, source, category, name, name_key, search_text, updated_at) VALUES ('a','SKINS','SKIN','Alpha','alpha','alpha','u')").run();
    getDb().prepare("INSERT INTO catalog_item_names VALUES ('a', 'pt-BR', 'Alfa'), ('a', 'ja', 'アルファ')").run();
    expect(svc.syncBundledCatalog({ now: NOW, snapshotPath: file }).imported).toBe(2);
    const first = snapshotOfDb();
    // mesma data: não reimporta
    expect(svc.syncBundledCatalog({ now: NOW, snapshotPath: file }).imported).toBe(0);
    expect(snapshotOfDb()).toEqual(first);
    // importar de novo à força: nada duplica nem se perde
    svc.importSnapshot(fs.readFileSync(file, 'utf8'), { now: NOW });
    expect(getDb().prepare('SELECT language, name FROM catalog_item_names WHERE catalog_id = ? ORDER BY language').all('a')).toEqual([
      { language: 'ja', name: 'アルファ' }, { language: 'pt-BR', name: 'Alfa' }, { language: 'zh-CN', name: '阿尔法' },
    ]);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM catalog_item_names').get().n).toBe(3);
    expect(CatalogItem.findById('a').searchText).toBe('alpha alfa アルファ 阿尔法');
    for (const t of ['阿尔法', 'alfa', 'アルファ']) expect(svc.searchCatalog({ q: t }).items.map((i) => i.id)).toEqual(['a']);
  });
});

describe('fumaça com o snapshot real (sem rede)', () => {
  test('importa o catálogo inteiro, tem nomes em chinês, a busca responde rápido e sem duplicar; idempotente', () => {
    const text = fs.readFileSync(CATALOG_SNAPSHOT_PATH, 'utf8');
    const t0 = Date.now();
    const imported = svc.importSnapshot(text, { now: NOW });
    const importMs = Date.now() - t0;
    expect(imported.imported).toBeGreaterThan(10000);
    const namesCount = getDb().prepare('SELECT COUNT(*) AS n FROM catalog_item_names').get().n;
    expect(namesCount).toBeGreaterThan(1000);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM catalog_item_names WHERE length(trim(name)) = 0").get().n).toBe(0);
    expect(getDb().pragma('foreign_key_check')).toEqual([]);

    const sample = getDb().prepare("SELECT catalog_id, name FROM catalog_item_names WHERE language = 'zh-CN' AND catalog_id LIKE 'skin-%' LIMIT 1").get();
    Setting.update({ language: 'zh-CN' });
    const timings = [];
    for (const q of [sample.name.slice(0, 4), 'ak-47', 'redline', 'AK 红线', 'karambit', 'sticker']) {
      const s = Date.now();
      const { items } = svc.searchCatalog({ q });
      timings.push(Date.now() - s);
      const keys = items.map((i) => `${i.category}|${i.name}|${i.phase}|${i.minFloat}|${i.maxFloat}|${i.hasStattrak}|${i.hasSouvenir}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(items.length).toBeLessThanOrEqual(50);
    }
    expect(svc.searchCatalog({ q: sample.name, limit: 50 }).items.map((i) => i.name)).toContain(CatalogItem.findById(sample.catalog_id).name);
    expect(Math.max(...timings)).toBeLessThan(1500);
    expect(importMs).toBeLessThan(30000);

    const before = snapshotOfDb();
    svc.importSnapshot(text, { now: NOW });
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM catalog_item_names').get().n).toBe(namesCount);
    expect(snapshotOfDb().names).toEqual(before.names);
    // exportar de volta gera o mesmo conteúdo de nomes (ida e volta)
    const allNames = CatalogItem.findAllNames();
    const round = svc.parseSnapshot(svc.serializeSnapshot(
      getDb().prepare('SELECT id FROM catalog_items ORDER BY id LIMIT 300').all().map((r) => ({
        ...CatalogItem.findById(r.id),
        names: Object.fromEntries(allNames.filter((n) => n.catalogId === r.id).map((n) => [n.language, n.name])),
      })), { now: NOW }
    ));
    expect(round.rows).toHaveLength(300);
  });
});
