'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { getCsfloatIntegration } from '@/services/api';

// Quantas importações esperam conferência ("Para conferir"). Vem do `openEntriesCount` da integração do CSFloat, a mesma consulta
// (mesma chave e mesma função) que o CsfloatAutoImportHost já faz em toda página: o cache é compartilhado e não há pedido a mais.
// Durante o carregamento e no erro devolve null (o selo some, em silêncio).
export function useReviewCount(): number | null {
  const query = useQuery({
    queryKey: queryKeys.integrations.csfloat,
    queryFn: ({ signal }) => getCsfloatIntegration(signal),
    refetchInterval: (q) => (q.state.data?.importInProgress ? 2000 : false),
  });
  return query.data ? query.data.openEntriesCount : null;
}
