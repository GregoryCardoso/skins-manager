'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { invalidateAfter, type InvalidationAction } from './queryInvalidation';

// Devolve `invalidate(action)`: marca como inválidas as consultas da ação (D259) e recarrega as que estão na tela.
export function useInvalidate() {
  const queryClient = useQueryClient();
  return useCallback((action: InvalidationAction) => invalidateAfter(queryClient, action), [queryClient]);
}
