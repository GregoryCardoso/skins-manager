'use client';

import Link from 'next/link';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatAgo, formatDateTime } from '@/lib/format';
import { priceStatusView } from '@/lib/priceStatus';
import { ApiRequestError } from '@/services/api';
import styles from './PriceStatusIndicator.module.css';
import { useMarketSummary } from './useMarketSummary';

// Indicador discreto do estado dos preços de mercado (10.6, D365 item 5). O texto do `title` também vai num `srOnly`.
export default function PriceStatusIndicator() {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const { summary, refreshing } = useMarketSummary();
  const view = priceStatusView({ summary, refreshing });
  if (view.kind === 'HIDDEN') return null;
  const now = new Date();
  const date = view.at ? formatDateTime(view.at, locale) : null;

  let text = '';
  let title: string | null = null;
  if (view.kind === 'REFRESHING') text = t('prices.status.refreshing');
  else if (view.kind === 'NOT_CONFIGURED') text = t('prices.status.notConfigured');
  else if (view.kind === 'NEVER') text = t('prices.status.never');
  else if (view.kind === 'UPDATED' && view.at) {
    text = t('prices.status.updatedAgo', { time: formatAgo(view.at, now, tLoose) });
    title = t('prices.status.updatedTitle', { date: date ?? '' });
  } else if (view.kind === 'FAILED') {
    text = t('prices.status.failed');
    const reason = view.errorCode ? errorMessageFor(new ApiRequestError(view.errorCode, ''), tLoose, locale) : '';
    title = date ? t('prices.status.failedTitleWithDate', { reason, date }) : t('prices.status.failedTitle', { reason });
  }

  return (
    <span
      className={view.kind === 'FAILED' ? `${styles.status} ${styles.failed}` : styles.status}
      role="status"
      aria-live="polite"
      aria-busy={view.kind === 'REFRESHING'}
      title={title ?? undefined}
    >
      <span>{text}</span>
      {title && <span className={styles.srOnly}>{title}</span>}
      {view.kind === 'NOT_CONFIGURED' && (
        <Link prefetch={false} href="/settings/#csfloat" className={styles.link}>{t('prices.status.configureLink')}</Link>
      )}
    </span>
  );
}
