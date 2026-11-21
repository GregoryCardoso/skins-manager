'use client';

import { useCallback, useEffect, useState } from 'react';
import pageStyles from '@/app/profit/page.module.css';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import { ApiRequestError, getCurrentStoreBalances } from '@/services/api';
import type { Currency, CurrentStoreBalances, StoreBalanceSummary } from '@/types/api';
import { Badge } from './badges';
import StoreBalanceFormModal from './StoreBalanceFormModal';
import StoreBalanceHistory from './StoreBalanceHistory';
import styles from './StoreBalancesPanel.module.css';

type Dialog = { kind: 'record'; store: StoreBalanceSummary } | { kind: 'history'; store: StoreBalanceSummary };

// Valor na moeda da loja com "≈ R$" discreto ao lado (só loja em dólar com cotação; 2.11).
function Amount({ cents, currency, approxBrlCents }: { cents: number; currency: Currency; approxBrlCents: number | null }) {
  const t = useT();
  const language = useLanguage();
  return (
    <span className={styles.amount}>
      <strong>{formatMoney(cents, currency, language)}</strong>
      {currency === 'USD' && approxBrlCents !== null && (
        <span className={styles.approx}> {t('common.approx', { value: formatMoney(approxBrlCents, 'BRL', language) })}</span>
      )}
    </span>
  );
}

function StoreRow({ store, onRecord, onHistory }: {
  store: StoreBalanceSummary;
  onRecord: (store: StoreBalanceSummary) => void;
  onHistory: (store: StoreBalanceSummary) => void;
}) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const { pending, releasedAfterBalance: released } = store;
  const hasBalance = store.balance !== null;
  const showReleased = released.cents > 0;
  const releasedLabel = hasBalance ? 'storeBalances.releasedAfterBalance' : 'storeBalances.releasedNoBalance';
  const fxMissing = store.warningCode === 'FX_NOT_CONFIGURED';
  const releasedSince = released.earliestReleasedAt;

  return (
    <li className={`${styles.row} ${store.isActive ? '' : styles.inactive}`}>
      <div className={styles.head}>
        <strong className={styles.name}>{store.storeName}</strong>
        {!store.isActive && <Badge tone="neutral">{t('storeBalances.inactive')}</Badge>}
        {!store.allowsWithdrawal && <Badge tone="warning" title={t('storeBalances.nonWithdrawableTitle')}>{t('storeBalances.nonWithdrawable')}</Badge>}
      </div>

      <div className={styles.values}>
        {hasBalance ? (
          <span>
            <Amount cents={store.availableCents} currency={store.currency} approxBrlCents={store.availableEstimatedBrlCents} />{' '}
            {t('storeBalances.available')}
          </span>
        ) : (
          <span className={styles.muted}>{t('storeBalances.noBalance')}</span>
        )}
        {pending.cents > 0 && (
          <span>
            {'+ '}
            <Amount cents={pending.cents} currency={store.currency} approxBrlCents={pending.estimatedBrlCents} />{' '}
            {t('storeBalances.pending', {
              date: pending.nextReleaseAt ? formatDate(pending.nextReleaseAt, language) : t('common.none'),
            })}
          </span>
        )}
        {showReleased && (
          <span>
            {'+ '}
            <Amount cents={released.cents} currency={store.currency} approxBrlCents={released.estimatedBrlCents} />{' '}
            {t(releasedLabel)}
          </span>
        )}
      </div>

      {hasBalance && store.balance && (
        <p className={styles.meta}>{t('storeBalances.recordedAt', { date: formatDate(store.balance.recordedAt, language) })}</p>
      )}
      {fxMissing && <p className={styles.warning} role="status">{tLoose('warnings.FX_NOT_CONFIGURED')}</p>}
      {store.outdated && (
        <p className={styles.warning} role="status">
          {tLoose('warnings.BALANCE_MAYBE_OUTDATED')}
          {store.outdatedReasons.includes('RELEASED_AFTER_BALANCE') && releasedSince && (
            <> {t('storeBalances.outdatedReleased', { date: formatDate(releasedSince, language) })}</>
          )}
        </p>
      )}

      <div className={styles.actions}>
        <button type="button" className={pageStyles.retry} onClick={() => onRecord(store)}>{t('storeBalances.update')}</button>
        <button type="button" className={pageStyles.retry} onClick={() => onHistory(store)} disabled={!hasBalance}>
          {t('storeBalances.history.open')}
        </button>
      </div>
    </li>
  );
}

// Seção Saldos da página Lucro real (8.3, D207, D216): disponível + pendente + liberado após o último registro,
// por loja, tudo vindo pronto do backend. Carrega os próprios dados.
// `reloadKey`: a página o incrementa quando algo externo (saques) muda, para o aviso de saldo desatualizado atualizar sem F5.
export default function StoreBalancesPanel({ onDataChanged, reloadKey = 0 }: { onDataChanged?: () => void; reloadKey?: number }) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const language = useLanguage();

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

  const nonWithdrawable = data ? data.totals.nonWithdrawableEstimatedBrlCents : null;
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
          {data.stores.length === 0 ? (
            <div className={pageStyles.empty}><p><strong>{t('storeBalances.empty')}</strong></p></div>
          ) : (
            <ul className={styles.list}>
              {data.stores.map((store) => (
                <StoreRow
                  key={store.storeId}
                  store={store}
                  onRecord={(target) => setDialog({ kind: 'record', store: target })}
                  onHistory={(target) => setDialog({ kind: 'history', store: target })}
                />
              ))}
            </ul>
          )}
          {showNonWithdrawable && (
            <p className={styles.nonWithdrawableTotal}>
              {nonWithdrawable === null
                ? `${t('storeBalances.nonWithdrawableTotalLabel')} ${tLoose('warnings.FX_NOT_CONFIGURED')}`
                : t('storeBalances.nonWithdrawableTotal', { value: formatMoney(nonWithdrawable, 'BRL', language) })}
            </p>
          )}
        </div>
      )}

      {dialog?.kind === 'record' && <StoreBalanceFormModal store={dialog.store} onClose={closeDialog} onSaved={saved} />}
      {dialog?.kind === 'history' && <StoreBalanceHistory store={dialog.store} onClose={closeDialog} onChanged={changed} />}
    </section>
  );
}
