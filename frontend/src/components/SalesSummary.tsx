'use client';

import { useLocale, useT, useTPlural } from '@/i18n/I18nProvider';
import { formatMoney } from '@/lib/format';
import type { SalesSummary as Summary } from '@/types/api';
import Money from './ui/Money';
import { useDisplayStaleRateNote } from './useStaleRateNote';
import { PositionStrip, StatCard } from './ui/StatCard';
import styles from './sales.module.css';

// Resumo do período (12.7a): faixa de posição com 5 números. Todos vêm prontos da API (o "≈" também); aqui só formata.
export default function SalesSummary({ summary }: { summary: Summary }) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const usd = (cents: number) => formatMoney(cents, 'USD', locale);
  const profit = summary.totalProfitUsdCents;
  const avg = summary.avgTurnaroundDays;
  const approxCurrency = summary.approxCurrency;
  const staleRateNote = useDisplayStaleRateNote();

  return (
    <section className={styles.summary} aria-label={t('salesSummary.label')}>
      <PositionStrip label={t('salesSummary.label')}>
        <StatCard label={t('salesSummary.sales')} value={summary.count} />
        <StatCard
          label={t('salesSummary.totalSold')}
          value={<Money size="lg" cents={summary.totalSalePriceUsdCents} currency="USD" approxCents={summary.approx.totalSalePrice} approxCurrency={approxCurrency} staleRateNote={staleRateNote} />}
        />
        <StatCard
          label={t('salesSummary.totalNet')}
          value={<Money size="lg" cents={summary.totalNetReceivedUsdCents} currency="USD" approxCents={summary.approx.totalNetReceived} approxCurrency={approxCurrency} staleRateNote={staleRateNote} />}
        />
        <StatCard
          label={t('salesSummary.totalProfit')}
          tone={profit > 0 ? 'profit' : profit < 0 ? 'loss' : 'neutral'}
          help={t('salesSummary.profitTitle', { net: usd(summary.totalNetReceivedUsdCents), cost: usd(summary.totalPurchaseCostUsdCents) })}
          value={<Money size="lg" signed cents={profit} currency="USD" approxCents={summary.approx.totalProfit} approxCurrency={approxCurrency} staleRateNote={staleRateNote} />}
        />
        <StatCard
          label={t('salesSummary.avgTurnaround')}
          value={
            avg === null
              ? t('common.none')
              : tPlural('salesSummary.avgTurnaroundValue', avg, { days: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(avg) })
          }
        />
      </PositionStrip>
      {summary.soldWithFxCount > 0 && <p className={styles.usdNote}>{t('salesSummary.usdNote')}</p>}
    </section>
  );
}
