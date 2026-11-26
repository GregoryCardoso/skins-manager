'use client';

import { useT } from '@/i18n/I18nProvider';
import Button from './Button';
import Icon from './Icon';
import styles from './EmptyState.module.css';

export interface ErrorStateProps {
  title?: string;
  // Texto já traduzido (normalmente o resultado de errorMessage).
  message: string;
  // Com ele, aparece o botão "Tentar de novo" (common.retry), junto do erro de carregamento.
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

// Erro de carregamento de uma área: role="alert", com "Tentar de novo". Mesmo molde do EmptyState.
export default function ErrorState({ title, message, onRetry, retrying = false, className }: ErrorStateProps) {
  const t = useT();
  return (
    <div role="alert" className={`${styles.empty} ${className ?? ''}`}>
      <span className={`${styles.icon} ${styles.errorIcon}`}>
        <Icon name="circleAlert" size={28} />
      </span>
      {title && <p className={styles.title}>{title}</p>}
      <div className={styles.description}>{message}</div>
      {onRetry && (
        <div className={styles.action}>
          <Button icon="refresh" loading={retrying} onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      )}
    </div>
  );
}
