import { describe, expect, test } from 'vitest';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translatePlural } from './translate';
import { COUNT_LINES } from '@/lib/importSummary';

// 9.2: textos de importação com número usam o plural do projeto ({one, other} + {count}).
const KEYS = [
  ...COUNT_LINES.map((k) => `imports.counts.${k}`),
  'imports.page.pendingCount', 'imports.undo.bodyItems', 'imports.undo.bodyLinks', 'settings.integrations.csfloat.openEntries',
];

describe('plural dos textos da importação', () => {
  test.each(KEYS)('%s tem one/other com {count} nos dois idiomas, e 1 difere de 2', (key) => {
    for (const [messages, locale] of [[ptBR, 'pt-BR'], [en, 'en']] as const) {
      const one = translatePlural(messages, key, 1, locale);
      const other = translatePlural(messages, key, 2, locale);
      expect(one).not.toBe(key);
      expect(one).not.toMatch(/\{\w+\}/);
      expect(one).toContain('1');
      expect(other).toContain('2');
    }
  });
  test('exemplos', () => {
    expect(translatePlural(ptBR, 'imports.counts.purchasesCreated', 1, 'pt-BR')).toBe('1 compra importada');
    expect(translatePlural(ptBR, 'imports.counts.purchasesCreated', 4, 'pt-BR')).toBe('4 compras importadas');
    expect(translatePlural(en, 'imports.counts.purchasesCreated', 1, 'en')).toBe('1 purchase imported');
    expect(translatePlural(en, 'imports.counts.purchasesCreated', 3, 'en')).toBe('3 purchases imported');
  });
});
