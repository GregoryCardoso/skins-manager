import { describe, expect, test } from 'vitest';
import {
  DEFAULT_SALES_FILTERS, parseSalesFilters, periodRange, toSalesApiQuery, toSalesSearchString, type SalesFilters,
} from './salesQuery';

const parse = (qs: string) => parseSalesFilters(new URLSearchParams(qs));
const NOW = new Date('2026-11-19T15:00:00.000Z');

describe('parseSalesFilters / toSalesSearchString', () => {
  test('padrão: data da venda, mais recentes, tudo', () => {
    expect(parse('')).toEqual(DEFAULT_SALES_FILTERS);
    expect(toSalesSearchString(DEFAULT_SALES_FILTERS)).toBe('');
  });

  test('ida e volta', () => {
    const filters: SalesFilters = { storeId: 2, period: 'LAST_30', from: null, to: null, sort: 'turnaround', order: 'asc' };
    const qs = toSalesSearchString(filters);
    expect(qs).toBe('store=2&period=LAST_30&sort=turnaround&order=asc');
    expect(parse(qs)).toEqual(filters);
    const custom: SalesFilters = { ...DEFAULT_SALES_FILTERS, period: 'CUSTOM', from: '2026-01-05', to: '2026-02-01', order: 'asc' };
    expect(parse(toSalesSearchString(custom))).toEqual(custom);
  });

  test('ordem padrão depende do sort; soldAt asc é preservado', () => {
    expect(parse('sort=turnaround').order).toBe('asc');
    expect(parse('sort=soldAt&order=asc').order).toBe('asc');
    expect(toSalesSearchString({ ...DEFAULT_SALES_FILTERS, order: 'asc' })).toBe('order=asc');
    expect(parse('order=asc')).toEqual({ ...DEFAULT_SALES_FILTERS, order: 'asc' });
  });

  test('inválidos são ignorados', () => {
    expect(parse('store=abc&period=XYZ&sort=age&order=up')).toEqual(DEFAULT_SALES_FILTERS);
    expect(parse('store=0').storeId).toBeNull();
    expect(parse('period=CUSTOM&from=2026-02-30&to=x')).toMatchObject({ period: 'CUSTOM', from: null, to: null });
  });

  test('personalizado com from > to é ignorado', () => {
    expect(parse('period=CUSTOM&from=2026-05-02&to=2026-05-01')).toMatchObject({ period: 'ALL', from: null, to: null });
    expect(parse('period=CUSTOM&from=2026-05-01&to=2026-05-01')).toMatchObject({ period: 'CUSTOM', from: '2026-05-01' });
  });

  test('from/to fora do personalizado não vão para a URL', () => {
    expect(toSalesSearchString({ ...DEFAULT_SALES_FILTERS, period: 'LAST_7', from: '2026-01-01' })).toBe('period=LAST_7');
  });
});

describe('periodRange', () => {
  test('últimos N dias = hoje e N-1 anteriores', () => {
    expect(periodRange('LAST_7', NOW)).toEqual({ from: '2026-11-13', to: '2026-11-19' });
    expect(periodRange('LAST_30', NOW)).toEqual({ from: '2026-10-21', to: '2026-11-19' });
    expect(periodRange('LAST_90', NOW)).toEqual({ from: '2026-08-22', to: '2026-11-19' });
  });

  test('hoje em Brasília: 02:30Z ainda é o dia anterior', () => {
    expect(periodRange('LAST_7', new Date('2026-11-20T02:30:00.000Z')).to).toBe('2026-11-19');
    expect(periodRange('LAST_7', new Date('2026-11-20T03:00:00.000Z')).to).toBe('2026-11-20');
  });

  test('mês atual, mês passado e ano', () => {
    expect(periodRange('THIS_MONTH', NOW)).toEqual({ from: '2026-11-01', to: '2026-11-19' });
    expect(periodRange('LAST_MONTH', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('THIS_YEAR', NOW)).toEqual({ from: '2026-01-01', to: '2026-11-19' });
  });

  test('mês passado em janeiro e em março (fevereiro)', () => {
    expect(periodRange('LAST_MONTH', new Date('2026-01-15T15:00:00.000Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange('LAST_MONTH', new Date('2026-03-10T15:00:00.000Z'))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  test('tudo não tem limites', () => {
    expect(periodRange('ALL', NOW)).toEqual({});
  });
});

describe('toSalesApiQuery', () => {
  test('sempre envia sortBy e order; omite o que não existe', () => {
    expect(toSalesApiQuery(DEFAULT_SALES_FILTERS, NOW)).toEqual({ sortBy: 'soldAt', order: 'desc' });
  });

  test('loja e período preset', () => {
    expect(toSalesApiQuery({ ...DEFAULT_SALES_FILTERS, storeId: 3, period: 'THIS_MONTH' }, NOW)).toEqual({
      saleStoreId: 3, soldFrom: '2026-11-01', soldTo: '2026-11-19', sortBy: 'soldAt', order: 'desc',
    });
  });

  test('personalizado aceita só um lado', () => {
    expect(toSalesApiQuery({ ...DEFAULT_SALES_FILTERS, period: 'CUSTOM', from: '2026-05-01', sort: 'turnaround', order: 'asc' }, NOW))
      .toEqual({ soldFrom: '2026-05-01', sortBy: 'turnaround', order: 'asc' });
  });
});
