import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';
import { DEFAULT_FILTERS, hasActiveFilters, parseFilters, toApiQuery, toSearchString } from './inventoryQuery';
import { INVALIDATION_MAP, invalidateAfter } from './queryInvalidation';
import { queryKeys } from './queryKeys';

// QA 8.7.2 (D266, D270): abas e filtros, invalidação, paridade i18n e botões dos itens "fora de venda".
const src = path.join(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(src, rel), 'utf-8');
const params = (qs: string) => new URLSearchParams(qs);

function flatten(node: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[full] = value;
    else Object.assign(out, flatten(value, full));
  }
  return out;
}
const holders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('inventoryQuery: aba "Fora de venda"', () => {
  test('padrão = aba À venda, sem parâmetro na URL', () => {
    expect(DEFAULT_FILTERS.saleState).toBe('FOR_SALE');
    expect(toSearchString(DEFAULT_FILTERS)).toBe('');
    expect(parseFilters(params('')).saleState).toBe('FOR_SALE');
    expect(toApiQuery(DEFAULT_FILTERS)).toMatchObject({ status: 'EM_ESTOQUE', saleState: 'FOR_SALE' });
  });

  test('sale=off vira a aba Fora de venda e volta igual (ida e volta); valores estranhos caem em À venda', () => {
    const filters = parseFilters(params('sale=off'));
    expect(filters.saleState).toBe('OFF_SALE');
    expect(toSearchString(filters)).toBe('sale=off');
    expect(parseFilters(params(toSearchString(filters)))).toEqual(filters);
    for (const bad of ['sale=OFF_SALE', 'sale=', 'sale=on', 'sale=off,on']) expect(parseFilters(params(bad)).saleState).toBe('FOR_SALE');
  });

  test('só agarrados é desligado na aba Fora de venda, na URL, na serialização e na consulta da API', () => {
    const parsed = parseFilters(params('sale=off&stagnant=1'));
    expect(parsed).toMatchObject({ saleState: 'OFF_SALE', stagnant: false });
    const manual = { ...DEFAULT_FILTERS, saleState: 'OFF_SALE' as const, stagnant: true };
    expect(toSearchString(manual)).toBe('sale=off');
    expect(toApiQuery(manual)).toEqual({ order: 'desc', status: 'EM_ESTOQUE', saleState: 'OFF_SALE' });
    expect(toApiQuery(manual).stagnantOnly).toBeUndefined();
  });

  test('só agarrados continua valendo na aba À venda', () => {
    expect(toApiQuery({ ...DEFAULT_FILTERS, stagnant: true })).toMatchObject({ stagnantOnly: true, saleState: 'FOR_SALE' });
    expect(parseFilters(params('stagnant=1'))).toMatchObject({ stagnant: true, saleState: 'FOR_SALE' });
  });

  test('saleState só vai para a API com o status "Em estoque" (com Vendidos ou Todos a API recusaria)', () => {
    for (const status of ['VENDIDO', 'ALL'] as const) {
      const query = toApiQuery({ ...DEFAULT_FILTERS, status, saleState: 'OFF_SALE' });
      expect(query.saleState, status).toBeUndefined();
    }
    expect(toApiQuery({ ...DEFAULT_FILTERS, status: 'VENDIDO' }).status).toBe('VENDIDO');
  });

  test('a categoria e a ordem convivem com a aba', () => {
    const filters = parseFilters(params('category=SKIN&order=asc&sale=off'));
    expect(filters).toMatchObject({ category: 'SKIN', order: 'asc', saleState: 'OFF_SALE' });
    expect(toApiQuery(filters)).toEqual({ order: 'asc', status: 'EM_ESTOQUE', category: 'SKIN', saleState: 'OFF_SALE' });
    expect(new URLSearchParams(toSearchString(filters)).get('sale')).toBe('off');
  });

  test('a aba sozinha não conta como filtro ativo (o vazio da aba tem mensagem própria)', () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, saleState: 'OFF_SALE' })).toBe(false);
  });
});

describe('invalidação das ações de fora de venda', () => {
  test.each(['item.offSale', 'item.backOnSale'] as const)('%s: inventário, vendas e resumo do lucro real (divisão do estoque, 8.9) são rebuscados; saldos, lojas e configurações não', async (action) => {
    expect(INVALIDATION_MAP[action]).toEqual([queryKeys.items.all, queryKeys.sales.all, queryKeys.profitSummary.all, queryKeys.marketValues.all]);
    const client = new QueryClient();
    const keys = {
      items: queryKeys.items.list({ status: 'EM_ESTOQUE', saleState: 'OFF_SALE' }),
      sales: queryKeys.sales.list({}),
      stores: queryKeys.stores.all,
      balances: queryKeys.storeBalances.current,
      history: queryKeys.storeBalances.history(1),
      summary: queryKeys.profitSummary.all,
      settings: queryKeys.settings.all,
    };
    for (const key of Object.values(keys)) client.setQueryData(key, {});
    await invalidateAfter(client, action);
    const inv = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, Boolean(client.getQueryState(key)?.isInvalidated)]));
    expect(inv).toEqual({ items: true, sales: true, stores: false, balances: false, history: false, summary: true, settings: false });
  });

  test('as duas ações são usadas no código (item.offSale no diálogo e item.backOnSale no putForSale)', () => {
    const dialogs = read('components/ItemDialogs.tsx');
    expect(dialogs).toContain("'item.offSale'");
    expect(dialogs).toContain("invalidate('item.backOnSale')");
  });

  test('venda e desfazer venda de item fora de venda continuam invalidando o grupo inteiro (saldo e lucro)', () => {
    for (const action of ['item.sell', 'item.unsell'] as const) {
      const groups = (INVALIDATION_MAP[action] as readonly (readonly unknown[])[]).map((k) => k[0]);
      expect(groups).toEqual(expect.arrayContaining(['items', 'sales', 'storeBalances', 'profitSummary']));
    }
  });
});

describe('i18n: paridade e textos', () => {
  const flatPt = flatten(ptBR);
  const flatEn = flatten(en);

  test('pt-BR e en continuam com as mesmas chaves e os mesmos marcadores', () => {
    expect(Object.keys(flatEn).sort()).toEqual(Object.keys(flatPt).sort());
    for (const key of Object.keys(flatPt)) expect(holders(flatEn[key]), key).toEqual(holders(flatPt[key]));
  });

  test('os novos baldes seguem o padrão dos existentes (enums.agingBucket / enums.turnaroundBucket) e não há duplicata em aging.bucket', () => {
    expect(flatPt['enums.agingBucket.FORA_DE_VENDA']).toBe('Holding');
    expect(flatEn['enums.agingBucket.FORA_DE_VENDA']).toBe('Holding');
    expect(flatPt['enums.turnaroundBucket.SEM_GIRO']).toBe('Vendido do holding (sem contar giro)');
    expect(flatEn['enums.turnaroundBucket.SEM_GIRO']).toBe('Sold from holding (not counted)');
    expect(Object.keys(flatPt).filter((k) => /^aging\.bucket\./.test(k))).toEqual([]);
    // os baldes antigos continuam ao lado dos novos
    for (const bucket of ['RECENTE', 'EM_TRADE_LOCK', 'AGARRADO']) expect(flatPt[`enums.agingBucket.${bucket}`], bucket).toBeTruthy();
  });

  test('plural do histórico (history.soldOffSale) usa {count} nas duas formas e nos dois idiomas', () => {
    for (const dict of [flatPt, flatEn]) {
      for (const form of ['one', 'other']) expect(holders(dict[`history.soldOffSale.${form}`]), form).toEqual(['{count}']);
    }
    expect(flatPt['history.soldOffSale.one']).toMatch(/holding/);
  });

  test('os textos de data usam {date} e os de nome usam {name}; ação não fala em "saldo inicial"', () => {
    expect(holders(flatPt['inventory.offSaleSince'])).toEqual(['{date}']);
    expect(holders(flatPt['inventory.offSaleDone'])).toEqual(['{name}']);
    expect(holders(flatEn['inventory.forSaleDone'])).toEqual(['{name}']);
    expect(translate(ptBR, 'inventory.offSaleConfirmMessage')).toMatch(/recomeça/);
    expect(translate(en, 'inventory.offSaleConfirmMessage')).toMatch(/starts again/);
  });
});

describe('botões, abas e exibição', () => {
  test('ItemActions: "Mover para holding" só em FOR_SALE e "Voltar para a venda" só em OFF_SALE; Vender, Editar e Excluir sempre', () => {
    const code = read('components/ItemActions.tsx');
    expect(code).toMatch(/item\.saleState === 'FOR_SALE' && onOffSale/);
    expect(code).toMatch(/item\.saleState === 'OFF_SALE' && onForSale/);
    expect(code).toContain("t('inventory.actions.edit')");
    expect(code).toContain("t('inventory.actions.delete')");
    expect(code).toContain("t('inventory.actions.sell')");
  });

  test('Vender fica desabilitado em trade lock também para item fora de venda (a regra do backend é a mesma)', () => {
    expect(read('components/ItemActions.tsx')).toMatch(/onClick=\{\(\) => onSell\(item\)\} disabled=\{locked\}/);
  });

  test('as abas mostram as contagens do backend e a aba escolhida zera "só agarrados"', () => {
    const page = read('app/page.tsx');
    expect(page).toContain('data.meta.saleStateCounts.forSale');
    expect(page).toContain('data.meta.saleStateCounts.offSale');
    expect(page).toMatch(/stagnant: state === 'OFF_SALE' \? false : filters\.stagnant/);
    expect(page).not.toMatch(/\.filter\([^)]*saleState|\.length\s*\}\)/); // nada contado no frontend
  });

  test('a tabela mostra "no holding desde" só com offSaleAt e a página de vendas mostra SEM_GIRO com tradução', () => {
    expect(read('components/InventoryUnitRow.tsx')).toMatch(/item\.offSaleAt && /);
    const sales = read('components/SalesTable.tsx');
    expect(sales).toContain('SEM_GIRO');
    expect(sales).toContain('enums.turnaroundBucket.');
  });

  test('o frontend não calcula o giro nem a faixa de fora de venda (usa os campos do backend)', () => {
    const offenders: string[] = [];
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const full = path.join(dir, n);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
    for (const file of walk(path.join(src, 'components')).concat(walk(path.join(src, 'app')))) {
      if (!/\.tsx?$/.test(file) || /\.test\./.test(file)) continue;
      if (/Date\.now\(\)[^\n]*(offSaleAt|forSaleSince)|(offSaleAt|forSaleSince)[^\n]*Date\.now\(\)/.test(readFileSync(file, 'utf-8'))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
