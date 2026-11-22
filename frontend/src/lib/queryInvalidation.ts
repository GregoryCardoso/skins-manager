// Mapa ação -> chaves invalidadas (D259). Toda escrita nova no api.ts precisa de uma entrada aqui.
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

type Prefix = readonly unknown[];

const K = queryKeys;

// Grupo "dinheiro": tudo o que muda com itens, aportes, saques, saldos, lojas ou cotação.
const MONEY: readonly Prefix[] = [
  K.items.all, K.sales.all, K.stores.all, K.deposits.all, K.withdrawals.all, K.storeBalances.all, K.profitSummary.all,
];
const ITEM_MONEY: readonly Prefix[] = [K.items.all, K.sales.all, K.stores.all, K.storeBalances.all, K.profitSummary.all];
const DEPOSIT: readonly Prefix[] = [K.deposits.all, K.stores.all, K.storeBalances.all, K.profitSummary.all];
const WITHDRAWAL: readonly Prefix[] = [K.withdrawals.all, K.stores.all, K.storeBalances.all, K.profitSummary.all];
const CHECK: readonly Prefix[] = [K.storeBalances.all, K.profitSummary.all];

export const INVALIDATION_MAP = {
  'item.create': ITEM_MONEY,
  'item.update': ITEM_MONEY,
  'item.delete': ITEM_MONEY,
  'item.sell': ITEM_MONEY,
  'item.unsell': ITEM_MONEY,
  'item.offSale': [K.items.all, K.sales.all],
  'item.backOnSale': [K.items.all, K.sales.all],
  'deposit.create': DEPOSIT,
  'deposit.update': DEPOSIT,
  'deposit.delete': DEPOSIT,
  'withdrawal.create': WITHDRAWAL,
  'withdrawal.update': WITHDRAWAL,
  'withdrawal.delete': WITHDRAWAL,
  'balanceCheck.create': CHECK,
  'balanceCheck.delete': CHECK,
  'store.create': MONEY,
  'store.update': MONEY,
  'store.delete': MONEY,
  'settings.fx': [K.settings.all, ...MONEY],
  'settings.aging': [K.settings.all, K.items.all, K.sales.all],
  'settings.preferences': [K.settings.all],
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
