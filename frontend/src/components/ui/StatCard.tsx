'use client';

import type { ReactNode } from 'react';
import HelpTip from './HelpTip';
import styles from './StatCard.module.css';

export type StatTone = 'neutral' | 'stuck' | 'lock' | 'profit' | 'loss';

export interface StatCardProps {
  label: string;
  // Normalmente um <Money>. Nada é calculado aqui.
  value: ReactNode;
  // Linha menor abaixo do valor (por exemplo, "à venda há mais de 21 dias").
  note?: ReactNode;
  tone?: StatTone;
  // Explicação (vira um HelpTip, acessível no teclado e no toque).
  help?: ReactNode;
  className?: string;
  // Para os testes e a automação (data-testid).
  testId?: string;
}

// Um número da faixa de posição: <div><dt/><dd/></div>. A cor do valor é reforço: o sentido está no rótulo.
export function StatCard({ label, value, note, tone = 'neutral', help, className, testId }: StatCardProps) {
  return (
    <div className={`${styles.card} ${className ?? ''}`} data-testid={testId}>
      <dt className={styles.label}>
        <span className={styles.labelText}>{label}</span>
        {help && <HelpTip topic={label}>{help}</HelpTip>}
      </dt>
      <dd className={`${styles.value} ${styles[tone]}`}>{value}</dd>
      {note && <dd className={styles.note}>{note}</dd>}
    </div>
  );
}

export interface PositionStripProps {
  // Nome acessível do grupo.
  label: string;
  // StatCards.
  children: ReactNode;
  className?: string;
}

// A "faixa de posição" do protótipo: uma linha de livro-razão com vários números, não uma grade de cards. Largura do próprio
// componente: abaixo de 960 px vira 2 colunas e abaixo de 480 px, 1 coluna; nada rola na horizontal.
export function PositionStrip({ label, children, className }: PositionStripProps) {
  return (
    <div role="group" aria-label={label} className={`${styles.root} ${className ?? ''}`}>
      <dl className={styles.strip}>{children}</dl>
    </div>
  );
}

export default StatCard;
