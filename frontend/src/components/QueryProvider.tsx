'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

// Um só QueryClient por janela (D258). Sem retry (o erro aparece com "Tentar de novo"), sempre busca ao montar
// (staleTime 0; o cache só evita a tela em branco) e recarrega ao voltar o foco para a janela.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, staleTime: 0 } },
  });
}

export default function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
