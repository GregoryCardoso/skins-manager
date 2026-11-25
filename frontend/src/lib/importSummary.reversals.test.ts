// 9.4 (D301): ações das pendências, confirmação de "Remover lançamento" e textos das reversões.
import { describe, expect, test } from 'vitest';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';
import type { ImportEntryView } from '@/types/api';
import { COUNT_LINES, entryActions, removeConfirmKey, summaryLines } from './importSummary';

function entry(outcome: ImportEntryView['outcome'], extra: Partial<ImportEntryView> = {}): ImportEntryView {
  return {
    id: 1, batchId: 1, outcome, reasonCode: null, entityType: null, entityId: null, candidateIds: [], resolution: null, resolvedAt: null,
    display: {
      direction: 'BUY', marketHashName: 'X', name: 'X', localizedName: null, imageUrl: null, catalogId: null, category: 'SKIN', variant: 'NORMAL',
      floatValue: null, paintSeed: null, phase: null, priceCents: 100, currency: 'USD', date: null, state: null,
    },
    ...extra,
  };
}

const get = (obj: unknown, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);

describe('entryActions', () => {
  test('por resultado, só enquanto aberta', () => {
    expect(entryActions(entry('REVERTED'))).toEqual(['REMOVE', 'KEEP']);
    expect(entryActions(entry('POSSIBLE_DUPLICATE'))).toEqual(['CREATE', 'LINK', 'IGNORE']);
    expect(entryActions(entry('FAILED'))).toEqual(['IGNORE']);
    expect(entryActions(entry('UNKNOWN_STATE'))).toEqual(['IGNORE']);
    expect(entryActions(entry('CREATED'))).toEqual([]);
    expect(entryActions(entry('REVERTED', { resolution: 'KEPT' }))).toEqual([]);
  });
});

describe('confirmação de "Remover lançamento"', () => {
  test('compra, venda e lançamento manual ligado têm textos próprios nos dois idiomas', () => {
    const keys = [
      removeConfirmKey(entry('REVERTED', { entityType: 'ITEM_PURCHASE', linkKind: 'CREATED' })),
      removeConfirmKey(entry('REVERTED', { entityType: 'ITEM_PURCHASE', linkKind: 'MATCHED' })),
      removeConfirmKey(entry('REVERTED', { entityType: 'ITEM_SALE', linkKind: 'CREATED' })),
      removeConfirmKey(entry('REVERTED', { entityType: 'ITEM_SALE', linkKind: 'MATCHED' })),
    ];
    expect(keys).toEqual([
      'imports.actions.removeConfirm.purchase', 'imports.actions.removeConfirm.purchaseManual',
      'imports.actions.removeConfirm.sale', 'imports.actions.removeConfirm.saleManual',
    ]);
    for (const key of keys) {
      expect(typeof get(ptBR, key)).toBe('string');
      expect(typeof get(en, key)).toBe('string');
    }
  });
});

describe('textos da 9.4', () => {
  test('motivos de reversão, ações, conflito de compra vendida e "revertido antes de importar"', () => {
    for (const lang of [ptBR, en]) {
      for (const code of ['REVERTED_STATE_FAILED', 'REVERTED_OFFER_CHANGED', 'REVERTED_REFUND']) expect(get(lang, `imports.reasons.${code}`)).toBeTruthy();
      for (const action of ['REMOVE', 'KEEP', 'CREATE', 'LINK', 'IGNORE']) expect(get(lang, `imports.actions.${action}`)).toBeTruthy();
      expect(get(lang, 'imports.actions.conflict.ITEM_SOLD_IN_APP')).toBeTruthy();
      expect(get(lang, 'imports.counts.revertedBeforeImport.other')).toBeTruthy();
    }
    expect(ptBR.imports.actions.REMOVE).toBe('Remover lançamento');
    expect(ptBR.imports.groups.REVERTED).toBe('Trade revertido');
    expect(COUNT_LINES).toContain('revertedBeforeImport');
  });
  test('lote antigo sem a contagem nova não quebra o resumo', () => {
    const counts = {
      purchasesCreated: 1, salesCreated: 0, matched: 0, known: 0, beforeCutoff: 0, notTransferred: 0, review: 0, reverted: 0, failed: 0,
      unknownState: 0, deferredSales: 0, withoutPurchase: 0,
    };
    expect(summaryLines(counts)).toEqual([{ key: 'purchasesCreated', count: 1 }]);
  });
});
