'use client';

import { useLocale, useT, useTPlural } from '@/i18n/I18nProvider';
import { formatMoney } from '@/lib/format';
import type { ItemStats } from '@/types/api';
import styles from './ItemHistoryBox.module.css';
import { StatCard } from './ui/StatCard';

interface Props {
  stats: ItemStats;
  compact?: boolean;
}

// Histórico agregado do "mesmo item" (2.7), com os dados que já vêm no item (D128). Valores em US$, sem "≈". Métricas em StatCards
// (12.6b); "Tempo médio até vender" ganha a legenda visível de como é contado (pendência B).
export default function ItemHistoryBox({ stats, compact = false }: Props) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const usd = (cents: number | null) => (cents === null ? t('common.none') : formatMoney(cents, 'USD', locale));
  const hasSales = stats.soldCount > 0;
  const profitTone = stats.avgProfitUsdCents === null || stats.avgProfitUsdCents === 0 ? 'neutral' : stats.avgProfitUsdCents < 0 ? 'loss' : 'profit';

  return (
    <section className={`${styles.box} ${compact ? `${styles.compact} ${styles.compactWrap}` : ''}`} aria-label={t('history.heading')}>
      {compact && <h3 className={styles.title}>{t('history.heading')}</h3>}
      {hasSales ? (
        <dl className={styles.grid}>
          <StatCard label={t('history.soldCount')} value={stats.soldCount} />
          <StatCard
            label={t('history.avgDaysToSell')}
            value={stats.avgDaysToSell === null
              ? t('common.none')
              : tPlural('history.daysValue', stats.avgDaysToSell, { days: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(stats.avgDaysToSell) })}
          />
          <StatCard label={t('history.avgPurchaseCost')} value={usd(stats.avgPurchaseCostUsdCents)} note={tPlural('history.avgCostUnits', stats.unitCount)} />
          <StatCard label={t('history.avgSalePrice')} value={usd(stats.avgSalePriceUsdCents)} />
          <StatCard label={t('history.avgProfit')} value={usd(stats.avgProfitUsdCents)} tone={profitTone} />
        </dl>
      ) : (
        <>
          <p className={styles.none}>{t('history.none')}</p>
          {stats.avgPurchaseCostUsdCents !== null && (
            <p className={styles.note}>
              {t('history.avgPurchaseCost')}: {usd(stats.avgPurchaseCostUsdCents)} {tPlural('history.avgCostUnits', stats.unitCount)}
            </p>
          )}
        </>
      )}
      {hasSales && !compact && <p className={styles.legend}>{t('history.avgDaysLegend')}</p>}
      {stats.consumedCount > 0 && (
        <p className={styles.note}>{tPlural('history.consumedCount', stats.consumedCount)}</p>
      )}
      {stats.lossCount > 0 && (
        <p className={styles.note}>{tPlural('history.lossCount', stats.lossCount, { value: usd(stats.lossUsdCents) })}</p>
      )}
      {stats.soldOffSaleCount > 0 && (
        <p className={styles.note}>{tPlural('history.soldOffSale', stats.soldOffSaleCount)}</p>
      )}
      {stats.soldWithFxCount > 0 && (
        <p className={styles.note}>{t('history.fxNote', { count: stats.soldWithFxCount, total: stats.soldCount })}</p>
      )}
      {!compact && <p className={styles.note}>{t('history.keyNote')}</p>}
    </section>
  );
}
