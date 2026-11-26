import type { ReactNode } from 'react';
import Icon, { type IconName } from './Icon';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  // Normalmente um Button.
  action?: ReactNode;
  className?: string;
}

// Lista ou área sem nada para mostrar: centralizado, com o texto limitado a 40ch (D370, 12.3b).
export default function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={`${styles.empty} ${className ?? ''}`}>
      {icon && (
        <span className={styles.icon}>
          <Icon name={icon} size={28} />
        </span>
      )}
      <p className={styles.title}>{title}</p>
      {description && <div className={styles.description}>{description}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
