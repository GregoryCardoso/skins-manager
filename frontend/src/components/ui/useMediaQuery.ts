'use client';

import { useSyncExternalStore } from 'react';
import { BREAKPOINTS } from '@/styles/breakpoints';

// "Faixa" de iconOnlyBelow: narrow = faixa estreita e abaixo (largura < 1100); compact = faixa compacta (largura < 900).
export type CollapseBelow = 'narrow' | 'compact';
const LIMIT_PX: Record<CollapseBelow, number> = { narrow: BREAKPOINTS.medium, compact: BREAKPOINTS.narrow };

// Só para o que é da janela inteira (D370, regra 3): iconOnlyBelow do Button e do SegmentedControl, que também decide se o Tooltip
// aparece. O resto da responsividade é CSS (container queries). Na renderização do servidor (export estático) vale "não está abaixo".
export function useBelow(below: CollapseBelow | undefined): boolean {
  const query = below ? `(width < ${LIMIT_PX[below]}px)` : null;
  return useSyncExternalStore(
    (onChange) => {
      if (!query || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => (query && typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  );
}
