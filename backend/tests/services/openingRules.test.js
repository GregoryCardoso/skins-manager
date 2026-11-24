'use strict';

// 10.4 (D363, E-P2-Q49): classificação do que abre e compatibilidade entre caixa e chave (puro, sem banco).
const fs = require('fs');
const path = require('path');
const { SHARED_CASE_KEYS, isKey, isKeyedCase, openingKindOf, caseKeyName, keyMatchesCase } = require('../../src/services/operations/openingRules');

const unit = (name, category, extra = {}) => ({ name, category, catalogId: 'x-1', status: 'EM_ESTOQUE', ...extra });
const entry = (category, source = 'CRATES') => ({ category, source });

describe('openingKindOf', () => {
  test.each([
    ['Kilowatt Case', 'CAIXA', 'CASE'],
    ['Operation Phoenix Weapon Case', 'CAIXA', 'CASE'],
    ['CS:GO Weapon Case 2', 'CAIXA', 'CASE'], // não termina em " Case", mas está na tabela de chaves compartilhadas
    ['CS:GO Weapon Case 3', 'CAIXA', 'CASE'],
    ['eSports 2014 Summer Case', 'CAIXA', 'CASE'],
    ['DreamHack 2013 Souvenir Package', 'CAIXA', 'NO_KEY'],
    ['ESL One Cologne 2014 Dust II Souvenir Highlight Package', 'CAIXA', 'NO_KEY'],
    ['Cologne 2026 Sticker Capsule', 'CAPSULA', 'NO_KEY'],
    ['EMS Katowice 2014 Legends', 'CAPSULA', 'NO_KEY'],
    ['CS:GO Patch Pack', 'CAPSULA', 'NO_KEY'],
    ['X-Ray P250 Package', 'OUTRO', 'NO_KEY'],
    ['Anubis Collection Package', 'OUTRO', 'NO_KEY'],
    ['Sealed Genesis Terminal', 'OUTRO', 'TERMINAL'],
    ['Sealed Dead Hand Terminal', 'OUTRO', 'TERMINAL'],
  ])('%s -> %s', (name, category, expected) => {
    expect(openingKindOf(unit(name, category), entry(category))).toBe(expected);
  });

  test.each([
    ['Gift Package', 'OUTRO'],
    ['Pallet of Presents', 'OUTRO'],
    ['Audience Participation Parcel', 'OUTRO'],
    ['Masterminds Music Kit Box', 'OUTRO'],
    ['CS:GO Graffiti Box', 'OUTRO'],
    ['Rio 2022 Storage Unit with Paper Stickers', 'OUTRO'],
    ['AK-47 | Redline', 'SKIN'],
  ])('%s não abre', (name, category) => {
    expect(openingKindOf(unit(name, category), entry(category))).toBeNull();
  });

  test('legado sem catálogo, sem entrada ou fora do estoque não abre', () => {
    expect(openingKindOf(unit('Kilowatt Case', 'CAIXA', { catalogId: null }), entry('CAIXA'))).toBeNull();
    expect(openingKindOf(unit('Kilowatt Case', 'CAIXA'), null)).toBeNull();
    expect(openingKindOf(unit('Kilowatt Case', 'CAIXA', { status: 'VENDIDO' }), entry('CAIXA'))).toBeNull();
    expect(openingKindOf(unit('Kilowatt Case', 'CAIXA', { status: 'CONSUMIDO' }), entry('CAIXA'))).toBeNull();
  });

  test('toda caixa, cápsula, pacote e terminal do catálogo embutido é classificada como a regra manda', () => {
    const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'seed', 'catalog.json'), 'utf8'));
    const rows = snapshot.rows.filter((r) => r[1] === 'CRATES').map((r) => ({ id: r[0], category: r[2], name: r[3] }));
    const kindOf = (r) => openingKindOf(unit(r.name, r.category, { catalogId: r.id }), entry(r.category));
    for (const r of rows) {
      const kind = kindOf(r);
      if (r.category === 'CAPSULA') expect([r.name, kind]).toEqual([r.name, 'NO_KEY']);
      if (r.category === 'CAIXA' && /Package$/.test(r.name)) expect([r.name, kind]).toEqual([r.name, 'NO_KEY']);
      if (r.category === 'CAIXA' && /Case$/.test(r.name)) expect([r.name, kind]).toEqual([r.name, 'CASE']);
      if (/Terminal$/.test(r.name)) expect([r.name, kind]).toEqual([r.name, 'TERMINAL']);
      if (/Storage Unit|Box$|Gift Package|Pallet|Parcel/.test(r.name)) expect([r.name, kind]).toEqual([r.name, null]);
    }
    // as seis caixas da tabela existem no catálogo embutido com esses nomes, e todas pedem chave
    const byName = new Map(rows.map((r) => [r.name, r]));
    for (const list of Object.values(SHARED_CASE_KEYS)) {
      for (const name of list) {
        expect(byName.has(name)).toBe(true);
        expect(kindOf(byName.get(name))).toBe('CASE');
      }
    }
  });
});

describe('isKey / isKeyedCase', () => {
  test('chave = OUTRO sem catálogo terminado em " Key"', () => {
    expect(isKey({ category: 'OUTRO', catalogId: null, name: 'Kilowatt Case Key' })).toBe(true);
    expect(isKey({ category: 'OUTRO', catalogId: 'crate-1', name: 'Kilowatt Case Key' })).toBe(false);
    expect(isKey({ category: 'OUTRO', catalogId: null, name: 'Keychain' })).toBe(false);
    expect(isKey({ category: 'CAIXA', catalogId: null, name: 'X Key' })).toBe(false);
  });

  test('isKeyedCase', () => {
    expect(isKeyedCase('Kilowatt Case')).toBe(true);
    expect(isKeyedCase('CS:GO Weapon Case 3')).toBe(true);
    expect(isKeyedCase('DreamHack 2013 Souvenir Package')).toBe(false);
  });
});

describe('caseKeyName e keyMatchesCase', () => {
  test('nome sugerido e casamento 1 <-> 1 pelo nome', () => {
    expect(caseKeyName('Kilowatt Case')).toBe('Kilowatt Case Key');
    expect(caseKeyName('Operation Phoenix Weapon Case')).toBe('Operation Phoenix Case Key');
    expect(keyMatchesCase('Kilowatt Case Key', 'Kilowatt Case')).toBe(true);
    expect(keyMatchesCase('kilowatt case key', 'Kilowatt Case')).toBe(true);
    expect(keyMatchesCase('Operation Phoenix Case Key', 'Operation Phoenix Weapon Case')).toBe(true);
    expect(keyMatchesCase('Operation Phoenix Weapon Case Key', 'Operation Phoenix Weapon Case')).toBe(true);
    expect(keyMatchesCase('Chroma Case Key', 'Kilowatt Case')).toBe(false);
    expect(keyMatchesCase('Kilowatt Case Key', 'Chroma Case')).toBe(false);
  });

  test('tabela de chaves compartilhadas (E-P2-Q49(b))', () => {
    for (const name of SHARED_CASE_KEYS['CS:GO Case Key']) {
      expect(keyMatchesCase('CS:GO Case Key', name)).toBe(true);
      expect(caseKeyName(name)).toBe('CS:GO Case Key');
    }
    for (const name of SHARED_CASE_KEYS['eSports Key']) {
      expect(keyMatchesCase('eSports Key', name)).toBe(true);
      expect(caseKeyName(name)).toBe('eSports Key');
    }
    expect(caseKeyName('eSports 2014 Summer Case')).toBe('eSports Key');
    expect(keyMatchesCase('CS:GO Case Key', 'eSports 2013 Case')).toBe(false);
    expect(keyMatchesCase('CS:GO Case Key', 'Chroma Case')).toBe(false);
    expect(keyMatchesCase('eSports Key', 'CS:GO Weapon Case')).toBe(false);
    // as seis caixas só aceitam a chave da tabela
    expect(keyMatchesCase('CS:GO Weapon Case 2 Key', 'CS:GO Weapon Case 2')).toBe(false);
    expect(keyMatchesCase('eSports 2013 Case Key', 'eSports 2013 Case')).toBe(false);
  });
});
