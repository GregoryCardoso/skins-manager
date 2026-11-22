'use client';

import { useEffect, useState } from 'react';
import pageStyles from '@/app/profit/page.module.css';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { describeFxRate } from '@/lib/fxDisplay';
import { formatDate, formatPercent } from '@/lib/format';
import MoneyApprox, { useMoneyLine } from './MoneyApprox';
import { ApiRequestError, getProfitSummary } from '@/services/api';
import type { ProfitSummary } from '@/types/api';
import styles from './SummaryCards.module.css';

interface Props {
  // Muda quando aportes, saques ou saldos são alterados: o resumo é recarregado.
  reloadKey: number;
}

// Resumo do lucro real em USD (8.5, D226, D229, D231). Tudo vem pronto do backend, inclusive o "≈ R$": o frontend só formata e traduz.
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
  const moneyLine = useMoneyLine();
  const tPlural = useTPlural();
  // Valor em US$ com "≈" só quando a parcela teve conversão; o "≈ R$" abaixo vem do backend.
  const amount = (cents: number | null, approx: number | null, estimated: boolean, className?: string) => (
    <MoneyApprox cents={cents} estimated={estimated} approxCents={approx} className={className} />
  );

  const profit = data.realProfitUsdCents;
  const tone = profit === null ? '' : profit > 0 ? styles.positive : profit < 0 ? styles.negative : '';
  const pending = data.pendingBalanceUsdCents;
  // O valor pendente só ganha "≈" se a parcela teve conversão.
  const pendingText = (value: number) => moneyLine({ cents: value, estimated: data.estimatedParts.pendingBalance });
  const ratio = data.withdrawnVsDeposited;
  const isEmpty =
    data.counts.deposits === 0 && data.counts.withdrawals === 0 && data.counts.stockItems === 0 &&
    data.balancesByStore.every((row) => row.lastCheck === null && row.pending.count === 0 && row.availableCents === 0);
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
            {amount(profit, data.approxBrl.realProfit, data.estimated)}
          </span>
          <p className={styles.hint}>{t('profit.summary.realProfitHint')}</p>
          {pending !== null && pending > 0 && (
            <p className={styles.included}>
              {data.nextReleaseAt
                ? t('profit.pendingIncluded', { amount: pendingText(pending), date: formatDate(data.nextReleaseAt, language) })
                : t('profit.pendingIncludedNoDate', { amount: pendingText(pending) })}
            </p>
          )}
          {pending === null && data.counts.pendingSales > 0 && (
            <p className={styles.included}>{t('profit.summary.pendingUnavailable')}</p>
          )}
          {data.counts.legacyDeposits > 0 && (
            <p className={styles.included}>{tPlural('profit.summary.legacyDeposits', data.counts.legacyDeposits)}</p>
          )}
          {data.counts.withdrawalsWithoutFee > 0 && (
            <p className={styles.included}>{tPlural('profit.summary.withdrawalsWithoutFee', data.counts.withdrawalsWithoutFee)}</p>
          )}
        </div>

        <div className={styles.card}>
          <span className={styles.label}>{t('profit.summary.deposited')}</span>
          <span className={styles.value}>{amount(data.depositsUsdCents, data.approxBrl.deposits, data.estimatedParts.deposits)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>{t('profit.summary.withdrawn')}</span>
          <span className={styles.value}>{amount(data.withdrawalsNetUsdCents, data.approxBrl.withdrawals, data.estimatedParts.withdrawals)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>{t('profit.summary.platformBalance')}</span>
          <span className={styles.value}>
            {amount(data.platformBalanceUsdCents, data.approxBrl.platformBalance, data.estimatedParts.platformBalance)}
          </span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>{t('profit.summary.stock')}</span>
          <span className={styles.value}>{amount(data.stockUsdCents, data.approxBrl.stock, data.estimatedParts.stock)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>{t('profit.summary.withdrawnVsDeposited')}</span>
          <span className={styles.value}>
            {ratio.ratio === null
              ? <span className={styles.unavailable}>{t('profit.summary.withdrawnVsDepositedNone')}</span>
              : formatPercent(ratio.ratio, language)}
          </span>
          {ratio.ratio !== null && ratio.withdrawnUsdCents !== null && ratio.depositedUsdCents !== null && (
            <p className={styles.hint}>
              {t('profit.summary.withdrawnVsDepositedDetail', {
                withdrawn: moneyLine({ cents: ratio.withdrawnUsdCents, estimated: data.estimatedParts.withdrawals }),
                deposited: moneyLine({ cents: ratio.depositedUsdCents, estimated: data.estimatedParts.deposits }),
              })}
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
                  : warning.source === 'DEPOSITS'
                    ? t('profit.summary.warningDeposits', { message })
                    : warning.source === 'WITHDRAWALS'
                      ? t('profit.summary.warningWithdrawals', { message })
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
