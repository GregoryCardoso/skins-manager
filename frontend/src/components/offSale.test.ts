import { readFileSync } from 'node:fs';
import path from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';
import { invalidateAfter } from '@/lib/queryInvalidation';
import { queryKeys } from '@/lib/queryKeys';

// 8.7.2 (D266, D270): itens "fora de venda" no frontend.
const read = (rel: string) => readFileSync(path.join(__dirname, '..', rel), 'utf-8');

const KEYS = [
  'inventory.tabs.forSale', 'inventory.tabs.offSale', 'inventory.actions.offSale', 'inventory.actions.forSale',
  'inventory.offSaleConfirmTitle', 'inventory.offSaleConfirmMessage', 'inventory.offSaleSince', 'inventory.offSaleEmpty',
  'inventory.offSaleDone', 'inventory.forSaleDone', 'enums.agingBucket.FORA_DE_VENDA', 'enums.turnaroundBucket.SEM_GIRO',
  'history.soldOffSale.one', 'history.soldOffSale.other',
];
const holders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('chaves i18n do "fora de venda"', () => {
  test.each(KEYS)('%s existe nos dois idiomas com os mesmos {marcadores}', (key) => {
    const pt = translate(ptBR, key);
    const enText = translate(en, key);
    expect(pt).not.toBe(key);
    expect(enText).not.toBe(key);
    expect(holders(enText)).toEqual(holders(pt));
  });

  test('textos confirmados em D266', () => {
    expect(translate(ptBR, 'inventory.actions.offSale')).toBe('Não está à venda');
    expect(translate(ptBR, 'inventory.actions.forSale')).toBe('Colocar à venda');
    expect(translate(ptBR, 'inventory.tabs.offSale', { count: 3 })).toBe('Fora de venda (3)');
    expect(translate(ptBR, 'inventory.offSaleConfirmMessage')).toContain('a contagem de giro recomeça');
    expect(translate(en, 'inventory.tabs.forSale', { count: 2 })).toBe('For sale (2)');
  });
});

describe('invalidação das ações da 8.7.2', () => {
  test.each(['item.offSale', 'item.backOnSale'] as const)('%s invalida só inventário e vendas', async (action) => {
    const client = new QueryClient();
    const samples = [
      queryKeys.items.list({}), queryKeys.sales.list({}), queryKeys.stores.all, queryKeys.storeBalances.current, queryKeys.profitSummary.all,
    ];
    for (const key of samples) client.setQueryData(key, {});
    await invalidateAfter(client, action);
    expect(samples.map((key) => Boolean(client.getQueryState(key)?.isInvalidated))).toEqual([true, true, false, false, false]);
  });
});

describe('confirmação e botões', () => {
  test('"Não está à venda" abre o ConfirmDialog; "Colocar à venda" age direto, sem confirmação', () => {
    const dialogs = read('components/ItemDialogs.tsx');
    expect(dialogs).toMatch(/openOffSale: \(item\) => setDialog\(\{ kind: 'offSale', item \}\)/);
    expect(dialogs).toMatch(/dialog\?\.kind === 'offSale' && \(\s*<ConfirmDialog/);
    expect(dialogs).not.toMatch(/kind: 'forSale'/);
    expect(dialogs).toMatch(/putForSale = \(item: ItemView\) => \{[^}]*forSalePendingRef[\s\S]*?markItemForSale\(item\.id\)/);
    expect(dialogs).not.toMatch(/putForSale = \(item: ItemView\) => \{[^]*?setDialog\([^]*?markItemForSale/);
    expect(dialogs).toContain("invalidate('item.backOnSale')");
    expect(dialogs).toContain("'item.offSale'");
  });

  test('os botões só aparecem conforme o estado e não existem na página de vendas', () => {
    const actions = read('components/ItemActions.tsx');
    expect(actions).toMatch(/item\.saleState === 'FOR_SALE' && onOffSale/);
    expect(actions).toMatch(/item\.saleState === 'OFF_SALE' && onForSale/);
    expect(read('app/sales/page.tsx')).not.toMatch(/openOffSale|putForSale/);
  });

  test('as abas usam a contagem do backend (meta.saleStateCounts) e a célula de giro mostra "Fora de venda desde"', () => {
    expect(read('app/page.tsx')).toContain('data.meta.saleStateCounts');
    expect(read('components/InventoryTable.tsx')).toContain("t('inventory.offSaleSince'");
    expect(read('components/ItemHistoryBox.tsx')).toContain('soldOffSaleCount');
  });
});
