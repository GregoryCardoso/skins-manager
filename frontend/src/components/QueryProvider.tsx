'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { isConnectionError, reportConnectionError } from '@/lib/connectionStatus';

// Um só QueryClient por janela (D258). Sem retry (o erro aparece com "Tentar de novo"), sempre busca ao montar
// (staleTime 0; o cache só evita a tela em branco) e recarrega ao voltar o foco para a janela. Erro de conexão em qualquer
// consulta ou ação dispara a checagem do /api/health (12.4); a tela "não está respondendo" só vem depois de duas falhas.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: (error) => { if (isConnectionError(error)) reportConnectionError(); } }),
    mutationCache: new MutationCache({ onError: (error) => { if (isConnectionError(error)) reportConnectionError(); } }),
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, staleTime: 0 } },
  });
}

export default function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
