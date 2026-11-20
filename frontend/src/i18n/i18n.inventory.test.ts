import { describe, expect, test } from 'vitest';
import en from './en.json';
import ptBR from './pt-BR.json';

function get(node: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), node);
}

// Valores dos tipos de src/types/api.ts (espelham o backend).
const ENUMS: Record<string, string[]> = {
  category: ['SKIN', 'FACA', 'LUVA', 'CAIXA', 'CAPSULA', 'STICKER', 'PINGENTE', 'PERSONAGEM', 'PASSE_BATALHA', 'OUTRO'],
  variant: ['NORMAL', 'STATTRAK', 'SOUVENIR'],
  exterior: ['FN', 'MW', 'FT', 'WW', 'BS'],
  exteriorShort: ['FN', 'MW', 'FT', 'WW', 'BS'],
  acquisitionType: ['GANHEI', 'COMPRA'],
  status: ['EM_ESTOQUE', 'VENDIDO'],
  agingBucket: ['RECENTE', 'EM_GIRO', 'AGARRADO'],
  turnaroundBucket: ['GIRO_RAPIDO', 'GIRO_NORMAL', 'DEMOROU_VENDER'],
};

const NEW_KEYS = [
  'common.dayCount.one', 'common.dayCount.other', 'common.approx', 'common.refresh',
  'inventory.title', 'inventory.count', 'inventory.refresh', 'inventory.empty', 'inventory.emptyFiltered', 'inventory.clearFilters',
  'inventory.loadError', 'inventory.primaryStore', 'inventory.otherStores', 'inventory.noPrice', 'inventory.ganhei',
  'inventory.informativeStore', 'inventory.legacy', 'inventory.sold', 'inventory.turnaround', 'inventory.inspect', 'inventory.inspectInvalid',
  ...['image', 'item', 'store', 'cost', 'days', 'tradeLock', 'minPrice', 'actions'].map((c) => `inventory.columns.${c}`),
  'filters.label', 'filters.status', 'filters.statusAll', 'filters.category', 'filters.categoryAll', 'filters.stagnantOnly',
  'filters.order', 'filters.orderDesc', 'filters.orderAsc',
  'tradeLock.locked', 'tradeLock.released', 'tradeLock.remaining', 'tradeLock.until',
  'tradeLock.units.d', 'tradeLock.units.h', 'tradeLock.units.min',
  'statusIndicator.online', 'statusIndicator.offline', 'statusIndicator.checking', 'statusIndicator.catalog',
  'statusIndicator.details', 'statusIndicator.close',
  'fx.label', 'fx.value', 'fx.notSet', 'fx.edit', 'fx.save', 'fx.cancel', 'fx.saving', 'fx.invalidInput',
];

describe.each([['pt-BR', ptBR], ['en', en]])('chaves da 4B.2 em %s', (_name, dict) => {
  for (const [group, values] of Object.entries(ENUMS)) {
    test(`enums.${group} cobre todos os valores`, () => {
      for (const value of values) {
        const text = get(dict, `enums.${group}.${value}`);
        expect(typeof text, `enums.${group}.${value}`).toBe('string');
        expect((text as string).trim(), `enums.${group}.${value}`).not.toBe('');
      }
    });

    test(`enums.${group} não tem chaves sobrando`, () => {
      expect(Object.keys(get(dict, `enums.${group}`) as object).sort()).toEqual([...values].sort());
    });
  }

  test('as chaves novas existem e não estão vazias', () => {
    for (const key of NEW_KEYS) {
      const text = get(dict, key);
      expect(typeof text, key).toBe('string');
      expect((text as string).trim(), key).not.toBe('');
    }
  });

  test('enums não tem grupos não previstos', () => {
    expect(Object.keys(get(dict, 'enums') as object).sort()).toEqual(Object.keys(ENUMS).sort());
  });

  test('placeholders esperados', () => {
    expect(get(dict, 'common.dayCount.one')).toContain('{count}');
    expect(get(dict, 'common.dayCount.other')).toContain('{count}');
    expect(get(dict, 'common.approx')).toContain('{value}');
    expect(get(dict, 'filters.stagnantOnly')).toContain('{days}');
    expect(get(dict, 'tradeLock.remaining')).toContain('{time}');
    expect(get(dict, 'tradeLock.until')).toContain('{date}');
    expect(get(dict, 'statusIndicator.catalog')).toContain('{total}');
    expect(get(dict, 'fx.value')).toContain('{rate}');
    expect(get(dict, 'inventory.count')).toContain('{count}');
  });
});
