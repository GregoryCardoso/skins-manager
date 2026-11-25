'use strict';

// 11.5 (D369): nomes dos itens nos idiomas. `localizedName` no idioma das configurações (nulo em inglês ou sem tradução), busca pelo nome
// no idioma e pelo inglês, snapshot v2 (e v1 ainda aceito), refresh multi-idioma com pasta ausente preservando os nomes gravados.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { closeDb } = require('../../src/config/database');
const CatalogItem = require('../../src/models/CatalogItem');
const Setting = require('../../src/models/Setting');
const svc = require('../../src/services/catalogService');
const itemComponentService = require('../../src/services/itemComponentService');
const { CATALOG_BASE_URL, CATALOG_LANGUAGE_FOLDERS } = require('../../src/config/constants');
const { freshDb } = require('../helpers/fixtures');
const { CAT, importCatalogFixture } = require('../helpers/catalog');

const API_FIX = path.join(__dirname, '..', 'fixtures', 'csgo-api');
const NOW = new Date('2026-11-25T12:00:00.000Z');

let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-catnames-')); });
afterAll(() => {
  closeDb();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
beforeEach(() => freshDb());

const ok = (body) => ({ ok: true, status: 200, text: async () => body });
const notFound = { ok: false, status: 404, text: async () => '[]' };

// fetch simulado: en e pt-BR do fixture; `extra` serve outras pastas; o resto dá 404 (como a API hospedada de verdade).
function makeFetch(extra = {}) {
  return async (url) => {
    const rel = url.slice(CATALOG_BASE_URL.length);
    if (Object.prototype.hasOwnProperty.call(extra, rel)) return extra[rel];
    const [folder, file] = rel.split('/');
    if (!['en', 'pt-BR'].includes(folder)) return notFound;
    return ok(fs.readFileSync(path.join(API_FIX, folder, file), 'utf8'));
  };
}

describe('mapa idioma -> pasta da CSGO-API', () => {
  test('os 13 idiomas do app; o espanhol usa es-MX', () => {
    expect(Object.keys(CATALOG_LANGUAGE_FOLDERS)).toEqual(['en', 'pt-BR', 'es', 'ru', 'tr', 'fr', 'it', 'zh-CN', 'de', 'pl', 'uk', 'ja', 'ko']);
    expect(CATALOG_LANGUAGE_FOLDERS.es).toBe('es-MX');
  });
});

describe('localizedName', () => {
  beforeEach(() => importCatalogFixture());

  test('em inglês é nulo; em pt-BR traz o nome; item sem tradução é nulo; o canônico em inglês nunca muda', () => {
    expect(Setting.get().language).toBe('en');
    expect(svc.getCatalogItem(CAT.AK_REDLINE)).toMatchObject({ name: 'AK-47 | Redline', localizedName: null });
    Setting.update({ language: 'pt-BR' });
    expect(svc.getCatalogItem(CAT.AK_REDLINE)).toMatchObject({ name: 'AK-47 | Redline', localizedName: 'AK-47 | Linha Vermelha' });
    expect(svc.getCatalogItem(CAT.DEAGLE_DDPAT).localizedName).toBeNull();
    expect(svc.getCatalogItem(CAT.AK_REDLINE)).not.toHaveProperty('namePtBr');
  });

  test('a busca acha pelo nome no idioma atual e pelo inglês', () => {
    Setting.update({ language: 'pt-BR' });
    expect(svc.searchCatalog({ q: 'linha vermelha' }).items.map((i) => i.id)).toEqual([CAT.AK_REDLINE]);
    expect(svc.searchCatalog({ q: 'ak red' }).items[0].localizedName).toBe('AK-47 | Linha Vermelha');
    Setting.update({ language: 'en' });
    expect(svc.searchCatalog({ q: 'ak red' }).items[0].localizedName).toBeNull();
  });

  test('findExactMatches, findExactMatch e getCatalogItemsByIds também trazem o nome localizado', () => {
    Setting.update({ language: 'pt-BR' });
    const m = svc.findExactMatches(['AK-47 | Redline'], 'SKIN');
    expect([...m.values()][0].localizedName).toBe('AK-47 | Linha Vermelha');
    expect(svc.findExactMatch({ name: 'AK-47 | Redline', category: 'SKIN' }).localizedName).toBe('AK-47 | Linha Vermelha');
    expect(svc.getCatalogItemsByIds([CAT.AK_REDLINE])[0].localizedName).toBe('AK-47 | Linha Vermelha');
  });
});

describe('localizedSlabName', () => {
  test('troca o prefixo do sticker traduzido por "Sticker Slab | "', () => {
    expect(itemComponentService.localizedSlabName('Adesivo | Coroa (Foil)')).toBe('Sticker Slab | Coroa (Foil)');
    expect(itemComponentService.localizedSlabName('Sem prefixo')).toBe('Sticker Slab | Sem prefixo');
  });
});

describe('refresh multi-idioma', () => {
  const zhStickers = JSON.stringify([{ id: 'sticker-1', name: '印花 | 泰坦 | 2014' }, { id: 'sticker-2', name: 'Sticker | Crown (Foil)' }]);

  test('traz o zh-CN quando a pasta existe; o nome igual ao inglês não é guardado; a busca acha em chinês e em inglês', async () => {
    await svc.refreshCatalog({ fetchFn: makeFetch({ 'zh-CN/stickers.json': ok(zhStickers) }), now: NOW });
    expect(CatalogItem.findNames(['sticker-1', 'sticker-2'], 'zh-CN')).toEqual([{ catalogId: 'sticker-1', name: '印花 | 泰坦 | 2014' }]);
    Setting.update({ language: 'zh-CN' });
    expect(svc.getCatalogItem('sticker-1').localizedName).toBe('印花 | 泰坦 | 2014');
    expect(svc.getCatalogItem('sticker-2').localizedName).toBeNull();
    expect(svc.searchCatalog({ q: '泰坦' }).items.map((i) => i.id)).toEqual(['sticker-1']);
    expect(svc.searchCatalog({ q: 'titan' }).items.map((i) => i.id)).toEqual(['sticker-1']);
  });

  test('pasta ausente (404) preserva os nomes gravados, inclusive no texto de busca', async () => {
    importCatalogFixture();
    CatalogItem.upsertMany([{
      id: CAT.AK_REDLINE, source: 'SKINS', category: 'SKIN', name: 'AK-47 | Redline', names: { ja: 'AK-47 | アルファ' }, nameKey: 'ak-47 | redline',
      searchText: 'ak-47 | redline', imageUrl: null, minFloat: 0.1, maxFloat: 0.7, hasStattrak: 1, hasSouvenir: 0, phase: null, rarity: null,
    }], { now: NOW });
    await svc.refreshCatalog({ fetchFn: makeFetch(), now: NOW });
    expect(CatalogItem.findNames([CAT.AK_REDLINE], 'ja')).toEqual([{ catalogId: CAT.AK_REDLINE, name: 'AK-47 | アルファ' }]);
    expect(CatalogItem.findNames([CAT.AK_REDLINE], 'pt-BR')).toHaveLength(1);
    expect(CatalogItem.findById(CAT.AK_REDLINE).searchText).toContain('アルファ');
    expect(CatalogItem.findById(CAT.AK_REDLINE).searchText).toContain('linha vermelha');
  });

  test('o refresh pede as pastas dos 13 idiomas (es-MX para o espanhol); 404 no en continua sendo erro', async () => {
    const calls = [];
    const fetchFn = async (url, opts) => { calls.push(url.slice(CATALOG_BASE_URL.length)); return makeFetch()(url, opts); };
    await svc.refreshCatalog({ fetchFn, now: NOW });
    const folders = new Set(calls.map((c) => c.split('/')[0]));
    expect([...folders].sort()).toEqual(Object.values(CATALOG_LANGUAGE_FOLDERS).sort());
    expect(folders.has('es')).toBe(false);
    const failing = async (url) => (url.includes('/en/skins.json') ? notFound : makeFetch()(url));
    await expect(svc.refreshCatalog({ fetchFn: failing, now: NOW })).rejects.toMatchObject({ code: 'CATALOG_FETCH_FAILED' });
  });
});

describe('snapshot com names', () => {
  const row = (id, name, extra = {}) => ({
    id, source: 'SKINS', category: 'SKIN', name, names: {}, imageUrl: null, minFloat: null, maxFloat: null, hasStattrak: 0, hasSouvenir: 0, phase: null, rarity: null, ...extra,
  });

  test('ida e volta com vários idiomas (ordem alfabética, sem os iguais ao inglês) e texto de busca com todos', () => {
    const text = svc.serializeSnapshot([row('a', 'Alpha', { names: { 'zh-CN': 'x-zh', 'pt-BR': 'Alfa', es: 'Alpha' } })], { now: NOW });
    const json = JSON.parse(text);
    expect(json.formatVersion).toBe(2);
    expect(json.columns[4]).toBe('names');
    expect(json.rows[0][4]).toEqual({ 'pt-BR': 'Alfa', 'zh-CN': 'x-zh' });
    const [parsed] = svc.parseSnapshot(text).rows;
    expect(parsed.names).toEqual({ 'pt-BR': 'Alfa', 'zh-CN': 'x-zh' });
    expect(parsed.searchText).toBe('alpha alfa x-zh');
  });

  test('nulo quando não há nomes; e o snapshot do formato 1 (namePtBr) ainda é aceito', () => {
    expect(JSON.parse(svc.serializeSnapshot([row('a', 'Alpha')], { now: NOW })).rows[0][4]).toBeNull();
    const v1 = JSON.parse(svc.serializeSnapshot([row('a', 'Alpha')], { now: NOW }));
    v1.formatVersion = 1;
    v1.columns[4] = 'namePtBr';
    v1.rows = [['a', 'SKINS', 'SKIN', 'Alpha', 'Alfa', null, null, null, 0, 0, null, null], ['b', 'SKINS', 'SKIN', 'Beta', null, null, null, null, 0, 0, null, null]];
    const { rows } = svc.parseSnapshot(v1);
    expect(rows.map((r) => r.names)).toEqual([{ 'pt-BR': 'Alfa' }, {}]);
  });

  test('nomes inválidos no formato 2 são recusados', () => {
    const base = () => JSON.parse(svc.serializeSnapshot([row('a', 'Alpha')], { now: NOW }));
    for (const bad of ['texto', ['x'], { 'pt BR!': 'x' }, { 'pt-BR': 5 }]) {
      const snap = base();
      snap.rows[0][4] = bad;
      expect(() => svc.parseSnapshot(snap)).toThrow(expect.objectContaining({ code: 'CATALOG_INVALID_FORMAT' }));
    }
  });

  test('syncBundledCatalog grava os nomes do snapshot e preserva os já gravados de outro idioma', () => {
    CatalogItem.upsertMany([row('a', 'Alpha', { names: { ja: 'jp-alpha' }, nameKey: 'alpha', searchText: 'alpha jp-alpha' })], { now: NOW });
    const file = path.join(tmpRoot, 'snap.json');
    fs.writeFileSync(file, svc.serializeSnapshot([row('a', 'Alpha', { names: { 'pt-BR': 'Alfa' } })], { now: new Date('2026-12-01T00:00:00.000Z') }));
    const result = svc.syncBundledCatalog({ now: NOW, snapshotPath: file });
    expect(result.imported).toBe(1);
    expect(CatalogItem.findNames(['a'], 'pt-BR')).toHaveLength(1);
    expect(CatalogItem.findNames(['a'], 'ja')).toHaveLength(1);
    expect(CatalogItem.findById('a').searchText).toBe('alpha jp-alpha alfa');
  });
});
