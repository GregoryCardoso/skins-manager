'use client';

import { useSyncExternalStore } from 'react';
import { BREAKPOINTS, HEIGHT_BREAKPOINTS } from '@/styles/breakpoints';

// Os três jeitos do menu lateral (D370, 12.4): expandido (232 px), recolhido (64 px, só ícones) e sobreposto (aberto por cima do
// conteúdo na faixa estreita, sem empurrar a página).
export type NavMode = 'expanded' | 'collapsed' | 'overlay';

const WIDE_QUERY = `(min-width: ${BREAKPOINTS.medium}px)`;
const TALL_QUERY = `(min-height: ${HEIGHT_BREAKPOINTS[1]}px)`;

function useMatch(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    // Sem matchMedia (servidor, export estático) vale o modo largo e alto.
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : true),
    () => true,
  );
}

// Função pura: o modo a partir da largura da janela, da preferência "recolhido" e de o menu estar aberto por cima. Abaixo de 1100 px
// o menu é sempre recolhido (a preferência só vale na faixa larga); abrir por cima não muda a preferência.
export function navModeFor({ wide, collapsedPref, overlayOpen }: { wide: boolean; collapsedPref: boolean; overlayOpen: boolean }): NavMode {
  if (!wide) return overlayOpen ? 'overlay' : 'collapsed';
  return collapsedPref ? 'collapsed' : 'expanded';
}

export interface NavViewport {
  // Largura >= 1100 px.
  wide: boolean;
  // Altura < 700 px: o rodapé do menu fica sempre na forma recolhida.
  short: boolean;
}

export function useNavViewport(): NavViewport {
  const wide = useMatch(WIDE_QUERY);
  const tall = useMatch(TALL_QUERY);
  return { wide, short: !tall };
}
