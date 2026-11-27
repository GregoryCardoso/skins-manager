'use client';

import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import Icon, { type IconName } from './Icon';
import { SpinnerRing } from './Spinner';
import Tooltip from './Tooltip';
import { useBelow } from './useMediaQuery';
import styles from './Button.module.css';

type NativeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'type'>;

interface BaseProps extends NativeProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  iconPosition?: 'start' | 'end';
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

// `iconOnlyBelow` exige `icon`: abaixo da faixa o texto fica só para leitor de tela e o Tooltip mostra o texto.
export type ButtonProps = BaseProps &
  ({ iconOnlyBelow: 'narrow' | 'compact'; icon: IconName } | { iconOnlyBelow?: undefined; icon?: IconName });

// Botão principal da interface (D370, 12.3a). Carregando: aria-busy, aria-disabled no lugar de disabled (o foco fica), cliques ignorados.
export default function Button(props: ButtonProps) {
  const {
    variant = 'secondary',
    size = 'md',
    icon,
    iconPosition = 'start',
    loading = false,
    type = 'button',
    fullWidth = false,
    iconOnlyBelow,
    className,
    children,
    onClick,
    disabled,
    ref,
    'aria-disabled': ariaDisabled,
    ...rest
  } = props;
  const collapsed = useBelow(iconOnlyBelow);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading || ariaDisabled === true || ariaDisabled === 'true') {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  const iconNode = loading ? <SpinnerRing size={16} /> : icon ? <Icon name={icon} size={16} /> : null;
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth ? styles.full : '',
    loading ? styles.loading : '',
    iconOnlyBelow === 'narrow' ? styles.iconOnlyNarrow : '',
    iconOnlyBelow === 'compact' ? styles.iconOnlyCompact : '',
    className ?? '',
  ].join(' ');

  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled}
      aria-busy={loading ? true : undefined}
      aria-disabled={loading ? true : ariaDisabled}
      onClick={handleClick}
    >
      {iconPosition === 'start' && iconNode}
      <span className={styles.label}>{children}</span>
      {iconPosition === 'end' && iconNode}
    </button>
  );

  const tooltipText = typeof children === 'string' ? children : undefined;
  return collapsed && tooltipText ? <Tooltip content={tooltipText}>{button}</Tooltip> : button;
}
