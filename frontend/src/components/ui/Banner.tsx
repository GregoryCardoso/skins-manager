'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import Button from './Button';
import Icon, { type IconName } from './Icon';
import IconButton from './IconButton';
import styles from './Banner.module.css';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

export interface BannerAction {
  label: string;
  onClick?: () => void;
  // Navegação (next/link). Os links "Ir para Configurações" são da 12.4; aqui é só o href.
  href?: string;
}

export interface BannerProps {
  tone: BannerTone;
  title?: string;
  children: ReactNode;
  action?: BannerAction;
  // "Tentar de novo" (common.retry). `retrying` mostra o carregando no botão.
  onRetry?: () => void;
  retrying?: boolean;
  // "Dispensar" (ui.banner.dismiss).
  onDismiss?: () => void;
  // danger/warning viram role="alert" quando aparecem depois do carregamento. Com `announce={false}` (já estava na tela ao carregar)
  // ficam sem papel, para o leitor de tela não repetir.
  announce?: boolean;
  className?: string;
}

const ICON_BY_TONE: Record<BannerTone, IconName> = { info: 'info', success: 'circleCheck', warning: 'alert', danger: 'circleAlert' };

// Aviso que não bloqueia (D370, 12.3b). O significado está no texto e no ícone, nunca só na cor. Em largura estreita (container), as
// ações descem para baixo do texto.
export default function Banner({ tone, title, children, action, onRetry, retrying = false, onDismiss, announce = true, className }: BannerProps) {
  const t = useT();
  const urgent = tone === 'danger' || tone === 'warning';
  const role = urgent ? (announce ? 'alert' : undefined) : 'status';
  const hasActions = Boolean(action || onRetry);
  return (
    <div className={`${styles.root} ${className ?? ''}`}>
      <div className={`${styles.banner} ${styles[tone]}`} role={role}>
        <span className={styles.icon}>
          <Icon name={ICON_BY_TONE[tone]} size={18} />
        </span>
        <div className={styles.body}>
          {title && <p className={styles.title}>{title}</p>}
          <div className={styles.text}>{children}</div>
        </div>
        {hasActions && (
          <div className={styles.actions}>
            {onRetry && (
              <Button size="sm" icon="refresh" loading={retrying} onClick={onRetry}>
                {t('common.retry')}
              </Button>
            )}
            {action?.href ? (
              <Link prefetch={false} href={action.href} className={styles.link} onClick={action.onClick}>
                <span>{action.label}</span>
                <Icon name="chevronRight" size={14} />
              </Link>
            ) : (
              action && (
                <Button size="sm" onClick={action.onClick}>
                  {action.label}
                </Button>
              )
            )}
          </div>
        )}
        {onDismiss && <IconButton icon="close" size="sm" label={t('ui.banner.dismiss')} onClick={onDismiss} className={styles.dismiss} />}
      </div>
    </div>
  );
}
