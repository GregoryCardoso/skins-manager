'use client';

import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { useRef } from 'react';
import Icon, { type IconName } from './Icon';
import Tooltip from './Tooltip';
import { useBelow, type CollapseBelow } from './useMediaQuery';
import styles from './SegmentedControl.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface SegmentedControlProps<T extends string> {
  // aria-label do grupo.
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'sm' | 'md';
  disabled?: boolean;
  // Nas faixas estreitas, as opções com ícone ficam só no ícone (o texto continua como nome acessível) e ganham Tooltip.
  iconOnlyBelow?: CollapseBelow;
  className?: string;
}

// Escolha única e exclusiva (Agrupado/Individual, densidade, tema). Setas movem e selecionam; um único ponto de Tab; nunca fica sem valor.
export default function SegmentedControl<T extends string>({ label, value, onChange, options, size = 'md', iconOnlyBelow, className, disabled }: SegmentedControlProps<T>) {
  const collapsed = useBelow(iconOnlyBelow);
  // Seleciona ao focar só quando o foco veio das setas/Home/End (clique e Tab não disparam duas vezes).
  const byKeyboard = useRef(false);
  const collapseClass = iconOnlyBelow === 'narrow' ? styles.iconOnlyNarrow : iconOnlyBelow === 'compact' ? styles.iconOnlyCompact : '';

  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={label}
      rovingFocus
      disabled={disabled}
      className={`${styles.group} ${styles[size]} ${collapseClass} ${className ?? ''}`}
      // O Radix deixa desmarcar o item ativo (valor ''): ignorado, o controle nunca fica sem valor.
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      onKeyDownCapture={(event) => {
        byKeyboard.current = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key);
      }}
      onPointerDownCapture={() => {
        byKeyboard.current = false;
      }}
    >
      {options.map((option) => {
        const item = (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            className={styles.item}
            onFocus={() => {
              if (byKeyboard.current && option.value !== value) onChange(option.value);
            }}
          >
            {option.icon && <Icon name={option.icon} size={14} />}
            <span className={option.icon ? styles.label : styles.plain}>{option.label}</span>
          </ToggleGroup.Item>
        );
        return collapsed && option.icon ? (
          <Tooltip key={option.value} content={option.label}>
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
    </ToggleGroup.Root>
  );
}
