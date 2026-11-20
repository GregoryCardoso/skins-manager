import { describe, expect, test } from 'vitest';
import {
  CATEGORIES, DEFAULT_FILTERS, hasActiveFilters, parseFilters, toApiQuery, toSearchString, type InventoryFilters,
} from './inventoryQuery';

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));

describe('parseFilters', () => {
  test('sem parâmetros: padrões', () => {
    expect(parse('')).toEqual({ status: 'EM_ESTOQUE', category: 'ALL', stagnant: false, order: 'desc' });
    expect(parse('')).toEqual(DEFAULT_FILTERS);
  });

  test('valores válidos', () => {
    expect(parse('status=VENDIDO&category=FACA&order=asc')).toEqual({ status: 'VENDIDO', category: 'FACA', stagnant: false, order: 'asc' });
    expect(parse('stagnant=1')).toMatchObject({ stagnant: true });
  });

  test('status=ALL significa Todos', () => {
    expect(parse('status=ALL').status).toBe('ALL');
  });

  test('valores inválidos são ignorados (voltam ao padrão)', () => {
    expect(parse('status=XYZ&category=ARMA&order=up&stagnant=true')).toEqual(DEFAULT_FILTERS);
    expect(parse('status=em_estoque&category=skin&order=ASC&stagnant=0')).toEqual(DEFAULT_FILTERS);
    expect(parse('status=&category=&order=&stagnant=')).toEqual(DEFAULT_FILTERS);
  });

  test('um inválido não derruba os válidos', () => {
    expect(parse('status=VENDIDO&category=XXX&order=asc')).toEqual({ status: 'VENDIDO', category: 'ALL', stagnant: false, order: 'asc' });
  });

  test('"só agarrados" com status Vendidos é descartado', () => {
    expect(parse('status=VENDIDO&stagnant=1').stagnant).toBe(false);
  });

  test('"só agarrados" vale com Em estoque e com Todos', () => {
    expect(parse('stagnant=1').stagnant).toBe(true);
    expect(parse('status=ALL&stagnant=1').stagnant).toBe(true);
  });

  test('categoria: as 10 são aceitas', () => {
    expect(CATEGORIES).toHaveLength(10);
    for (const c of CATEGORIES) expect(parse(`category=${c}`).category).toBe(c);
  });
});

describe('toSearchString', () => {
  test('padrão = string vazia', () => {
    expect(toSearchString(DEFAULT_FILTERS)).toBe('');
  });

  test('só o que difere do padrão', () => {
    expect(toSearchString({ ...DEFAULT_FILTERS, status: 'VENDIDO' })).toBe('status=VENDIDO');
    expect(toSearchString({ ...DEFAULT_FILTERS, category: 'LUVA', order: 'asc', stagnant: true }))
      .toBe('category=LUVA&stagnant=1&order=asc');
    expect(toSearchString({ ...DEFAULT_FILTERS, status: 'ALL' })).toBe('status=ALL');
  });

  test('stagnant não é serializado com Vendidos', () => {
    expect(toSearchString({ status: 'VENDIDO', category: 'ALL', stagnant: true, order: 'desc' })).toBe('status=VENDIDO');
  });

  test('ida e volta (serializar e interpretar) preserva os filtros', () => {
    const cases: InventoryFilters[] = [
      DEFAULT_FILTERS,
      { status: 'VENDIDO', category: 'SKIN', stagnant: false, order: 'asc' },
      { status: 'ALL', category: 'PASSE_BATALHA', stagnant: true, order: 'asc' },
      { status: 'EM_ESTOQUE', category: 'ALL', stagnant: true, order: 'desc' },
    ];
    for (const f of cases) expect(parse(toSearchString(f))).toEqual(f);
  });
});

describe('toApiQuery', () => {
  test('padrão: status e order', () => {
    expect(toApiQuery(DEFAULT_FILTERS)).toEqual({ order: 'desc', status: 'EM_ESTOQUE' });
  });

  test('Todos: sem status', () => {
    const q = toApiQuery({ ...DEFAULT_FILTERS, status: 'ALL' });
    expect(q).toEqual({ order: 'desc' });
    expect('status' in q).toBe(false);
  });

  test('categoria e stagnantOnly', () => {
    expect(toApiQuery({ ...DEFAULT_FILTERS, category: 'FACA', stagnant: true, order: 'asc' }))
      .toEqual({ order: 'asc', status: 'EM_ESTOQUE', category: 'FACA', stagnantOnly: true });
  });

  test('Vendidos nunca manda stagnantOnly, mesmo com o filtro ligado', () => {
    const q = toApiQuery({ status: 'VENDIDO', category: 'ALL', stagnant: true, order: 'desc' });
    expect(q.stagnantOnly).toBeUndefined();
    expect(q.status).toBe('VENDIDO');
  });

  test('Todos + stagnant manda stagnantOnly', () => {
    expect(toApiQuery({ status: 'ALL', category: 'ALL', stagnant: true, order: 'desc' }).stagnantOnly).toBe(true);
  });
});

describe('hasActiveFilters', () => {
  test('padrão = inativo; qualquer desvio (exceto ordem) = ativo', () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, order: 'asc' })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, status: 'ALL' })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, category: 'SKIN' })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, stagnant: true })).toBe(true);
  });
});
