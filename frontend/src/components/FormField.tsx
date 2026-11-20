'use client';

import { useId, type ReactNode } from 'react';
import styles from './forms.module.css';

export interface FieldControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

interface Props {
  label: string;
  error?: string | null;
  hint?: string | null;
  full?: boolean;
  // Recebe os atributos de acessibilidade para aplicar no controle (input/select).
  children: (control: FieldControlProps) => ReactNode;
}

// Rótulo + controle + dica + erro do campo, ligados por id (acessível a leitores de tela).
export default function FormField({ label, error, hint, full = false, children }: Props) {
  const id = useId();
  const messageId = `${id}-msg`;
  const hasMessage = !!error || !!hint;
  return (
    <div className={`${styles.field} ${full ? styles.full : ''}`}>
      <label htmlFor={id} className={styles.label}>{label}</label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': hasMessage ? messageId : undefined })}
      {hasMessage && (
        <span id={messageId} className={error ? styles.error : styles.hint} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}
