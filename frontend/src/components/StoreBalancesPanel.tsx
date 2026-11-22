'use client';

import { useCallback, useEffect, useState } from 'react';
import pageStyles from '@/app/profit/page.module.css';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import { ApiRequestError, getCurrentStoreBalances } from '@/services/api';
import type { Currency, CurrentStoreBalances, StoreBalanceSummary } from '@/types/api';
import { Badge } from './badges';
import { useMoneyLine } from './MoneyApprox';
import StoreBalanceFormModal from './StoreBalanceFormModal';
import StoreBalanceHistory from './StoreBalanceHistory';
import styles from './StoreBalancesPanel.module.css';

type Dialog = { kind: 'check'; store: StoreBalanceSummary } | { kind: 'history'; store: StoreBalanceSummary };

// Valor na moeda da loja (2.8) com o aproximado discreto ao lado, calculado no backend (D229): "≈ R$" em loja USD,
// "≈ US$" em loja BRL. Sem cotação, o aproximado some. Saldo negativo aparece em vermelho.
function Amount({ cents, currency, usdCents, approxBrlCents, negative = false }: {
  cents: number; currency: Currency; usdCents: number | null; approxBrlCents: number | null; negative?: boolean;
}) {
  const t = useT();
  const language = useLanguage();
  const approx = currency === 'USD'
    ? (approxBrlCents === null ? null : formatMoney(approxBrlCents, 'BRL', language))
    : (usdCents === null ? null : formatMoney(usdCents, 'USD', language));
  return (
    <span className={styles.amount}>
      <strong className={negative ? styles.negative : undefined}>{formatMoney(cents, currency, language)}</strong>
      {approx !== null && <span className={styles.approx}> {t('common.approx', { value: approx })}</span>}
    </span>
  );
}

function StoreRow({ store, onCheck, onHistory }: {
  store: StoreBalanceSummary;
  onCheck: (store: StoreBalanceSummary) => void;
  onHistory: (store: StoreBalanceSummary) => void;
}) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const language = useLanguage();
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
            approxBrlCents={store.availableApproxBrlCents}
            negative={store.negative}
          />{' '}
          {t('storeBalances.available')}
        </span>
        {pending.cents > 0 && (
          <span>
            {'+ '}
            <Amount cents={pending.cents} currency={store.currency} usdCents={pending.usdCents} approxBrlCents={pending.approxBrlCents} />{' '}
            {t('storeBalances.pending', {
              date: pending.nextReleaseAt ? formatDate(pending.nextReleaseAt, language) : t('common.none'),
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
              <dd>{formatMoney(cents, store.currency, language)}</dd>
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
    </li>
  );
}

// Seção Saldos da página Lucro real (8.6, D246, D247): saldo calculado (disponível + pendente) por loja,
// "última conferência há X dias", detalhes e histórico, tudo vindo pronto do backend. Os totais ficam no topo (D255). Carrega os próprios dados.
// `reloadKey`: a página o incrementa quando algo externo (aportes, saques, itens) muda, para o saldo atualizar sem F5.
export default function StoreBalancesPanel({ onDataChanged, reloadKey = 0 }: { onDataChanged?: () => void; reloadKey?: number }) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const language = useLanguage();
  const moneyLine = useMoneyLine();

  const [data, setData] = useState<CurrentStoreBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  // Mudança de saldo: recarrega o painel e avisa a página (o resumo do topo depende dos saldos).
  const changed = useCallback(() => {
    setReloadToken((n) => n + 1);
    onDataChanged?.();
  }, [onDataChanged]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getCurrentStoreBalances(controller.signal)
      .then((current) => {
        setData(current);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof ApiRequestError && err.code === 'ABORTED')) return;
        setError(err);
        setLoading(false);
      });
    return () => controller.abort();
  }, [reloadToken, reloadKey]);

  const closeDialog = useCallback(() => setDialog(null), []);
  const saved = useCallback((message: string) => {
    setDialog(null);
    setNotice(message);
    changed();
  }, [changed]);

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
          <p>{t('storeBalances.loadError', { reason: errorMessageFor(error, tLoose, language) })}</p>
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
                {t('storeBalances.totalAvailable', { value: moneyLine({ cents: data.totals.availableUsdCents, estimated: data.totals.availableEstimated, approxCents: data.totals.approxBrl.available }) })}
              </p>
              <p className={styles.totalLine}>
                {data.totals.nextReleaseAt
                  ? t('storeBalances.totalPendingDate', {
                    value: moneyLine({ cents: data.totals.pendingUsdCents, estimated: data.totals.pendingEstimated, approxCents: data.totals.approxBrl.pending }),
                    date: formatDate(data.totals.nextReleaseAt, language),
                  })
                  : t('storeBalances.totalPending', { value: moneyLine({ cents: data.totals.pendingUsdCents, estimated: data.totals.pendingEstimated, approxCents: data.totals.approxBrl.pending }) })}
              </p>
              {showNonWithdrawable && (
                <p className={styles.totalLine}>
                  {nonWithdrawable === null
                    ? `${t('storeBalances.nonWithdrawableTotalLabel')} ${tLoose('warnings.FX_NOT_CONFIGURED')}`
                    : t('storeBalances.nonWithdrawableTotal', {
                      value: moneyLine({
                        cents: nonWithdrawable,
                        estimated: data.totals.nonWithdrawableEstimated,
                        approxCents: data.totals.approxBrl.nonWithdrawable,
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
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {dialog?.kind === 'check' && <StoreBalanceFormModal store={dialog.store} onClose={closeDialog} onSaved={saved} />}
      {dialog?.kind === 'history' && <StoreBalanceHistory store={dialog.store} onClose={closeDialog} onChanged={changed} />}
    </section>
  );
}
