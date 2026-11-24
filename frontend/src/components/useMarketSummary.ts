'use client';

import { useIsMutating, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { getMarketValueSummary } from '@/services/api';

// Chave da mutação que busca os preços (usada pelo host e pelo indicador).
export const PRICE_REFRESH_MUTATION_KEY = ['marketValues', 'refresh'] as const;

// Resumo do valor de mercado (10.6, D365). Recarrega a cada 2 s só enquanto o backend diz que há uma rodada em curso e esta página
// não foi a que a disparou (outra aba, ou F5 no meio da rodada); quem disparou recarrega pela invalidação no fim.
export function useMarketSummary() {
  const refreshing = useIsMutating({ mutationKey: PRICE_REFRESH_MUTATION_KEY }) > 0;
  const query = useQuery({
    queryKey: queryKeys.marketValues.summary,
    queryFn: ({ signal }) => getMarketValueSummary(signal),
    refetchInterval: (q) => (q.state.data?.inProgress && !refreshing ? 2000 : false),
  });
  return { summary: query.data ?? null, error: query.error ?? null, refreshing, query };
}
