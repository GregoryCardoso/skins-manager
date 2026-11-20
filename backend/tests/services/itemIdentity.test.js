'use strict';

const { resolveItemIdentity } = require('../../src/services/itemService');
const {
  assertFloatInCatalogRange, CATALOG_CATEGORIES, FREE_NAME_CATEGORIES, CATEGORIES,
} = require('../../src/services/itemAttributesService');

const entry = (o = {}) => ({ id: 'e1', name: 'Nome Canônico', category: 'SKIN', phase: null, minFloat: 0, maxFloat: 1, ...o });
const stored = (o = {}) => ({ catalogId: null, name: 'Gravado', category: 'SKIN', phase: null, ...o });
const code = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return null;
};

describe('grupos de categoria (D78)', () => {
  test('CATALOG_CATEGORIES e FREE_NAME_CATEGORIES cobrem todas as categorias sem sobreposição', () => {
    expect([...CATALOG_CATEGORIES, ...FREE_NAME_CATEGORIES].sort()).toEqual([...CATEGORIES].sort());
    expect(FREE_NAME_CATEGORIES).toEqual(['OUTRO', 'PASSE_BATALHA']);
  });
});

describe('resolveItemIdentity', () => {
  test('POST com catálogo: copia nome e categoria; fase do catálogo trava', () => {
    expect(resolveItemIdentity({ body: { catalogId: 'e1' }, catalogEntry: entry({ phase: 'Phase 2' }) })).toEqual({
      catalogId: 'e1', name: 'Nome Canônico', category: 'SKIN', phase: 'Phase 2', phaseLocked: true,
    });
    expect(resolveItemIdentity({ body: { catalogId: 'e1', phase: 'Livre' }, catalogEntry: entry() })).toMatchObject({
      phase: 'Livre', phaseLocked: false,
    });
    expect(resolveItemIdentity({ body: { catalogId: 'e1' }, catalogEntry: entry() }).phase).toBeNull();
  });

  test('ordem: DERIVED_FIELD antes de NOT_FOUND', () => {
    expect(code(() => resolveItemIdentity({ body: { catalogId: 'x', name: 'a' }, catalogEntry: null }))).toBe('CATALOG_DERIVED_FIELD');
    expect(code(() => resolveItemIdentity({ body: { catalogId: 'x' }, catalogEntry: null }))).toBe('CATALOG_ITEM_NOT_FOUND');
    expect(
      code(() => resolveItemIdentity({ body: { catalogId: 'e1', phase: 'x' }, catalogEntry: entry({ phase: 'P' }) }))
    ).toBe('CATALOG_DERIVED_FIELD');
  });

  test('PATCH sem mudar o catalogId: nome e categoria gravados ficam, mesmo se o catálogo mudou', () => {
    const existing = stored({ catalogId: 'e1', name: 'Nome Antigo', category: 'SKIN', phase: 'Phase 1' });
    expect(resolveItemIdentity({ body: { originDetail: 'x' }, existing, catalogEntry: entry() })).toMatchObject({
      name: 'Nome Antigo', category: 'SKIN', phase: 'Phase 1',
    });
    // entrada removida: nenhuma checagem de catálogo
    expect(resolveItemIdentity({ body: { phase: 'Livre' }, existing, catalogEntry: null })).toMatchObject({
      catalogId: 'e1', name: 'Nome Antigo', phase: 'Livre',
    });
    // entrada com fase: a do catálogo vale
    expect(resolveItemIdentity({ body: {}, existing, catalogEntry: entry({ phase: 'Phase 4' }) }).phase).toBe('Phase 4');
  });

  test('PATCH trocando o catalogId: nome/categoria do novo; fase antiga não é herdada', () => {
    const existing = stored({ catalogId: 'e0', phase: 'Phase 1' });
    expect(resolveItemIdentity({ body: { catalogId: 'e1' }, existing, catalogEntry: entry({ category: 'LUVA' }) })).toMatchObject({
      catalogId: 'e1', name: 'Nome Canônico', category: 'LUVA', phase: null,
    });
  });

  test('sem catálogo: categoria de catálogo -> CATALOG_ITEM_REQUIRED; categoria inválida/ausente', () => {
    expect(code(() => resolveItemIdentity({ body: { name: 'x', category: 'SKIN' } }))).toBe('CATALOG_ITEM_REQUIRED');
    expect(code(() => resolveItemIdentity({ body: { name: 'x', category: 'XYZ' } }))).toBe('INVALID_CATEGORY');
    expect(code(() => resolveItemIdentity({ body: { name: 'x', category: null } }))).toBe('INVALID_CATEGORY');
    expect(code(() => resolveItemIdentity({ body: { name: 'x' } }))).toBe('REQUIRED_FIELD');
  });

  test('nome livre: obrigatório, até 200, PASSE_BATALHA com correspondência no catálogo', () => {
    expect(resolveItemIdentity({ body: { name: '  Livre ', category: 'OUTRO' } })).toMatchObject({
      name: 'Livre', category: 'OUTRO', catalogId: null,
    });
    expect(code(() => resolveItemIdentity({ body: { name: ' ', category: 'OUTRO' } }))).toBe('REQUIRED_FIELD');
    expect(code(() => resolveItemIdentity({ body: { name: 'a'.repeat(201), category: 'OUTRO' } }))).toBe('FIELD_TOO_LONG');
    expect(
      code(() => resolveItemIdentity({ body: { name: 'Passe', category: 'PASSE_BATALHA' }, freeNameCatalogMatch: entry() }))
    ).toBe('CATALOG_ITEM_REQUIRED');
    expect(
      code(() => resolveItemIdentity({ body: { name: 'Passe', category: 'OUTRO' }, freeNameCatalogMatch: entry() }))
    ).toBeNull();
  });

  test('PATCH legado: só passa sem name/category/catalogId', () => {
    const legacy = stored();
    expect(resolveItemIdentity({ body: { originDetail: 'x' }, existing: legacy })).toMatchObject({
      catalogId: null, name: 'Gravado', category: 'SKIN',
    });
    for (const body of [{ name: 'n' }, { category: 'LUVA' }, { catalogId: null }]) {
      expect(code(() => resolveItemIdentity({ body, existing: legacy }))).toBe('CATALOG_ITEM_REQUIRED');
    }
    expect(resolveItemIdentity({ body: { category: 'OUTRO', name: 'Livre' }, existing: legacy })).toMatchObject({
      category: 'OUTRO', name: 'Livre',
    });
  });

  test('PATCH desvincular de entrada OUTRO mantém o nome', () => {
    const existing = stored({ catalogId: 'e1', name: 'Music Kit Box', category: 'OUTRO' });
    expect(resolveItemIdentity({ body: { catalogId: null }, existing })).toMatchObject({
      catalogId: null, name: 'Music Kit Box', category: 'OUTRO',
    });
    expect(code(() => resolveItemIdentity({ body: { catalogId: null }, existing: stored({ catalogId: 'e1' }) }))).toBe(
      'CATALOG_ITEM_REQUIRED'
    );
  });
});

describe('assertFloatInCatalogRange', () => {
  const range = { minFloat: 0.1, maxFloat: 0.7 };

  test('limites inclusivos e mensagem com a faixa', () => {
    expect(() => assertFloatInCatalogRange(0.1, range)).not.toThrow();
    expect(() => assertFloatInCatalogRange(0.7, range)).not.toThrow();
    expect(() => assertFloatInCatalogRange(0.0999, range)).toThrow(
      expect.objectContaining({ code: 'FLOAT_OUT_OF_RANGE', status: 400 })
    );
    expect(() => assertFloatInCatalogRange(0.7001, range)).toThrow('O float deste item deve estar entre 0,10 e 0,70.');
    expect(() => assertFloatInCatalogRange(0.5, { minFloat: 0, maxFloat: 0.08 })).toThrow('entre 0,00 e 0,08.');
    expect(() => assertFloatInCatalogRange(0.01, { minFloat: 0.065, maxFloat: 0.8 })).toThrow('entre 0,065 e 0,80.');
  });

  test('sem float ou sem faixa completa: não checa', () => {
    expect(() => assertFloatInCatalogRange(null, range)).not.toThrow();
    expect(() => assertFloatInCatalogRange(undefined, range)).not.toThrow();
    expect(() => assertFloatInCatalogRange(0.9, { minFloat: null, maxFloat: null })).not.toThrow();
    expect(() => assertFloatInCatalogRange(0.9, { minFloat: 0.1, maxFloat: null })).not.toThrow();
    expect(() => assertFloatInCatalogRange(0.9)).not.toThrow();
  });
});
