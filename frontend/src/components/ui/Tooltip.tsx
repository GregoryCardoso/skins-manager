'use client';

import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';
import styles from './Tooltip.module.css';

export interface TooltipProps {
  // Texto curto. Nunca leva informação que não exista em outro lugar (para isso, HelpTip).
  content: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactElement;
}

const DELAY_MS = 400;

function delayDuration(): number {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  return DELAY_MS;
}

// Um só Provider para o app todo (no layout, 12.4): atraso de 400 ms, e 0 com movimento reduzido.
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={delayDuration()} skipDelayDuration={300}>
      {children}
    </RadixTooltip.Provider>
  );
}

// Complemento visual de algo que já tem nome acessível (IconButton, botão recolhido). Abre no hover e no foco; Esc fecha.
// Precisa de um <TooltipProvider> acima (o layout e o renderUi dos testes já o trazem).
export default function Tooltip({ content, side = 'top', children }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className={styles.content} side={side} sideOffset={6} collisionPadding={8} avoidCollisions>
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
