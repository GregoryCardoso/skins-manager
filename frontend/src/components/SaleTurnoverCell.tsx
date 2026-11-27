'use client';

import { useT } from '@/i18n/I18nProvider';
import type { ItemView } from '@/types/api';
import Badge from './ui/Badge';
import TurnoverRule, { type TurnoverLimits } from './ui/TurnoverRule';
import styles from './sales.module.css';

// "Tempo até vender" (12.7a): a régua de giro com o pino na faixa vinda do backend (`turnaroundBucket`) e uma linha de texto
// ("12 d após liberar · Giro rápido"). Venda feita do holding (SEM_GIRO, sem dias) não tem régua: só o selo.
export default function SaleTurnoverCell({ item, limits }: { item: ItemView; limits: TurnoverLimits }) {
  const t = useT();
  const aging = item.aging;
  if (!('turnaroundDays' in aging)) return <span className={styles.muted}>{t('common.none')}</span>;
  if (aging.turnaroundDays === null || aging.turnaroundBucket === 'SEM_GIRO') {
    return <Badge tone="neutral">{t('enums.turnaroundBucket.SEM_GIRO')}</Badge>;
  }
  return <TurnoverRule kind="sale" bucket={aging.turnaroundBucket} days={aging.turnaroundDays} limits={limits} />;
}
