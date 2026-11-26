'use client';

import { useId, type ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import Icon from './Icon';
import styles from './Field.module.css';

// O que o controle (input, select...) recebe para ficar ligado ao rótulo, à dica e ao erro.
export interface FieldControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
  'aria-required'?: boolean;
  // Nome do campo: o FormErrorSummary acha e foca o controle por este atributo.
  'data-field'?: string;
}

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  // Mostra "(opcional)" ao lado do rótulo.
  optional?: boolean;
  full?: boolean;
  // Nome do campo para o FormErrorSummary (vira data-field no controle).
  name?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

// Moldura de campo: rótulo + controle + dica + erro, ligados por id. Sucessora do FormField, com a mesma render prop.
// O erro NÃO usa role="alert" (falaria a cada tecla): o anúncio é do FormErrorSummary, ao enviar.
export default function Field({ label, hint, error, required, optional, full = false, name, className, children }: FieldProps) {
  const t = useT();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasHint = hint !== undefined && hint !== null && hint !== false && hint !== '';
  const describedBy = [hasHint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={`${styles.field} ${full ? styles.full : ''} ${className ?? ''}`}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required && <span className={styles.required} aria-hidden="true"> *</span>}
        {optional && <span className={styles.optional}> {t('common.optional')}</span>}
      </label>
      {children({
        id,
        'aria-invalid': !!error,
        'aria-describedby': describedBy || undefined,
        'aria-required': required ? true : undefined,
        'data-field': name,
      })}
      {hasHint && (
        <div id={hintId} className={styles.hint}>
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} className={styles.error}>
          <Icon name="alert" size={14} className={styles.errorIcon} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
