'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import Icon from './Icon';
import styles from './Checkbox.module.css';

export interface CheckboxProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  // Só no Checkbox: estado "parcial" (selecionar tudo com seleção parcial). Aplicado por ref (não existe como atributo HTML).
  indeterminate?: boolean;
  hint?: ReactNode;
  error?: string | null;
  disabled?: boolean;
  name?: string;
  // Rótulo só para leitor de tela quando `label` não é texto (célula de tabela).
  'aria-label'?: string;
  className?: string;
}

interface InternalProps extends CheckboxProps {
  asSwitch?: boolean;
}

export function CheckControl({ label, checked, onChange, indeterminate = false, hint, error, disabled, name, className, asSwitch = false, ...rest }: InternalProps) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !asSwitch && indeterminate && !checked;
  }, [indeterminate, checked, asSwitch]);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={`${styles.root} ${className ?? ''}`}>
      <label className={`${styles.label} ${disabled ? styles.disabled : ''}`}>
        <input
          ref={ref}
          id={id}
          type="checkbox"
          role={asSwitch ? 'switch' : undefined}
          className={`${styles.input} ${asSwitch ? styles.switch : styles.box}`}
          name={name}
          checked={checked}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          aria-label={rest['aria-label']}
          onChange={(event) => onChange(event.target.checked)}
        />
        {!asSwitch && (
          <span className={styles.mark} aria-hidden="true">
            {indeterminate && !checked ? <Icon name="minus" size={14} /> : <Icon name="check" size={14} />}
          </span>
        )}
        {asSwitch && <span className={styles.thumb} aria-hidden="true" />}
        <span className={styles.text}>{label}</span>
      </label>
      {hint && (
        <div id={hintId} className={styles.hint}>
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} className={styles.error}>
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// <input type="checkbox"> nativo estilizado. O rótulo inteiro é clicável; a marca é um ícone (não só cor). Em formulário que salva
// depois, use o Checkbox; o Switch é só para efeito imediato.
export default function Checkbox(props: CheckboxProps) {
  return <CheckControl {...props} />;
}
