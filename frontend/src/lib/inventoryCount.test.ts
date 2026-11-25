import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate, translatePlural } from '@/i18n/translate';
import { inventoryCountText } from './inventoryCount';

const pt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const enT = (key: string, params?: Record<string, string | number>) => translate(en, key, params);
const ptP = (key: string, count: number, params?: Record<string, string | number>) => translatePlural(ptBR, key, count, 'pt-BR', params);
const enP = (key: string, count: number, params?: Record<string, string | number>) => translatePlural(en, key, count, 'en', params);

describe('inventoryCountText (revisão da 8.8, item 1; plural da 11.6)', () => {
  test.each([
    [0, 0, 'Nenhum item', 'No items'],
    [1, 1, '1 item em 1 grupo', '1 item in 1 group'],
    [3, 1, '3 itens em 1 grupo', '3 items in 1 group'],
    [5, 2, '5 itens em 2 grupos', '5 items in 2 groups'],
  ])('agrupado: %i itens em %i grupos', (count, groups, ptText, enText) => {
    expect(inventoryCountText(count, groups, pt, ptP)).toBe(ptText);
    expect(inventoryCountText(count, groups, enT, enP)).toBe(enText);
  });

  test.each([
    [0, 'Nenhum item', 'No items'],
    [1, '1 item', '1 item'],
    [7, '7 itens', '7 items'],
  ])('individual: %i itens', (count, ptText, enText) => {
    expect(inventoryCountText(count, null, pt, ptP)).toBe(ptText);
    expect(inventoryCountText(count, null, enT, enP)).toBe(enText);
  });

  test('a ordem das duas partes vem do idioma (countInGroups) e sobe no russo com few/many', () => {
    const RU = {
      inventory: {
        itemCount: { one: '{count} предмет', few: '{count} предмета', many: '{count} предметов', other: '{count} предмета' },
        groupsCount: { one: '{count} группа', few: '{count} группы', many: '{count} групп', other: '{count} группы' },
        countInGroups: '{groups}: {items}',
      },
    };
    const ruP = (key: string, count: number) => translatePlural(RU, key, count, 'ru');
    const ruT = (key: string, params?: Record<string, string | number>) => translate(RU, key, params);
    expect(inventoryCountText(5, 2, ruT, ruP)).toBe('2 группы: 5 предметов');
  });

  test('a página usa a função (e não uma cópia da lógica)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const page = fs.readFileSync(path.join(__dirname, '..', 'app', 'page.tsx'), 'utf8');
    expect(page).toContain('inventoryCountText(groupsData.meta.count, groupsData.meta.groupCount, tLoose, tPlural)');
    expect(page).toContain('inventoryCountText(data.meta.count, null, tLoose, tPlural)');
    expect(page).not.toMatch(/tPlural\('inventory\.groupCount'/);
  });
});
