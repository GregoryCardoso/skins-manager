import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test } from 'vitest';
import { createQueryClient } from '@/components/QueryProvider';
import { INVALIDATION_MAP, invalidateAfter, type InvalidationAction } from './queryInvalidation';
import { queryKeys } from './queryKeys';

// 8.7.1 (D258, D259, D262): chaves, mapa ação -> invalidação e a regressão do aporte.

// Uma consulta de exemplo para cada chave de D259.
const SAMPLE_KEYS: Array<readonly unknown[]> = [
  queryKeys.items.list({ status: 'EM_ESTOQUE' }),
  queryKeys.sales.list({ period: '30d' }),
  queryKeys.stores.all,
  queryKeys.settings.all,
  queryKeys.deposits.all,
  queryKeys.withdrawals.all,
  queryKeys.storeBalances.current,
  queryKeys.storeBalances.history(1),
  queryKeys.profitSummary.all,
  queryKeys.catalog.status,
  queryKeys.health.all,
  queryKeys.backupInfo.all,
  queryKeys.integrations.csfloat,
  queryKeys.imports.batches,
];
const GROUPS = ['items', 'sales', 'stores', 'settings', 'deposits', 'withdrawals', 'storeBalances', 'profitSummary', 'catalog', 'health', 'backupInfo', 'integrations', 'imports'];
const MONEY = ['items', 'sales', 'stores', 'deposits', 'withdrawals', 'storeBalances', 'profitSummary'];

// Grupos que cada ação deve invalidar (tabela de D259).
const EXPECTED: Record<string, string[]> = {
  'item.create': ['items', 'sales', 'stores', 'storeBalances', 'profitSummary'],
  'item.update': ['items', 'sales', 'stores', 'storeBalances', 'profitSummary', 'imports'],
  'item.delete': ['items', 'sales', 'stores', 'storeBalances', 'profitSummary', 'imports'],
  'item.sell': ['items', 'sales', 'stores', 'storeBalances', 'profitSummary'],
  'item.unsell': ['items', 'sales', 'stores', 'storeBalances', 'profitSummary', 'imports'],
  // Aplicar do estoque (10.3, D362): os mesmos alvos de editar/desfazer venda.
  'item.applyComponent': ['items', 'sales', 'stores', 'storeBalances', 'profitSummary', 'imports'],
  'item.scrapeOff': ['items', 'sales', 'stores', 'storeBalances', 'profitSummary', 'imports'],
  'operation.undo': ['items', 'sales', 'stores', 'storeBalances', 'profitSummary', 'imports'],
  'item.open': ['items', 'sales', 'stores', 'storeBalances', 'profitSummary', 'imports'],
  'settings.steamStore': ['settings', 'stores', 'items'],
  // Importação (9.2, D318): o card, os lotes e as pendências, mais tudo o que muda com itens.
  'import.run': ['integrations', 'imports', ...MONEY],
  'import.undo': ['integrations', 'imports', ...MONEY],
  'integration.update': ['integrations'],
  'import.changeCutoff': ['integrations', 'imports', ...MONEY],
  'item.offSaleBulk': ['items', 'sales', 'profitSummary'],
  'item.backOnSaleBulk': ['items', 'sales', 'profitSummary'],
  'import.resolve': ['integrations', 'imports', ...MONEY],
  'item.offSale': ['items', 'sales', 'profitSummary'],
  'item.backOnSale': ['items', 'sales', 'profitSummary'],
  'deposit.create': ['deposits', 'stores', 'storeBalances', 'profitSummary', 'imports', 'integrations'],
  'deposit.update': ['deposits', 'stores', 'storeBalances', 'profitSummary', 'imports', 'integrations'],
  'deposit.delete': ['deposits', 'stores', 'storeBalances', 'profitSummary', 'imports', 'integrations'],
  'withdrawal.create': ['withdrawals', 'stores', 'storeBalances', 'profitSummary', 'imports', 'integrations'],
  'withdrawal.update': ['withdrawals', 'stores', 'storeBalances', 'profitSummary', 'imports', 'integrations'],
  'withdrawal.delete': ['withdrawals', 'stores', 'storeBalances', 'profitSummary', 'imports', 'integrations'],
  'balanceCheck.create': ['storeBalances', 'profitSummary'],
  'balanceCheck.delete': ['storeBalances', 'profitSummary'],
  'store.create': [...MONEY, 'integrations'],
  'store.update': [...MONEY, 'integrations'],
  'store.delete': [...MONEY, 'integrations'],
  'settings.fx': ['settings', ...MONEY],
  'settings.aging': ['settings', 'items', 'sales'],
  'settings.preferences': ['settings'],
  'catalog.refresh': ['catalog', 'items', 'sales', 'health'],
  'integration.apiKey': ['integrations'],
  'integration.test': ['integrations'],
  'integration.switchAccount': ['integrations', 'imports', 'storeBalances'],
};

function populated(): QueryClient {
  const client = new QueryClient();
  for (const key of SAMPLE_KEYS) client.setQueryData(key, { ok: true });
  return client;
}

const invalidated = (client: QueryClient) =>
  SAMPLE_KEYS.filter((key) => client.getQueryState(key)?.isInvalidated).map((key) => String(key[0]));

describe('queryKeys', () => {
  test('as chaves são estáveis e os prefixos corretos', () => {
    expect(queryKeys.items.list({ a: 1 })).toEqual(['items', 'list', { a: 1 }]);
    expect(queryKeys.items.list({ a: 1 })[0]).toBe(queryKeys.items.all[0]);
    expect(queryKeys.sales.list({ b: 2 })).toEqual(['sales', { b: 2 }]);
    expect(queryKeys.storeBalances.history(7)).toEqual(['storeBalances', 'history', 7]);
    expect(queryKeys.storeBalances.current.slice(0, 1)).toEqual(queryKeys.storeBalances.all);
    expect(queryKeys.catalog.status.slice(0, 1)).toEqual(queryKeys.catalog.all);
    expect(JSON.stringify(queryKeys.items.list({ x: 1 }))).toBe(JSON.stringify(queryKeys.items.list({ x: 1 })));
  });

  test('o idioma não faz parte de nenhuma chave', () => {
    for (const key of SAMPLE_KEYS) expect(JSON.stringify(key)).not.toMatch(/pt-BR|"en"/);
  });
});

describe('INVALIDATION_MAP (D259)', () => {
  test('cobre exatamente as ações da tabela de D259 (mais backup.import)', () => {
    expect(Object.keys(INVALIDATION_MAP).sort()).toEqual([...Object.keys(EXPECTED), 'backup.import'].sort());
  });

  test.each(Object.keys(EXPECTED))('%s invalida exatamente as chaves esperadas, e nada além', async (action) => {
    const client = populated();
    await invalidateAfter(client, action as InvalidationAction);
    expect(new Set(invalidated(client))).toEqual(new Set(EXPECTED[action]));
    // nenhuma outra consulta do grupo vizinho é tocada
    for (const group of GROUPS.filter((g) => !EXPECTED[action].includes(g))) {
      const touched = SAMPLE_KEYS.filter((k) => k[0] === group).some((k) => client.getQueryState(k)?.isInvalidated);
      expect(touched, group).toBe(false);
    }
  });

  test('regressão do relato: registrar um aporte invalida saldos e resumo do lucro real', async () => {
    const client = populated();
    await invalidateAfter(client, 'deposit.create');
    const state = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
    expect(state(queryKeys.storeBalances.current)).toBe(true);
    expect(state(queryKeys.storeBalances.history(1))).toBe(true);
    expect(state(queryKeys.profitSummary.all)).toBe(true);
    expect(state(queryKeys.deposits.all)).toBe(true);
    expect(state(queryKeys.stores.all)).toBe(true);
    expect(state(queryKeys.settings.all)).toBe(false);
  });

  test('backup.import limpa o cache inteiro', async () => {
    const client = populated();
    await invalidateAfter(client, 'backup.import');
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  test('toda ação usada no código (invalidate(...) e invalidateAfter(...)) existe no mapa', () => {
    const root = path.join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) files.push(full);
      }
    };
    walk(root);
    // Nomes de ação são literais 'grupo.verbo' (ex.: 'deposit.create'); chaves de i18n têm outros verbos.
    const ACTION = /'((?:item|deposit|withdrawal|store|balanceCheck)\.(?:create|update|delete|sell|unsell|offSale|backOnSale)|settings\.(?:fx|aging|preferences)|catalog\.refresh|backup\.import)'/g;
    const used = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      if (!/invalidat/i.test(source)) continue;
      for (const m of source.matchAll(ACTION)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(15);
    expect([...used].filter((action) => !(action in INVALIDATION_MAP))).toEqual([]);
    // e toda chamada invalidate('x') / invalidateAfter(c, 'x') com um literal aponta para o mapa
    for (const file of files) {
      for (const m of readFileSync(file, 'utf-8').matchAll(/invalidate(?:After)?\(\s*(?:\w+,\s*)?'([^']+)'/g)) {
        expect(Object.keys(INVALIDATION_MAP), `${file}: ${m[1]}`).toContain(m[1]);
      }
    }
  });

  test('o createQueryClient usa a configuração de D258', () => {
    const defaults = createQueryClient().getDefaultOptions().queries;
    expect(defaults).toMatchObject({ retry: false, refetchOnWindowFocus: true, staleTime: 0 });
  });

  test('os componentes não têm mais recargas manuais (D260)', () => {
    const root = path.join(__dirname, '..');
    const files = [
      'app/page.tsx', 'app/sales/page.tsx', 'app/profit/page.tsx', 'app/stores/page.tsx', 'app/settings/page.tsx',
      'components/ItemDialogs.tsx', 'components/SummaryCards.tsx', 'components/StoreBalancesPanel.tsx',
      'components/StoreBalanceHistory.tsx', 'components/WithdrawalsSection.tsx', 'components/PreferencesProvider.tsx',
      'components/SystemStatus.tsx', 'components/CatalogSettings.tsx', 'components/AboutSettings.tsx', 'components/BackupSettings.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(path.join(root, file), 'utf-8');
      expect(source, file).not.toMatch(/reloadToken|reloadKey|onDataChanged|balancesToken|summaryToken|retryToken|addEventListener\('focus'/);
    }
  });
});
