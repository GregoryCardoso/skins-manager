'use client';

import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import DepositFormModal from '@/components/DepositFormModal';
import DepositsTable from '@/components/DepositsTable';
import StoreBalancesPanel from '@/components/StoreBalancesPanel';
import SummaryCards from '@/components/SummaryCards';
import WithdrawalsSection from '@/components/WithdrawalsSection';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import { ApiRequestError, deleteDeposit, listDeposits, listStores } from '@/services/api';
import type { Deposit, DepositList, Store } from '@/types/api';
import styles from './page.module.css';

type Dialog = { kind: 'create' } | { kind: 'edit'; deposit: Deposit } | { kind: 'delete'; deposit: Deposit };

// 8.1: Aportes; 8.2: Saques; 8.3: Saldos; 8.4: resumo (SummaryCards) no topo.
export default function ProfitPage() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const language = useLanguage();

  const [data, setData] = useState<DepositList | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // Qualquer mudança em aportes, saques ou saldos recarrega o resumo do topo.
  const [summaryToken, setSummaryToken] = useState(0);
  const refreshSummary = useCallback(() => setSummaryToken((n) => n + 1), []);
  const [balancesToken, setBalancesToken] = useState(0);
  const withdrawalsChanged = useCallback(() => {
    setSummaryToken((n) => n + 1);
    setBalancesToken((n) => n + 1);
  }, []);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([listDeposits(controller.signal), listStores(controller.signal)])
      .then(([list, storeList]) => {
        setData(list);
        setStores(storeList);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof ApiRequestError && err.code === 'ABORTED')) return;
        setError(err);
        setLoading(false);
      });
    return () => controller.abort();
  }, [reloadToken]);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setConfirmBusy(false);
    setConfirmError(null);
  }, []);

  const finish = useCallback(
    (message: string) => {
      closeDialog();
      setNotice(message);
      reload();
      refreshSummary();
    },
    [closeDialog, reload, refreshSummary],
  );

  const depositGone = useCallback(() => finish(t('deposits.gone')), [finish, t]);

  const confirmDelete = (deposit: Deposit) => {
    setConfirmBusy(true);
    setConfirmError(null);
    deleteDeposit(deposit.id)
      .then(() => finish(t('deposits.deleted', { value: formatMoney(deposit.amountBrlCents, 'BRL', language) })))
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'DEPOSIT_NOT_FOUND') {
          depositGone();
          return;
        }
        setConfirmBusy(false);
        setConfirmError(errorMessageFor(err, tLoose, language));
      });
  };

  return (
    <>
      <h1>{t('profit.title')}</h1>
      <p className={styles.subtitle}>{t('profit.subtitle')}</p>

      <SummaryCards reloadKey={summaryToken} />

      <section className={styles.section} aria-labelledby="deposits-heading">
        <div className={styles.titleRow}>
          <h2 id="deposits-heading">{t('deposits.title')}</h2>
          {data && <span className={styles.count} aria-live="polite">{tPlural('deposits.count', data.totals.count)}</span>}
        </div>
        <div className={styles.toolbar}>
          <p className={styles.note}>{t('deposits.intro')}</p>
          <button type="button" className={styles.primaryButton} onClick={() => setDialog({ kind: 'create' })}>
            {t('deposits.new')}
          </button>
        </div>

        {data && data.totals.count > 0 && (
          <p className={styles.total}>{t('deposits.total', { value: formatMoney(data.totals.amountBrlCents, 'BRL', language) })}</p>
        )}

        {notice && (
          <div className={styles.notice} role="status">
            <span>{notice}</span>
            <button type="button" className={styles.retry} onClick={() => setNotice(null)}>{t('common.close')}</button>
          </div>
        )}

        {error !== null && (
          <div className={styles.error} role="alert">
            <p>{t('deposits.loadError', { reason: errorMessageFor(error, tLoose, language) })}</p>
            <button type="button" className={styles.retry} onClick={reload}>{t('common.retry')}</button>
          </div>
        )}

        {data === null && error === null && <p className={styles.muted}>{t('common.loading')}</p>}

        {data !== null && error === null && (
          <div className={loading ? styles.dim : undefined} aria-busy={loading}>
            {data.deposits.length === 0 ? (
              <div className={styles.empty}>
                <p><strong>{t('deposits.empty')}</strong></p>
                <p>{t('deposits.emptyHint')}</p>
              </div>
            ) : (
              <DepositsTable
                deposits={data.deposits}
                onEdit={(deposit) => setDialog({ kind: 'edit', deposit })}
                onDelete={(deposit) => setDialog({ kind: 'delete', deposit })}
              />
            )}
          </div>
        )}
      </section>

      <WithdrawalsSection onDataChanged={withdrawalsChanged} />

      <StoreBalancesPanel onDataChanged={refreshSummary} reloadKey={balancesToken} />

      {dialog?.kind === 'create' && <DepositFormModal stores={stores} onClose={closeDialog} onSaved={finish} onGone={depositGone} />}
      {dialog?.kind === 'edit' && (
        <DepositFormModal deposit={dialog.deposit} stores={stores} onClose={closeDialog} onSaved={finish} onGone={depositGone} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('deposits.deleteTitle')}
          message={t('deposits.deleteMessage', {
            value: formatMoney(dialog.deposit.amountBrlCents, 'BRL', language),
            date: formatDate(dialog.deposit.depositedAt, language),
          })}
          confirmLabel={t('deposits.confirmDelete')}
          danger
          busy={confirmBusy}
          error={confirmError}
          onCancel={closeDialog}
          onConfirm={() => confirmDelete(dialog.deposit)}
        />
      )}
    </>
  );
}
