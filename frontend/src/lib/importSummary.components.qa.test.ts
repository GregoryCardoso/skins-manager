// 10.2 (D361), QA: bordas do resumo de importação com componentes e paridade pt-BR/en das chaves novas.
import { describe, expect, test } from 'vitest';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';
import { API_ERROR_CODES } from '@/i18n/errorCodes';
import type { ImportBatchCounts, ImportEntryView } from '@/types/api';
import { COUNT_LINES, componentWarningsOf, isNothingNew, summaryLines } from './importSummary';

const ZERO: ImportBatchCounts = {
  purchasesCreated: 0, salesCreated: 0, matched: 0, known: 0, beforeCutoff: 0, notTransferred: 0, review: 0, reverted: 0, failed: 0,
  unknownState: 0, deferredSales: 0, withoutPurchase: 0,
};

function entry(outcome: ImportEntryView['outcome'], display: Partial<ImportEntryView['display']> = {}): ImportEntryView {
  return {
    id: 1, batchId: 1, outcome, reasonCode: null, entityType: 'ITEM_PURCHASE', entityId: 5, candidateIds: [], resolution: null, resolvedAt: null,
    display: {
      direction: 'BUY', marketHashName: 'X', name: 'X', localizedName: null, imageUrl: null, catalogId: null, category: 'SKIN', variant: 'NORMAL',
      floatValue: null, paintSeed: null, phase: null, priceCents: 100, currency: 'USD', date: null, state: null, ...display,
    },
  };
}

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]);
}
const get = (obj: unknown, path: string): unknown => path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], obj);
const holders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe('isNothingNew e linhas do resumo com as contagens novas', () => {
  test('contagens ausentes (lote antigo) valem como zero, sem NaN', () => {
    const old = { ...ZERO } as ImportBatchCounts;
    expect(isNothingNew(old)).toBe(true);
    expect(Number.isNaN(Number(old.componentsFilled ?? 0))).toBe(false);
    expect(summaryLines(old)).toEqual([]);
  });

  test('componentsFilled com qualquer outra novidade: segue não sendo "nada novo"; componentsSkipped sozinho com nada novo continua "nada novo"', () => {
    expect(isNothingNew({ ...ZERO, componentsFilled: 1, matched: 0 })).toBe(false);
    expect(isNothingNew({ ...ZERO, componentsSkipped: 99, known: 5, beforeCutoff: 3 })).toBe(true);
    expect(isNothingNew({ ...ZERO, componentsSkipped: 1, purchasesCreated: 1 })).toBe(false);
  });

  test('as duas linhas aparecem só com contagem > 0 e uma única vez em COUNT_LINES', () => {
    expect(COUNT_LINES.filter((k) => k === 'componentsFilled')).toHaveLength(1);
    expect(COUNT_LINES.filter((k) => k === 'componentsSkipped')).toHaveLength(1);
    expect(summaryLines({ ...ZERO, componentsFilled: 0, componentsSkipped: 0 })).toEqual([]);
    expect(summaryLines({ ...ZERO, componentsSkipped: 1 })).toEqual([{ key: 'componentsSkipped', count: 1 }]);
  });

  test('toda chave de COUNT_LINES tem texto de contagem nos dois idiomas', () => {
    for (const key of COUNT_LINES) {
      expect(get(ptBR.imports.counts, key), `pt-BR ${key}`).toBeTruthy();
      expect(get(en.imports.counts, key), `en ${key}`).toBeTruthy();
    }
  });
});

describe('avisos de componentes por entrada', () => {
  test('só CREATED mostra os avisos; POSSIBLE_DUPLICATE, FAILED e os demais não, mesmo com avisos no display', () => {
    const warnings = [{ code: 'COMPONENT_LIMIT_EXCEEDED' as const, name: 'Sticker | X' }];
    for (const outcome of ['MATCHED', 'POSSIBLE_DUPLICATE', 'REVERTED', 'FAILED', 'WITHOUT_PURCHASE'] as const) {
      expect(componentWarningsOf(entry(outcome as ImportEntryView['outcome'], { componentWarnings: warnings }))).toEqual([]);
    }
    expect(componentWarningsOf(entry('CREATED', { componentWarnings: warnings }))).toEqual(warnings);
  });

  test('entrada CREATED sem `componentWarnings` (lote antigo) ou com lista vazia: nenhum aviso, sem erro', () => {
    expect(componentWarningsOf(entry('CREATED'))).toEqual([]);
    expect(componentWarningsOf(entry('CREATED', { componentWarnings: [] }))).toEqual([]);
  });

  test('aviso sem nome (nome vazio no trade) é aceito: o texto usa o rótulo de componente sem nome', () => {
    expect(componentWarningsOf(entry('CREATED', { componentWarnings: [{ code: 'COMPONENT_CATALOG_NOT_FOUND', name: null }] }))).toEqual([
      { code: 'COMPONENT_CATALOG_NOT_FOUND', name: null },
    ]);
    expect(ptBR.imports.componentUnnamed.trim()).not.toBe('');
    expect(en.imports.componentUnnamed.trim()).not.toBe('');
  });
});

describe('paridade das chaves de importação entre pt-BR e en', () => {
  const ptKeys = flatten(ptBR.imports as unknown as Record<string, unknown>).sort();
  const enKeys = flatten(en.imports as unknown as Record<string, unknown>).sort();

  test('o conjunto de chaves de `imports.*` é idêntico nos dois idiomas', () => {
    expect(enKeys).toEqual(ptKeys);
  });

  test('as chaves novas da 10.2 existem nos dois idiomas, não vazias, com os mesmos marcadores', () => {
    const keys = ptKeys.filter((k) => /component/i.test(k));
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const key of keys) {
      const pt = get(ptBR.imports, key) as string;
      const english = get(en.imports, key) as string;
      expect(typeof pt).toBe('string');
      expect(pt.trim(), `pt-BR ${key}`).not.toBe('');
      expect(english.trim(), `en ${key}`).not.toBe('');
      expect(holders(english), key).toEqual(holders(pt));
    }
  });

  test('COMPONENT_SLOT_TAKEN saiu de todos os lugares: sem chave i18n e fora da lista de erros', () => {
    expect(API_ERROR_CODES as readonly string[]).not.toContain('COMPONENT_SLOT_TAKEN');
    expect(JSON.stringify(ptBR)).not.toContain('COMPONENT_SLOT_TAKEN');
    expect(JSON.stringify(en)).not.toContain('COMPONENT_SLOT_TAKEN');
  });

  test('todo código de erro de componente da API tem mensagem nos dois idiomas', () => {
    for (const code of ['COMPONENTS_NOT_ALLOWED', 'COMPONENT_LIMIT_EXCEEDED', 'COMPONENT_CATALOG_REQUIRED', 'COMPONENT_CATALOG_MISMATCH', 'INVALID_COMPONENT_FIELD']) {
      expect(API_ERROR_CODES as readonly string[]).toContain(code);
      expect(get(ptBR.errors, code), `pt-BR ${code}`).toBeTruthy();
      expect(get(en.errors, code), `en ${code}`).toBeTruthy();
    }
  });

  test('a frase da confirmação da varredura existe nos dois idiomas e o texto de limite cita os números certos', () => {
    expect(ptBR.imports.fullScanConfirm.componentsNote.trim()).not.toBe('');
    expect(en.imports.fullScanConfirm.componentsNote.trim()).not.toBe('');
    expect(ptBR.imports.componentWarnings.COMPONENT_LIMIT_EXCEEDED).toMatch(/5/);
    expect(en.imports.componentWarnings.COMPONENT_LIMIT_EXCEEDED).toMatch(/5/);
  });
});
