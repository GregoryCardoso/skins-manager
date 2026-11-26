'use client';

import { useT } from '@/i18n/I18nProvider';
import Icon from './Icon';
import styles from './Spinner.module.css';
import VisuallyHidden from './VisuallyHidden';

// Anel decorativo (usado dentro do Button, que já tem aria-busy).
export function SpinnerRing({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span className={`${styles.ring} ${className ?? ''}`} aria-hidden="true">
      <Icon name="loader" size={size} />
    </span>
  );
}

export interface SpinnerProps {
  size?: 'sm' | 'md';
  // Texto já traduzido (padrão common.loading).
  label?: string;
  className?: string;
}

// Indicador de carregamento: role="status" com o texto visualmente oculto. Com prefers-reduced-motion vira um anel estático.
export default function Spinner({ size = 'md', label, className }: SpinnerProps) {
  const t = useT();
  return (
    <span role="status" className={`${styles.spinner} ${className ?? ''}`}>
      <SpinnerRing size={size === 'sm' ? 14 : 20} />
      <VisuallyHidden>{label ?? t('common.loading')}</VisuallyHidden>
    </span>
  );
}
