'use client';

import type { ReactNode, Ref } from 'react';
import Field from './Field';
import Icon, { type IconName } from './Icon';
import styles from './TextField.module.css';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'search' | 'date' | 'datetime-local' | 'url' | 'password';
  hint?: ReactNode;
  error?: string | null;
  placeholder?: string;
  leadingIcon?: IconName;
  // Algo ao fim do campo (botão de limpar, unidade).
  trailing?: ReactNode;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  name?: string;
  maxLength?: number;
  // Campos secretos (chave da API): sem autocompletar, correção nem checagem ortográfica.
  autoComplete?: string;
  autoCorrect?: 'on' | 'off';
  autoCapitalize?: 'off' | 'none' | 'sentences' | 'words' | 'characters';
  spellCheck?: boolean;
  inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';
  required?: boolean;
  optional?: boolean;
  full?: boolean;
  align?: 'start' | 'end';
  onBlur?: () => void;
  onFocus?: () => void;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
}

// Field + <input>. O campo de busca é type="search" + leadingIcon="search". Data: type="date" com lib/dateInput.
export default function TextField({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  error,
  placeholder,
  leadingIcon,
  trailing,
  disabled,
  readOnly,
  autoFocus,
  name,
  maxLength,
  autoComplete,
  autoCorrect,
  autoCapitalize,
  spellCheck,
  inputMode,
  required,
  optional,
  full,
  align = 'start',
  onBlur,
  onFocus,
  className,
  inputRef,
}: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} optional={optional} full={full} name={name} className={className}>
      {(control) => (
        <div className={`${styles.wrap} ${control['aria-invalid'] ? styles.invalid : ''} ${disabled ? styles.disabled : ''}`}>
          {leadingIcon && <Icon name={leadingIcon} size={16} className={styles.leading} />}
          <input
            {...control}
            ref={inputRef}
            className={`${styles.input} ${align === 'end' ? styles.alignEnd : ''}`}
            type={type}
            name={name}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            readOnly={readOnly}
            autoFocus={autoFocus}
            maxLength={maxLength}
            autoComplete={autoComplete}
            autoCorrect={autoCorrect}
            autoCapitalize={autoCapitalize}
            spellCheck={spellCheck}
            inputMode={inputMode}
            required={required}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            onFocus={onFocus}
          />
          {trailing && <span className={styles.trailing}>{trailing}</span>}
        </div>
      )}
    </Field>
  );
}
