import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { API_ERROR_CODES } from '@/i18n/errorCodes';
import { translate, translatePlural } from '@/i18n/translate';
import { DEFAULT_FILTERS, isGroupedAvailable, parseFilters, toApiQuery, toGroupQuery, type InventoryFilters } from './inventoryQuery';
import {
  DEFAULT_INVENTORY_VIEW, INVENTORY_VIEW_STORAGE_KEY, isInventoryView, readInventoryView, writeInventoryView,
} from './preferences';
import { INVALIDATION_MAP, invalidateAfter, type InvalidationAction } from './queryInvalidation';
import { queryKeys } from './queryKeys';

// QA 8.8: bordas da visão agrupada no frontend (D276, D277, D278, D282).

const filters = (extra: Partial<InventoryFilters> = {}): InventoryFilters => ({ ...DEFAULT_FILTERS, ...extra });

function flatten(node: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[full] = value;
    else Object.assign(out, flatten(value, full));
  }
  return out;
}
const pt = flatten(ptBR);
const enFlat = flatten(en);
const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('cache local da visão (bordas)', () => {
  const store = (initial: Record<string, string> = {}) => {
    const data: Record<string, string> = { ...initial };
    return {
      data,
      getItem: (k: string) => (k in data ? data[k] : null),
      setItem: (k: string, v: string) => { data[k] = v; },
      removeItem: (k: string) => { delete data[k]; },
    };
  };

  test('usa a chave sm.inventoryView e o padrão GROUPED', () => {
    expect(INVENTORY_VIEW_STORAGE_KEY).toBe('sm.inventoryView');
    expect(DEFAULT_INVENTORY_VIEW).toBe('GROUPED');
  });

  test.each(['', ' ', 'grouped', 'individual', 'LIST', 'GROUPED ', ' INDIVIDUAL', 'null', 'undefined', '1', '{}'])(
    'valor inválido %j no cache -> GROUPED',
    (value) => {
      expect(readInventoryView(store({ [INVENTORY_VIEW_STORAGE_KEY]: value }))).toBe('GROUPED');
    }
  );

  test('getItem que devolve não-string (objeto/número/undefined) -> GROUPED', () => {
    for (const weird of [undefined, 0, 1, {}, [], true]) {
      const s = { getItem: () => weird as unknown as string, setItem: () => {}, removeItem: () => {} };
      expect(readInventoryView(s)).toBe('GROUPED');
    }
  });

  test('só getItem lança / só setItem lança: nunca propaga', () => {
    const onlyGet = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => {}, removeItem: () => {} };
    const onlySet = { getItem: () => 'INDIVIDUAL', setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => {} };
    expect(readInventoryView(onlyGet)).toBe('GROUPED');
    expect(() => writeInventoryView('GROUPED', onlyGet)).not.toThrow();
    expect(() => writeInventoryView('INDIVIDUAL', onlySet)).not.toThrow();
    expect(readInventoryView(onlySet)).toBe('INDIVIDUAL');
  });

  test('storage nulo (sem localStorage): ler -> GROUPED, gravar não lança', () => {
    expect(readInventoryView(null)).toBe('GROUPED');
    expect(() => writeInventoryView('INDIVIDUAL', null)).not.toThrow();
  });

  test('ida e volta GROUPED <-> INDIVIDUAL e não mexe em outras chaves', () => {
    const s = store({ 'sm.theme': 'DARK', 'sm.language': 'en' });
    const before = { ...s.data };
    writeInventoryView('INDIVIDUAL', s);
    expect(readInventoryView(s)).toBe('INDIVIDUAL');
    writeInventoryView('GROUPED', s);
    expect(readInventoryView(s)).toBe('GROUPED');
    const { [INVENTORY_VIEW_STORAGE_KEY]: _ignored, ...rest } = s.data;
    expect(rest).toEqual(before);
  });

  test('isInventoryView só aceita os dois valores', () => {
    expect(isInventoryView('GROUPED')).toBe(true);
    expect(isInventoryView('INDIVIDUAL')).toBe(true);
    for (const v of [null, undefined, '', 'LIST', 'grouped', 1, {}]) expect(isInventoryView(v)).toBe(false);
  });
});

describe('toGroupQuery / isGroupedAvailable (bordas)', () => {
  test('nunca inclui status, para qualquer filtro de status', () => {
    for (const status of ['EM_ESTOQUE', 'VENDIDO', 'ALL'] as const) {
      expect('status' in toGroupQuery(filters({ status }))).toBe(false);
    }
  });

  test('com status VENDIDO/ALL a consulta agrupada ainda é válida para o backend (saleState e order)', () => {
    // a página nem faz a consulta agrupada nesses casos (enabled), mas a função não pode vazar status
    expect(toGroupQuery(filters({ status: 'VENDIDO' }))).toMatchObject({ order: 'desc', saleState: 'FOR_SALE' });
  });

  test('cada categoria vai na consulta; ALL não vai', () => {
    expect(toGroupQuery(filters({ category: 'FACA' })).category).toBe('FACA');
    expect('category' in toGroupQuery(filters({ category: 'ALL' }))).toBe(false);
  });

  test('order asc/desc e stagnant', () => {
    expect(toGroupQuery(filters({ order: 'asc' })).order).toBe('asc');
    expect(toGroupQuery(filters({ stagnant: true })).stagnantOnly).toBe(true);
    expect('stagnantOnly' in toGroupQuery(filters({ stagnant: false }))).toBe(false);
  });

  test('stagnant na aba holding é descartado (a API aceitaria, mas a UI zera)', () => {
    expect('stagnantOnly' in toGroupQuery(filters({ saleState: 'OFF_SALE', stagnant: true }))).toBe(false);
    expect(toGroupQuery(filters({ saleState: 'OFF_SALE' })).saleState).toBe('OFF_SALE');
  });

  test('não muta os filtros recebidos e equivale à consulta individual sem status', () => {
    const f = filters({ category: 'SKIN', stagnant: true, order: 'asc' });
    const copy = { ...f };
    const { status: _s, ...individual } = toApiQuery(f);
    expect(toGroupQuery(f)).toEqual(individual);
    expect(f).toEqual(copy);
  });

  test('isGroupedAvailable independe de categoria, ordem, agarrados e aba', () => {
    expect(isGroupedAvailable(filters({ category: 'SKIN', stagnant: true, order: 'asc', saleState: 'OFF_SALE' }))).toBe(true);
    expect(isGroupedAvailable(filters({ status: 'VENDIDO', saleState: 'OFF_SALE' }))).toBe(false);
  });

  test('URL com status=vendido via parseFilters desabilita o agrupado; URL padrão habilita', () => {
    expect(isGroupedAvailable(parseFilters(new URLSearchParams('status=VENDIDO')))).toBe(false);
    expect(isGroupedAvailable(parseFilters(new URLSearchParams('status=ALL')))).toBe(false);
    expect(isGroupedAvailable(parseFilters(new URLSearchParams('')))).toBe(true);
    expect(isGroupedAvailable(parseFilters(new URLSearchParams('status=lixo')))).toBe(true);
  });
});

describe('queryKeys.items.groups e o mapa de invalidação', () => {
  const usesItemsPrefix = (action: InvalidationAction) => {
    const entry = INVALIDATION_MAP[action] as readonly (readonly unknown[])[] | 'clear';
    return entry === 'clear' || entry.some((k) => k[0] === 'items' && k.length === 1);
  };

  test('a chave de grupos e a da lista compartilham o prefixo items e não colidem entre si', () => {
    const q = { order: 'desc' };
    expect(queryKeys.items.groups(q)[0]).toBe(queryKeys.items.all[0]);
    expect(queryKeys.items.list(q)[0]).toBe(queryKeys.items.all[0]);
    expect(queryKeys.items.groups(q)).not.toEqual(queryKeys.items.list(q));
    expect(queryKeys.items.groups({ saleState: 'FOR_SALE' })).not.toEqual(queryKeys.items.groups({ saleState: 'OFF_SALE' }));
  });

  test.each(Object.keys(INVALIDATION_MAP) as InvalidationAction[])('%s: invalida os grupos se e somente se invalida itens', async (action) => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.items.groups({ a: 1 }), { ok: true });
    client.setQueryData(queryKeys.items.list({ a: 1 }), { ok: true });
    await invalidateAfter(client, action);
    const groupsGone = client.getQueryState(queryKeys.items.groups({ a: 1 })) === undefined;
    const groupsInvalid = client.getQueryState(queryKeys.items.groups({ a: 1 }))?.isInvalidated === true;
    const listGone = client.getQueryState(queryKeys.items.list({ a: 1 })) === undefined;
    const listInvalid = client.getQueryState(queryKeys.items.list({ a: 1 }))?.isInvalidated === true;
    // grupos e lista sempre andam juntos
    expect(groupsGone || groupsInvalid).toBe(listGone || listInvalid);
    expect(groupsGone || groupsInvalid).toBe(usesItemsPrefix(action));
  });

  test('ações de item, loja, cotação, limites de giro, catálogo e backup invalidam os grupos', async () => {
    const mustInvalidate: InvalidationAction[] = [
      'item.create', 'item.update', 'item.delete', 'item.sell', 'item.unsell', 'item.offSale', 'item.backOnSale',
      'store.create', 'store.update', 'store.delete', 'settings.fx', 'settings.aging', 'catalog.refresh', 'backup.import',
    ];
    for (const action of mustInvalidate) {
      const client = new QueryClient();
      client.setQueryData(queryKeys.items.groups({ a: 1 }), { ok: true });
      await invalidateAfter(client, action);
      const st = client.getQueryState(queryKeys.items.groups({ a: 1 }));
      expect(st === undefined || st.isInvalidated, action).toBe(true);
    }
  });

  test('settings.preferences (trocar a visão) e aportes/saques/conferências não recarregam os grupos', async () => {
    for (const action of ['settings.preferences', 'deposit.create', 'withdrawal.create', 'balanceCheck.create'] as const) {
      const client = new QueryClient();
      client.setQueryData(queryKeys.items.groups({ a: 1 }), { ok: true });
      await invalidateAfter(client, action);
      expect(client.getQueryState(queryKeys.items.groups({ a: 1 }))?.isInvalidated, action).toBe(false);
    }
  });
});

describe('textos do holding (bordas, D282)', () => {
  const old = /fora de venda|n[aã]o est[aá] [aà] venda|colocar [aà] venda|tirar da venda|not for sale|put up for sale|take off sale|off sale|sold while not/i;

  test('nenhuma chave nem texto dos dois dicionários usa os nomes antigos', () => {
    for (const dict of [pt, enFlat]) {
      for (const [key, text] of Object.entries(dict)) {
        expect(text, key).not.toMatch(old);
      }
    }
  });

  test('os textos pedidos em D282, nos dois idiomas', () => {
    const expected: Record<string, [string, string]> = {
      'inventory.actions.offSale': ['Mover para o holding', 'Move to holding'],
      'inventory.actions.forSale': ['Voltar para a venda', 'Put back on sale'],
      'inventory.tabs.offSale': ['Holding ({count})', 'Holding ({count})'],
      'inventory.tabs.offSaleHint': ['Itens guardados esperando valorização.', 'Items held while waiting for their value to rise.'],
      'inventory.offSaleConfirmTitle': ['Mover para o holding?', 'Move to holding?'],
      'inventory.offSaleSince': ['No holding desde {date}', 'In holding since {date}'],
      'inventory.offSaleEmpty': ['Nenhum item no holding.', 'No items in holding.'],
      'inventory.offSaleDone': ['{name} foi movido para o holding.', '{name} moved to holding.'],
      'inventory.forSaleDone': ['{name} voltou para a venda.', '{name} put back on sale.'],
      'enums.agingBucket.FORA_DE_VENDA': ['Holding', 'Holding'],
      'enums.turnaroundBucket.SEM_GIRO': ['Vendido do holding (sem contar giro)', 'Sold from holding (not counted)'],
      'history.soldOffSale.one': ['{count} venda do holding não entra no tempo médio', '{count} sale from holding is not in the average time'],
      'history.soldOffSale.other': ['{count} vendas do holding não entram no tempo médio', '{count} sales from holding are not in the average time'],
      'inventory.group.offSale': ['{count} no holding', '{count} in holding'],
    };
    for (const [key, [ptText, enText]] of Object.entries(expected)) {
      expect(pt[key], `pt ${key}`).toBe(ptText);
      expect(enFlat[key], `en ${key}`).toBe(enText);
    }
    expect(pt['inventory.offSaleConfirmMessage']).toBe('O item sai da lista "À venda" e vai para o holding. Quando voltar para a venda, a contagem dos dias recomeça.');
    expect(enFlat['inventory.offSaleConfirmMessage']).toBe('The item leaves the "For sale" list and goes to holding. When you put it back on sale, the day count starts again.');
  });

  test('textos que não deviam mudar continuam iguais', () => {
    expect(pt['inventory.tabs.forSale']).toBe('À venda ({count})');
    expect(enFlat['inventory.tabs.forSale']).toBe('For sale ({count})');
  });
});

describe('chaves da visão agrupada (D278)', () => {
  const keys = [
    'inventory.view.label', 'inventory.view.grouped', 'inventory.view.individual', 'inventory.view.onlyInStock',
    'inventory.itemCount.one', 'inventory.itemCount.other', 'inventory.groupsCount.one', 'inventory.groupsCount.other', 'inventory.countInGroups',
    'inventory.columns.quantity', 'inventory.columns.avgCost', 'inventory.columns.totalCost', 'inventory.columns.situation',
    'inventory.group.expand', 'inventory.group.collapse', 'inventory.group.forSale', 'inventory.group.tradeLocked',
    'inventory.group.offSale', 'inventory.group.stagnant.one', 'inventory.group.stagnant.other', 'inventory.group.convertedCost',
    'inventory.tabs.offSaleHint', 'errors.INVALID_INVENTORY_VIEW',
  ];

  test('todas existem, não vazias, nos dois idiomas, com os mesmos placeholders', () => {
    for (const key of keys) {
      expect(pt[key]?.trim(), `pt ${key}`).toBeTruthy();
      expect(enFlat[key]?.trim(), `en ${key}`).toBeTruthy();
      expect(params(pt[key]), key).toEqual(params(enFlat[key]));
    }
  });

  test('os mesmos conjuntos de chaves e placeholders no dicionário inteiro', () => {
    expect(Object.keys(enFlat).sort()).toEqual(Object.keys(pt).sort());
    for (const key of Object.keys(pt)) expect(params(enFlat[key]), key).toEqual(params(pt[key]));
  });

  test('INVALID_INVENTORY_VIEW está na lista de códigos da API e traduzido', () => {
    expect(API_ERROR_CODES).toContain('INVALID_INVENTORY_VIEW');
    expect(pt['errors.INVALID_INVENTORY_VIEW']).toBe('Visão do inventário inválida.');
    expect(enFlat['errors.INVALID_INVENTORY_VIEW']).toBe('Invalid inventory view.');
  });

  test('placeholders esperados nas chaves de grupo', () => {
    expect(params(pt['inventory.group.expand'])).toEqual(['name']);
    expect(params(pt['inventory.group.tradeLocked'])).toEqual(['count', 'date']);
    expect(params(pt['inventory.countInGroups'])).toEqual(['groups', 'items']);
  });
});

describe('plural do título (itemCount, groupsCount, countInGroups) e stagnant', () => {
  // Espelha a lógica de lib/inventoryCount.ts.
  const title = (messages: unknown, locale: string, count: number, groups: number) =>
    translate(messages, 'inventory.countInGroups', {
      items: translatePlural(messages, 'inventory.itemCount', count, locale),
      groups: translatePlural(messages, 'inventory.groupsCount', groups, locale),
    });

  test('pt-BR', () => {
    expect(title(ptBR, 'pt-BR', 1, 1)).toBe('1 item em 1 grupo');
    expect(title(ptBR, 'pt-BR', 5, 1)).toBe('5 itens em 1 grupo');
    expect(title(ptBR, 'pt-BR', 5, 3)).toBe('5 itens em 3 grupos');
    expect(title(ptBR, 'pt-BR', 2, 2)).toBe('2 itens em 2 grupos');
  });

  test('en', () => {
    expect(title(en, 'en', 1, 1)).toBe('1 item in 1 group');
    expect(title(en, 'en', 5, 1)).toBe('5 items in 1 group');
    expect(title(en, 'en', 5, 3)).toBe('5 items in 3 groups');
  });

  test('nenhuma combinação deixa placeholder sem preencher', () => {
    for (const [messages, locale] of [[ptBR, 'pt-BR'], [en, 'en']] as const) {
      for (const [count, groups] of [[1, 1], [2, 1], [2, 2], [10, 4], [100, 1]]) {
        expect(title(messages, locale, count, groups)).not.toMatch(/[{}]/);
      }
    }
  });

  test('stagnant: singular e plural', () => {
    expect(translatePlural(ptBR, 'inventory.group.stagnant', 1, 'pt-BR')).toBe('1 encalhada');
    expect(translatePlural(ptBR, 'inventory.group.stagnant', 3, 'pt-BR')).toBe('3 encalhadas');
    expect(translatePlural(en, 'inventory.group.stagnant', 1, 'en')).toBe('1 stuck');
    expect(translatePlural(en, 'inventory.group.stagnant', 4, 'en')).toBe('4 stuck');
  });

  test('situação do grupo: textos preenchidos', () => {
    expect(translate(ptBR, 'inventory.group.tradeLocked', { count: 2, date: '25/11/2026' })).toBe('2 em trade lock (libera em 25/11/2026)');
    expect(translate(en, 'inventory.group.forSale', { count: 3 })).toBe('3 for sale');
    expect(translate(ptBR, 'inventory.group.expand', { name: 'AK-47 | Redline' })).toBe('Mostrar unidades de AK-47 | Redline');
  });
});
