// 10.2 (D361): componentes na importação do CSFloat: contagens do resumo, "nada novo", avisos por entrada e textos nos dois idiomas.
import { describe, expect, test } from 'vitest';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';
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
      direction: 'BUY', marketHashName: 'X', name: 'X', namePtBr: null, imageUrl: null, catalogId: null, category: 'SKIN', variant: 'NORMAL',
      floatValue: null, paintSeed: null, phase: null, priceCents: 100, currency: 'USD', date: null, state: null, ...display,
    },
  };
}

describe('contagens de componentes no resumo', () => {
  test('as duas linhas vêm logo depois dos saques importados, na ordem fixa', () => {
    const order = COUNT_LINES.slice();
    expect(order.indexOf('componentsFilled')).toBe(order.indexOf('withdrawalsCreated') + 1);
    expect(order.indexOf('componentsSkipped')).toBe(order.indexOf('componentsFilled') + 1);
    expect(summaryLines({ ...ZERO, purchasesCreated: 1, componentsFilled: 3, componentsSkipped: 2, failed: 1 })).toEqual([
      { key: 'purchasesCreated', count: 1 },
      { key: 'componentsFilled', count: 3 },
      { key: 'componentsSkipped', count: 2 },
      { key: 'failed', count: 1 },
    ]);
  });

  test('lote antigo sem as contagens: nenhuma linha extra', () => {
    expect(summaryLines({ ...ZERO, matched: 1 }).map((l) => l.key)).toEqual(['matched']);
  });

  test('o resumo não diz "nada novo" se a varredura preencheu compras; componente não registrado sozinho só informa', () => {
    expect(isNothingNew({ ...ZERO, componentsFilled: 1 })).toBe(false);
    expect(isNothingNew({ ...ZERO, componentsSkipped: 4 })).toBe(true);
    expect(isNothingNew(ZERO)).toBe(true);
  });

  test('textos no plural, nos dois idiomas, com o marcador {count}', () => {
    for (const key of ['componentsFilled', 'componentsSkipped'] as const) {
      for (const lang of [ptBR, en]) {
        const text = lang.imports.counts[key] as { one: string; other: string };
        expect(text.one).toContain('{count}');
        expect(text.other).toContain('{count}');
      }
    }
  });
});

describe('avisos de componentes por entrada', () => {
  test('só as compras criadas mostram os avisos, na ordem em que vieram', () => {
    const warnings = [
      { code: 'COMPONENT_CATALOG_NOT_FOUND' as const, name: 'Sticker | Inventado' },
      { code: 'COMPONENT_FULLY_SCRAPED' as const, name: 'Sticker | Scavenger' },
    ];
    expect(componentWarningsOf(entry('CREATED', { componentWarnings: warnings }))).toEqual(warnings);
    expect(componentWarningsOf(entry('MATCHED', { componentWarnings: warnings }))).toEqual([]);
    expect(componentWarningsOf(entry('CREATED'))).toEqual([]);
  });

  test('cada código de aviso tem texto nos dois idiomas; os que citam o nome trazem {name}', () => {
    const codes = ['COMPONENT_CATALOG_NOT_FOUND', 'COMPONENT_FULLY_SCRAPED', 'COMPONENT_LIMIT_EXCEEDED', 'COMPONENTS_NOT_ALLOWED'] as const;
    for (const lang of [ptBR, en]) {
      const texts = lang.imports.componentWarnings as Record<string, string>;
      for (const code of codes) expect(texts[code]?.trim()).toBeTruthy();
      expect(texts.COMPONENT_CATALOG_NOT_FOUND).toContain('{name}');
      expect(texts.COMPONENT_FULLY_SCRAPED).toContain('{name}');
      expect(texts.COMPONENT_LIMIT_EXCEEDED).toContain('{name}');
      expect(lang.imports.componentWarningsTitle).toBeTruthy();
      expect(lang.imports.componentWarningsHint).toBeTruthy();
      expect(lang.imports.componentUnnamed).toBeTruthy();
    }
  });
});

describe('confirmação da "Varredura completa"', () => {
  test('a frase a mais explica que a varredura preenche stickers e chaveiro uma única vez, sem mexer nos manuais', () => {
    expect(ptBR.imports.fullScanConfirm.componentsNote).toMatch(/uma única vez/);
    expect(ptBR.imports.fullScanConfirm.componentsNote).toMatch(/sem mexer/);
    expect(en.imports.fullScanConfirm.componentsNote).toMatch(/once/);
    expect(en.imports.fullScanConfirm.componentsNote).toMatch(/without touching/);
  });
});
