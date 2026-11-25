'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import styles from '@/app/profit/page.module.css';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDate } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { withdrawalAmountText, withdrawalStoreOptions } from '@/lib/withdrawalForm';
import { ApiRequestError, deleteWithdrawal, listStores, listWithdrawals } from '@/services/api';
import type { Withdrawal } from '@/types/api';
import ImportButton from './ImportButton';
import ConfirmDialog from './ConfirmDialog';
import { useMoneyLine } from './MoneyApprox';
import WithdrawalFormModal from './WithdrawalFormModal';
import WithdrawalsTable from './WithdrawalsTable';

type Dialog = { kind: 'create' } | { kind: 'edit'; withdrawal: Withdrawal } | { kind: 'delete'; withdrawal: Withdrawal };

// Seção Saques da página Lucro real (8.2): lista, cadastro, edição e exclusão. Carrega os próprios dados.
export default function WithdrawalsSection() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const moneyLine = useMoneyLine();

  const invalidate = useInvalidate();
  const withdrawalsQuery = useQuery({ queryKey: queryKeys.withdrawals.all, queryFn: ({ signal }) => listWithdrawals(signal) });
  const storesQuery = useQuery({ queryKey: queryKeys.stores.all, queryFn: ({ signal }) => listStores(signal) });
  const data = withdrawalsQuery.data ?? null;
  const stores = storesQuery.data ?? null;
  const error = withdrawalsQuery.error ?? storesQuery.error;
  const loading = withdrawalsQuery.isFetching || storesQuery.isFetching;
  const reload = () => {
    withdrawalsQuery.refetch();
    storesQuery.refetch();
  };
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setConfirmBusy(false);
    setConfirmError(null);
  }, []);

  const finish = useCallback(
    (message: string) => {
      closeDialog();
      setNotice(message);
    },
    [closeDialog],
  );

  // Já excluído em outro lugar: só atualiza as telas.
  const gone = useCallback(() => {
    invalidate('withdrawal.delete');
    finish(t('withdrawals.gone'));
  }, [finish, invalidate, t]);

  const confirmDelete = (withdrawal: Withdrawal) => {
    setConfirmBusy(true);
    setConfirmError(null);
    deleteWithdrawal(withdrawal.id)
      .then(() => {
        invalidate('withdrawal.delete');
        finish(t('withdrawals.deleted', { value: withdrawalAmountText(withdrawal, locale) }));
      })
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'WITHDRAWAL_NOT_FOUND') {
          gone();
          return;
        }
        setConfirmBusy(false);
        setConfirmError(errorMessageFor(err, tLoose, locale));
      });
  };

  const storeList = stores ?? [];
  const noWithdrawalStores = stores !== null && withdrawalStoreOptions(stores, null).length === 0;

  return (
    <section className={styles.section} aria-labelledby="withdrawals-heading">
      <div className={styles.titleRow}>
        <h2 id="withdrawals-heading">{t('withdrawals.title')}</h2>
        {data && <span className={styles.count} aria-live="polite">{tPlural('withdrawals.count', data.totals.count)}</span>}
      </div>
      <div className={styles.toolbar}>
        <p className={styles.note}>{t('withdrawals.intro')}</p>
        <span className={styles.toolbarActions}>
          <ImportButton />
          <button type="button" className={styles.primaryButton} onClick={() => setDialog({ kind: 'create' })} disabled={noWithdrawalStores}>
            {t('withdrawals.new')}
          </button>
        </span>
      </div>

      {noWithdrawalStores && (
        <p className={styles.note} role="status">
          {t('withdrawals.noWithdrawalStores')} <Link href="/stores/">{t('withdrawals.goToStores')}</Link>
        </p>
      )}

      {data && data.totals.count > 0 && (
        <p className={styles.total}>
          {t('withdrawals.total', {
            value: moneyLine({ cents: data.totals.netUsdCents, estimated: data.totals.estimated, approxCents: data.totals.approxCents }),
          })}
        </p>
      )}

      {notice && (
        <div className={styles.notice} role="status">
          <span>{notice}</span>
          <button type="button" className={styles.retry} onClick={() => setNotice(null)}>{t('common.close')}</button>
        </div>
      )}

      {error !== null && (
        <div className={styles.error} role="alert">
          <p>{t('withdrawals.loadError', { reason: errorMessageFor(error, tLoose, locale) })}</p>
          <button type="button" className={styles.retry} onClick={reload}>{t('common.retry')}</button>
        </div>
      )}

      {data === null && error === null && <p className={styles.muted}>{t('common.loading')}</p>}

      {data !== null && error === null && (
        <div className={loading ? styles.dim : undefined} aria-busy={loading}>
          {data.withdrawals.length === 0 ? (
            <div className={styles.empty}>
              <p><strong>{t('withdrawals.empty')}</strong></p>
              <p>{t('withdrawals.emptyHint')}</p>
            </div>
          ) : (
            <WithdrawalsTable
              withdrawals={data.withdrawals}
              onEdit={(withdrawal) => setDialog({ kind: 'edit', withdrawal })}
              onDelete={(withdrawal) => setDialog({ kind: 'delete', withdrawal })}
            />
          )}
        </div>
      )}

      {dialog?.kind === 'create' && <WithdrawalFormModal stores={storeList} onClose={closeDialog} onSaved={finish} onGone={gone} />}
      {dialog?.kind === 'edit' && (
        <WithdrawalFormModal withdrawal={dialog.withdrawal} stores={storeList} onClose={closeDialog} onSaved={finish} onGone={gone} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('withdrawals.deleteTitle')}
          message={t('withdrawals.deleteMessage', {
            value: withdrawalAmountText(dialog.withdrawal, locale),
            date: formatDate(dialog.withdrawal.withdrawnAt, locale),
          })}
          confirmLabel={t('withdrawals.confirmDelete')}
          danger
          busy={confirmBusy}
          error={confirmError}
          onCancel={closeDialog}
          onConfirm={() => confirmDelete(dialog.withdrawal)}
        />
      )}
    </section>
  );
}
