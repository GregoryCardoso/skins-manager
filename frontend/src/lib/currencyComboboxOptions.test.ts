import { describe, expect, test } from 'vitest';
import { CURRENCIES, CURRENCY_GROUP_IDS, CURRENCY_GROUPS, CURRENCY_PINNED, currencyComboboxOptions } from './currencies';

describe('currencyComboboxOptions (12.3a)', () => {
  const options = currencyComboboxOptions('en');

  test('as 42 moedas, cada uma em exatamente um grupo', () => {
    expect(options).toHaveLength(42);
    expect(options.map((o) => o.value).sort()).toEqual([...CURRENCIES].sort());
    const all = CURRENCY_GROUP_IDS.flatMap((id) => CURRENCY_GROUPS[id]);
    expect(new Set(all).size).toBe(all.length);
    for (const option of options) expect(CURRENCY_GROUPS[option.group]).toContain(option.value);
  });

  test('dentro de cada grupo, ordem pelo código', () => {
    for (const id of CURRENCY_GROUP_IDS) {
      const codes = options.filter((o) => o.group === id).map((o) => o.value);
      expect(codes).toEqual([...codes].sort());
    }
  });

  test('USD, BRL e EUR fixados; busca por código e nome em inglês', () => {
    expect([...CURRENCY_PINNED]).toEqual(['USD', 'BRL', 'EUR']);
    const brl = currencyComboboxOptions('pt-BR').find((o) => o.value === 'BRL');
    expect(brl?.keywords).toContain('BRL');
    expect(brl?.keywords.some((k) => /real/i.test(k))).toBe(true);
  });
});
