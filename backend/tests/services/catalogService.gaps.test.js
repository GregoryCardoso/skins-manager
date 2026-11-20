'use strict';

// Lacunas de D86 no catálogo: refresh tudo-ou-nada (casos de borda), sync do snapshot e vínculo de legados.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { closeDb, getDb } = require('../../src/config/database');
const CatalogItem = require('../../src/models/CatalogItem');
const Item = require('../../src/models/Item');
const Setting = require('../../src/models/Setting');
const svc = require('../../src/services/catalogService');
const { CATALOG_BASE_URL } = require('../../src/config/constants');
const { freshDb, wonSkin } = require('../helpers/fixtures');
const { CAT, importCatalogFixture, readFixture } = require('../helpers/catalog');

const API_FIX = path.join(__dirname, '..', 'fixtures', 'csgo-api');
const NOW = new Date('2026-11-20T12:00:00.000Z');
const FILES = ['skins', 'stickers', 'crates', 'keychains', 'agents'];

let tmpRoot;
beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-catalog-gaps-'));
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

function makeFetch(overrides = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push(url);
    const rel = url.slice(CATALOG_BASE_URL.length);
    if (Object.prototype.hasOwnProperty.call(overrides, rel)) {
      const o = overrides[rel];
      return typeof o === 'function' ? o(url, opts) : o;
    }
    const [lang, file] = rel.split('/');
    return okResponse(apiFile(lang, file.replace('.json', '')));
  };
  fn.calls = calls;
  return fn;
}

const row = (id, name, extra = {}) => ({
  id, source: 'SKINS', category: 'SKIN', name, namePtBr: null, imageUrl: null, minFloat: null, maxFloat: null,
  hasStattrak: 0, hasSouvenir: 0, phase: null, rarity: null, ...extra,
});
const writeFile = (name, text) => {
  const file = path.join(tmpRoot, name);
  fs.writeFileSync(file, text);
  return file;
};
const snapshotFile = (name, rows, now) => writeFile(name, svc.serializeSnapshot(rows, { now }));

describe('refresh: 404 só é tolerado em idioma secundário', () => {
  test('pt-BR com 404 em alguns arquivos e ok em outros: traduz só o que veio', async () => {
    const overrides = { 'pt-BR/skins.json': statusResponse(404), 'pt-BR/crates.json': statusResponse(404) };
    await svc.refreshCatalog({ fetchFn: makeFetch(overrides), now: NOW });
    expect(svc.getCatalogItem('skin-ak-redline').namePtBr).toBeNull();
    expect(svc.getCatalogItem('sticker-1').namePtBr).toBe('Adesivo | Titan | Katowice 2014');
  });

  test.each([403, 429, 500, 502, 503, 301])('pt-BR com HTTP %i NÃO é tolerado (só 404)', async (status) => {
    importCatalogFixture();
    const before = svc.getCatalogStatus();
    await expect(
      svc.refreshCatalog({ fetchFn: makeFetch({ 'pt-BR/agents.json': statusResponse(status) }), now: NOW })
    ).rejects.toMatchObject({ status: 502, code: 'CATALOG_FETCH_FAILED' });
    expect(svc.getCatalogStatus()).toEqual(before);
  });

  test('en com 404 em um arquivo falha mesmo com todo o pt-BR em 404 (tolerância não vaza para o en)', async () => {
    const overrides = Object.fromEntries(FILES.map((f) => [`pt-BR/${f}.json`, statusResponse(404)]));
    overrides['en/stickers.json'] = statusResponse(404);
    await expect(svc.refreshCatalog({ fetchFn: makeFetch(overrides), now: NOW })).rejects.toMatchObject({ code: 'CATALOG_FETCH_FAILED' });
    expect(svc.getCatalogStatus().total).toBe(0);
    expect(Setting.get().catalogUpdatedAt).toBeNull();
  });

  test('pt-BR com JSON que não é lista (200) é erro de formato, não tolerado', async () => {
    await expect(
      svc.refreshCatalog({ fetchFn: makeFetch({ 'pt-BR/skins.json': okResponse('{"erro":"x"}') }), now: NOW })
    ).rejects.toMatchObject({ code: 'CATALOG_INVALID_FORMAT' });
  });

  test('resposta só com json() (sem text()) também é aceita', async () => {
    const jsonOnly = (file) => ({ ok: true, status: 200, json: async () => JSON.parse(apiFile('en', file)) });
    const overrides = Object.fromEntries(FILES.map((f) => [`en/${f}.json`, jsonOnly(f)]));
    await expect(svc.refreshCatalog({ fetchFn: makeFetch(overrides), now: NOW })).resolves.toMatchObject({ total: 21 });
  });
});

describe('refresh: tudo ou nada', () => {
  beforeEach(() => importCatalogFixture());

  test('falha deixa legados sem vínculo e catalogUpdatedAt como estava', async () => {
    const legacy = Item.create(wonSkin({ name: 'AK-47 | Redline', catalogId: null }));
    const before = Setting.get().catalogUpdatedAt;
    await expect(
      svc.refreshCatalog({ fetchFn: makeFetch({ 'en/skins.json': statusResponse(500) }), now: NOW })
    ).rejects.toBeDefined();
    expect(Setting.get().catalogUpdatedAt).toBe(before);
    expect(Item.findById(legacy.id).catalogId).toBeNull();
  });

  test('falha tardia (último arquivo) não grava nada dos arquivos que já tinham chegado', async () => {
    const before = CatalogItem.findById('skin-ak-redline');
    const slowFail = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return statusResponse(500);
    };
    await expect(
      svc.refreshCatalog({ fetchFn: makeFetch({ 'pt-BR/agents.json': slowFail }), now: NOW })
    ).rejects.toMatchObject({ code: 'CATALOG_FETCH_FAILED' });
    expect(CatalogItem.findById('skin-ak-redline')).toEqual(before);
  });

  test('na primeira falha os downloads pendentes são abortados (signal)', async () => {
    let signal;
    const hang = (url, opts) => {
      signal = opts.signal;
      return new Promise(() => {});
    };
    await expect(
      svc.refreshCatalog({ fetchFn: makeFetch({ 'en/skins.json': statusResponse(500), 'pt-BR/stickers.json': hang }), now: NOW })
    ).rejects.toMatchObject({ code: 'CATALOG_FETCH_FAILED' });
    expect(signal.aborted).toBe(true);
  });

  test('timeout em arquivo pt-BR: 502, nada gravado e trava liberada', async () => {
    const before = svc.getCatalogStatus();
    const hang = (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    await expect(
      svc.refreshCatalog({ fetchFn: makeFetch({ 'pt-BR/keychains.json': hang }), now: NOW, timeoutMs: 30 })
    ).rejects.toMatchObject({ status: 502, code: 'CATALOG_FETCH_FAILED' });
    expect(svc.getCatalogStatus()).toEqual(before);
    await expect(svc.refreshCatalog({ fetchFn: makeFetch(), now: NOW })).resolves.toMatchObject({ total: expect.any(Number) });
  });

  test('erro no meio da gravação desfaz as linhas já inseridas e libera a trava', async () => {
    const before = svc.getCatalogStatus();
    jest.spyOn(Setting, 'update').mockImplementationOnce(() => {
      throw new Error('disco cheio');
    });
    await expect(svc.refreshCatalog({ fetchFn: makeFetch(), now: NOW })).rejects.toThrow('disco cheio');
    expect(svc.getCatalogStatus()).toEqual(before); // upsert desfeito junto com a data
    jest.restoreAllMocks();
    await expect(svc.refreshCatalog({ fetchFn: makeFetch(), now: NOW })).resolves.toBeDefined();
  });

  test('refresh simultâneo: o segundo e o terceiro são recusados sem chamar o fetch', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const slow = makeFetch({ 'en/skins.json': async () => { await gate; return okResponse(apiFile('en', 'skins')); } });
    const first = svc.refreshCatalog({ fetchFn: slow, now: NOW });
    const other = makeFetch();
    await expect(svc.refreshCatalog({ fetchFn: other, now: NOW })).rejects.toMatchObject({ code: 'CATALOG_REFRESH_IN_PROGRESS' });
    await expect(svc.refreshCatalog({ fetchFn: other, now: NOW })).rejects.toMatchObject({ code: 'CATALOG_REFRESH_IN_PROGRESS' });
    expect(other.calls).toHaveLength(0);
    release();
    await first;
  });

  test('refresh que falha por timeout não bloqueia o seguinte nem deixa a trava presa se a 1ª foi rejeitada', async () => {
    const hang = (url, { signal }) =>
      new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort'))));
    const first = svc.refreshCatalog({ fetchFn: makeFetch({ 'en/skins.json': hang }), now: NOW, timeoutMs: 20 });
    await expect(svc.refreshCatalog({ fetchFn: makeFetch(), now: NOW })).rejects.toMatchObject({ code: 'CATALOG_REFRESH_IN_PROGRESS' });
    await expect(first).rejects.toMatchObject({ code: 'CATALOG_FETCH_FAILED' });
    await expect(svc.refreshCatalog({ fetchFn: makeFetch(), now: NOW })).resolves.toBeDefined();
  });
});

describe('refresh: upsert', () => {
  test('atualiza linhas existentes (nome novo) e não duplica ao repetir', async () => {
    importCatalogFixture();
    const changed = JSON.parse(apiFile('en', 'skins'));
    changed[0].name = `${changed[0].name} v2`;
    const fetchFn = makeFetch({ 'en/skins.json': okResponse(JSON.stringify(changed)) });
    await svc.refreshCatalog({ fetchFn, now: NOW });
    const afterFirst = svc.getCatalogStatus();
    await svc.refreshCatalog({ fetchFn, now: NOW });
    expect(svc.getCatalogStatus().total).toBe(afterFirst.total);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM catalog_items WHERE name LIKE '% v2'").get().n).toBe(1);
  });

  test('item gravado não é renomeado pelo refresh (histórico estável, D78)', async () => {
    importCatalogFixture();
    const item = Item.create(wonSkin({ name: 'AK-47 | Redline', catalogId: CAT.AK_REDLINE }));
    const changed = JSON.parse(apiFile('en', 'skins')).map((s) => (s.name ? { ...s, name: s.name.replace('Redline', 'Redline Reborn') } : s));
    await svc.refreshCatalog({ fetchFn: makeFetch({ 'en/skins.json': okResponse(JSON.stringify(changed)) }), now: NOW });
    expect(Item.findById(item.id).name).toBe('AK-47 | Redline');
  });
});

describe('syncBundledCatalog: bordas', () => {
  test('generatedAt com mesmo instante em outro formato (Z sem milissegundos) não reimporta', () => {
    Setting.update({ catalogUpdatedAt: '2026-10-01T00:00:00.000Z' });
    const snap = JSON.parse(svc.serializeSnapshot([row('a-1', 'Um')], { now: new Date('2026-10-01T00:00:00.000Z') }));
    snap.generatedAt = '2026-10-01T00:00:00Z';
    const file = writeFile('mesmo-instante.json', JSON.stringify(snap));
    expect(svc.syncBundledCatalog({ now: NOW, snapshotPath: file }).imported).toBe(0);
    expect(svc.getCatalogStatus().total).toBe(0);
  });

  test('generatedAt 1 ms mais novo importa', () => {
    Setting.update({ catalogUpdatedAt: '2026-10-01T00:00:00.000Z' });
    const file = snapshotFile('um-ms.json', [row('a-1', 'Um')], new Date('2026-10-01T00:00:00.001Z'));
    expect(svc.syncBundledCatalog({ now: NOW, snapshotPath: file }).imported).toBe(1);
  });

  test('o snapshot não apaga entradas que não estão nele (upsert)', () => {
    importCatalogFixture();
    const file = snapshotFile('parcial.json', [row('skin-ak-redline', 'AK-47 | Redline')], new Date('2026-12-01T00:00:00.000Z'));
    expect(svc.syncBundledCatalog({ now: NOW, snapshotPath: file }).imported).toBe(1);
    expect(svc.getCatalogStatus().total).toBe(21);
    expect(svc.getCatalogItem(CAT.AWP_DLORE)).not.toBeNull();
  });

  const invalidFiles = {
    'arquivo vazio': () => '',
    'JSON truncado': () => svc.serializeSnapshot([row('a-1', 'Um'), row('a-2', 'Dois')], { now: new Date('2026-12-01T00:00:00.000Z') }).slice(0, 200),
    'ids repetidos': () => svc.serializeSnapshot([row('a-1', 'Um'), row('a-1', 'Um de novo')], { now: new Date('2026-12-01T00:00:00.000Z') }),
    formatVersion: () => svc.serializeSnapshot([row('a-1', 'Um')], { now: new Date('2026-12-01T00:00:00.000Z') }).replace('"formatVersion":1', '"formatVersion":2'),
    'categoria inválida na última linha': () => {
      const snap = JSON.parse(svc.serializeSnapshot([row('a-1', 'Um'), row('a-2', 'Dois')], { now: new Date('2026-12-01T00:00:00.000Z') }));
      snap.rows[1][2] = 'ARMA';
      return JSON.stringify(snap);
    },
  };
  test.each(Object.keys(invalidFiles))('snapshot inválido (%s): não lança, nada importado e data intacta', (name) => {
    importCatalogFixture();
    const before = svc.getCatalogStatus();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const file = writeFile(`inv-${name.replace(/\W+/g, '_')}.json`, invalidFiles[name]());
    let result;
    expect(() => {
      result = svc.syncBundledCatalog({ now: NOW, snapshotPath: file });
    }).not.toThrow();
    expect(result.error).toBeTruthy();
    expect(result.imported).toBe(0);
    expect(svc.getCatalogStatus()).toEqual(before);
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/Não foi possível importar o catálogo embutido/));
  });

  test('snapshot ausente ainda vincula legados com o catálogo que já existe', () => {
    importCatalogFixture();
    Item.create(wonSkin({ name: 'AK-47 | Redline', catalogId: null }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = svc.syncBundledCatalog({ now: NOW, snapshotPath: path.join(tmpRoot, 'nada.json') });
    expect(result).toMatchObject({ imported: 0, linkedLegacyItems: 1 });
  });

  test('falha ao gravar (banco) não derruba o boot e deixa o catálogo como estava', () => {
    importCatalogFixture();
    const before = svc.getCatalogStatus();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(CatalogItem, 'upsertMany').mockImplementation(() => {
      throw new Error('falha de gravação');
    });
    const file = snapshotFile('novo.json', [row('a-9', 'Novo')], new Date('2026-12-01T00:00:00.000Z'));
    const result = svc.syncBundledCatalog({ now: NOW, snapshotPath: file });
    expect(result.error).toBeTruthy();
    expect(svc.getCatalogStatus()).toEqual(before);
  });

  test('snapshot sem linhas é válido: grava a data e não quebra', () => {
    const file = snapshotFile('vazio.json', [], new Date('2026-12-01T00:00:00.000Z'));
    expect(svc.syncBundledCatalog({ now: NOW, snapshotPath: file })).toMatchObject({ imported: 0, error: null });
  });

  test('snapshot sem linhas: não pode ser confundido com "já importado" quando o banco está vazio (data gravada = generatedAt)', () => {
    const file = snapshotFile('vazio2.json', [], new Date('2026-12-01T00:00:00.000Z'));
    svc.syncBundledCatalog({ now: NOW, snapshotPath: file });
    expect(Setting.get().catalogUpdatedAt).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('parseSnapshot: bordas adicionais', () => {
  const base = () => JSON.parse(svc.serializeSnapshot([row('a-1', 'Um', { minFloat: 0.1, maxFloat: 0.1 })], { now: NOW }));
  const withRow = (mutate) => {
    const snap = base();
    mutate(snap.rows[0]);
    return snap;
  };
  test('minFloat igual a maxFloat é válido; limites 0 e 1 são válidos', () => {
    expect(() => svc.parseSnapshot(base())).not.toThrow();
    expect(() => svc.parseSnapshot(withRow((r) => { r[6] = 0; r[7] = 1; }))).not.toThrow();
  });

  test.each([
    ['float acima de 1', (r) => { r[7] = 1.01; }],
    ['float negativo', (r) => { r[6] = -0.01; }],
    ['float como string', (r) => { r[6] = '0.1'; }],
    ['float NaN (null no JSON vira null, então usa string)', (r) => { r[7] = 'NaN'; }],
    ['id com espaço', (r) => { r[0] = 'a 1'; }],
    ['id com 101 caracteres', (r) => { r[0] = 'x'.repeat(101); }],
    ['id vazio', (r) => { r[0] = ''; }],
    ['nome só com espaços', (r) => { r[3] = '   '; }],
    ['hasStattrak 2', (r) => { r[8] = 2; }],
    ['hasSouvenir true', (r) => { r[9] = true; }],
    ['fonte desconhecida', (r) => { r[1] = 'MAPS'; }],
    ['linha curta', (r) => { r.pop(); }],
    ['phase numérica', (r) => { r[10] = 1; }],
  ])('recusa: %s', (_name, mutate) => {
    expect(() => svc.parseSnapshot(withRow(mutate))).toThrow(expect.objectContaining({ code: 'CATALOG_INVALID_FORMAT' }));
  });

  test('formatVersion como string "1" e generatedAt inválido são recusados', () => {
    const a = base();
    a.formatVersion = '1';
    expect(() => svc.parseSnapshot(a)).toThrow(expect.objectContaining({ code: 'CATALOG_INVALID_FORMAT' }));
    const b = base();
    b.generatedAt = 'ontem';
    expect(() => svc.parseSnapshot(b)).toThrow(expect.objectContaining({ code: 'CATALOG_INVALID_FORMAT' }));
  });

  test('calcula nameKey e searchText (sem tradução: só nameKey; com tradução igual: sem repetir)', () => {
    const snap = JSON.parse(svc.serializeSnapshot([row('a-1', '★ Faca™ ÁÉ'), row('a-2', 'Igual', { namePtBr: 'IGUAL' }), row('a-3', 'Um', { namePtBr: 'Úm Dois' })], { now: NOW }));
    const { rows } = svc.parseSnapshot(snap);
    expect(rows[0]).toMatchObject({ nameKey: 'faca ae', searchText: 'faca ae' });
    expect(rows[1].searchText).toBe('igual');
    expect(rows[2].searchText).toBe('um um dois');
  });
});

describe('matchLegacyItem: bordas', () => {
  const cand = (id, extra = {}) => ({ id, name: 'X', category: 'FACA', phase: null, minFloat: null, maxFloat: null, ...extra });

  test('item com fase e vários candidatos sem fase: nenhum casa', () => {
    expect(svc.matchLegacyItem({ phase: 'Phase 1' }, [cand('a'), cand('b')])).toBeNull();
  });

  test('fase com espaços/maiúsculas diferentes ainda desempata', () => {
    const match = svc.matchLegacyItem({ phase: '  PHASE   2 ' }, [cand('a', { phase: 'Phase 1' }), cand('b', { phase: 'Phase 2' })]);
    expect(match.id).toBe('b');
  });

  test('item com fase e um único candidato sem fase: vincula', () => {
    expect(svc.matchLegacyItem({ phase: 'Phase 1', floatValue: null }, [cand('a')]).id).toBe('a');
  });

  test('faixa com só um limite (min sem max) não checa float', () => {
    expect(svc.matchLegacyItem({ floatValue: 0.9 }, [cand('a', { minFloat: 0.1, maxFloat: null })]).id).toBe('a');
  });

  test('float exatamente nos limites vincula; epsilon fora não', () => {
    const c = cand('a', { minFloat: 0.1, maxFloat: 0.7 });
    expect(svc.matchLegacyItem({ floatValue: 0.1 }, [c])).toBe(c);
    expect(svc.matchLegacyItem({ floatValue: 0.7 }, [c])).toBe(c);
    expect(svc.matchLegacyItem({ floatValue: 0.0999999 }, [c])).toBeNull();
    expect(svc.matchLegacyItem({ floatValue: 0.7000001 }, [c])).toBeNull();
  });

  test('entrada inválida de candidatos', () => {
    expect(svc.matchLegacyItem({}, null)).toBeNull();
    expect(svc.matchLegacyItem({}, [])).toBeNull();
  });
});

describe('linkLegacyItems: bordas', () => {
  beforeEach(() => importCatalogFixture());
  const legacy = (overrides) => Item.create(wonSkin({ catalogId: null, ...overrides }));

  test('idempotente: a segunda execução não vincula nada e não altera updated_at', () => {
    const it = legacy({ name: 'ak-47 | redline' });
    expect(svc.linkLegacyItems({ now: NOW })).toBe(1);
    const after = Item.findById(it.id);
    expect(svc.linkLegacyItems({ now: NOW })).toBe(0);
    expect(Item.findById(it.id)).toEqual(after);
  });

  test('normaliza espaços e maiúsculas do nome antigo', () => {
    const it = legacy({ name: '  AK-47   |  REDLINE ' });
    expect(svc.linkLegacyItems({ now: NOW })).toBe(1);
    expect(Item.findById(it.id)).toMatchObject({ catalogId: CAT.AK_REDLINE, name: 'AK-47 | Redline' });
  });

  test('float exatamente no limite da faixa vincula; item sem float vincula', () => {
    const lo = legacy({ name: 'AK-47 | Redline', floatValue: 0.1, exterior: 'MW' });
    const hi = legacy({ name: 'AK-47 | Redline', floatValue: 0.7, exterior: 'BS' });
    const none = legacy({ name: 'AK-47 | Redline' });
    expect(svc.linkLegacyItems({ now: NOW })).toBe(3);
    for (const i of [lo, hi, none]) expect(Item.findById(i.id).catalogId).toBe(CAT.AK_REDLINE);
  });

  test('faca com nome duplicado no catálogo não vincula, nem com fase informada', () => {
    const a = legacy({ name: '★ Bayonet | Blue Steel', category: 'FACA' });
    const b = legacy({ name: 'bayonet | blue steel', category: 'FACA', phase: 'Phase 1' });
    expect(svc.linkLegacyItems({ now: NOW })).toBe(0);
    expect(Item.findById(a.id).catalogId).toBeNull();
    expect(Item.findById(b.id).catalogId).toBeNull();
  });

  test('fase do item desempata entre fases do catálogo; fase é mantida e nome canônico aplicado', () => {
    const it = legacy({ name: '★ karambit | doppler', category: 'FACA', phase: 'phase 1' });
    expect(svc.linkLegacyItems({ now: NOW })).toBe(1);
    expect(Item.findById(it.id)).toMatchObject({ catalogId: CAT.KARAMBIT_DOPPLER_P1, phase: 'Phase 1', name: '★ Karambit | Doppler' });
  });

  test('item vinculado sem fase no catálogo mantém a fase livre do item', () => {
    const it = legacy({ name: 'Karambit | Fade', category: 'FACA', phase: 'Fade 90%' });
    svc.linkLegacyItems({ now: NOW });
    expect(Item.findById(it.id)).toMatchObject({ catalogId: CAT.KARAMBIT_FADE, phase: 'Fade 90%' });
  });

  test('item vendido também é vinculado e a venda não muda', () => {
    const sold = Item.create({
      ...wonSkin({ name: 'AK-47 | Redline', catalogId: null }),
      status: 'VENDIDO', saleStoreId: 1, salePriceCents: 1000, saleCurrency: 'USD', saleFeeTypeApplied: 'DEDUCTED',
      saleFeeRateApplied: 0.02, saleFeeRoundingApplied: 'CEIL', saleFixedFeeCentsApplied: 0, netReceivedCents: 980,
      soldAt: '2026-01-20T12:00:00.000Z',
    });
    svc.linkLegacyItems({ now: NOW });
    expect(Item.findById(sold.id)).toMatchObject({ catalogId: CAT.AK_REDLINE, status: 'VENDIDO', salePriceCents: 1000, netReceivedCents: 980 });
  });

  test('é atômico: erro ao atualizar o 2º item desfaz o 1º e devolve 0', () => {
    const a = legacy({ name: 'AK-47 | Redline' });
    const b = legacy({ name: 'AWP | Dragon Lore' });
    const original = Item.update;
    let calls = 0;
    jest.spyOn(Item, 'update').mockImplementation((...args) => {
      calls += 1;
      if (calls === 2) throw new Error('falhou o segundo');
      return original(...args);
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(svc.linkLegacyItems({ now: NOW })).toBe(0);
    jest.restoreAllMocks();
    expect(Item.findById(a.id).catalogId).toBeNull();
    expect(Item.findById(b.id).catalogId).toBeNull();
  });

  test('o fixture do catálogo não muda quando o vínculo roda', () => {
    legacy({ name: 'AK-47 | Redline' });
    const before = readFixture().rows.length;
    svc.linkLegacyItems({ now: NOW });
    expect(svc.getCatalogStatus().total).toBe(before);
  });
});

describe('searchCatalog: bordas', () => {
  beforeEach(() => importCatalogFixture());

  test('limit 1 e 50 aceitos; 0, 51, 1.5 e string rejeitados', () => {
    expect(svc.searchCatalog({ q: 'ak', limit: 1 }).items).toHaveLength(1);
    expect(svc.searchCatalog({ q: 'sticker', limit: 50 }).items.length).toBeGreaterThan(0);
    for (const limit of [0, 51, 1.5, '5', -1, NaN]) {
      expect(() => svc.searchCatalog({ q: 'ak', limit })).toThrow(expect.objectContaining({ code: 'INVALID_QUERY' }));
    }
  });

  test('todos os termos: ordem dos termos não importa; termo que não casa zera', () => {
    expect(svc.searchCatalog({ q: 'redline ak' }).items.map((i) => i.id)).toEqual([CAT.AK_REDLINE]);
    expect(svc.searchCatalog({ q: 'ak awp' }).meta.total).toBe(0);
  });

  test('digitar o nome completo com "|" e hífen acha o item', () => {
    expect(svc.searchCatalog({ q: 'AK-47 | Redline' }).items.map((i) => i.id)).toEqual([CAT.AK_REDLINE]);
  });

  test('acentos e maiúsculas no termo e no texto traduzido', () => {
    expect(svc.searchCatalog({ q: 'LINHÁ vermélha' }).items.map((i) => i.id)).toEqual([CAT.AK_REDLINE]);
    expect(svc.searchCatalog({ q: 'ADESIVO' }).items.map((i) => i.id)).toEqual([CAT.STICKER_TITAN]);
  });

  test('filtro de categoria isola categorias com nomes parecidos e categoria null/undefined não filtra', () => {
    expect(svc.searchCatalog({ q: 'karambit', category: 'FACA' }).meta.total).toBe(4);
    expect(svc.searchCatalog({ q: 'karambit', category: 'SKIN' }).meta.total).toBe(0);
    expect(svc.searchCatalog({ q: 'karambit', category: null }).meta.total).toBe(4);
  });

  test('metacaracteres do LIKE ( % _ \\ ) são literais', () => {
    for (const q of ['%%', '__', 'ak\\', '%ak', 'a_']) expect(svc.searchCatalog({ q }).meta.total).toBe(0);
  });
});
