'use client';

import type { ReactNode } from 'react';
import Icon from './Icon';
import styles from './Chip.module.css';

export interface ChipProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  // Só a bolinha colorida ao lado do texto.
  tone?: 'neutral' | 'stuck' | 'lock' | 'brand';
  count?: number;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

// Filtro liga/desliga. Grupo de chips: o chamador envolve em <div role="group" aria-label>. Pressionado: borda, fundo e ícone check.
export default function Chip({ pressed, onPressedChange, tone, count, disabled, className, children }: ChipProps) {
  return (
    <button type="button" className={`${styles.chip} ${className ?? ''}`} aria-pressed={pressed} disabled={disabled} onClick={() => onPressedChange(!pressed)}>
      {pressed ? <Icon name="check" size={14} /> : tone ? <span className={`${styles.dot} ${styles[tone]}`} aria-hidden="true" /> : null}
      <span className={styles.text}>{children}</span>
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
}
