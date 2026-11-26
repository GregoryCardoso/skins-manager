'use client';

import { useT } from '@/i18n/I18nProvider';
import styles from './BalanceBar.module.css';

export interface BalanceBarProps {
  // Os três valores na MESMA unidade, prontos da API (normalmente centavos de US$). O componente só divide.
  availableCents: number;
  pendingCents: number;
  // O valor que corresponde à barra cheia (por exemplo, o maior saldo entre as lojas).
  scaleMaxCents: number;
  // Textos já formatados pelo chamador, para o nome acessível: "Disponível {available}, pendente {pending}".
  availableText: string;
  pendingText: string;
  // Substitui o nome acessível padrão (ui.balance.barLabel).
  label?: string;
  className?: string;
}

// Larguras em % da barra: valores negativos viram 0, `scaleMax` 0 deixa a barra vazia, e a soma nunca passa de 100%.
export function barWidths(availableCents: number, pendingCents: number, scaleMaxCents: number): { available: number; pending: number } {
  if (!(scaleMaxCents > 0)) return { available: 0, pending: 0 };
  const part = (cents: number) => (Number.isFinite(cents) && cents > 0 ? (cents / scaleMaxCents) * 100 : 0);
  const available = Math.min(part(availableCents), 100);
  const pending = Math.min(part(pendingCents), 100 - available);
  return { available, pending };
}

// Barra de saldo de uma loja: disponível em --brand e a parte ainda retida listrada (padrão de "pendente"). role="img" com o resumo em
// texto, porque a barra em si é só visual.
export default function BalanceBar({ availableCents, pendingCents, scaleMaxCents, availableText, pendingText, label, className }: BalanceBarProps) {
  const t = useT();
  const widths = barWidths(availableCents, pendingCents, scaleMaxCents);
  return (
    <div
      role="img"
      aria-label={label ?? t('ui.balance.barLabel', { available: availableText, pending: pendingText })}
      className={`${styles.bar} ${className ?? ''}`}
    >
      <i className={styles.available} style={{ width: `${widths.available}%` }} />
      <i className={styles.pending} style={{ width: `${widths.pending}%` }} />
    </div>
  );
}
