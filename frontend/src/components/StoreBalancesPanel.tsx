'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import pageStyles from '@/app/profit/page.module.css';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { storeCounterpart } from '@/lib/baseMoney';
import { formatDate, formatMoney } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { getCsfloatIntegration, getCurrentStoreBalances } from '@/services/api';
import type { Currency, CurrentStoreBalances, StoreBalanceSummary } from '@/types/api';
import { Badge } from './badges';
import { useMoneyLine } from './MoneyApprox';
import CsfloatBalanceCheck from './CsfloatBalanceCheck';
import StoreBalanceFormModal from './StoreBalanceFormModal';
import StoreBalanceHistory from './StoreBalanceHistory';
import styles from './StoreBalancesPanel.module.css';

type Dialog =
  | { kind: 'check'; store: StoreBalanceSummary; initialAmountCents?: number }
  | { kind: 'history'; store: StoreBalanceSummary };

// Valor na moeda da loja (2.8) com o aproximado discreto ao lado, calculado no backend (D229): "≈ R$" em loja USD,
// "≈ US$" em loja BRL. Sem cotação, o aproximado some. Saldo negativo aparece em vermelho.
function Amount({ cents, currency, usdCents, approxCents, approxCurrency, negative = false }: {
  cents: number; currency: Currency; usdCents: number | null; approxCents: number | null; approxCurrency: string; negative?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const counterpart = storeCounterpart({ currency, usdCents, approxCents, approxCurrency });
  const approx = counterpart === null ? null : formatMoney(counterpart.cents, counterpart.currency, locale);
  return (
    <span className={styles.amount}>
      <strong className={negative ? styles.negative : undefined}>{formatMoney(cents, currency, locale)}</strong>
      {approx !== null && <span className={styles.approx}> {t('common.approx', { value: approx })}</span>}
    </span>
  );
}

function StoreRow({ store, onCheck, onHistory, csfloat = false, onRegisterCsfloat }: {
  store: StoreBalanceSummary;
  onCheck: (store: StoreBalanceSummary) => void;
  onHistory: (store: StoreBalanceSummary) => void;
  // A loja da integração CSFloat, com chave salva: ganha "Conferir com o CSFloat" (9.7).
  csfloat?: boolean;
  onRegisterCsfloat?: (store: StoreBalanceSummary, balanceCents: number) => void;
}) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const [showDetails, setShowDetails] = useState(false);
  const { pending, breakdown, ignored } = store;
  const fxMissing = store.warningCode === 'FX_NOT_CONFIGURED';
  const days = store.daysSinceLastCheck;
  // Texto discreto, sem estilo de alerta: "nunca conferido" não é um problema (D243, D247).
  const lastCheckText = days === null
    ? t('storeBalances.neverChecked')
    : days === 0 ? t('storeBalances.lastCheckToday') : tPlural('storeBalances.lastCheckDays', days);
  const detailLines = [
    ['deposits', breakdown.depositsCents],
    ['purchases', -breakdown.purchasesCents],
    ['withdrawals', -breakdown.withdrawalsCents],
    ['salesReleased', breakdown.salesReleasedCents],
    ['adjustments', breakdown.adjustmentsCents],
  ] as const;

  return (
    <li className={`${styles.row} ${store.isActive ? '' : styles.inactive}`}>
      <div className={styles.head}>
        <strong className={styles.name}>{store.storeName}</strong>
        {!store.isActive && <Badge tone="neutral">{t('storeBalances.inactive')}</Badge>}
        {!store.allowsWithdrawal && <Badge tone="warning" title={t('storeBalances.nonWithdrawableTitle')}>{t('storeBalances.nonWithdrawable')}</Badge>}
      </div>

      <div className={styles.values}>
        <span>
          <Amount
            cents={store.availableCents}
            currency={store.currency}
            usdCents={store.availableUsdCents}
            approxCents={store.availableApproxCents}
            approxCurrency={store.approxCurrency}
            negative={store.negative}
          />{' '}
          {t('storeBalances.available')}
        </span>
        {pending.cents > 0 && (
          <span>
            {'+ '}
            <Amount cents={pending.cents} currency={store.currency} usdCents={pending.usdCents} approxCents={pending.approxCents} approxCurrency={store.approxCurrency} />{' '}
            {t('storeBalances.pending', {
              date: pending.nextReleaseAt ? formatDate(pending.nextReleaseAt, locale) : t('common.none'),
            })}
          </span>
        )}
      </div>

      <p className={styles.meta}>{lastCheckText}</p>

      {fxMissing && <p className={styles.warning} role="status">{tLoose('warnings.FX_NOT_CONFIGURED')}</p>}
      {store.negative && <p className={styles.warning} role="status">{tLoose('warnings.COMPUTED_BALANCE_NEGATIVE')}</p>}
      {ignored.legacyDeposits > 0 && <p className={styles.meta}>{tPlural('storeBalances.legacyDepositsIgnored', ignored.legacyDeposits)}</p>}
      {ignored.currencyMismatch > 0 && <p className={styles.meta}>{tPlural('storeBalances.currencyMismatchIgnored', ignored.currencyMismatch)}</p>}

      {showDetails && (
        <dl className={styles.breakdown} aria-label={t('storeBalances.breakdown.title')}>
          {detailLines.map(([key, cents]) => (
            <div key={key} className={styles.breakdownLine}>
              <dt>{t(`storeBalances.breakdown.${key}`)}</dt>
              <dd>{formatMoney(cents, store.currency, locale)}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className={styles.actions}>
        <button type="button" className={pageStyles.retry} onClick={() => onCheck(store)}>{t('storeBalances.check')}</button>
        <button type="button" className={pageStyles.retry} onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
          {t(showDetails ? 'storeBalances.hideDetails' : 'storeBalances.details')}
        </button>
        <button type="button" className={pageStyles.retry} onClick={() => onHistory(store)}>{t('storeBalances.history.open')}</button>
      </div>
      {csfloat && onRegisterCsfloat && <CsfloatBalanceCheck onRegister={(cents) => onRegisterCsfloat(store, cents)} />}
    </li>
  );
}

// Seção Saldos da página Lucro real (8.6, D246, D247): saldo calculado (disponível + pendente) por loja,
// "última conferência há X dias", detalhes e histórico, tudo vindo pronto do backend. Os totais ficam no topo (D255). Carrega os próprios dados.
// A consulta é invalidada por qualquer ação que mude aportes, saques, itens, lojas ou conferências (D259).
export default function StoreBalancesPanel() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const moneyLine = useMoneyLine();

  const query = useQuery({ queryKey: queryKeys.storeBalances.current, queryFn: ({ signal }) => getCurrentStoreBalances(signal) });
  const data = query.data ?? null;
  const error = query.error ?? null;
  const loading = query.isFetching;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // A conferência com o CSFloat aparece só na loja da integração, com a chave salva (9.7).
  const integration = useQuery({ queryKey: queryKeys.integrations.csfloat, queryFn: ({ signal }) => getCsfloatIntegration(signal) }).data ?? null;
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () => {
    query.refetch();
  };
  const closeDialog = useCallback(() => setDialog(null), []);
  const saved = useCallback((message: string) => {
    setDialog(null);
    setNotice(message);
  }, []);

  const nonWithdrawable = data ? data.totals.nonWithdrawableUsdCents : null;
  const hasNonWithdrawable = data !== null && data.stores.some((store) => !store.allowsWithdrawal);
  // A soma só aparece se for maior que 0 ou nula por falta de cotação (D212).
  const showNonWithdrawable = hasNonWithdrawable && (nonWithdrawable === null || nonWithdrawable > 0);

  return (
    <section className={pageStyles.section} aria-labelledby="balances-heading">
      <div className={pageStyles.titleRow}>
        <h2 id="balances-heading">{t('storeBalances.title')}</h2>
        {data && <span className={pageStyles.count} aria-live="polite">{tPlural('storeBalances.count', data.stores.length)}</span>}
      </div>
      <p className={pageStyles.note}>{t('storeBalances.intro')}</p>

      {notice && (
        <div className={pageStyles.notice} role="status">
          <span>{notice}</span>
          <button type="button" className={pageStyles.retry} onClick={() => setNotice(null)}>{t('common.close')}</button>
        </div>
      )}

      {error !== null && (
        <div className={pageStyles.error} role="alert">
          <p>{t('storeBalances.loadError', { reason: errorMessageFor(error, tLoose, locale) })}</p>
          <button type="button" className={pageStyles.retry} onClick={reload}>{t('common.retry')}</button>
        </div>
      )}

      {data === null && error === null && <p className={pageStyles.muted}>{t('common.loading')}</p>}

      {data !== null && error === null && (
        <div className={loading ? pageStyles.dim : undefined} aria-busy={loading}>
          {data.stores.length > 0 && (
            <div className={styles.totalsBar} role="group" aria-label={t('storeBalances.totalsTitle')}>
              <h3 className={styles.totalsTitle}>{t('storeBalances.totalsTitle')}</h3>
              <p className={styles.totalLine}>
                {t('storeBalances.totalAvailable', { value: moneyLine({ cents: data.totals.availableUsdCents, estimated: data.totals.availableEstimated, approxCents: data.totals.approx.available, approxCurrency: data.totals.approxCurrency }) })}
              </p>
              <p className={styles.totalLine}>
                {data.totals.nextReleaseAt
                  ? t('storeBalances.totalPendingDate', {
                    value: moneyLine({ cents: data.totals.pendingUsdCents, estimated: data.totals.pendingEstimated, approxCents: data.totals.approx.pending, approxCurrency: data.totals.approxCurrency }),
                    date: formatDate(data.totals.nextReleaseAt, locale),
                  })
                  : t('storeBalances.totalPending', { value: moneyLine({ cents: data.totals.pendingUsdCents, estimated: data.totals.pendingEstimated, approxCents: data.totals.approx.pending, approxCurrency: data.totals.approxCurrency }) })}
              </p>
              {showNonWithdrawable && (
                <p className={styles.totalLine}>
                  {nonWithdrawable === null
                    ? `${t('storeBalances.nonWithdrawableTotalLabel')} ${tLoose('warnings.FX_NOT_CONFIGURED')}`
                    : t('storeBalances.nonWithdrawableTotal', {
                      value: moneyLine({
                        cents: nonWithdrawable,
                        estimated: data.totals.nonWithdrawableEstimated,
                        approxCents: data.totals.approx.nonWithdrawable, approxCurrency: data.totals.approxCurrency,
                      }),
                    })}
                </p>
              )}
            </div>
          )}
          <p className={styles.meta}>{t('storeBalances.startHint')}</p>
          {data.stores.length === 0 ? (
            <div className={pageStyles.empty}><p><strong>{t('storeBalances.empty')}</strong></p></div>
          ) : (
            <ul className={styles.list}>
              {data.stores.map((store) => (
                <StoreRow
                  key={store.storeId}
                  store={store}
                  onCheck={(target) => setDialog({ kind: 'check', store: target })}
                  onHistory={(target) => setDialog({ kind: 'history', store: target })}
                  csfloat={Boolean(integration && integration.hasApiKey && integration.storeId === store.storeId)}
                  onRegisterCsfloat={(target, cents) => setDialog({ kind: 'check', store: target, initialAmountCents: cents })}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {dialog?.kind === 'check' && (
        <StoreBalanceFormModal store={dialog.store} onClose={closeDialog} onSaved={saved} initialAmountCents={dialog.initialAmountCents ?? null} />
      )}
      {dialog?.kind === 'history' && <StoreBalanceHistory store={dialog.store} onClose={closeDialog} />}
    </section>
  );
}
