'use client';

import { useLanguage, useT, useTPlural } from '@/i18n/I18nProvider';
import { formatMoney } from '@/lib/format';
import type { ItemStats } from '@/types/api';
import styles from './ItemHistoryBox.module.css';

interface Props {
  stats: ItemStats;
  compact?: boolean;
}

// Histórico agregado do "mesmo item" (2.7), com os dados que já vêm no item (D128). Valores em US$, sem "≈".
export default function ItemHistoryBox({ stats, compact = false }: Props) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLanguage();
  const usd = (cents: number | null) => (cents === null ? t('common.none') : formatMoney(cents, 'USD', locale));
  const hasSales = stats.soldCount > 0;
  const profitNegative = stats.avgProfitUsdCents !== null && stats.avgProfitUsdCents < 0;

  return (
    <section className={`${styles.box} ${compact ? styles.compact : ''}`} aria-label={t('history.heading')}>
      {compact && <h3 className={styles.title}>{t('history.heading')}</h3>}
      {hasSales ? (
        <dl className={styles.grid}>
          <div className={styles.cell}>
            <dt>{t('history.soldCount')}</dt>
            <dd>{stats.soldCount}</dd>
          </div>
          <div className={styles.cell}>
            <dt>{t('history.avgDaysToSell')}</dt>
            <dd>{stats.avgDaysToSell === null ? t('common.none') : t('history.daysValue', { days: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(stats.avgDaysToSell) })}</dd>
          </div>
          <div className={styles.cell}>
            <dt>{t('history.avgPurchaseCost')}</dt>
            <dd>
              {usd(stats.avgPurchaseCostUsdCents)}{' '}
              <span className={styles.sub}>{tPlural('history.avgCostUnits', stats.unitCount)}</span>
            </dd>
          </div>
          <div className={styles.cell}>
            <dt>{t('history.avgSalePrice')}</dt>
            <dd>{usd(stats.avgSalePriceUsdCents)}</dd>
          </div>
          <div className={styles.cell}>
            <dt>{t('history.avgProfit')}</dt>
            <dd className={profitNegative ? styles.negative : undefined}>{usd(stats.avgProfitUsdCents)}</dd>
          </div>
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
