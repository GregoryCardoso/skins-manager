'use client';

import { useEffect, useRef } from 'react';
import { useTPlural } from '@/i18n/I18nProvider';
import Icon from './Icon';
import styles from './FormErrorSummary.module.css';

export interface FormErrorItem {
  // Nome do campo (o mesmo `name` do Field / data-field do controle).
  field: string;
  label: string;
  message: string;
}

export interface FormErrorSummaryProps {
  errors: FormErrorItem[];
  title?: string;
  className?: string;
}

function focusField(field: string): void {
  const name = CSS.escape(field);
  // Checkbox e Switch não têm `data-field`: o nome do campo é o `name` do <input>.
  const control = document.querySelector<HTMLElement>(`[data-field="${name}"], input[name="${name}"]`);
  control?.focus();
}

// Resumo no topo do formulário ao enviar com erros: recebe o foco ao montar ou mudar (anuncia por role="alert") e cada item leva ao campo.
export default function FormErrorSummary({ errors, title, className }: FormErrorSummaryProps) {
  const tPlural = useTPlural();
  const ref = useRef<HTMLDivElement>(null);
  const signature = errors.map((error) => `${error.field}:${error.message}`).join('|');
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Só pega o foco quando aparece um erro novo (ou ao montar): corrigir um campo e sobrar o resto não tira o foco de quem digita.
    const current = new Set(errors.map((error) => `${error.field}:${error.message}`));
    const appeared = [...current].some((key) => !seen.current.has(key));
    seen.current = current;
    if (appeared) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  if (errors.length === 0) return null;
  return (
    <div ref={ref} role="alert" tabIndex={-1} className={`${styles.summary} ${className ?? ''}`}>
      <div className={styles.title}>
        <Icon name="alert" size={16} />
        <span>{title ?? tPlural('ui.formErrors.title', errors.length)}</span>
      </div>
      <ul className={styles.list}>
        {errors.map((error) => (
          <li key={error.field}>
            <button type="button" className={styles.link} onClick={() => focusField(error.field)}>
              <strong>{error.label}</strong>: {error.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
