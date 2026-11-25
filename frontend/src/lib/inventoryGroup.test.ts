import { readFileSync } from 'node:fs';
import path from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { DEFAULT_FILTERS, isGroupedAvailable, toApiQuery, toGroupQuery } from './inventoryQuery';
import { DEFAULT_INVENTORY_VIEW, INVENTORY_VIEW_STORAGE_KEY, readInventoryView, writeInventoryView } from './preferences';
import { invalidateAfter } from './queryInvalidation';
import { queryKeys } from './queryKeys';

// 8.8 (D276, D277, D282): consulta agrupada, chave de cache, preferência local e textos do "Holding".

describe('toGroupQuery / isGroupedAvailable', () => {
  test('sem status; saleState e ordem iguais à consulta individual', () => {
    const filters = { ...DEFAULT_FILTERS, category: 'SKIN' as const, stagnant: true, order: 'asc' as const };
    const query = toGroupQuery(filters);
    expect(query).toEqual({ order: 'asc', category: 'SKIN', stagnantOnly: true, saleState: 'FOR_SALE' });
    expect('status' in query).toBe(false);
    const { status: _status, ...individual } = toApiQuery(filters);
    expect(query).toEqual(individual);
  });

  test('aba Holding zera "só agarrados" e usa OFF_SALE', () => {
    expect(toGroupQuery({ ...DEFAULT_FILTERS, saleState: 'OFF_SALE', stagnant: true })).toEqual({ order: 'desc', saleState: 'OFF_SALE' });
  });

  test('agrupado só com o status "Em estoque"', () => {
    expect(isGroupedAvailable(DEFAULT_FILTERS)).toBe(true);
    expect(isGroupedAvailable({ ...DEFAULT_FILTERS, status: 'VENDIDO' })).toBe(false);
    expect(isGroupedAvailable({ ...DEFAULT_FILTERS, status: 'ALL' })).toBe(false);
  });
});

describe('queryKeys.items.groups', () => {
  test('fica sob o prefixo items e as ações de item a invalidam', async () => {
    expect(queryKeys.items.groups({ a: 1 })).toEqual(['items', 'groups', { a: 1 }]);
    for (const action of ['item.offSale', 'item.backOnSale', 'item.sell', 'item.delete'] as const) {
      const client = new QueryClient();
      client.setQueryData(queryKeys.items.groups({ a: 1 }), { ok: true });
      await invalidateAfter(client, action);
      expect(client.getQueryState(queryKeys.items.groups({ a: 1 }))?.isInvalidated, action).toBe(true);
    }
  });
});

describe('cache local da visão do inventário', () => {
  const store = (initial: Record<string, string> = {}) => {
    const data = { ...initial };
    return {
      data,
      getItem: (k: string) => (k in data ? data[k] : null),
      setItem: (k: string, v: string) => { data[k] = v; },
      removeItem: (k: string) => { delete data[k]; },
    };
  };

  test('ausente, inválido ou localStorage que lança -> GROUPED', () => {
    expect(DEFAULT_INVENTORY_VIEW).toBe('GROUPED');
    expect(readInventoryView(store())).toBe('GROUPED');
    expect(readInventoryView(store({ [INVENTORY_VIEW_STORAGE_KEY]: 'LIST' }))).toBe('GROUPED');
    const throwing = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => {} };
    expect(readInventoryView(throwing)).toBe('GROUPED');
    expect(() => writeInventoryView('INDIVIDUAL', throwing)).not.toThrow();
    expect(readInventoryView(null)).toBe('GROUPED');
  });

  test('grava e lê INDIVIDUAL', () => {
    const s = store();
    writeInventoryView('INDIVIDUAL', s);
    expect(s.data['sm.inventoryView']).toBe('INDIVIDUAL');
    expect(readInventoryView(s)).toBe('INDIVIDUAL');
  });
});

describe('textos do holding (D282)', () => {
  const collect = (node: unknown, out: string[] = []): string[] => {
    if (typeof node === 'string') out.push(node);
    else if (node && typeof node === 'object') Object.values(node).forEach((v) => collect(v, out));
    return out;
  };

  test('nenhum texto da interface usa os nomes antigos', () => {
    const old = /fora de venda|não está à venda|colocar à venda|not for sale|put up for sale|off sale|take off sale/i;
    for (const dict of [ptBR, en]) {
      for (const text of collect(dict)) expect(text, text).not.toMatch(old);
    }
  });

  test('textos novos', () => {
    expect(ptBR.inventory.actions.offSale).toBe('Mover para o holding');
    expect(ptBR.inventory.actions.forSale).toBe('Voltar para a venda');
    expect(ptBR.inventory.tabs.offSaleHint).toBe('Itens guardados esperando valorização.');
    expect(en.inventory.actions.offSale).toBe('Move to holding');
    expect(en.inventory.tabs.offSale).toBe('Holding ({count})');
    expect(ptBR.inventory.group.offSale).toBe('{count} no holding');
  });

  test('a página e o provider usam a visão agrupada e o cache', () => {
    const page = readFileSync(path.join(__dirname, '..', 'app', 'page.tsx'), 'utf8');
    expect(page).toContain('listItemGroups');
    expect(page).toMatch(/enabled: grouped/);
    expect(page).toMatch(/enabled: !grouped/);
    const files = ['components/InventoryGroupTable.tsx', 'components/InventoryViewToggle.tsx', 'components/InventoryUnitRow.tsx'];
    for (const f of files) expect(readFileSync(path.join(__dirname, '..', f), 'utf8').length).toBeGreaterThan(100);
  });
});
