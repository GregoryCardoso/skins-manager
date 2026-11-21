'use client';

import { useEffect, useState, type ReactNode } from 'react';
import pageStyles from '@/app/profit/page.module.css';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { describeFxRate } from '@/lib/fxDisplay';
import { formatDate, formatMoney, formatPercent } from '@/lib/format';
import { ApiRequestError, getProfitSummary } from '@/services/api';
import type { ProfitSummary } from '@/types/api';
import styles from './SummaryCards.module.css';

interface Props {
  // Muda quando aportes, saques ou saldos são alterados: o resumo é recarregado.
  reloadKey: number;
}

// Resumo do lucro real (8.4, D205, D206, D207). Tudo vem pronto do backend: o frontend só formata e traduz.
export default function SummaryCards({ reloadKey }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const [data, setData] = useState<ProfitSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getProfitSummary(controller.signal)
      .then((summary) => {
        setData(summary);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof ApiRequestError && err.code === 'ABORTED')) return;
        setError(err);
      });
    return () => controller.abort();
  }, [reloadKey, retryToken]);

  return (
    <section className={styles.wrap} aria-labelledby="summary-heading">
      <h2 id="summary-heading" className={styles.srOnly}>{t('profit.summary.title')}</h2>

      {error !== null && (
        <div className={pageStyles.error} role="alert">
          <p>{t('profit.summary.loadError', { reason: errorMessageFor(error, tLoose, language) })}</p>
          <button type="button" className={pageStyles.retry} onClick={() => setRetryToken((n) => n + 1)}>{t('common.retry')}</button>
        </div>
      )}

      {data === null && error === null && <p className={pageStyles.muted}>{t('common.loading')}</p>}

      {data !== null && <SummaryBody data={data} />}
    </section>
  );
}

function SummaryBody({ data }: { data: ProfitSummary }) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const brl = (cents: number) => formatMoney(cents, 'BRL', language);
  // Valor estimado: "≈ R$ x", ou "indisponível" quando falta a cotação (null).
  const estimated = (cents: number | null): ReactNode =>
    cents === null ? (
      <span className={styles.unavailable} title={t('profit.summary.unavailableHint')}>{t('profit.summary.unavailable')}</span>
    ) : (
      t('common.approx', { value: brl(cents) })
    );

  const profit = data.realProfitBrlCents;
  const tone = profit === null ? '' : profit > 0 ? styles.positive : profit < 0 ? styles.negative : '';
  const pending = data.pendingBalanceEstimatedBrlCents;
  const released = data.releasedAfterBalanceEstimatedBrlCents;
  const ratio = data.withdrawnVsDeposited;
  const isEmpty =
    data.counts.deposits === 0 && data.counts.withdrawals === 0 && data.counts.stockItems === 0 &&
    data.balancesByStore.every((row) => row.balance === null && row.pending.count === 0 && row.releasedAfterBalance.count === 0);
  const fxText = data.fx.usdBrlRate !== null
    ? describeFxRate(
      { rate: data.fx.usdBrlRate, source: data.fx.source, quotedAt: data.fx.quotedAt, updatedAt: data.fx.updatedAt },
      language,
      tLoose,
    )
    : null;

  return (
    <>
      <div className={styles.grid}>
        <div className={`${styles.card} ${styles.hero}`}>
          <span className={styles.label}>{t('profit.summary.realProfit')}</span>
          <span className={`${styles.value} ${styles.heroValue} ${tone}`}>
            {estimated(profit)}
            {profit !== null && data.realProfitUsdCentsApprox !== null && (
              <span className={styles.approx}>
                {t('profit.summary.usdApprox', { value: formatMoney(data.realProfitUsdCentsApprox, 'USD', language) })}
              </span>
            )}
          </span>
          <p className={styles.hint}>{t('profit.summary.realProfitHint')}</p>
          {pending !== null && pending > 0 && (
            <p className={styles.included}>
              {data.nextReleaseAt
                ? t('profit.pendingIncluded', { amount: brl(pending), date: formatDate(data.nextReleaseAt, language) })
                : t('profit.pendingIncludedNoDate', { amount: brl(pending) })}
            </p>
          )}
          {pending === null && data.counts.pendingSales > 0 && (
            <p className={styles.included}>{t('profit.summary.pendingUnavailable')}</p>
          )}
          {released !== null && released > 0 && (
            <p className={styles.included}>{t('profit.releasedIncluded', { amount: brl(released) })}</p>
          )}
          {released === null && data.counts.releasedAfterBalanceSales > 0 && (
            <p className={styles.included}>{t('profit.summary.releasedUnavailable')}</p>
          )}
        </div>

        <div className={styles.card}>
          <span className={styles.label}>{t('profit.summary.deposited')}</span>
          <span className={styles.value}>{brl(data.depositsBrlCents)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>{t('profit.summary.withdrawn')}</span>
          <span className={styles.value}>{brl(data.withdrawalsBrlCents)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>{t('profit.summary.platformBalance')}</span>
          <span className={styles.value}>{estimated(data.platformBalanceEstimatedBrlCents)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>{t('profit.summary.stock')}</span>
          <span className={styles.value}>{estimated(data.stockEstimatedBrlCents)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>{t('profit.summary.withdrawnVsDeposited')}</span>
          <span className={styles.value}>
            {ratio.ratio === null
              ? <span className={styles.unavailable}>{t('profit.summary.withdrawnVsDepositedNone')}</span>
              : formatPercent(ratio.ratio, language)}
          </span>
          {ratio.ratio !== null && (
            <p className={styles.hint}>
              {t('profit.summary.withdrawnVsDepositedDetail', { withdrawn: brl(ratio.withdrawnBrlCents), deposited: brl(ratio.depositedBrlCents) })}
            </p>
          )}
        </div>
      </div>

      {data.warnings.length > 0 && (
        <ul className={styles.warnings} role="status">
          {data.warnings.map((warning, index) => {
            const message = tLoose(`warnings.${warning.code}`);
            return (
              <li key={`${warning.source}-${warning.storeId ?? 'x'}-${warning.code}-${index}`}>
                {warning.source === 'STORE' && warning.storeName
                  ? t('profit.summary.warningStore', { store: warning.storeName, message })
                  : t('profit.summary.warningStock', { message })}
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.note}>{fxText ? t('profit.estimatedNote', { fx: fxText }) : t('profit.estimatedNoFx')}</p>
      {isEmpty && <p className={styles.empty}>{t('profit.emptyHint')}</p>}
    </>
  );
}
