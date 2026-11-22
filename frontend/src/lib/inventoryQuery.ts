import type { Category, ItemListQuery, ItemStatus, SaleState } from '@/types/api';

export type StatusFilter = ItemStatus | 'ALL';
export type CategoryFilter = Category | 'ALL';
export type AgeOrder = 'asc' | 'desc';

export interface InventoryFilters {
  status: StatusFilter;
  category: CategoryFilter;
  stagnant: boolean;
  order: AgeOrder;
  // Aba do inventário (D266): à venda (padrão) ou fora de venda. Só vale com o status "Em estoque".
  saleState: SaleState;
}

export const DEFAULT_FILTERS: InventoryFilters = { status: 'EM_ESTOQUE', category: 'ALL', stagnant: false, order: 'desc', saleState: 'FOR_SALE' };

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
    saleState: params.get('sale') === 'off' ? 'OFF_SALE' : 'FOR_SALE',
  };
  if (filters.status === 'VENDIDO' || filters.saleState === 'OFF_SALE') filters.stagnant = false;
  return filters;
}

// Filtros -> query string (só o que difere do padrão; sem "?" inicial).
export function toSearchString(filters: InventoryFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== DEFAULT_FILTERS.status) params.set('status', filters.status);
  if (filters.category !== 'ALL') params.set('category', filters.category);
  if (filters.stagnant && filters.status !== 'VENDIDO' && filters.saleState !== 'OFF_SALE') params.set('stagnant', '1');
  if (filters.saleState === 'OFF_SALE') params.set('sale', 'off');
  if (filters.order !== DEFAULT_FILTERS.order) params.set('order', filters.order);
  return params.toString();
}

// Filtros -> consulta da API. Agarrado só vale para itens em estoque à venda; `saleState` só com o status "Em estoque"
// (com vendidos a API recusa o filtro).
export function toApiQuery(filters: InventoryFilters): ItemListQuery {
  const query: ItemListQuery = { order: filters.order };
  if (filters.status !== 'ALL') query.status = filters.status;
  if (filters.category !== 'ALL') query.category = filters.category;
  if (filters.stagnant && !isStagnantDisabled(filters)) query.stagnantOnly = true;
  if (filters.status === 'EM_ESTOQUE') query.saleState = filters.saleState;
  return query;
}

// "Só agarrados" fica bloqueado para vendidos e só na aba "Fora de venda" com o status "Em estoque"
// (a aba só vale com esse status; adendo 2 da revisão 8.6/8.7).
export function isStagnantDisabled(filters: InventoryFilters): boolean {
  return filters.status === 'VENDIDO' || (filters.status === 'EM_ESTOQUE' && filters.saleState === 'OFF_SALE');
}

// "Limpar filtros" volta ao padrão, mas preserva a aba ativa (adendo 3 da revisão 8.6/8.7).
export function clearedFilters(filters: InventoryFilters): InventoryFilters {
  return { ...DEFAULT_FILTERS, saleState: filters.saleState };
}

export function hasActiveFilters(filters: InventoryFilters): boolean {
  return filters.status !== DEFAULT_FILTERS.status || filters.category !== 'ALL' || filters.stagnant;
}
