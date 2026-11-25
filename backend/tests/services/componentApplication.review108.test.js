// 10.8 (S1): resolveSourceKinds resolve em lote (sem uma consulta de catálogo por unidade) e dá o mesmo resultado que resolveSourceKind.
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture, CAT } = require('../helpers/catalog');
const { closeDb } = require('../../src/config/database');
const catalogService = require('../../src/services/catalogService');
const CatalogItem = require('../../src/models/CatalogItem');
const { resolveSourceKind, resolveSourceKinds } = require('../../src/services/operations/componentApplicationService');

beforeEach(() => {
  freshDb();
  importCatalogFixture();
});
afterAll(() => closeDb());

const units = () => [
  { id: 1, category: 'STICKER', catalogId: CAT.STICKER_TITAN, name: 'x' },
  { id: 2, category: 'STICKER', catalogId: CAT.STICKER_CROWN, name: 'x' },
  { id: 3, category: 'PINGENTE', catalogId: CAT.CHARM_LIL_AVA, name: 'x' },
  { id: 4, category: 'OUTRO', catalogId: null, name: 'Sticker Slab | Titan | Katowice 2014' },
  { id: 5, category: 'OUTRO', catalogId: null, name: 'Sticker Slab | Titan | Katowice 2014' }, // repetido: uma só consulta de nome
  { id: 6, category: 'OUTRO', catalogId: null, name: 'Sticker Slab | Nome que não existe' }, // sem casamento
  { id: 7, category: 'SKIN', catalogId: CAT.AK_REDLINE, name: 'x' }, // não é componente
  { id: 8, category: 'STICKER', catalogId: null, name: 'x' }, // sem catálogo
  { id: 9, category: 'STICKER', catalogId: 'nao-existe', name: 'x' }, // catálogo inexistente
  { id: 10, category: 'STICKER', catalogId: CAT.CHARM_LIL_AVA, name: 'x' }, // categoria do catálogo diferente
  { id: 11, category: 'OUTRO', catalogId: null, name: 'Chave qualquer' },
];

describe('S1: resolveSourceKinds em lote', () => {
  test('mesmo resultado do resolveSourceKind unitário, unidade a unidade', () => {
    const list = units();
    const batch = resolveSourceKinds(list);
    for (const unit of list) {
      const single = resolveSourceKind(unit);
      if (single === null) expect(batch.has(unit.id)).toBe(false);
      else expect(batch.get(unit.id)).toEqual(single);
    }
    expect([...batch.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(batch.get(4)).toMatchObject({ kind: 'STICKER_SLAB', entry: { id: CAT.STICKER_TITAN } });
  });

  test('sem N+1: nenhuma consulta unitária de catálogo, só as de lote', () => {
    const byId = jest.spyOn(CatalogItem, 'findById');
    const byName = jest.spyOn(CatalogItem, 'findByNameKey');
    const batchIds = jest.spyOn(CatalogItem, 'findByIds');
    const batchNames = jest.spyOn(CatalogItem, 'findByNameKeys');
    const viaService = jest.spyOn(catalogService, 'getCatalogItem');
    try {
      resolveSourceKinds(units());
      expect(byId).not.toHaveBeenCalled();
      expect(byName).not.toHaveBeenCalled();
      expect(viaService).not.toHaveBeenCalled();
      expect(batchIds).toHaveBeenCalledTimes(1);
      expect(batchNames).toHaveBeenCalledTimes(1);
    } finally {
      [byId, byName, batchIds, batchNames, viaService].forEach((s) => s.mockRestore());
    }
  });

  test('sem nenhum slab, a consulta por nome nem acontece; lista vazia não consulta nada', () => {
    const batchNames = jest.spyOn(CatalogItem, 'findByNameKeys');
    const batchIds = jest.spyOn(CatalogItem, 'findByIds');
    try {
      expect(resolveSourceKinds(units().filter((u) => u.category !== 'OUTRO')).size).toBe(3);
      expect(batchNames).not.toHaveBeenCalled();
      batchIds.mockClear();
      expect(resolveSourceKinds([]).size).toBe(0);
    } finally {
      batchNames.mockRestore();
      batchIds.mockRestore();
    }
  });
});
