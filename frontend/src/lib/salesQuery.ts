import type { SalesQuery, SalesSortBy } from '@/types/api';

export type SalesPeriod =
  | 'ALL' | 'LAST_7' | 'LAST_30' | 'LAST_90' | 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_YEAR' | 'CUSTOM';
export type SalesOrder = 'asc' | 'desc';

export interface SalesFilters {
  storeId: number | null;
  period: SalesPeriod;
  // Só valem com period === 'CUSTOM' ("YYYY-MM-DD"; qualquer lado pode faltar).
  from: string | null;
  to: string | null;
  sort: SalesSortBy;
  order: SalesOrder;
}

// Padrão (4B4-Q4): data da venda, mais recentes primeiro.
export const DEFAULT_SALES_FILTERS: SalesFilters = {
  storeId: null, period: 'ALL', from: null, to: null, sort: 'soldAt', order: 'desc',
};

export const SALES_PERIODS: readonly SalesPeriod[] = [
  'ALL', 'LAST_7', 'LAST_30', 'LAST_90', 'THIS_MONTH', 'LAST_MONTH', 'THIS_YEAR', 'CUSTOM',
];

interface ParamsReader {
  get(name: string): string | null;
}

const pad = (n: number, size = 2) => String(n).padStart(size, '0');
const toDayString = (year: number, month: number, day: number) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

// "YYYY-MM-DD" de calendário real; senão null.
export function parseDayString(value: string | null): string | null {
  if (value === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const ok = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return ok ? value : null;
}

const SP_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

// Dia civil de hoje em America/Sao_Paulo (a mesma referência do backend).
export function todayInSaoPaulo(now: Date): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(SP_FORMAT.formatToParts(now).map((p) => [p.type, Number(p.value)]));
  return { year: parts.year, month: parts.month, day: parts.day };
}

function shiftDays(day: { year: number; month: number; day: number }, delta: number): string {
  const d = new Date(Date.UTC(day.year, day.month - 1, day.day + delta));
  return toDayString(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// Intervalo do preset em dias de Brasília, ambos inclusivos. "Últimos N dias" = hoje e os N−1 anteriores.
export function periodRange(preset: SalesPeriod, now: Date): { from?: string; to?: string } {
  const today = todayInSaoPaulo(now);
  const todayStr = toDayString(today.year, today.month, today.day);
  switch (preset) {
    case 'LAST_7': return { from: shiftDays(today, -6), to: todayStr };
    case 'LAST_30': return { from: shiftDays(today, -29), to: todayStr };
    case 'LAST_90': return { from: shiftDays(today, -89), to: todayStr };
    case 'THIS_MONTH': return { from: toDayString(today.year, today.month, 1), to: todayStr };
    case 'LAST_MONTH': {
      const first = new Date(Date.UTC(today.year, today.month - 2, 1));
      const last = new Date(Date.UTC(today.year, today.month - 1, 0));
      return {
        from: toDayString(first.getUTCFullYear(), first.getUTCMonth() + 1, 1),
        to: toDayString(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate()),
      };
    }
    case 'THIS_YEAR': return { from: toDayString(today.year, 1, 1), to: todayStr };
    default: return {};
  }
}

// URL -> filtros. Valores inválidos voltam ao padrão.
export function parseSalesFilters(params: ParamsReader): SalesFilters {
  const storeRaw = params.get('store');
  const period = params.get('period');
  const sort = params.get('sort');
  const order = params.get('order');
  const filters: SalesFilters = { ...DEFAULT_SALES_FILTERS };
  if (storeRaw !== null && /^[1-9]\d{0,14}$/.test(storeRaw)) filters.storeId = Number(storeRaw);
  if (SALES_PERIODS.includes(period as SalesPeriod)) filters.period = period as SalesPeriod;
  if (sort === 'soldAt' || sort === 'turnaround') filters.sort = sort;
  filters.order = order === 'asc' || order === 'desc' ? order : defaultOrder(filters.sort);
  if (filters.period === 'CUSTOM') {
    const from = parseDayString(params.get('from'));
    const to = parseDayString(params.get('to'));
    if (from !== null && to !== null && from > to) {
      // Intervalo invertido é ignorado (volta a "Tudo").
      filters.period = 'ALL';
    } else {
      filters.from = from;
      filters.to = to;
    }
  }
  return filters;
}

export function defaultOrder(sort: SalesSortBy): SalesOrder {
  return sort === 'turnaround' ? 'asc' : 'desc';
}

// Filtros -> query string (só o que difere do padrão; sem "?").
export function toSalesSearchString(filters: SalesFilters): string {
  const params = new URLSearchParams();
  if (filters.storeId !== null) params.set('store', String(filters.storeId));
  if (filters.period !== 'ALL') params.set('period', filters.period);
  if (filters.period === 'CUSTOM') {
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
  }
  if (filters.sort !== DEFAULT_SALES_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.sort !== DEFAULT_SALES_FILTERS.sort || filters.order !== DEFAULT_SALES_FILTERS.order) {
    params.set('order', filters.order);
  }
  return params.toString();
}

// Filtros -> consulta da API. `now` fixa o "hoje" dos presets.
export function toSalesApiQuery(filters: SalesFilters, now: Date): SalesQuery {
  const range = filters.period === 'CUSTOM'
    ? { from: filters.from ?? undefined, to: filters.to ?? undefined }
    : periodRange(filters.period, now);
  const query: SalesQuery = { sortBy: filters.sort, order: filters.order };
  if (filters.storeId !== null) query.saleStoreId = filters.storeId;
  if (range.from) query.soldFrom = range.from;
  if (range.to) query.soldTo = range.to;
  return query;
}

export function hasActiveSalesFilters(filters: SalesFilters): boolean {
  return filters.storeId !== null || filters.period !== 'ALL';
}

// Opções do seletor único de ordenação.
export const SALES_SORT_OPTIONS: readonly { value: string; sort: SalesSortBy; order: SalesOrder; key: string }[] = [
  { value: 'soldAt:desc', sort: 'soldAt', order: 'desc', key: 'salesFilters.sortSoldAtDesc' },
  { value: 'soldAt:asc', sort: 'soldAt', order: 'asc', key: 'salesFilters.sortSoldAtAsc' },
  { value: 'turnaround:asc', sort: 'turnaround', order: 'asc', key: 'salesFilters.sortTurnaroundAsc' },
  { value: 'turnaround:desc', sort: 'turnaround', order: 'desc', key: 'salesFilters.sortTurnaroundDesc' },
];
