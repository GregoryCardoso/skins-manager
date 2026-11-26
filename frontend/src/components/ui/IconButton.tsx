'use client';

import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react';
import Icon, { type IconName } from './Icon';
import { SpinnerRing } from './Spinner';
import Tooltip from './Tooltip';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'type' | 'aria-label'> {
  icon: IconName;
  // Obrigatório: vira o aria-label e o texto do Tooltip.
  label: string;
  variant?: 'ghost' | 'secondary' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  // Botão que liga/desliga: vira aria-pressed.
  pressed?: boolean;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

// Botão só de ícone. A área clicável nunca fica menor que --target-min (24 px), mesmo com o ícone de 16 px.
export default function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  loading = false,
  pressed,
  className,
  onClick,
  ref,
  ...rest
}: IconButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <Tooltip content={label}>
      <button
        {...rest}
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        aria-busy={loading ? true : undefined}
        aria-disabled={loading ? true : undefined}
        className={`${styles.button} ${styles[variant]} ${styles[size]} ${className ?? ''}`}
        onClick={handleClick}
      >
        {loading ? <SpinnerRing size={16} /> : <Icon name={icon} size={16} />}
      </button>
    </Tooltip>
  );
}
