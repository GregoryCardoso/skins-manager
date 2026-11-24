'use strict';

const { closeDb } = require('../../src/config/database');
const CatalogItem = require('../../src/models/CatalogItem');
const Item = require('../../src/models/Item');
const { freshDb, wonSkin } = require('../helpers/fixtures');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const NOW = new Date('2026-11-20T10:00:00.000Z');

function row(id, name, overrides = {}) {
  const key = name.toLowerCase();
  return {
    id, source: 'SKINS', category: 'SKIN', name, namePtBr: null, nameKey: key, searchText: key,
    imageUrl: null, minFloat: null, maxFloat: null, hasStattrak: 0, hasSouvenir: 0, phase: null, rarity: null,
    ...overrides,
  };
}

describe('models/CatalogItem', () => {
  test('upsertMany insere, devolve camelCase com booleanos e grava updatedAt', () => {
    CatalogItem.upsertMany([row('a', 'AK-47 | Redline', { minFloat: 0.1, maxFloat: 0.7, hasStattrak: 1, imageUrl: 'http://x/a.png' })], { now: NOW });
    expect(CatalogItem.findById('a')).toEqual({
      id: 'a', source: 'SKINS', category: 'SKIN', name: 'AK-47 | Redline', namePtBr: null, nameKey: 'ak-47 | redline',
      searchText: 'ak-47 | redline', imageUrl: 'http://x/a.png', minFloat: 0.1, maxFloat: 0.7, hasStattrak: true,
      hasSouvenir: false, phase: null, rarity: null, updatedAt: '2026-11-20T10:00:00.000Z',
    });
    expect(CatalogItem.findById('inexistente')).toBeNull();
  });

  test('upsertMany atualiza linha existente e não apaga as ausentes', () => {
    CatalogItem.upsertMany([row('a', 'Um'), row('b', 'Dois')], { now: NOW });
    CatalogItem.upsertMany([row('a', 'Um Novo', { namePtBr: 'Um BR' })], { now: new Date('2026-11-21T00:00:00.000Z') });
    expect(CatalogItem.findById('a')).toMatchObject({ name: 'Um Novo', namePtBr: 'Um BR', updatedAt: '2026-11-21T00:00:00.000Z' });
    expect(CatalogItem.findById('b')).not.toBeNull();
  });

  test('upsertMany é atômico: linha inválida desfaz o lote', () => {
    expect(() => CatalogItem.upsertMany([row('a', 'Ok'), row('b', 'Ruim', { category: 'XYZ' })], { now: NOW })).toThrow();
    expect(CatalogItem.findById('a')).toBeNull();
  });

  test('findByIds devolve só os existentes, sem repetir', () => {
    CatalogItem.upsertMany([row('a', 'Um'), row('b', 'Dois')], { now: NOW });
    expect(CatalogItem.findByIds(['a', 'a', 'zzz', 'b']).map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(CatalogItem.findByIds([])).toEqual([]);
  });

  test('findByNameKey filtra por categoria', () => {
    CatalogItem.upsertMany([row('a', 'Foo'), row('b', 'Foo', { category: 'LUVA' })], { now: NOW });
    expect(CatalogItem.findByNameKey('foo', 'SKIN').map((r) => r.id)).toEqual(['a']);
    expect(CatalogItem.findByNameKey('foo', 'CAIXA')).toEqual([]);
  });

  describe('search', () => {
    beforeEach(() => {
      CatalogItem.upsertMany(
        [
          row('1', 'AK-47 | Redline', { searchText: 'ak-47 | redline ak-47 | linha vermelha', nameKey: 'ak-47 | redline' }),
          row('2', 'M4A4 | Red Line Copy', { searchText: 'm4a4 | red line copy', nameKey: 'm4a4 | red line copy' }),
          row('3', 'Sticker 100% Fire', { source: 'STICKERS', category: 'STICKER', searchText: 'sticker 100% fire', nameKey: 'sticker 100% fire' }),
          row('4', 'Sticker 100x Fire', { source: 'STICKERS', category: 'STICKER', searchText: 'sticker 100x fire', nameKey: 'sticker 100x fire' }),
          row('5', 'Sticker a_b', { source: 'STICKERS', category: 'STICKER', searchText: 'sticker a_b', nameKey: 'sticker a_b' }),
          row('6', 'Sticker axb', { source: 'STICKERS', category: 'STICKER', searchText: 'sticker axb', nameKey: 'sticker axb' }),
        ],
        { now: NOW }
      );
    });

    test('todos os tokens precisam aparecer (AND)', () => {
      const { rows, total } = CatalogItem.search({ tokens: ['ak', 'red'], limit: 20 });
      expect(rows.map((r) => r.id)).toEqual(['1']);
      expect(total).toBe(1);
    });

    test('acha pelo texto traduzido', () => {
      expect(CatalogItem.search({ tokens: ['vermelha'], limit: 20 }).rows.map((r) => r.id)).toEqual(['1']);
    });

    test('% e _ são literais', () => {
      expect(CatalogItem.search({ tokens: ['100%'], limit: 20 }).rows.map((r) => r.id)).toEqual(['3']);
      expect(CatalogItem.search({ tokens: ['a_b'], limit: 20 }).rows.map((r) => r.id)).toEqual(['5']);
      expect(CatalogItem.search({ tokens: ['a' + String.fromCharCode(92) + 'b'], limit: 20 }).total).toBe(0);
    });

    test('ordena: nome começando com o 1º token, depois o mais curto', () => {
      const { rows } = CatalogItem.search({ tokens: ['red'], limit: 20 });
      expect(rows.map((r) => r.id)).toEqual(['1', '2']);
      const r2 = CatalogItem.search({ tokens: ['line'], limit: 20 }).rows.map((r) => r.id);
      expect(r2).toEqual(['1', '2']);
      const r3 = CatalogItem.search({ tokens: ['m4a4'], limit: 20 }).rows.map((r) => r.id);
      expect(r3).toEqual(['2']);
    });

    test('filtro de categoria, limit e total antes do limit', () => {
      const res = CatalogItem.search({ tokens: ['sticker'], category: 'STICKER', limit: 2 });
      expect(res.rows).toHaveLength(2);
      expect(res.total).toBe(4);
      expect(CatalogItem.search({ tokens: ['sticker'], category: 'SKIN', limit: 5 })).toEqual({ rows: [], total: 0 });
    });
  });

  test('countBySource devolve as 5 fontes, com zero nas vazias', () => {
    expect(CatalogItem.countBySource()).toEqual({ SKINS: 0, STICKERS: 0, CRATES: 0, KEYCHAINS: 0, AGENTS: 0, PATCHES: 0 });
    CatalogItem.upsertMany([row('a', 'Um'), row('b', 'Dois', { source: 'AGENTS', category: 'PERSONAGEM' })], { now: NOW });
    expect(CatalogItem.countBySource()).toEqual({ SKINS: 1, STICKERS: 0, CRATES: 0, KEYCHAINS: 0, AGENTS: 1, PATCHES: 0 });
  });

  test('Item.findLegacy: catalog_id nulo nas categorias pedidas', () => {
    const legacy = Item.create(wonSkin());
    Item.create(wonSkin({ catalogId: 'a' }));
    Item.create({ name: 'Livre', category: 'OUTRO', acquisitionType: 'GANHEI', acquiredAt: '2026-01-10T12:00:00.000Z' });
    expect(Item.findLegacy(['SKIN', 'FACA']).map((i) => i.id)).toEqual([legacy.id]);
    expect(Item.findLegacy([])).toEqual([]);
  });
});
