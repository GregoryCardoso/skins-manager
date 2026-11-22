import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';
import { inventoryCountText } from './inventoryCount';

const pt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const enT = (key: string, params?: Record<string, string | number>) => translate(en, key, params);

describe('inventoryCountText (revisão da 8.8, item 1)', () => {
  test.each([
    [0, 0, '0 itens', '0 items'],
    [1, 1, '1 item em 1 grupo', '1 item in 1 group'],
    [3, 1, '3 itens em 1 grupo', '3 items in 1 group'],
    [5, 2, '5 itens em 2 grupos', '5 items in 2 groups'],
  ])('agrupado: %i itens em %i grupos', (count, groups, ptText, enText) => {
    expect(inventoryCountText(count, groups, pt)).toBe(ptText);
    expect(inventoryCountText(count, groups, enT)).toBe(enText);
  });

  test.each([
    [0, '0 itens', '0 items'],
    [1, '1 item', '1 item'],
    [7, '7 itens', '7 items'],
  ])('individual: %i itens', (count, ptText, enText) => {
    expect(inventoryCountText(count, null, pt)).toBe(ptText);
    expect(inventoryCountText(count, null, enT)).toBe(enText);
  });

  test('a página usa a função (e não uma cópia da lógica)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const page = fs.readFileSync(path.join(__dirname, '..', 'app', 'page.tsx'), 'utf8');
    expect(page).toContain('inventoryCountText(groupsData.meta.count, groupsData.meta.groupCount, tLoose)');
    expect(page).toContain('inventoryCountText(data.meta.count, null, tLoose)');
    expect(page).not.toMatch(/tPlural\('inventory\.groupCount'/);
  });
});
