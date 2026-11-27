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
    expect(translate(ptBR, 'inventory.actions.offSale')).toBe('Mover para o holding');
    expect(translate(ptBR, 'inventory.actions.forSale')).toBe('Voltar para a venda');
    expect(translate(ptBR, 'inventory.tabs.offSale', { count: 3 })).toBe('Holding (3)');
    expect(translate(ptBR, 'inventory.offSaleConfirmMessage')).toContain('a contagem dos dias recomeça');
    expect(translate(en, 'inventory.tabs.forSale', { count: 2 })).toBe('For sale (2)');
  });
});

describe('invalidação das ações da 8.7.2', () => {
  test.each(['item.offSale', 'item.backOnSale'] as const)('%s invalida inventário, vendas e resumo do lucro real (8.9), sem saldos', async (action) => {
    const client = new QueryClient();
    const samples = [
      queryKeys.items.list({}), queryKeys.sales.list({}), queryKeys.stores.all, queryKeys.storeBalances.current, queryKeys.profitSummary.all,
    ];
    for (const key of samples) client.setQueryData(key, {});
    await invalidateAfter(client, action);
    expect(samples.map((key) => Boolean(client.getQueryState(key)?.isInvalidated))).toEqual([true, true, false, false, true]);
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
    // 12.5a: as ações por situação ficam em `lib/itemRowActions` (holding: voltar à venda; à venda: mover para o holding)
    const actions = read('lib/itemRowActions.ts');
    expect(actions).toMatch(/if \(holding\) return \{ primary: act\('forSale'\)/);
    expect(actions).toMatch(/return \{ primary: sell, menu: \[\.\.\.common, act\('offSale'\)/);
    expect(read('app/sales/page.tsx')).not.toMatch(/openOffSale|putForSale/);
  });

  test('as abas usam a contagem do backend (meta.saleStateCounts) e a célula de giro mostra "No holding desde"', () => {
    expect(read('app/page.tsx')).toContain('meta.saleStateCounts');
    expect(read('components/inventory/UnitCells.tsx')).toContain('offSaleSinceText');
    expect(read('components/ItemHistoryBox.tsx')).toContain('soldOffSaleCount');
  });
});
