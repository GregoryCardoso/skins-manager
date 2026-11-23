import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import { createQueryClient } from '@/components/QueryProvider';
import { ApiRequestError } from '@/services/api';
import { errorMessageFor } from '@/i18n/errorMessage';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';
import { INVALIDATION_MAP, invalidateAfter, type InvalidationAction } from './queryInvalidation';
import { queryKeys } from './queryKeys';

// QA 8.7.1 (D258 a D262): cobertura do mapa contra o código, efeitos entre telas, erros e estados das consultas.
const src = path.join(__dirname, '..');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
const prod = walk(src).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const read = (f: string) => readFileSync(f, 'utf-8');
const rel = (f: string) => path.relative(src, f).replace(/\\/g, '/');
const screens = prod.filter((f) => /^(app|components)\//.test(rel(f)));
const ACTIONS = Object.keys(INVALIDATION_MAP) as InvalidationAction[];
const groupsOf = (action: InvalidationAction): string[] => {
  const entry = INVALIDATION_MAP[action];
  return entry === 'clear' ? [] : (entry as readonly (readonly unknown[])[]).map((k) => String(k[0]));
};

describe('cada função de escrita do api.ts invalida a ação certa onde é usada', () => {
  // função de escrita -> ações aceitas nos arquivos que a chamam
  const WRITES: Record<string, InvalidationAction[]> = {
    createItem: ['item.create'], updateItem: ['item.update'], sellItem: ['item.sell'],
    deleteItem: ['item.delete'], unsellItem: ['item.unsell'],
    markItemOffSale: ['item.offSale'], markItemForSale: ['item.backOnSale'],
    createDeposit: ['deposit.create'], updateDeposit: ['deposit.update'], deleteDeposit: ['deposit.delete'],
    createWithdrawal: ['withdrawal.create'], updateWithdrawal: ['withdrawal.update'], deleteWithdrawal: ['withdrawal.delete'],
    createStoreBalanceCheck: ['balanceCheck.create'], deleteStoreBalanceEntry: ['balanceCheck.delete'],
    createStore: ['store.create'], updateStore: ['store.update'], deleteStore: ['store.delete'],
    updateFxRate: ['settings.fx'], refreshFxRate: ['settings.fx'],
    updatePreferences: ['settings.preferences', 'settings.aging', 'settings.fx'],
    refreshCatalog: ['catalog.refresh'],
    saveCsfloatApiKey: ['integration.apiKey'], removeCsfloatApiKey: ['integration.apiKey'],
    testCsfloatConnection: ['integration.test'],
    switchCsfloatAccount: ['integration.switchAccount'],
    runCsfloatImport: ['import.run'], undoImportBatch: ['import.undo'], resolveImportEntry: ['import.resolve'], changeCutoff: ['import.changeCutoff'], reopenImportEntry: ['import.resolve'], bulkResolveImportEntries: ['import.resolve'], updateCsfloatIntegration: ['integration.update'],
    bulkMarkOffSale: ['item.offSaleBulk'], bulkMarkForSale: ['item.backOnSaleBulk'],
  };
  // Só quem importa a função do api.ts (o PreferencesProvider expõe refreshFxRate/saveFxRate já com a invalidação).
  const callers = (fn: string) => prod.filter((f) => !rel(f).startsWith('services/') && new RegExp(`\\b${fn}\\(`).test(read(f))
    && new RegExp(`import[^;]*\\b${fn}\\b[^;]*from '@/services/api'`, 's').test(read(f)));
  const actionsIn = (file: string) => {
    const code = read(file);
    return new Set([...code.matchAll(/'((?:item|deposit|withdrawal|balanceCheck|store|settings|catalog|backup|integration|import)\.\w+)'/g)].map((m) => m[1]));
  };

  test.each(Object.entries(WRITES))('%s: todo arquivo que a chama usa uma das ações esperadas', (fn, accepted) => {
    const files = callers(fn);
    expect(files.length, `${fn} não é usada em nenhuma tela`).toBeGreaterThan(0);
    for (const file of files) {
      const used = actionsIn(file);
      expect([...used].some((a) => (accepted as string[]).includes(a)), `${rel(file)} não invalida ${accepted.join(' ou ')}`).toBe(true);
    }
  });

  test('toda função de escrita (POST/PUT/PATCH/DELETE) do api.ts está na tabela ou é isenta', () => {
    const api = read(path.join(src, 'services', 'api.ts'));
    const writers = [...api.matchAll(/export const (\w+)\s*=[^;]*?request<[^>]+>\(\s*'(POST|PUT|PATCH|DELETE)'/gs)].map((m) => m[1]);
    // isentas: não mudam dados guardados (pasta de backups, importação tratada à parte)
    const EXEMPT = ['importBackup', 'openBackupsFolder'];
    expect(writers.length).toBeGreaterThan(15);
    for (const fn of writers) expect(Object.keys(WRITES).concat(EXEMPT), `${fn} sem invalidação mapeada`).toContain(fn);
    expect(writers).toEqual(expect.arrayContaining(['createItem', 'sellItem', 'createDeposit', 'refreshCatalog']));
  });

  test('importBackup limpa o cache pelo mapa e recarrega a janela', () => {
    const code = read(path.join(src, 'components', 'BackupSettings.tsx'));
    expect(code).toMatch(/invalidateAfter\(queryClient, 'backup\.import'\)/);
    expect(code).toContain('window.location.reload()');
  });

  test('todo nome de ação usado no código existe no mapa', () => {
    for (const file of prod) {
      for (const m of read(file).matchAll(/(?:invalidate|invalidateAfter\(\w+,)\(?\s*'([\w.]+)'/g)) {
        expect(ACTIONS as string[], `${rel(file)}: ${m[1]}`).toContain(m[1]);
      }
    }
  });

  test('toda ação do mapa é usada em algum arquivo (inclusive as da 8.7.2)', () => {
    const used = new Set(prod.filter((f) => !rel(f).startsWith('lib/queryInvalidation')).flatMap((f) => [...actionsIn(f)]));
    for (const action of ACTIONS) {
      expect(used.has(action), `ação ${action} nunca usada`).toBe(true);
    }
  });
});

describe('o mapa cobre os efeitos entre telas (nenhuma tela dependente fica sem invalidar)', () => {
  const must = (action: InvalidationAction, expected: string[]) => {
    for (const g of expected) expect(groupsOf(action), `${action} deveria invalidar ${g}`).toContain(g);
  };

  test('venda e desfazer venda: inventário, vendas (e histórico do item), saldos, resumo do lucro e lojas', () => {
    for (const a of ['item.sell', 'item.unsell'] as const) must(a, ['items', 'sales', 'storeBalances', 'profitSummary', 'stores']);
  });

  test('criar, editar e excluir item mexem no saldo (compra desconta) e no resumo', () => {
    for (const a of ['item.create', 'item.update', 'item.delete'] as const) must(a, ['items', 'sales', 'storeBalances', 'profitSummary']);
  });

  test('aporte e saque: lista própria, saldos (painel e histórico), resumo e lojas (travas de uso)', () => {
    for (const a of ['deposit.create', 'deposit.update', 'deposit.delete'] as const) must(a, ['deposits', 'storeBalances', 'profitSummary', 'stores']);
    for (const a of ['withdrawal.create', 'withdrawal.update', 'withdrawal.delete'] as const) must(a, ['withdrawals', 'storeBalances', 'profitSummary', 'stores']);
  });

  test('conferência: painel, histórico e resumo', () => {
    for (const a of ['balanceCheck.create', 'balanceCheck.delete'] as const) must(a, ['storeBalances', 'profitSummary']);
  });

  test('loja (nome, taxa, retenção, moeda, ativa/principal): todas as listas que mostram dados da loja', () => {
    for (const a of ['store.create', 'store.update', 'store.delete'] as const) {
      must(a, ['stores', 'items', 'sales', 'deposits', 'withdrawals', 'storeBalances', 'profitSummary']);
    }
  });

  test('cotação (manual, atualizar, fonte): configurações e todas as telas com "≈ R$"', () => {
    must('settings.fx', ['settings', 'items', 'sales', 'deposits', 'withdrawals', 'storeBalances', 'profitSummary', 'stores']);
  });

  test('limites de giro, tema e idioma, catálogo', () => {
    must('settings.aging', ['settings', 'items', 'sales']);
    expect(groupsOf('settings.preferences')).toEqual(['settings']);
    must('catalog.refresh', ['catalog', 'items', 'sales', 'health']);
  });

  test('toda chave consumida por uma tela é invalidada por pelo menos uma ação (nenhuma consulta órfã)', () => {
    const used = new Set<string>();
    for (const file of prod) for (const m of read(file).matchAll(/queryKeys\.(\w+)\./g)) used.add(m[1]);
    const invalidatedSomewhere = new Set(ACTIONS.flatMap(groupsOf));
    for (const group of used) {
      if (group === 'backupInfo') continue; // limpo pelo backup.import
      expect(invalidatedSomewhere.has(group), `chave ${group} nunca é invalidada`).toBe(true);
    }
    expect(used.has('backupInfo')).toBe(true);
  });

  test('as telas só usam chaves da fábrica (nenhuma queryKey literal)', () => {
    for (const file of prod) {
      for (const m of read(file).matchAll(/queryKey:\s*([^,}\n]+)/g)) {
        expect(m[1].trim(), `${rel(file)} usa queryKey literal`).toMatch(/^queryKeys\./);
      }
    }
  });

  test('o histórico dos saldos (por loja) é invalidado em todas as ações que mudam saldo', async () => {
    for (const action of ACTIONS.filter((a) => groupsOf(a).includes('storeBalances'))) {
      const client = new QueryClient();
      client.setQueryData(queryKeys.storeBalances.history(3), { balances: [] });
      await invalidateAfter(client, action);
      expect(client.getQueryState(queryKeys.storeBalances.history(3))?.isInvalidated, action).toBe(true);
    }
  });
});

describe('recarga de consultas ativas e inativas', () => {
  test('consulta ativa é rebuscada após a ação; inativa só fica inválida', async () => {
    const client = createQueryClient();
    const listStores = vi.fn().mockResolvedValue([{ id: 1 }]);
    const getSummary = vi.fn().mockResolvedValue({});
    const observer = new QueryObserver(client, { queryKey: queryKeys.stores.all, queryFn: listStores });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(listStores).toHaveBeenCalledTimes(1));
    await client.prefetchQuery({ queryKey: queryKeys.profitSummary.all, queryFn: getSummary });
    await invalidateAfter(client, 'store.update');
    expect(listStores).toHaveBeenCalledTimes(2);
    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(queryKeys.profitSummary.all)?.isInvalidated).toBe(true);
    unsubscribe();
  });

  test('ação que não toca a chave não rebusca a consulta ativa', async () => {
    const client = createQueryClient();
    const listItems = vi.fn().mockResolvedValue({ items: [] });
    const observer = new QueryObserver(client, { queryKey: queryKeys.items.list({}), queryFn: listItems });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(listItems).toHaveBeenCalledTimes(1));
    await invalidateAfter(client, 'balanceCheck.create');
    expect(listItems).toHaveBeenCalledTimes(1);
    await invalidateAfter(client, 'item.sell');
    expect(listItems).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  test('backup.import limpa todo o cache, inclusive consultas com dados', async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.settings.all, { theme: 'DARK' });
    client.setQueryData(queryKeys.backupInfo.all, {});
    await invalidateAfter(client, 'backup.import');
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe('erros e estados das consultas', () => {
  const tPt = (k: string, p?: Record<string, string | number>) => translate(ptBR, k, p);
  const tEn = (k: string, p?: Record<string, string | number>) => translate(en, k, p);

  test('configuração do cliente: sem retry, refetch no foco e staleTime 0', () => {
    expect(createQueryClient().getDefaultOptions().queries).toMatchObject({ retry: false, refetchOnWindowFocus: true, staleTime: 0 });
  });

  test('um ApiRequestError da queryFn chega ao componente com o code e é traduzido por código nos dois idiomas', async () => {
    const client = createQueryClient();
    const fn = vi.fn().mockRejectedValue(new ApiRequestError('STORE_NOT_FOUND', 'msg do backend', 400, { field: 'storeId' }));
    const observer = new QueryObserver(client, { queryKey: queryKeys.stores.all, queryFn: fn });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
    const result = observer.getCurrentResult();
    expect(fn).toHaveBeenCalledTimes(1); // sem retry
    expect(result.error).toBeInstanceOf(ApiRequestError);
    expect(result.data).toBeUndefined();
    expect(errorMessageFor(result.error, tPt, 'pt-BR')).toBe(translate(ptBR, 'errors.STORE_NOT_FOUND'));
    expect(errorMessageFor(result.error, tEn, 'en')).toBe(translate(en, 'errors.STORE_NOT_FOUND'));
    expect(errorMessageFor(result.error, tPt, 'pt-BR')).not.toBe('msg do backend');
    unsubscribe();
  });

  test('erro de rede, timeout e código desconhecido seguem a mesma tradução', () => {
    for (const code of ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE']) {
      expect(errorMessageFor(new ApiRequestError(code, 'x', 0), tPt, 'pt-BR')).toBe(translate(ptBR, `errors.${code}`));
    }
    expect(errorMessageFor(new ApiRequestError('CODIGO_NOVO', 'mensagem do servidor', 500), tPt, 'pt-BR')).toBe('mensagem do servidor');
  });

  test('depois do erro, o refetch com sucesso limpa o erro e traz os dados ("Tentar de novo")', async () => {
    const client = createQueryClient();
    const fn = vi.fn().mockRejectedValueOnce(new ApiRequestError('NETWORK_ERROR', 'x', 0)).mockResolvedValue([{ id: 1 }]);
    const observer = new QueryObserver(client, { queryKey: queryKeys.stores.all, queryFn: fn });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
    await observer.refetch();
    expect(observer.getCurrentResult().error).toBeNull();
    expect(observer.getCurrentResult().data).toEqual([{ id: 1 }]);
    unsubscribe();
  });

  test('o dado em cache fica visível durante a recarga, e um erro na recarga mantém o dado antigo', async () => {
    const client = createQueryClient();
    const fn = vi.fn().mockResolvedValueOnce(['a']).mockRejectedValueOnce(new ApiRequestError('TIMEOUT', 'x', 0));
    const observer = new QueryObserver(client, { queryKey: queryKeys.stores.all, queryFn: fn });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(['a']));
    const pending = observer.refetch();
    expect(observer.getCurrentResult()).toMatchObject({ isFetching: true, data: ['a'] });
    await pending;
    expect(observer.getCurrentResult()).toMatchObject({ isError: true, data: ['a'] });
    unsubscribe();
  });

  test('cancelamento (signal abortado) não vira erro na tela', async () => {
    const client = createQueryClient();
    const fn = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new ApiRequestError('ABORTED', 'Requisição cancelada', 0)));
    }));
    const observer = new QueryObserver(client, { queryKey: queryKeys.stores.all, queryFn: fn as never });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(fn).toHaveBeenCalled());
    await client.cancelQueries({ queryKey: queryKeys.stores.all });
    unsubscribe();
    expect(client.getQueryState(queryKeys.stores.all)?.status).not.toBe('error');
  });
});

describe('nada ficou com recarga manual', () => {
  test('nenhum token de recarga, onFocus manual ou callback onDataChanged sobra no código', () => {
    for (const file of screens) {
      const code = read(file).replace(/\/\/.*$/gm, '');
      expect(code, rel(file)).not.toMatch(/reloadToken|reloadKey|balancesToken|summaryToken|retryToken|onDataChanged|onChanged\b/);
      expect(code, rel(file)).not.toMatch(/addEventListener\(\s*'focus'/);
    }
  });

  test('as funções GET de dados só são chamadas dentro de queryFn (as exceções são prévias efêmeras)', () => {
    const getters = ['listItems', 'listSales', 'listStores', 'listDeposits', 'listWithdrawals', 'listStoreBalances', 'getSettings',
      'getCurrentStoreBalances', 'getProfitSummary', 'getCatalogStatus', 'getHealth', 'getBackupInfo'];
    for (const file of screens) {
      const code = read(file);
      for (const g of getters) {
        for (const m of code.matchAll(new RegExp(`.*\\b${g}\\(.*`, 'g'))) {
          expect(m[0], `${rel(file)}: ${g} fora de queryFn`).toMatch(/queryFn/);
        }
      }
    }
  });

  test('cada tela com consulta trata erro e carregamento', () => {
    for (const file of screens.filter((f) => /useQuery\(/.test(read(f)))) {
      const code = read(file);
      expect(code, rel(file)).toMatch(/error/);
      expect(code, rel(file)).toMatch(/isFetching|isPending|isLoading|\.data/);
    }
  });
});
