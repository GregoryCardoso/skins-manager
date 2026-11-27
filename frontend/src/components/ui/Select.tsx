'use client';

import type { ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import Field from './Field';
import Icon from './Icon';
import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  // Idioma do texto da opção (nomes de idiomas escritos neles mesmos).
  lang?: string;
  // Grupo (`<optgroup>`) da opção; sem grupo, a opção vem antes dos grupos.
  group?: string;
}

export interface SelectGroup {
  id: string;
  label: string;
}

export interface SelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  // Grupos, na ordem em que aparecem (`<optgroup>`). As opções sem `group` vêm antes, soltas.
  groups?: SelectGroup[];
  // Texto da opção vazia (padrão common.select), mostrada só enquanto `value` é ''.
  placeholder?: string;
  hint?: ReactNode;
  error?: string | null;
  disabled?: boolean;
  required?: boolean;
  optional?: boolean;
  full?: boolean;
  name?: string;
  autoFocus?: boolean;
  className?: string;
}

// <select> nativo estilizado: teclado e leitor de tela são os do sistema. Listas longas podem vir em grupos (a moeda de conversão,
// por região, a pedido do usuário: lista igual à do idioma, sem campo de busca). O Combobox fica para busca no catálogo.
export default function Select({ label, value, onChange, options, groups, placeholder, hint, error, disabled, required, optional, full, name, autoFocus, className }: SelectProps) {
  const t = useT();
  const renderOption = (option: SelectOption) => (
    <option key={option.value} value={option.value} disabled={option.disabled} lang={option.lang}>
      {option.label}
    </option>
  );
  return (
    <Field label={label} hint={hint} error={error} required={required} optional={optional} full={full} name={name} className={className}>
      {(control) => (
        <div className={`${styles.wrap} ${control['aria-invalid'] ? styles.invalid : ''} ${disabled ? styles.disabled : ''}`}>
          <select {...control} className={styles.select} name={name} value={value} disabled={disabled} required={required} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)}>
            {value === '' && (
              <option value="" disabled>
                {placeholder ?? t('common.select')}
              </option>
            )}
            {options.filter((option) => !groups || option.group === undefined).map(renderOption)}
            {groups?.map((group) => {
              const inGroup = options.filter((option) => option.group === group.id);
              return inGroup.length === 0 ? null : (
                <optgroup key={group.id} label={group.label}>
                  {inGroup.map(renderOption)}
                </optgroup>
              );
            })}
          </select>
          <Icon name="chevronDown" size={16} className={styles.chevron} />
        </div>
      )}
    </Field>
  );
}
