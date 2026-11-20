'use client';

import { useLanguage, useT } from '@/i18n/I18nProvider';
import { formatMoney } from '@/lib/format';
import type { SalesSummary as Summary } from '@/types/api';
import styles from './SalesSummary.module.css';

export default function SalesSummary({ summary }: { summary: Summary }) {
  const t = useT();
  const locale = useLanguage();
  const usd = (cents: number) => formatMoney(cents, 'USD', locale);
  const approx = (cents: number | null) =>
    cents === null ? null : <span className={styles.approx}>{t('common.approx', { value: formatMoney(cents, 'BRL', locale) })}</span>;
  const profit = summary.totalProfitUsdCents;
  const profitText = `${profit > 0 ? '+' : ''}${usd(profit)}`;
  const avg = summary.avgTurnaroundDays;

  return (
    <section className={styles.wrap} aria-label={t('salesSummary.label')}>
      <dl className={styles.cards}>
        <div className={styles.card}>
          <dt>{t('salesSummary.sales')}</dt>
          <dd>{summary.count}</dd>
        </div>
        <div className={styles.card}>
          <dt>{t('salesSummary.totalSold')}</dt>
          <dd>{usd(summary.totalSalePriceUsdCents)} {approx(summary.approxBrl.totalSalePrice)}</dd>
        </div>
        <div className={styles.card}>
          <dt>{t('salesSummary.totalNet')}</dt>
          <dd>{usd(summary.totalNetReceivedUsdCents)} {approx(summary.approxBrl.totalNetReceived)}</dd>
        </div>
        <div className={styles.card}>
          <dt>{t('salesSummary.totalProfit')}</dt>
          <dd
            className={profit < 0 ? styles.negative : undefined}
            title={t('salesSummary.profitTitle', {
              net: usd(summary.totalNetReceivedUsdCents), cost: usd(summary.totalPurchaseCostUsdCents),
            })}
          >
            {profitText} {approx(summary.approxBrl.totalProfit)}
          </dd>
        </div>
        <div className={styles.card}>
          <dt>{t('salesSummary.avgTurnaround')}</dt>
          <dd>
            {avg === null
              ? t('common.none')
              : t('salesSummary.avgTurnaroundValue', { days: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(avg) })}
          </dd>
        </div>
      </dl>
      {summary.soldWithFxCount > 0 && <p className={styles.note}>{t('salesSummary.usdNote')}</p>}
    </section>
  );
}
