'use strict';

// T37 (D102): imagens só por https://.
const fs = require('fs');
const path = require('path');
const adapter = require('../../../src/services/catalog/csgoApiAdapter');
const catalogService = require('../../../src/services/catalogService');
const CatalogItem = require('../../../src/models/CatalogItem');
const { CATALOG_SNAPSHOT_PATH } = require('../../../src/config/constants');
const { closeDb } = require('../../../src/config/database');
const { freshDb } = require('../../helpers/fixtures');
const { readFixture } = require('../../helpers/catalog');

const { toSafeImageUrl } = adapter;
const FIX = path.join(__dirname, '..', '..', 'fixtures', 'csgo-api');

afterAll(() => closeDb());

describe('toSafeImageUrl', () => {
  test.each([
    'https://cdn.example.com/a.png',
    'https://community.fastly.steamstatic.com/economy/image/abc/360fx360f',
    'HTTPS://CDN.EXAMPLE.COM/A.PNG',
    'https://host:8443/x?y=1#z',
  ])('aceita %p e devolve o texto', (url) => {
    expect(toSafeImageUrl(url)).toBe(url);
  });

  test('aceita https com espaços nas pontas (devolve aparado)', () => {
    expect(toSafeImageUrl('  https://a.example/x.png  ')).toBe('https://a.example/x.png');
  });

  test.each([
    'http://cdn.example.com/a.png',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:image/png;base64,AAAA',
    '//cdn.example.com/a.png',
    'https://',
    'https:',
    'ftp://x/a.png',
    'file:///c:/a.png',
    'not a url',
    '/relative/a.png',
    '',
    '   ',
  ])('recusa %p', (value) => {
    expect(toSafeImageUrl(value)).toBeNull();
  });

  test.each([null, undefined, 0, 12, true, {}, [], ['https://a.example/x.png'], () => 'https://a.example'])(
    'não-string %p -> null', (value) => {
      expect(toSafeImageUrl(value)).toBeNull();
    },
  );
});

describe('uso no adaptador (download)', () => {
  function loadLang(lang) {
    const out = {};
    for (const s of ['SKINS', 'STICKERS', 'CRATES', 'KEYCHAINS', 'AGENTS']) {
      out[s] = JSON.parse(fs.readFileSync(path.join(FIX, lang, `${s.toLowerCase()}.json`), 'utf8'));
    }
    return out;
  }

  test('imagem http:// vira imageUrl null e a linha é mantida', () => {
    const en = loadLang('en');
    const baseline = adapter.mapCatalog({ en });
    const target = en.STICKERS[0];
    const original = target.image;
    expect(typeof original).toBe('string');
    target.image = 'http://insecure.example/a.png';
    const result = adapter.mapCatalog({ en });
    expect(result.rows).toHaveLength(baseline.rows.length);
    const row = result.rows.find((r) => r.id === target.id);
    expect(row).toBeDefined();
    expect(row.imageUrl).toBeNull();
    target.image = 'javascript:alert(1)';
    expect(adapter.mapCatalog({ en }).rows.find((r) => r.id === target.id).imageUrl).toBeNull();
    target.image = original;
    expect(adapter.mapCatalog({ en }).rows.find((r) => r.id === target.id).imageUrl).toBe(original);
  });
});

describe('uso no parseSnapshot e na leitura (toCatalogView)', () => {
  beforeEach(() => {
    freshDb();
  });

  function snapshotWithImage(imageUrl) {
    const snap = readFixture();
    const col = snap.columns.indexOf('imageUrl');
    expect(col).toBeGreaterThanOrEqual(0);
    snap.rows[0][col] = imageUrl;
    return { snap, id: snap.rows[0][0] };
  }

  test('parseSnapshot: http:// vira null sem erro; https permanece', () => {
    const bad = snapshotWithImage('http://insecure.example/a.png');
    const parsed = catalogService.parseSnapshot(JSON.stringify(bad.snap));
    expect(parsed.rows.find((r) => r.id === bad.id).imageUrl).toBeNull();
    expect(parsed.rows.length).toBe(bad.snap.rows.length);
    const good = snapshotWithImage('https://ok.example/a.png');
    expect(catalogService.parseSnapshot(JSON.stringify(good.snap)).rows.find((r) => r.id === good.id).imageUrl).toBe('https://ok.example/a.png');
  });

  test('toCatalogView: linha http:// gravada direto no model vira null em getCatalogItem e na busca', () => {
    const base = {
      source: 'STICKERS', category: 'STICKER', name: 'Sticker | Teste Inseguro', namePtBr: null,
      nameKey: 'sticker | teste inseguro', searchText: 'sticker | teste inseguro',
    };
    CatalogItem.upsertMany([
      { ...base, id: 't37-http', imageUrl: 'http://insecure.example/a.png' },
      { ...base, id: 't37-js', imageUrl: 'javascript:alert(1)', name: 'Sticker | Teste Js', nameKey: 'sticker | teste js', searchText: 'sticker | teste js' },
      { ...base, id: 't37-https', imageUrl: 'https://ok.example/a.png', name: 'Sticker | Teste Seguro', nameKey: 'sticker | teste seguro', searchText: 'sticker | teste seguro' },
    ]);
    expect(catalogService.getCatalogItem('t37-http').imageUrl).toBeNull();
    expect(catalogService.getCatalogItem('t37-js').imageUrl).toBeNull();
    expect(catalogService.getCatalogItem('t37-https').imageUrl).toBe('https://ok.example/a.png');
    const found = catalogService.searchCatalog({ q: 'teste', limit: 10 });
    const list = found.items;
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const entry of list) expect([null, 'https://ok.example/a.png']).toContain(entry.imageUrl);
  });
});

describe('snapshot embutido real', () => {
  test('toda imageUrl é https:// ou null', () => {
    const parsed = catalogService.parseSnapshot(fs.readFileSync(CATALOG_SNAPSHOT_PATH, 'utf8'));
    expect(parsed.rows.length).toBeGreaterThan(1000);
    const bad = parsed.rows.filter((r) => r.imageUrl !== null && !/^https:\/\/[^/]/i.test(r.imageUrl));
    expect(bad.map((r) => `${r.id}: ${r.imageUrl}`)).toEqual([]);
  });

  test('o texto cru do arquivo não contém http:// em nenhuma imagem', () => {
    const raw = JSON.parse(fs.readFileSync(CATALOG_SNAPSHOT_PATH, 'utf8'));
    const col = raw.columns.indexOf('imageUrl');
    const offenders = raw.rows.filter((r) => typeof r[col] === 'string' && !/^https:\/\//i.test(r[col]));
    expect(offenders.length).toBe(0);
  });
});
