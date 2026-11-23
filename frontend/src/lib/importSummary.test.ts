import { describe, expect, test } from 'vitest';
import type { ImportBatchCounts, ImportEntryView } from '@/types/api';
import { entryLink, groupEntries, isNothingNew, parseItemParam, reasonKey, summaryLines } from './importSummary';

const ZERO: ImportBatchCounts = {
  purchasesCreated: 0, salesCreated: 0, matched: 0, known: 0, beforeCutoff: 0, notTransferred: 0, review: 0, reverted: 0, failed: 0,
  unknownState: 0, deferredSales: 0, withoutPurchase: 0,
};

function entry(id: number, outcome: ImportEntryView['outcome'], extra: Partial<ImportEntryView> = {}): ImportEntryView {
  return {
    id, batchId: 1, outcome, reasonCode: null, entityType: null, entityId: null, candidateIds: [], resolution: null, resolvedAt: null,
    display: {
      direction: 'BUY', marketHashName: 'X', name: 'X', namePtBr: null, imageUrl: null, catalogId: null, category: 'SKIN', variant: 'NORMAL',
      floatValue: null, paintSeed: null, phase: null, priceCents: 100, currency: 'USD', date: null, state: null,
    },
    ...extra,
  };
}

describe('summaryLines', () => {
  test('só as contagens maiores que zero, na ordem fixa', () => {
    const lines = summaryLines({ ...ZERO, known: 37, purchasesCreated: 4, beforeCutoff: 210, deferredSales: 12 });
    expect(lines).toEqual([
      { key: 'purchasesCreated', count: 4 },
      { key: 'deferredSales', count: 12 },
      { key: 'known', count: 37 },
      { key: 'beforeCutoff', count: 210 },
    ]);
  });
  test('tudo zero: nenhuma linha', () => {
    expect(summaryLines(ZERO)).toEqual([]);
  });
});

describe('isNothingNew', () => {
  test('já importadas, antes do corte, não transferidas e vendas adiadas não contam como novidade', () => {
    expect(isNothingNew({ ...ZERO, known: 5, beforeCutoff: 9, notTransferred: 2, deferredSales: 3 })).toBe(true);
  });
  test.each(['purchasesCreated', 'matched', 'review', 'reverted', 'failed', 'unknownState'] as const)('%s > 0 é novidade', (key) => {
    expect(isNothingNew({ ...ZERO, [key]: 1 })).toBe(false);
  });
});

describe('groupEntries', () => {
  test('agrupa por resultado, omite grupos vazios, põe as pendências antes e junta estado desconhecido em "Não importadas"', () => {
    const groups = groupEntries([
      entry(1, 'CREATED'), entry(2, 'FAILED'), entry(3, 'UNKNOWN_STATE'), entry(4, 'POSSIBLE_DUPLICATE'), entry(5, 'MATCHED'), entry(6, 'REVERTED'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['POSSIBLE_DUPLICATE', 'REVERTED', 'FAILED', 'CREATED', 'MATCHED']);
    expect(groups.find((g) => g.key === 'FAILED')?.entries.map((e) => e.id)).toEqual([2, 3]);
    expect(groupEntries([])).toEqual([]);
  });
});

describe('reasonKey e entryLink', () => {
  test('chave i18n do motivo; sem motivo, nulo', () => {
    expect(reasonKey(entry(1, 'FAILED', { reasonCode: 'CATALOG_NOT_FOUND' }))).toBe('imports.reasons.CATALOG_NOT_FOUND');
    expect(reasonKey(entry(1, 'CREATED'))).toBeNull();
  });
  test('link da compra no inventário; aporte/saque (9.6) no lucro real; sem lançamento, nenhum', () => {
    expect(entryLink(entry(1, 'CREATED', { entityType: 'ITEM_PURCHASE', entityId: 55 }))).toBe('/?item=55');
    expect(entryLink(entry(1, 'FAILED'))).toBeNull();
    expect(entryLink(entry(1, 'CREATED', { entityType: 'DEPOSIT', entityId: 3 }))).toBe('/profit');
  });
});

describe('parseItemParam', () => {
  test('inteiro positivo ou nulo', () => {
    expect(parseItemParam('55')).toBe(55);
    for (const bad of [null, undefined, '', '0', '-1', '1.5', 'abc', '12abc', '99999999999999999']) expect(parseItemParam(bad)).toBeNull();
  });
});
