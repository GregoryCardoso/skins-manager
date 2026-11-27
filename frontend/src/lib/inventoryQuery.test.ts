import { describe, expect, test } from 'vitest';
import {
  CATEGORIES, DEFAULT_FILTERS, clearedFilters, hasActiveFilters, isStagnantDisabled, parseFilters, toApiQuery, toGroupQuery, toSearchString, type InventoryFilters,
} from './inventoryQuery';

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));

describe('parseFilters', () => {
  test('sem parâmetros: padrões', () => {
    expect(parse('')).toEqual({ status: 'EM_ESTOQUE', category: 'ALL', stagnant: false, order: 'desc', saleState: 'FOR_SALE', search: '' });
    expect(parse('')).toEqual(DEFAULT_FILTERS);
  });

  test('valores válidos', () => {
    expect(parse('status=VENDIDO&category=FACA&order=asc')).toEqual({ status: 'VENDIDO', category: 'FACA', stagnant: false, order: 'asc', saleState: 'FOR_SALE', search: '' });
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
    expect(parse('status=VENDIDO&category=XXX&order=asc')).toEqual({ status: 'VENDIDO', category: 'ALL', stagnant: false, order: 'asc', saleState: 'FOR_SALE', search: '' });
  });

  test('"só agarrados" com status Vendidos é descartado', () => {
    expect(parse('status=VENDIDO&stagnant=1').stagnant).toBe(false);
  });

  test('"só agarrados" vale com Em estoque e com Todos', () => {
    expect(parse('stagnant=1').stagnant).toBe(true);
    expect(parse('status=ALL&stagnant=1').stagnant).toBe(true);
  });

  test('categoria: as 11 são aceitas', () => {
    expect(CATEGORIES).toHaveLength(11);
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
    expect(toSearchString({ status: 'VENDIDO', category: 'ALL', stagnant: true, order: 'desc', saleState: 'FOR_SALE', search: '' })).toBe('status=VENDIDO');
  });

  test('ida e volta (serializar e interpretar) preserva os filtros', () => {
    const cases: InventoryFilters[] = [
      DEFAULT_FILTERS,
      { status: 'VENDIDO', category: 'SKIN', stagnant: false, order: 'asc', saleState: 'FOR_SALE', search: '' },
      { status: 'ALL', category: 'PASSE_BATALHA', stagnant: true, order: 'asc', saleState: 'FOR_SALE', search: '' },
      { status: 'EM_ESTOQUE', category: 'ALL', stagnant: true, order: 'desc', saleState: 'FOR_SALE', search: '' },
    ];
    for (const f of cases) expect(parse(toSearchString(f))).toEqual(f);
  });
});

describe('toApiQuery', () => {
  test('padrão: status e order', () => {
    expect(toApiQuery(DEFAULT_FILTERS)).toEqual({ order: 'desc', status: 'EM_ESTOQUE', saleState: 'FOR_SALE' });
  });

  test('Todos: sem status', () => {
    const q = toApiQuery({ ...DEFAULT_FILTERS, status: 'ALL' });
    expect(q).toEqual({ order: 'desc' });
    expect('status' in q).toBe(false);
  });

  test('categoria e stagnantOnly', () => {
    expect(toApiQuery({ ...DEFAULT_FILTERS, category: 'FACA', stagnant: true, order: 'asc' }))
      .toEqual({ order: 'asc', status: 'EM_ESTOQUE', category: 'FACA', stagnantOnly: true, saleState: 'FOR_SALE' });
  });

  test('Vendidos nunca manda stagnantOnly, mesmo com o filtro ligado', () => {
    const q = toApiQuery({ status: 'VENDIDO', category: 'ALL', stagnant: true, order: 'desc', saleState: 'FOR_SALE', search: '' });
    expect(q.stagnantOnly).toBeUndefined();
    expect(q.status).toBe('VENDIDO');
  });

  test('Todos + stagnant manda stagnantOnly', () => {
    expect(toApiQuery({ status: 'ALL', category: 'ALL', stagnant: true, order: 'desc', saleState: 'FOR_SALE', search: '' }).stagnantOnly).toBe(true);
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

describe('saleState (abas À venda / Fora de venda, D266)', () => {
  test('padrão FOR_SALE: não vai para a URL; OFF_SALE vira sale=off e volta na leitura', () => {
    expect(DEFAULT_FILTERS.saleState).toBe('FOR_SALE');
    expect(toSearchString(DEFAULT_FILTERS)).toBe('');
    expect(toSearchString({ ...DEFAULT_FILTERS, saleState: 'OFF_SALE', search: '' })).toBe('sale=off');
    expect(parseFilters(new URLSearchParams('sale=off')).saleState).toBe('OFF_SALE');
    expect(parseFilters(new URLSearchParams('sale=xyz')).saleState).toBe('FOR_SALE');
  });

  test('na aba Fora de venda "só agarrados" é desligado (leitura, URL e API)', () => {
    expect(parseFilters(new URLSearchParams('sale=off&stagnant=1')).stagnant).toBe(false);
    expect(toSearchString({ ...DEFAULT_FILTERS, saleState: 'OFF_SALE', stagnant: true })).toBe('sale=off');
    expect(toApiQuery({ ...DEFAULT_FILTERS, saleState: 'OFF_SALE', stagnant: true }).stagnantOnly).toBeUndefined();
  });

  test('a API recebe saleState só com o status Em estoque (com Vendidos ou Todos ela recusaria)', () => {
    expect(toApiQuery({ ...DEFAULT_FILTERS, saleState: 'OFF_SALE', search: '' }).saleState).toBe('OFF_SALE');
    expect(toApiQuery({ ...DEFAULT_FILTERS, status: 'ALL', saleState: 'OFF_SALE', search: '' }).saleState).toBeUndefined();
    expect(toApiQuery({ ...DEFAULT_FILTERS, status: 'VENDIDO', saleState: 'OFF_SALE', search: '' }).saleState).toBeUndefined();
  });

  test('a aba não conta como filtro ativo', () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, saleState: 'OFF_SALE', search: '' })).toBe(false);
  });
});

describe('adendos 2 e 3 da revisão 8.6/8.7', () => {
  test('"só agarrados" bloqueado só para vendidos e para a aba "Fora de venda" em estoque', () => {
    expect(isStagnantDisabled({ ...DEFAULT_FILTERS, saleState: 'OFF_SALE', search: '' })).toBe(true);
    expect(isStagnantDisabled({ ...DEFAULT_FILTERS, status: 'VENDIDO' })).toBe(true);
    expect(isStagnantDisabled({ ...DEFAULT_FILTERS, status: 'ALL', saleState: 'OFF_SALE', search: '' })).toBe(false);
    expect(isStagnantDisabled(DEFAULT_FILTERS)).toBe(false);
    expect(toApiQuery({ ...DEFAULT_FILTERS, status: 'ALL', saleState: 'OFF_SALE', stagnant: true }).stagnantOnly).toBe(true);
    expect(toApiQuery({ ...DEFAULT_FILTERS, saleState: 'OFF_SALE', stagnant: true }).stagnantOnly).toBeUndefined();
  });

  test('"Limpar filtros" preserva a aba ativa', () => {
    const dirty = { status: 'ALL', category: 'SKIN', stagnant: true, order: 'asc', saleState: 'OFF_SALE', search: '' } as const;
    expect(clearedFilters(dirty)).toEqual({ ...DEFAULT_FILTERS, saleState: 'OFF_SALE', search: '' });
    expect(clearedFilters({ ...dirty, saleState: 'FOR_SALE', search: '' })).toEqual(DEFAULT_FILTERS);
  });
});

describe('busca pelo nome (12.5b, ?q=)', () => {
  test('lê q da URL, apara e limita a 100 caracteres', () => {
    expect(parseFilters(new URLSearchParams('q=%20redline%20')).search).toBe('redline');
    expect(parseFilters(new URLSearchParams('')).search).toBe('');
    expect(parseFilters(new URLSearchParams(`q=${'a'.repeat(150)}`)).search).toHaveLength(100);
  });

  test('só entra na URL e na consulta da API com texto', () => {
    expect(toSearchString(DEFAULT_FILTERS)).toBe('');
    expect(toSearchString({ ...DEFAULT_FILTERS, search: '  ak 47 ' })).toBe('q=ak+47');
    expect(toApiQuery(DEFAULT_FILTERS).search).toBeUndefined();
    expect(toApiQuery({ ...DEFAULT_FILTERS, search: ' ak ' }).search).toBe('ak');
    expect(toGroupQuery({ ...DEFAULT_FILTERS, search: 'ak' }).search).toBe('ak');
  });

  test('ida e volta, filtro ativo e "Limpar filtros" apaga a busca', () => {
    const filters = { ...DEFAULT_FILTERS, search: 'ışık' };
    expect(parseFilters(new URLSearchParams(toSearchString(filters)))).toEqual(filters);
    expect(hasActiveFilters(filters)).toBe(true);
    expect(clearedFilters({ ...filters, saleState: 'OFF_SALE' })).toEqual({ ...DEFAULT_FILTERS, saleState: 'OFF_SALE' });
  });
});
