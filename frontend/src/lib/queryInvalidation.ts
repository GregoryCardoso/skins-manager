// Mapa ação -> chaves invalidadas (D259). Toda escrita nova no api.ts precisa de uma entrada aqui.
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

type Prefix = readonly unknown[];

const K = queryKeys;

// Grupo "dinheiro": tudo o que muda com itens, aportes, saques, saldos, lojas ou cotação.
const MONEY: readonly Prefix[] = [
  K.items.all, K.sales.all, K.stores.all, K.deposits.all, K.withdrawals.all, K.storeBalances.all, K.profitSummary.all,
];
// O card da integração mostra o nome e as taxas da loja (D316).
const STORE_CHANGE: readonly Prefix[] = [...MONEY, K.integrations.all];
const ITEM_MONEY: readonly Prefix[] = [K.items.all, K.sales.all, K.stores.all, K.storeBalances.all, K.profitSummary.all];
// Aportes e saques podem vir do CSFloat (9.6): mexer num deles muda as pendências e o card da importação.
const DEPOSIT: readonly Prefix[] = [K.deposits.all, K.stores.all, K.storeBalances.all, K.profitSummary.all, K.imports.all, K.integrations.all];
const WITHDRAWAL: readonly Prefix[] = [K.withdrawals.all, K.stores.all, K.storeBalances.all, K.profitSummary.all, K.imports.all, K.integrations.all];
const CHECK: readonly Prefix[] = [K.storeBalances.all, K.profitSummary.all];

// Importação (9.2, D318): o card, os lotes, as pendências e tudo o que muda com itens. Editar, excluir ou desfazer a venda de um
// item importado muda o desfazer e as pendências; por isso essas ações também invalidam `imports`.
// Desde a 9.6 a importação também cria e exclui aportes e saques: por isso todo o dinheiro (MONEY).
const IMPORT_CHANGE: readonly Prefix[] = [K.integrations.all, K.imports.all, ...MONEY];
const ITEM_IMPORTS: readonly Prefix[] = [...ITEM_MONEY, K.imports.all];

export const INVALIDATION_MAP = {
  'item.create': ITEM_MONEY,
  'item.update': ITEM_IMPORTS,
  'item.delete': ITEM_IMPORTS,
  'item.sell': ITEM_MONEY,
  'item.unsell': ITEM_IMPORTS,
  'import.run': IMPORT_CHANGE,
  'import.undo': IMPORT_CHANGE,
  // Mudar a data de corte (9.5.1c) é uma importação: os mesmos alvos.
  'import.changeCutoff': IMPORT_CHANGE,
  // Resolver uma pendência (9.4) pode excluir um item, desfazer uma venda ou criar/ligar um lançamento.
  'import.resolve': IMPORT_CHANGE,
  // O lucro real mostra o estoque à venda e em holding (8.9, D283).
  'item.offSale': [K.items.all, K.sales.all, K.profitSummary.all],
  // Holding em lote (9.5.1a): os mesmos alvos, numa única invalidação no fim.
  'item.offSaleBulk': [K.items.all, K.sales.all, K.profitSummary.all],
  'item.backOnSaleBulk': [K.items.all, K.sales.all, K.profitSummary.all],
  'item.backOnSale': [K.items.all, K.sales.all, K.profitSummary.all],
  'deposit.create': DEPOSIT,
  'deposit.update': DEPOSIT,
  'deposit.delete': DEPOSIT,
  'withdrawal.create': WITHDRAWAL,
  'withdrawal.update': WITHDRAWAL,
  'withdrawal.delete': WITHDRAWAL,
  'balanceCheck.create': CHECK,
  'balanceCheck.delete': CHECK,
  'store.create': STORE_CHANGE,
  'store.update': STORE_CHANGE,
  'store.delete': STORE_CHANGE,
  'settings.fx': [K.settings.all, ...MONEY],
  'settings.aging': [K.settings.all, K.items.all, K.sales.all],
  'settings.preferences': [K.settings.all],
  // Integrações (9.1, D316): chave, loja, teste de conexão e troca de conta só mudam o card.
  'integration.apiKey': [K.integrations.all],
  // "Importar ao abrir o app" e "Reativar" (9.5); também depois de uma importação automática sem nada novo.
  'integration.update': [K.integrations.all],
  'integration.test': [K.integrations.all],
  'integration.switchAccount': [K.integrations.all],
  'catalog.refresh': [K.catalog.all, K.items.all, K.sales.all, K.health.all],
  // O banco inteiro mudou: limpa o cache (o chamador recarrega a janela em seguida).
  'backup.import': 'clear',
} as const satisfies Record<string, readonly Prefix[] | 'clear'>;

export type InvalidationAction = keyof typeof INVALIDATION_MAP;

// Marca como inválidas (e recarrega as consultas ativas) as chaves da ação.
export function invalidateAfter(queryClient: QueryClient, action: InvalidationAction): Promise<unknown> {
  const entry = INVALIDATION_MAP[action];
  if (entry === 'clear') {
    queryClient.clear();
    return Promise.resolve();
  }
  return Promise.all(entry.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
