// 9.5.1a (D332, D334): ação em lote da linha do grupo, quantidade digitada e textos.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';
import type { ItemGroup } from '@/types/api';
import { forSaleCount, groupBulkAction, holdingCount, parseBulkQuantity } from './bulkSaleState';

const group = (stock: Partial<ItemGroup['stock']>) =>
  ({ stock: { total: 0, forSale: 0, tradeLocked: 0, offSale: 0, nextUnlockAt: null, ...stock } }) as unknown as ItemGroup;

describe('groupBulkAction', () => {
  test('aba À venda: mover para o holding (à venda + em trade lock); aba Holding: voltar para a venda', () => {
    const recoil = group({ total: 80, forSale: 58, tradeLocked: 3, offSale: 19 });
    expect(forSaleCount(recoil)).toBe(61);
    expect(holdingCount(recoil)).toBe(19);
    expect(groupBulkAction(recoil, 'FOR_SALE')).toEqual({ direction: 'OFF_SALE', available: 61 });
    expect(groupBulkAction(recoil, 'OFF_SALE')).toEqual({ direction: 'FOR_SALE', available: 19 });
  });
  test('nada para mover: sem botão', () => {
    expect(groupBulkAction(group({ total: 2, offSale: 2 }), 'FOR_SALE')).toBeNull();
    expect(groupBulkAction(group({ total: 2, forSale: 2 }), 'OFF_SALE')).toBeNull();
  });
});

test('parseBulkQuantity: inteiro de 1 até o máximo', () => {
  expect(parseBulkQuantity('19', 61)).toBe(19);
  expect(parseBulkQuantity(' 61 ', 61)).toBe(61);
  for (const bad of ['0', '62', '1.5', '', 'abc', '-3']) expect(parseBulkQuantity(bad, 61)).toBeNull();
});

test('textos nos dois idiomas e a QTD com a divisão logo abaixo', () => {
  expect(ptBR.inventory.group.quantitySplit.replace('{forSale}', '61').replace('{holding}', '19')).toBe('61 à venda · 19 no holding');
  for (const lang of [ptBR, en]) {
    for (const key of ['offSaleButton', 'forSaleButton', 'quantity', 'whichOffSale', 'whichForSale', 'clearSelection'] as const) {
      expect(lang.inventory.bulk[key]).toBeTruthy();
    }
    expect((lang.errors as Record<string, string>).BULK_QUANTITY_EXCEEDS_AVAILABLE).toBeTruthy();
  }
  const table = fs.readFileSync(path.join(__dirname, '..', 'lib', 'inventoryColumns.tsx'), 'utf8');
  expect(table).toMatch(/inventory\.group\.quantitySplit/);
});
