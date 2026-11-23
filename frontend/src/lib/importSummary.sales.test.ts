// 9.3 (D299, D300): vendas importadas no resumo e nas pendências.
import { describe, expect, test } from 'vitest';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';
import type { ImportBatchCounts, ImportEntryView } from '@/types/api';
import { COUNT_LINES, entryLink, entryLinkLabelKey, groupEntries, isNothingNew, summaryLines } from './importSummary';

const ZERO: ImportBatchCounts = {
  purchasesCreated: 0, salesCreated: 0, matched: 0, known: 0, beforeCutoff: 0, notTransferred: 0, review: 0, reverted: 0, failed: 0,
  unknownState: 0, deferredSales: 0, withoutPurchase: 0,
};

function entry(id: number, outcome: ImportEntryView['outcome'], extra: Partial<ImportEntryView> = {}): ImportEntryView {
  return {
    id, batchId: 1, outcome, reasonCode: null, entityType: null, entityId: null, candidateIds: [], resolution: null, resolvedAt: null,
    display: {
      direction: 'SELL', marketHashName: 'X', name: 'X', namePtBr: null, imageUrl: null, catalogId: null, category: 'SKIN', variant: 'NORMAL',
      floatValue: null, paintSeed: null, phase: null, priceCents: 100, currency: 'USD', date: null, state: null,
    },
    ...extra,
  };
}

describe('contagens das vendas', () => {
  test('vendas importadas logo depois das compras; "venda sem compra no app" antes das falhas', () => {
    expect(summaryLines({ ...ZERO, purchasesCreated: 1, salesCreated: 2, withoutPurchase: 3, failed: 4 })).toEqual([
      { key: 'purchasesCreated', count: 1 },
      { key: 'salesCreated', count: 2 },
      { key: 'withoutPurchase', count: 3 },
      { key: 'failed', count: 4 },
    ]);
  });
  test('venda importada e venda sem compra no app são novidade', () => {
    expect(isNothingNew({ ...ZERO, salesCreated: 1 })).toBe(false);
    expect(isNothingNew({ ...ZERO, withoutPurchase: 1 })).toBe(false);
  });
  test('toda linha de contagem tem texto nos dois idiomas', () => {
    for (const key of COUNT_LINES) {
      expect((ptBR.imports.counts as Record<string, unknown>)[key]).toBeTruthy();
      expect((en.imports.counts as Record<string, unknown>)[key]).toBeTruthy();
    }
  });
});

describe('grupo "Venda sem compra no app"', () => {
  test('FAILED com PURCHASE_NOT_FOUND tem grupo próprio, antes das outras falhas', () => {
    const groups = groupEntries([
      entry(1, 'FAILED', { reasonCode: 'CATALOG_NOT_FOUND' }),
      entry(2, 'FAILED', { reasonCode: 'PURCHASE_NOT_FOUND' }),
      entry(3, 'CREATED', { entityType: 'ITEM_SALE', entityId: 9 }),
    ]);
    expect(groups.map((g) => [g.key, g.entries.map((e) => e.id)])).toEqual([
      ['WITHOUT_PURCHASE', [2]],
      ['FAILED', [1]],
      ['CREATED', [3]],
    ]);
    expect(ptBR.imports.groups.WITHOUT_PURCHASE).toBe('Venda sem compra no app');
    expect(en.imports.groups.WITHOUT_PURCHASE).toBeTruthy();
  });
  test('motivos novos com texto nos dois idiomas; FEE_MISMATCH mostra as duas taxas', () => {
    for (const code of ['PURCHASE_NOT_FOUND', 'SALE_TX_NOT_FOUND', 'FEE_MISMATCH', 'FEE_INCONSISTENT', 'ITEM_TRADE_LOCKED']) {
      expect((ptBR.imports.reasons as Record<string, string>)[code]).toBeTruthy();
      expect((en.imports.reasons as Record<string, string>)[code]).toBeTruthy();
    }
    expect(ptBR.imports.reasons.PURCHASE_NOT_FOUND).toBe('Lance a compra deste item à mão; a próxima importação registra a venda.');
    for (const text of [ptBR.imports.reasons.FEE_MISMATCH, en.imports.reasons.FEE_MISMATCH]) {
      expect(text).toContain('{fee}');
      expect(text).toContain('{expected}');
    }
  });
});

describe('link da venda', () => {
  test('venda vai para a página de vendas; compra (inclusive a unidade em trade lock) para o inventário', () => {
    const sale = entry(1, 'CREATED', { entityType: 'ITEM_SALE', entityId: 9 });
    expect(entryLink(sale)).toBe('/sales?item=9');
    expect(entryLinkLabelKey(sale)).toBe('imports.seeInSales');
    const locked = entry(2, 'FAILED', { reasonCode: 'ITEM_TRADE_LOCKED', entityType: 'ITEM_PURCHASE', entityId: 4 });
    expect(entryLink(locked)).toBe('/?item=4');
    expect(entryLinkLabelKey(locked)).toBe('imports.seeInInventory');
    expect(entryLink(entry(3, 'FAILED', { reasonCode: 'PURCHASE_NOT_FOUND' }))).toBeNull();
  });
});
