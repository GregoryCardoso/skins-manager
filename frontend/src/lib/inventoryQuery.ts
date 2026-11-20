import type { Category, ItemListQuery, ItemStatus } from '@/types/api';

export type StatusFilter = ItemStatus | 'ALL';
export type CategoryFilter = Category | 'ALL';
export type AgeOrder = 'asc' | 'desc';

export interface InventoryFilters {
  status: StatusFilter;
  category: CategoryFilter;
  stagnant: boolean;
  order: AgeOrder;
}

export const DEFAULT_FILTERS: InventoryFilters = { status: 'EM_ESTOQUE', category: 'ALL', stagnant: false, order: 'desc' };

export const STATUS_FILTERS: readonly StatusFilter[] = ['EM_ESTOQUE', 'VENDIDO', 'ALL'];
export const CATEGORIES: readonly Category[] = [
  'SKIN', 'FACA', 'LUVA', 'CAIXA', 'CAPSULA', 'STICKER', 'PINGENTE', 'PERSONAGEM', 'PASSE_BATALHA', 'OUTRO',
];

interface ParamsReader {
  get(name: string): string | null;
}

// URL -> filtros. Valores inválidos são ignorados (voltam ao padrão).
export function parseFilters(params: ParamsReader): InventoryFilters {
  const status = params.get('status');
  const category = params.get('category');
  const order = params.get('order');
  const filters: InventoryFilters = {
    status: STATUS_FILTERS.includes(status as StatusFilter) ? (status as StatusFilter) : DEFAULT_FILTERS.status,
    category: CATEGORIES.includes(category as Category) ? (category as Category) : 'ALL',
    stagnant: params.get('stagnant') === '1',
    order: order === 'asc' || order === 'desc' ? order : DEFAULT_FILTERS.order,
  };
  if (filters.status === 'VENDIDO') filters.stagnant = false;
  return filters;
}

// Filtros -> query string (só o que difere do padrão; sem "?" inicial).
export function toSearchString(filters: InventoryFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== DEFAULT_FILTERS.status) params.set('status', filters.status);
  if (filters.category !== 'ALL') params.set('category', filters.category);
  if (filters.stagnant && filters.status !== 'VENDIDO') params.set('stagnant', '1');
  if (filters.order !== DEFAULT_FILTERS.order) params.set('order', filters.order);
  return params.toString();
}

// Filtros -> consulta da API. Agarrado só vale para itens em estoque.
export function toApiQuery(filters: InventoryFilters): ItemListQuery {
  const query: ItemListQuery = { order: filters.order };
  if (filters.status !== 'ALL') query.status = filters.status;
  if (filters.category !== 'ALL') query.category = filters.category;
  if (filters.stagnant && filters.status !== 'VENDIDO') query.stagnantOnly = true;
  return query;
}

export function hasActiveFilters(filters: InventoryFilters): boolean {
  return filters.status !== DEFAULT_FILTERS.status || filters.category !== 'ALL' || filters.stagnant;
}
