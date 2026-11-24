'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useAutoImportProgress } from '@/lib/autoImportProgress';
import { BUSY_RETRY_DELAY_MS, BUSY_RETRY_MAX_WAIT_MS, decidePriceRefreshStart, nextAfterRefresh, START_DELAY_MS } from '@/lib/priceRefresh';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { getCsfloatIntegration, refreshMarketValues } from '@/services/api';
import type { IntegrationView } from '@/types/api';
import { PRICE_REFRESH_MUTATION_KEY } from './useMarketSummary';

// Uma tentativa por carga da página; o backend ainda garante uma por processo (`ALREADY_RAN`).
let attemptedThisPage = false;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Busca os preços de mercado ao abrir o app, depois da importação automática (10.6, D365 item 4). Nunca mostra aviso nem erro
// (falhas silenciosas, 2.13) e não renderiza nada.
export default function PriceAutoRefreshHost() {
  const invalidate = useInvalidate();
  const integrationQuery = useQuery({
    queryKey: queryKeys.integrations.csfloat,
    queryFn: ({ signal }) => getCsfloatIntegration(signal),
    refetchInterval: (query) => (query.state.data?.importInProgress ? 2000 : false),
  });
  const autoImport = useAutoImportProgress();
  const mutation = useMutation({ mutationKey: PRICE_REFRESH_MUTATION_KEY, mutationFn: () => refreshMarketValues() });
  const integration = integrationQuery.data ?? null;
  const integrationRef = useRef<IntegrationView | null>(integration);
  integrationRef.current = integration;
  const started = useRef(false);
  const mutateAsync = mutation.mutateAsync;

  useEffect(() => {
    if (started.current || attemptedThisPage) return undefined;
    const status = integrationQuery.isPending ? 'pending' : integrationQuery.isError ? 'error' : 'success';
    if (decidePriceRefreshStart({ integrationStatus: status, integration, autoImport }) !== 'GO') return undefined;

    const run = async () => {
      let retried = false;
      for (;;) {
        let outcome: unknown;
        try {
          outcome = await mutateAsync();
        } catch (err) {
          outcome = err;
        }
        const next = nextAfterRefresh(outcome, { retried });
        if (next.action === 'RETRY_WHEN_IDLE') {
          retried = true;
          // A consulta da integração volta a vigiar o `importInProgress`; espera ele acabar e o tempo mínimo.
          invalidate('integration.update').catch(() => undefined);
          const waitingSince = Date.now();
          while (Date.now() - waitingSince < BUSY_RETRY_MAX_WAIT_MS
            && (Date.now() - waitingSince < BUSY_RETRY_DELAY_MS || integrationRef.current?.importInProgress)) {
            await sleep(500);
          }
          continue;
        }
        const action: 'marketValues.refresh' | 'marketValues.status' = next.invalidate;
        await invalidate(action).catch(() => undefined);
        return;
      }
    };

    const timer = setTimeout(() => {
      if (started.current || attemptedThisPage) return;
      started.current = true;
      attemptedThisPage = true;
      run().catch(() => undefined);
    }, START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [integration, integrationQuery.isPending, integrationQuery.isError, autoImport, invalidate, mutateAsync]);

  return null;
}
