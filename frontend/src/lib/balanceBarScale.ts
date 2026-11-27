// Escala da BalanceBar (12.7b): só geometria. A barra cheia corresponde ao maior total (disponível + pendente, em US$) entre as
// lojas; valores nulos (sem cotação), zero ou negativos não entram na conta. Nenhum valor de dinheiro é calculado aqui.
import type { StoreBalanceSummary } from '@/types/api';

type BarStore = Pick<StoreBalanceSummary, 'availableUsdCents'> & { pending: Pick<StoreBalanceSummary['pending'], 'usdCents'> };

const positive = (cents: number | null | undefined): number => (typeof cents === 'number' && Number.isFinite(cents) && cents > 0 ? cents : 0);

export function balanceBarScale(stores: readonly BarStore[]): number {
  let max = 0;
  for (const store of stores) max = Math.max(max, positive(store.availableUsdCents) + positive(store.pending.usdCents));
  return max;
}
