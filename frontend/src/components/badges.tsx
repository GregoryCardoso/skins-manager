import type { ReactNode } from 'react';
import styles from './badges.module.css';

export type BadgeTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

interface BadgeProps {
  tone?: BadgeTone;
  icon?: string;
  title?: string;
  children: ReactNode;
}

// O significado vem sempre do texto; cor e ícone só reforçam (acessível sem depender de cor).
export function Badge({ tone = 'neutral', icon, title, children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`} title={title}>
      {icon && <span aria-hidden="true">{icon} </span>}
      {children}
    </span>
  );
}
