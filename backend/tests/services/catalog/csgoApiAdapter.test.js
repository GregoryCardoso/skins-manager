'use strict';

const fs = require('fs');
const path = require('path');
const adapter = require('../../../src/services/catalog/csgoApiAdapter');

const FIX = path.join(__dirname, '..', '..', 'fixtures', 'csgo-api');
const SOURCES = ['SKINS', 'STICKERS', 'CRATES', 'KEYCHAINS', 'AGENTS'];

function loadLang(lang) {
  const out = {};
  for (const source of SOURCES) {
    out[source] = JSON.parse(fs.readFileSync(path.join(FIX, lang, `${source.toLowerCase()}.json`), 'utf8'));
  }
  return out;
}

const en = loadLang('en');
const ptBr = loadLang('pt-BR');
const result = adapter.mapCatalog({ en, ptBr });
const byId = (id) => result.rows.find((r) => r.id === id);

describe('normalizeSearchText', () => {
  test.each([
    ['★ Karambit | Doppler', 'karambit | doppler'],
    ['StatTrak™ AK-47', 'stattrak ak-47'],
    ['Café   COM  Açúcar®', 'cafe com acucar'],
    ['  Adesivo   Pingente  ', 'adesivo pingente'],
    ['Faca Karambit', 'faca karambit'],
  ])('%p -> %p', (input, expected) => {
    expect(adapter.normalizeSearchText(input)).toBe(expected);
  });

  test('entrada que não é string vira vazio', () => {
    expect(adapter.normalizeSearchText(null)).toBe('');
    expect(adapter.normalizeSearchText(undefined)).toBe('');
    expect(adapter.normalizeSearchText(3)).toBe('');
  });
});

describe('csgoApiAdapter.mapCatalog', () => {
  test('mapeia cada categoria', () => {
    const cat = (id) => byId(id).category;
    expect(cat('skin-ak-redline')).toBe('SKIN');
    expect(cat('skin-deagle-ddpat')).toBe('SKIN');
    expect(cat('skin-karambit-doppler-p1')).toBe('FACA');
    expect(cat('skin-karambit-vanilla')).toBe('FACA');
    expect(cat('skin-sport-gloves-pandora')).toBe('LUVA');
    expect(cat('sticker-1')).toBe('STICKER');
    expect(cat('crate-case')).toBe('CAIXA');
    expect(cat('crate-souvenir')).toBe('CAIXA');
    expect(cat('crate-sticker-capsule')).toBe('CAPSULA');
    expect(cat('crate-autograph')).toBe('CAPSULA');
    expect(cat('crate-patch')).toBe('CAPSULA');
    expect(cat('crate-pins')).toBe('CAPSULA');
    expect(cat('crate-music')).toBe('OUTRO');
    expect(cat('crate-graffiti')).toBe('OUTRO');
    expect(cat('crate-null')).toBe('OUTRO');
    expect(cat('keychain-1')).toBe('PINGENTE');
    expect(cat('agent-4613')).toBe('PERSONAGEM');
  });

  test('guarda a fonte de cada linha e nenhuma é PASSE_BATALHA', () => {
    expect(byId('skin-ak-redline').source).toBe('SKINS');
    expect(byId('sticker-1').source).toBe('STICKERS');
    expect(byId('crate-case').source).toBe('CRATES');
    expect(byId('keychain-1').source).toBe('KEYCHAINS');
    expect(byId('agent-4613').source).toBe('AGENTS');
    expect(result.rows.some((r) => r.category === 'PASSE_BATALHA')).toBe(false);
  });

  test('skin: floats, StatTrak, Souvenir, raridade e imagem', () => {
    expect(byId('skin-ak-redline')).toMatchObject({
      name: 'AK-47 | Redline', minFloat: 0.1, maxFloat: 0.7, hasStattrak: 1, hasSouvenir: 0,
      rarity: 'Classified', imageUrl: 'https://img.test/ak-redline.png', phase: null,
    });
    expect(byId('skin-deagle-ddpat')).toMatchObject({ hasStattrak: 0, hasSouvenir: 1 });
  });

  test('fases são linhas separadas (uma por id) e carregam a fase', () => {
    expect(byId('skin-karambit-doppler-p1')).toMatchObject({ name: '★ Karambit | Doppler', phase: 'Phase 1' });
    expect(byId('skin-karambit-doppler-p2')).toMatchObject({ name: '★ Karambit | Doppler', phase: 'Phase 2' });
  });

  test('faca sem faixa de float e floats invertidos viram null/null', () => {
    expect(byId('skin-karambit-vanilla')).toMatchObject({ minFloat: null, maxFloat: null });
    expect(byId('skin-bad-floats')).toMatchObject({ minFloat: null, maxFloat: null });
  });

  test('sem imagem -> imageUrl null', () => {
    expect(byId('skin-no-image').imageUrl).toBeNull();
  });

  test('namePtBr pelo id; null se ausente; id só no pt-BR é ignorado', () => {
    expect(byId('skin-ak-redline').namePtBr).toBe('AK-47 | Linha Vermelha');
    expect(byId('sticker-1').namePtBr).toBe('Adesivo | Titan | Katowice 2014');
    expect(byId('skin-deagle-ddpat').namePtBr).toBeNull();
    expect(byId('agent-4613').namePtBr).toBeNull();
    expect(byId('skin-so-no-ptbr')).toBeUndefined();
  });

  test('nameKey e searchText (com e sem tradução)', () => {
    expect(byId('skin-karambit-vanilla')).toMatchObject({
      nameKey: 'karambit', searchText: 'karambit faca karambit',
    });
    expect(byId('skin-deagle-ddpat')).toMatchObject({
      nameKey: 'desert eagle | urban ddpat', searchText: 'desert eagle | urban ddpat',
    });
    // tradução igual ao nome não duplica o texto
    expect(byId('skin-karambit-doppler-p1').searchText).toBe('karambit | doppler');
  });

  test('entradas sem id, sem nome ou com id inválido vão para skipped', () => {
    expect(result.skipped).toBe(3);
    expect(byId('skin-sem-nome')).toBeUndefined();
    expect(byId('skin/invalido')).toBeUndefined();
  });

  test('funciona sem pt-BR (todo ou por fonte) e com fontes ausentes', () => {
    const noPt = adapter.mapCatalog({ en });
    expect(noPt.rows.length).toBe(result.rows.length);
    expect(noPt.rows.every((r) => r.namePtBr === null)).toBe(true);
    const partial = adapter.mapCatalog({ en, ptBr: { STICKERS: ptBr.STICKERS } });
    expect(partial.rows.find((r) => r.id === 'sticker-1').namePtBr).toBe('Adesivo | Titan | Katowice 2014');
    expect(partial.rows.find((r) => r.id === 'skin-ak-redline').namePtBr).toBeNull();
    expect(adapter.mapCatalog({ en: { SKINS: [] } })).toEqual({ rows: [], skipped: 0 });
    expect(adapter.mapCatalog()).toEqual({ rows: [], skipped: 0 });
  });

  test('mapeadores individuais recebem (rawEn, mapa de nomes)', () => {
    const one = adapter.mapStickers(en.STICKERS, new Map([['sticker-2', 'Adesivo Coroa']]));
    expect(one.rows.map((r) => r.namePtBr)).toEqual([null, 'Adesivo Coroa']);
    expect(adapter.mapSkins(undefined).rows).toEqual([]);
  });
});
