import { describe, expect, test } from 'vitest';
import {
  DEFAULT_SALES_FILTERS, SALES_SORT_OPTIONS, hasActiveSalesFilters, parseDayString, parseSalesFilters, periodRange,
  toSalesApiQuery, toSalesSearchString, type SalesFilters,
} from './salesQuery';

const parse = (qs: string) => parseSalesFilters(new URLSearchParams(qs));

describe('salesQuery: lacunas QA 4B.4', () => {
  test('virada UTC x BRT: 2026-12-01T02:00Z ainda é 30/11 em Brasília', () => {
    const now = new Date('2026-12-01T02:00:00.000Z');
    expect(periodRange('THIS_MONTH', now)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodRange('LAST_MONTH', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('LAST_7', now)).toEqual({ from: '2026-11-24', to: '2026-11-30' });
  });

  test('virada de ano: 2027-01-01T02:59Z ainda é 2026; 03:00Z já é 2027', () => {
    expect(periodRange('THIS_YEAR', new Date('2027-01-01T02:59:59.999Z'))).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange('THIS_YEAR', new Date('2027-01-01T03:00:00.000Z'))).toEqual({ from: '2027-01-01', to: '2027-01-01' });
    expect(periodRange('LAST_MONTH', new Date('2027-01-01T03:00:00.000Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  test('janela atravessando meses e ano bissexto', () => {
    expect(periodRange('LAST_7', new Date('2026-01-03T15:00:00.000Z'))).toEqual({ from: '2025-12-28', to: '2026-01-03' });
    expect(periodRange('LAST_30', new Date('2028-03-10T15:00:00.000Z'))).toEqual({ from: '2028-02-10', to: '2028-03-10' });
    expect(periodRange('LAST_MONTH', new Date('2028-03-10T15:00:00.000Z'))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  test('1º dia do mês: este mês = só hoje', () => {
    expect(periodRange('THIS_MONTH', new Date('2026-11-01T15:00:00.000Z'))).toEqual({ from: '2026-11-01', to: '2026-11-01' });
  });

  test('parseDayString', () => {
    expect(parseDayString('2026-02-28')).toBe('2026-02-28');
    for (const bad of ['2026-02-30', '2026-1-5', '2026-11-17T10:00:00Z', '', 'abc', '2026-13-01']) {
      expect(parseDayString(bad)).toBeNull();
    }
    expect(parseDayString(null)).toBeNull();
    expect(parseDayString('2028-02-29')).toBe('2028-02-29');
    expect(parseDayString('2027-02-29')).toBeNull();
  });

  test('URL: só from, só to, store gigante/zerado, valores repetidos', () => {
    expect(parse('period=CUSTOM&from=2026-05-01')).toMatchObject({ period: 'CUSTOM', from: '2026-05-01', to: null });
    expect(parse('period=CUSTOM&to=2026-05-01')).toMatchObject({ period: 'CUSTOM', from: null, to: '2026-05-01' });
    expect(parse('period=CUSTOM')).toMatchObject({ period: 'CUSTOM', from: null, to: null });
    expect(parse('store=-1').storeId).toBeNull();
    expect(parse('store=1.5').storeId).toBeNull();
    expect(parse('store=01').storeId).toBeNull();
    expect(parse('store=1234567890123456789').storeId).toBeNull();
    expect(parse('store=1&store=2').storeId).toBe(1);
  });

  test('from/to sem period=CUSTOM são ignorados na leitura', () => {
    expect(parse('period=LAST_7&from=2026-01-01&to=2026-02-01')).toMatchObject({ period: 'LAST_7', from: null, to: null });
    expect(parse('from=2026-01-01')).toEqual(DEFAULT_SALES_FILTERS);
  });

  test('ida e volta de todas as combinações de sort/order e de todos os presets', () => {
    for (const opt of SALES_SORT_OPTIONS) {
      for (const period of ['ALL', 'LAST_7', 'LAST_30', 'LAST_90', 'THIS_MONTH', 'LAST_MONTH', 'THIS_YEAR'] as const) {
        const f: SalesFilters = { ...DEFAULT_SALES_FILTERS, storeId: 7, period, sort: opt.sort, order: opt.order };
        expect(parse(toSalesSearchString(f))).toEqual(f);
      }
    }
  });

  test('personalizado com um lado só faz ida e volta; from = to preservado', () => {
    for (const f of [
      { ...DEFAULT_SALES_FILTERS, period: 'CUSTOM' as const, from: '2026-05-01', to: null },
      { ...DEFAULT_SALES_FILTERS, period: 'CUSTOM' as const, from: null, to: '2026-05-01' },
      { ...DEFAULT_SALES_FILTERS, period: 'CUSTOM' as const, from: '2026-05-01', to: '2026-05-01' },
    ]) expect(parse(toSalesSearchString(f))).toEqual(f);
  });

  test('toSalesApiQuery: custom sem lados, from = to, preset ALL e hasActiveSalesFilters', () => {
    const now = new Date('2026-11-19T15:00:00.000Z');
    expect(toSalesApiQuery({ ...DEFAULT_SALES_FILTERS, period: 'CUSTOM' }, now)).toEqual({ sortBy: 'soldAt', order: 'desc' });
    expect(toSalesApiQuery({ ...DEFAULT_SALES_FILTERS, period: 'CUSTOM', from: '2026-05-01', to: '2026-05-01' }, now))
      .toEqual({ soldFrom: '2026-05-01', soldTo: '2026-05-01', sortBy: 'soldAt', order: 'desc' });
    expect(toSalesApiQuery({ ...DEFAULT_SALES_FILTERS, period: 'LAST_MONTH' }, new Date('2026-01-15T15:00:00.000Z')))
      .toEqual({ soldFrom: '2025-12-01', soldTo: '2025-12-31', sortBy: 'soldAt', order: 'desc' });
    expect(hasActiveSalesFilters(DEFAULT_SALES_FILTERS)).toBe(false);
    expect(hasActiveSalesFilters({ ...DEFAULT_SALES_FILTERS, storeId: 1 })).toBe(true);
    expect(hasActiveSalesFilters({ ...DEFAULT_SALES_FILTERS, period: 'LAST_7' })).toBe(true);
  });

  test('opções do seletor cobrem os 4 pares e ordem padrão primeiro', () => {
    expect(SALES_SORT_OPTIONS.map((o) => o.value)).toEqual(['soldAt:desc', 'soldAt:asc', 'turnaround:asc', 'turnaround:desc']);
  });
});
