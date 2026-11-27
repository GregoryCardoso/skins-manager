'use client';

import { useId } from 'react';
import Button from '../ui/Button';
import styles from './EntryChoice.module.css';

interface Props {
  label: string;
  // A frase que explica o que a escolha faz: fica visível ao lado do botão e ligada a ele por aria-describedby.
  explain: string;
  tone?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}

// Uma escolha de uma pendência da importação (12.9): botão + frase. A principal fica em destaque e as perigosas em `danger`.
export default function EntryChoice({ label, explain, tone = 'secondary', disabled = false, onClick }: Props) {
  const explainId = useId();
  return (
    <div className={styles.choice} data-testid="entry-choice">
      <Button size="sm" variant={tone} disabled={disabled} aria-describedby={explainId} onClick={onClick}>
        {label}
      </Button>
      <span id={explainId} className={styles.explain}>{explain}</span>
    </div>
  );
}
