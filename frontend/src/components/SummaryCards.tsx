'use client';

import { useQuery } from '@tanstack/react-query';
import pageStyles from '@/app/profit/page.module.css';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { describeFxRate } from '@/lib/fxDisplay';
import { formatDate, formatPercent } from '@/lib/format';
import MoneyApprox, { useMoneyLine } from './MoneyApprox';
import { queryKeys } from '@/lib/queryKeys';
import { getProfitSummary } from '@/services/api';
import type { ProfitSummary } from '@/types/api';
import styles from './SummaryCards.module.css';

// Resumo do lucro real em USD (8.5, D226, D229, D231). Tudo vem pronto do backend, inclusive o "≈ R$": o frontend só formata e traduz.
// A consulta `profitSummary` é invalidada por qualquer ação que mude aportes, saques, saldos, itens ou lojas (D259).
export default function SummaryCards() {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const query = useQuery({ queryKey: queryKeys.profitSummary.all, queryFn: ({ signal }) => getProfitSummary(signal) });
  const data = query.data ?? null;
  const error = query.error ?? null;

  return (
    <section className={styles.wrap} aria-labelledby="summary-heading">
      <h2 id="summary-heading" className={styles.srOnly}>{t('profit.summary.title')}</h2>

      {error !== null && (
        <div className={pageStyles.error} role="alert">
          <p>{t('profit.summary.loadError', { reason: errorMessageFor(error, tLoose, language) })}</p>
          <button type="button" className={pageStyles.retry} onClick={() => query.refetch()}>{t('common.retry')}</button>
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
        {/* Estoque à venda e em holding (8.9, D283): só exibição; a soma dos dois é o card acima. */}
        <div className={styles.card}>
          <span className={styles.label}>{t('profit.summary.stockForSale')}</span>
          <span className={styles.value}>
            {amount(data.stockBreakdown.forSale.usdCents, data.stockBreakdown.forSale.approxBrl, data.stockBreakdown.forSale.estimated)}
          </span>
        </div>
        <div className={styles.card}>
          <span className={styles.label}>{t('profit.summary.stockOffSale')}</span>
          <span className={styles.value}>
            {amount(data.stockBreakdown.offSale.usdCents, data.stockBreakdown.offSale.approxBrl, data.stockBreakdown.offSale.estimated)}
          </span>
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

      {/* Perdas por consumo (10.4, D363): terminais não comprados. Só informativo, fora da fórmula do lucro real. */}
      {data.consumptionLosses && data.consumptionLosses.count > 0 && (
        <div className={styles.grid}>
          <div className={styles.card}>
            <span className={styles.label}>{t('profit.summary.consumptionLosses')}</span>
            <span className={styles.value}>
              {amount(data.consumptionLosses.usdCents, data.consumptionLosses.approxBrl, data.consumptionLosses.estimated)}
            </span>
            <p className={styles.hint}>{tPlural('profit.summary.consumptionLossesCount', data.consumptionLosses.count)}</p>
            <p className={styles.hint}>{t('profit.summary.consumptionLossesHint')}</p>
          </div>
        </div>
      )}

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
