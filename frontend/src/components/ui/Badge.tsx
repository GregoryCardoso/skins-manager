'use client';

import type { ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import Icon, { type IconName } from './Icon';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'lock' | 'holding' | 'stuck' | 'profit' | 'loss' | 'estimated' | 'pending' | 'info';

export interface BadgeProps {
  tone: BadgeTone;
  // Decorativo: o significado está sempre no texto.
  icon?: IconName;
  className?: string;
  children: ReactNode;
}

// Etiqueta de estado, sem interação. Sucessora de badges.tsx e das .tag do protótipo.
export default function Badge({ tone, icon, className, children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[tone]} ${className ?? ''}`}>
      {icon && <Icon name={icon} size={12} />}
      <span className={styles.text}>{children}</span>
    </span>
  );
}

// `remainingText`: tempo restante já formatado ("3 d"); sem ele, só o nome do estado.
export function TradeLockBadge({ remainingText }: { remainingText?: string }) {
  const t = useT();
  return (
    <Badge tone="lock" icon="lock">
      {remainingText ? t('inventory.inTradeLock', { time: remainingText }) : t('enums.agingBucket.EM_TRADE_LOCK')}
    </Badge>
  );
}

// `sinceText`: há quanto tempo está no holding, já formatado.
export function HoldingBadge({ sinceText }: { sinceText?: string }) {
  const t = useT();
  return <Badge tone="holding">{sinceText ? `${t('enums.agingBucket.FORA_DE_VENDA')} · ${sinceText}` : t('enums.agingBucket.FORA_DE_VENDA')}</Badge>;
}

export function StuckBadge() {
  const t = useT();
  return (
    <Badge tone="stuck" icon="alert">
      {t('enums.agingBucket.AGARRADO')}
    </Badge>
  );
}
