'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { closeDb } = require('../../src/config/database');
const CatalogItem = require('../../src/models/CatalogItem');
const Item = require('../../src/models/Item');
const Setting = require('../../src/models/Setting');
const svc = require('../../src/services/catalogService');
const { CATALOG_BASE_URL } = require('../../src/config/constants');
const { freshDb, wonSkin } = require('../helpers/fixtures');
const { CAT, readFixture, importCatalogFixture } = require('../helpers/catalog');

const API_FIX = path.join(__dirname, '..', 'fixtures', 'csgo-api');
const NOW = new Date('2026-11-20T12:00:00.000Z');
const FILES = ['skins', 'stickers', 'crates', 'keychains', 'agents'];

let tmpRoot;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-catalog-test-'));
});
afterAll(() => {
  closeDb();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
beforeEach(() => {
  freshDb();
  jest.restoreAllMocks();
});

const apiFile = (lang, file) => fs.readFileSync(path.join(API_FIX, lang, `${file}.json`), 'utf8');
const okResponse = (body) => ({ ok: true, status: 200, text: async () => body });
const statusResponse = (status) => ({ ok: status >= 200 && status < 300, status, text: async () => '[]' });

// fetch simulado: serve os fixtures; `overrides[url sufixo]` troca a resposta (ou função).
function makeFetch(overrides = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push(url);
    const rel = url.slice(CATALOG_BASE_URL.length);
    const key = Object.keys(overrides).find((k) => rel === k);
    if (key) {
      const o = overrides[key];
      return typeof o === 'function' ? o(url, opts) : o;
    }
    const [lang, file] = rel.split('/');
    return okResponse(apiFile(lang, file.replace('.json', '')));
  };
  fn.calls = calls;
  return fn;
}

function writeSnapshotFile(name, rows, now) {
  const file = path.join(tmpRoot, name);
  fs.writeFileSync(file, svc.serializeSnapshot(rows, { now }));
  return file;
}

const row = (id, name, extra = {}) => ({
  id, source: 'SKINS', category: 'SKIN', name, namePtBr: null, imageUrl: null, minFloat: null, maxFloat: null,
  hasStattrak: 0, hasSouvenir: 0, phase: null, rarity: null, ...extra,
});

describe('refreshCatalog', () => {
  test('caminho feliz: 10 URLs, contagens, catalogUpdatedAt = now e skipped', async () => {
    const fetchFn = makeFetch();
    const result = await svc.refreshCatalog({ fetchFn, now: NOW });
    expect(fetchFn.calls).toHaveLength(10);
    for (const lang of ['en', 'pt-BR']) {
      for (const f of FILES) expect(fetchFn.calls).toContain(`${CATALOG_BASE_URL}${lang}/${f}.json`);
    }
    expect(result).toEqual({
      catalogUpdatedAt: NOW.toISOString(),
      countsBySource: { SKINS: 8, STICKERS: 2, CRATES: 9, KEYCHAINS: 1, AGENTS: 1 },
      total: 21,
      skipped: 3,
      linkedLegacyItems: 0,
    });
    expect(Setting.get().catalogUpdatedAt).toBe(NOW.toISOString());
    expect(svc.getCatalogItem('skin-ak-redline')).toMatchObject({ namePtBr: 'AK-47 | Linha Vermelha', category: 'SKIN' });
  });

  test('pt-BR não hospedado (404) é tolerado: nomes traduzidos ficam nulos', async () => {
    const overrides = Object.fromEntries(FILES.map((f) => [`pt-BR/${f}.json`, statusResponse(404)]));
    const result = await svc.refreshCatalog({ fetchFn: makeFetch(overrides), now: NOW });
    expect(result.total).toBe(21);
    expect(svc.getCatalogItem('skin-ak-redline').namePtBr).toBeNull();
  });

  test('refresh vincula itens legados e informa a quantidade', async () => {
    Item.create(wonSkin({ name: 'AK-47 | Redline' }));
    const result = await svc.refreshCatalog({ fetchFn: makeFetch(), now: NOW });
    expect(result.linkedLegacyItems).toBe(1);
    expect(Item.findById(1).catalogId).toBe('skin-ak-redline');
  });

  describe('falhas: nada muda e o catálogo anterior fica intacto', () => {
    beforeEach(() => importCatalogFixture());

    const failures = [
      ['HTTP 500 em arquivo en', { 'en/skins.json': statusResponse(500) }, 'CATALOG_FETCH_FAILED'],
      ['HTTP 500 em arquivo pt-BR', { 'pt-BR/stickers.json': statusResponse(500) }, 'CATALOG_FETCH_FAILED'],
      ['HTTP 404 em arquivo en', { 'en/crates.json': statusResponse(404) }, 'CATALOG_FETCH_FAILED'],
      ['rede caindo', { 'en/agents.json': () => Promise.reject(new TypeError('fetch failed')) }, 'CATALOG_FETCH_FAILED'],
      ['rede caindo só no pt-BR', { 'pt-BR/agents.json': () => Promise.reject(new TypeError('fetch failed')) }, 'CATALOG_FETCH_FAILED'],
      ['JSON inválido', { 'en/keychains.json': okResponse('{nao e json') }, 'CATALOG_INVALID_FORMAT'],
      ['JSON inválido só no pt-BR', { 'pt-BR/skins.json': okResponse('<html>') }, 'CATALOG_INVALID_FORMAT'],
      ['JSON que não é lista', { 'en/skins.json': okResponse('{"a":1}') }, 'CATALOG_INVALID_FORMAT'],
    ];

    test.each(failures)('%s', async (_name, overrides, code) => {
      const before = svc.getCatalogStatus();
      await expect(svc.refreshCatalog({ fetchFn: makeFetch(overrides), now: NOW })).rejects.toMatchObject({
        status: 502, code, message: expect.any(String),
      });
      expect(svc.getCatalogStatus()).toEqual(before);
      expect(svc.getCatalogItem('skin-ak-redline').updatedAt).toBeUndefined();
    });

    test('timeout: aborta e responde CATALOG_FETCH_FAILED', async () => {
      const hang = (url, { signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      const before = svc.getCatalogStatus();
      await expect(
        svc.refreshCatalog({ fetchFn: makeFetch({ 'en/stickers.json': hang }), now: NOW, timeoutMs: 30 })
      ).rejects.toMatchObject({ status: 502, code: 'CATALOG_FETCH_FAILED' });
      expect(svc.getCatalogStatus()).toEqual(before);
    });

    test('sem fetch disponível ou resposta vazia em todas as fontes', async () => {
      await expect(svc.refreshCatalog({ fetchFn: null, now: NOW })).rejects.toMatchObject({ code: 'CATALOG_FETCH_FAILED' });
      const empty = Object.fromEntries(FILES.map((f) => [`en/${f}.json`, okResponse('[]')]));
      await expect(svc.refreshCatalog({ fetchFn: makeFetch(empty), now: NOW })).rejects.toMatchObject({ code: 'CATALOG_INVALID_FORMAT' });
    });

    test('depois de uma falha, nova atualização funciona (trava liberada)', async () => {
      await expect(
        svc.refreshCatalog({ fetchFn: makeFetch({ 'en/skins.json': statusResponse(500) }), now: NOW })
      ).rejects.toBeDefined();
      await expect(svc.refreshCatalog({ fetchFn: makeFetch(), now: NOW })).resolves.toMatchObject({ skipped: 3 });
    });
  });

  test('linhas ausentes no novo download continuam (upsert, sem apagar)', async () => {
    importCatalogFixture();
    const before = svc.getCatalogStatus().total;
    await svc.refreshCatalog({ fetchFn: makeFetch(), now: NOW });
    expect(svc.getCatalogItem(CAT.AWP_DLORE)).not.toBeNull(); // só existe no fixture, não no download
    expect(svc.getCatalogStatus().total).toBeGreaterThanOrEqual(before);
    expect(svc.getCatalogStatus().catalogUpdatedAt).toBe(NOW.toISOString());
  });

  test('atualização simultânea -> CATALOG_REFRESH_IN_PROGRESS; a primeira conclui normalmente', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const slow = makeFetch({ 'en/skins.json': async () => { await gate; return okResponse(apiFile('en', 'skins')); } });
    const first = svc.refreshCatalog({ fetchFn: slow, now: NOW });
    await expect(svc.refreshCatalog({ fetchFn: makeFetch(), now: NOW })).rejects.toMatchObject({
      status: 409, code: 'CATALOG_REFRESH_IN_PROGRESS',
    });
    release();
    await expect(first).resolves.toMatchObject({ total: 21 });
    await expect(svc.refreshCatalog({ fetchFn: makeFetch(), now: NOW })).resolves.toMatchObject({ total: 21 });
  });
});

describe('snapshot', () => {
  test('serializeSnapshot -> parseSnapshot: ida e volta', () => {
    const rows = [
      row('b-2', 'Segundo', { namePtBr: 'Segunda Opção', minFloat: 0.1, maxFloat: 0.5, hasStattrak: 1, phase: 'Phase 1', rarity: 'Covert', imageUrl: 'https://x/y.png' }),
      row('a-1', '★ Primeiro'),
    ];
    const text = svc.serializeSnapshot(rows, { now: NOW });
    const json = JSON.parse(text);
    expect(json).toMatchObject({ formatVersion: 1, generatedAt: NOW.toISOString(), counts: { SKINS: 2, STICKERS: 0, CRATES: 0, KEYCHAINS: 0, AGENTS: 0 } });
    expect(json.rows.map((r) => r[0])).toEqual(['a-1', 'b-2']); // ordenado por id
    expect(text.trim().split('\n')).toHaveLength(json.rows.length + 2); // cabeçalho + 1 linha por row + fechamento
    const parsed = svc.parseSnapshot(text);
    expect(parsed.generatedAt).toBe(NOW.toISOString());
    expect(parsed.rows).toEqual([
      expect.objectContaining({ id: 'a-1', name: '★ Primeiro', nameKey: 'primeiro', searchText: 'primeiro', namePtBr: null }),
      expect.objectContaining({
        id: 'b-2', namePtBr: 'Segunda Opção', nameKey: 'segundo', searchText: 'segundo segunda opcao', minFloat: 0.1, maxFloat: 0.5,
        hasStattrak: 1, hasSouvenir: 0, phase: 'Phase 1', rarity: 'Covert', imageUrl: 'https://x/y.png',
      }),
    ]);
    // aceita também o objeto já convertido
    expect(svc.parseSnapshot(json).rows).toHaveLength(2);
  });

  describe('parseSnapshot recusa', () => {
    const base = () => JSON.parse(svc.serializeSnapshot([row('a-1', 'Um')], { now: NOW }));
    const mutate = (fn) => {
      const s = base();
      fn(s);
      return s;
    };
    test.each([
      ['formatVersion 2', (s) => { s.formatVersion = 2; }],
      ['columns diferentes', (s) => { s.columns = [...s.columns].reverse(); }],
      ['columns a menos', (s) => { s.columns = s.columns.slice(1); }],
      ['categoria inválida', (s) => { s.rows[0][2] = 'XYZ'; }],
      ['fonte inválida', (s) => { s.rows[0][1] = 'MAPS'; }],
      ['minFloat > maxFloat', (s) => { s.rows[0][6] = 0.9; s.rows[0][7] = 0.1; }],
      ['float fora de 0..1', (s) => { s.rows[0][7] = 1.5; }],
      ['id inválido', (s) => { s.rows[0][0] = 'a/b'; }],
      ['nome vazio', (s) => { s.rows[0][3] = '  '; }],
      ['booleano que não é 0/1', (s) => { s.rows[0][8] = 2; }],
      ['linha com tamanho errado', (s) => { s.rows[0].pop(); }],
      ['generatedAt inválido', (s) => { s.generatedAt = 'ontem'; }],
      ['rows ausente', (s) => { delete s.rows; }],
      ['id repetido', (s) => { s.rows.push([...s.rows[0]]); }],
    ])('%s', (_name, fn) => {
      expect(() => svc.parseSnapshot(mutate(fn))).toThrow(expect.objectContaining({ status: 502, code: 'CATALOG_INVALID_FORMAT' }));
    });

    test('texto que não é JSON e estruturas inesperadas', () => {
      expect(() => svc.parseSnapshot('{nao')).toThrow(expect.objectContaining({ code: 'CATALOG_INVALID_FORMAT' }));
      expect(() => svc.parseSnapshot(null)).toThrow(expect.objectContaining({ code: 'CATALOG_INVALID_FORMAT' }));
      expect(() => svc.parseSnapshot([])).toThrow(expect.objectContaining({ code: 'CATALOG_INVALID_FORMAT' }));
    });
  });

  test('o fixture é um snapshot válido', () => {
    expect(svc.parseSnapshot(readFixture()).rows.length).toBe(21);
  });

  describe('syncBundledCatalog', () => {
    test('primeira vez importa e grava generatedAt; segunda não reimporta', () => {
      const file = writeSnapshotFile('s1.json', [row('a-1', 'Um'), row('a-2', 'Dois')], new Date('2026-10-01T00:00:00.000Z'));
      const spy = jest.spyOn(CatalogItem, 'upsertMany');
      expect(svc.syncBundledCatalog({ now: NOW, snapshotPath: file })).toMatchObject({ imported: 2, error: null });
      expect(Setting.get().catalogUpdatedAt).toBe('2026-10-01T00:00:00.000Z');
      expect(svc.getCatalogStatus().total).toBe(2);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(svc.syncBundledCatalog({ now: NOW, snapshotPath: file })).toMatchObject({ imported: 0, error: null });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('snapshot mais novo importa; mais antigo é ignorado', () => {
      const v1 = writeSnapshotFile('v1.json', [row('a-1', 'Um')], new Date('2026-10-01T00:00:00.000Z'));
      const v2 = writeSnapshotFile('v2.json', [row('a-1', 'Um Novo'), row('a-3', 'Três')], new Date('2026-11-01T00:00:00.000Z'));
      const spy = jest.spyOn(CatalogItem, 'upsertMany');
      svc.syncBundledCatalog({ now: NOW, snapshotPath: v1 });
      expect(svc.syncBundledCatalog({ now: NOW, snapshotPath: v2 }).imported).toBe(2);
      expect(svc.getCatalogItem('a-1').name).toBe('Um Novo');
      expect(Setting.get().catalogUpdatedAt).toBe('2026-11-01T00:00:00.000Z');
      expect(svc.syncBundledCatalog({ now: NOW, snapshotPath: v1 }).imported).toBe(0);
      expect(svc.getCatalogItem('a-1').name).toBe('Um Novo');
      expect(spy).toHaveBeenCalledTimes(2);
    });

    test('atualização online mais recente que o snapshot não é sobrescrita por ele', () => {
      Setting.update({ catalogUpdatedAt: '2026-11-10T00:00:00.000Z' });
      const file = writeSnapshotFile('antigo.json', [row('a-1', 'Um')], new Date('2026-10-01T00:00:00.000Z'));
      expect(svc.syncBundledCatalog({ now: NOW, snapshotPath: file }).imported).toBe(0);
      expect(svc.getCatalogStatus().total).toBe(0);
    });

    test('arquivo ausente ou corrompido não lança e mantém o catálogo', () => {
      importCatalogFixture();
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const missing = svc.syncBundledCatalog({ now: NOW, snapshotPath: path.join(tmpRoot, 'nao-existe.json') });
      expect(missing.error).toBeTruthy();
      const broken = path.join(tmpRoot, 'quebrado.json');
      fs.writeFileSync(broken, '{"formatVersion":1,');
      expect(svc.syncBundledCatalog({ now: NOW, snapshotPath: broken }).error).toBeTruthy();
      expect(errSpy).toHaveBeenCalledTimes(2);
      expect(errSpy.mock.calls[0][0]).toMatch(/Não foi possível importar o catálogo embutido/);
      expect(svc.getCatalogStatus().total).toBe(21);
    });

    test('depois do import, vincula itens legados', () => {
      Item.create(wonSkin({ name: 'AK-47 | Redline' }));
      const file = writeSnapshotFile('l.json', [row('skin-ak-redline', 'AK-47 | Redline')], NOW);
      expect(svc.syncBundledCatalog({ now: NOW, snapshotPath: file }).linkedLegacyItems).toBe(1);
    });
  });
});

describe('matchLegacyItem (função pura)', () => {
  const cand = (id, extra = {}) => ({ id, name: 'X', category: 'SKIN', phase: null, minFloat: null, maxFloat: null, ...extra });
  const item = (extra = {}) => ({ name: 'x', category: 'SKIN', phase: null, floatValue: null, ...extra });

  test('candidato único vincula; nenhum não vincula', () => {
    expect(svc.matchLegacyItem(item(), [cand('a')])).toEqual(cand('a'));
    expect(svc.matchLegacyItem(item(), [])).toBeNull();
    expect(svc.matchLegacyItem(item(), undefined)).toBeNull();
  });

  test('vários candidatos sem fase no item: não vincula', () => {
    expect(svc.matchLegacyItem(item(), [cand('a', { phase: 'Phase 1' }), cand('b', { phase: 'Phase 2' })])).toBeNull();
  });

  test('vários candidatos: a fase do item desempata (normalizada)', () => {
    const list = [cand('a', { phase: 'Phase 1' }), cand('b', { phase: 'Phase 2' })];
    expect(svc.matchLegacyItem(item({ phase: 'phase 2' }), list).id).toBe('b');
    expect(svc.matchLegacyItem(item({ phase: 'Ruby' }), list)).toBeNull();
  });

  test('vários candidatos com a mesma fase continuam ambíguos', () => {
    expect(svc.matchLegacyItem(item({ phase: 'Phase 1' }), [cand('a', { phase: 'Phase 1' }), cand('b', { phase: 'Phase 1' })])).toBeNull();
  });

  test('float fora da faixa não vincula; nos limites vincula; sem float ou sem faixa vincula', () => {
    const c = cand('a', { minFloat: 0.1, maxFloat: 0.7 });
    expect(svc.matchLegacyItem(item({ floatValue: 0.05 }), [c])).toBeNull();
    expect(svc.matchLegacyItem(item({ floatValue: 0.71 }), [c])).toBeNull();
    expect(svc.matchLegacyItem(item({ floatValue: 0.1 }), [c])).toBe(c);
    expect(svc.matchLegacyItem(item({ floatValue: 0.7 }), [c])).toBe(c);
    expect(svc.matchLegacyItem(item(), [c])).toBe(c);
    expect(svc.matchLegacyItem(item({ floatValue: 0.99 }), [cand('b')])).not.toBeNull();
  });

  test('fase do candidato diferente da do item (único candidato) não vincula; item sem fase vincula', () => {
    expect(svc.matchLegacyItem(item({ phase: 'Phase 1' }), [cand('a', { phase: 'Phase 2' })])).toBeNull();
    expect(svc.matchLegacyItem(item(), [cand('a', { phase: 'Phase 2' })]).id).toBe('a');
    expect(svc.matchLegacyItem(item({ phase: 'Phase 2' }), [cand('a')]).id).toBe('a');
  });
});

describe('linkLegacyItems', () => {
  beforeEach(() => importCatalogFixture());
  const legacy = (overrides) => Item.create(wonSkin(overrides));

  test('vincula e troca o nome para o canônico (nome em minúsculas, sem ★, com fase)', () => {
    const it = legacy({ name: 'karambit | doppler', category: 'FACA', phase: 'Phase 2', floatValue: 0.02, exterior: 'FN' });
    expect(svc.linkLegacyItems({ now: NOW })).toBe(1);
    expect(Item.findById(it.id)).toMatchObject({
      catalogId: CAT.KARAMBIT_DOPPLER_P2, name: '★ Karambit | Doppler', phase: 'Phase 2', category: 'FACA',
    });
  });

  test('ambíguo (duas fases, item sem fase) e nome repetido no catálogo continuam legados', () => {
    const a = legacy({ name: 'karambit | doppler', category: 'FACA' });
    const b = legacy({ name: '★ Bayonet | Blue Steel', category: 'FACA' });
    expect(svc.linkLegacyItems({ now: NOW })).toBe(0);
    expect(Item.findById(a.id).catalogId).toBeNull();
    expect(Item.findById(b.id).catalogId).toBeNull();
  });

  test('float fora da faixa e categoria diferente não vinculam', () => {
    const outOfRange = legacy({ name: 'AK-47 | Redline', floatValue: 0.01, exterior: 'FN' });
    const wrongCategory = legacy({ name: 'AK-47 | Redline', category: 'LUVA', variant: 'NORMAL' });
    const noMatch = legacy({ name: 'AK-47 | Inexistente' });
    expect(svc.linkLegacyItems({ now: NOW })).toBe(0);
    for (const i of [outOfRange, wrongCategory, noMatch]) expect(Item.findById(i.id).catalogId).toBeNull();
  });

  test('não mexe em itens já vinculados nem em OUTRO/PASSE_BATALHA', () => {
    const linked = legacy({ name: 'Nome Antigo', catalogId: CAT.AK_REDLINE });
    const free = Item.create({ name: 'Music Kit Box', category: 'OUTRO', acquisitionType: 'GANHEI', acquiredAt: '2026-01-10T12:00:00.000Z' });
    expect(svc.linkLegacyItems({ now: NOW })).toBe(0);
    expect(Item.findById(linked.id)).toMatchObject({ catalogId: CAT.AK_REDLINE, name: 'Nome Antigo' });
    expect(Item.findById(free.id).catalogId).toBeNull();
  });

  test('nunca lança: erro interno vira 0 e mensagem no console', () => {
    legacy({ name: 'AK-47 | Redline' });
    jest.spyOn(CatalogItem, 'findByNameKey').mockImplementation(() => {
      throw new Error('boom');
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(svc.linkLegacyItems({ now: NOW })).toBe(0);
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('consultas', () => {
  beforeEach(() => importCatalogFixture());

  test('searchCatalog: busca por nome, tradução, acento e meta', () => {
    const r = svc.searchCatalog({ q: 'ak red' });
    expect(r.items.map((i) => i.id)).toEqual([CAT.AK_REDLINE]);
    expect(r.meta).toEqual({ catalogUpdatedAt: '2026-11-01T00:00:00.000Z', total: 1 });
    expect(r.items[0]).toEqual({
      id: 'skin-ak-redline', source: 'SKINS', category: 'SKIN', name: 'AK-47 | Redline', namePtBr: 'AK-47 | Linha Vermelha',
      imageUrl: 'https://img.test/skin-ak-redline.png', minFloat: 0.1, maxFloat: 0.7, hasStattrak: true, hasSouvenir: false,
      phase: null, rarity: 'Classified',
    });
    expect(svc.searchCatalog({ q: 'LINHA vermelhá' }).items.map((i) => i.id)).toEqual([CAT.AK_REDLINE]);
    expect(svc.searchCatalog({ q: 'faca karambit' }).items.map((i) => i.id)).toEqual([CAT.KARAMBIT_VANILLA]);
    expect(svc.searchCatalog({ q: 'adesivo titan' }).items.map((i) => i.id)).toEqual([CAT.STICKER_TITAN]);
    expect(svc.searchCatalog({ q: '★ karambit', category: 'FACA', limit: 2 }).items).toHaveLength(2);
  });

  test('searchCatalog: validações (INVALID_QUERY)', () => {
    for (const args of [{}, { q: 'a' }, { q: '★' }, { q: 'ak', category: 'X' }, { q: 'ak', limit: 0 }, { q: 'ak', limit: 51 }, { q: 'ak', limit: 1.5 }]) {
      expect(() => svc.searchCatalog(args)).toThrow(expect.objectContaining({ status: 400, code: 'INVALID_QUERY' }));
    }
  });

  test('getCatalogItem / getCatalogItemOrFail / getCatalogItemsByIds', () => {
    expect(svc.getCatalogItem(CAT.AK_REDLINE).name).toBe('AK-47 | Redline');
    expect(svc.getCatalogItem('nao-existe')).toBeNull();
    expect(svc.getCatalogItem(123)).toBeNull();
    expect(svc.getCatalogItem('x'.repeat(101))).toBeNull();
    expect(() => svc.getCatalogItemOrFail('nao-existe')).toThrow(expect.objectContaining({ status: 404, code: 'CATALOG_ITEM_NOT_FOUND' }));
    expect(svc.getCatalogItemsByIds([CAT.AK_REDLINE, 'nao-existe', null]).map((i) => i.id)).toEqual([CAT.AK_REDLINE]);
  });

  test('findExactMatch normaliza o nome e exige a mesma categoria', () => {
    expect(svc.findExactMatch({ name: '  operation RIPTIDE access pass ', category: 'PASSE_BATALHA' }).id).toBe(CAT.BATTLE_PASS_RIPTIDE);
    expect(svc.findExactMatch({ name: 'Operation Riptide Access Pass', category: 'OUTRO' })).toBeNull();
    expect(svc.findExactMatch({ name: 'Nada', category: 'OUTRO' })).toBeNull();
  });

  test('getCatalogStatus', () => {
    expect(svc.getCatalogStatus()).toEqual({
      catalogUpdatedAt: '2026-11-01T00:00:00.000Z',
      countsBySource: { SKINS: 12, STICKERS: 2, CRATES: 5, KEYCHAINS: 1, AGENTS: 1 },
      total: 21,
    });
  });
});
