'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { withdrawalAmountText, withdrawalStoreOptions } from '@/lib/withdrawalForm';
import { ApiRequestError, deleteWithdrawal, listStores, listWithdrawals } from '@/services/api';
import type { Withdrawal } from '@/types/api';
import ImportButton from './ImportButton';
import { useMoneyLine } from './MoneyApprox';
import styles from './moneySection.module.css';
import WithdrawalFormModal from './WithdrawalFormModal';
import WithdrawalsTable from './WithdrawalsTable';
import Banner from './ui/Banner';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import Skeleton from './ui/Skeleton';
import { useToast } from './ui/Toast';

type Dialog = { kind: 'edit'; withdrawal: Withdrawal } | { kind: 'delete'; withdrawal: Withdrawal };

interface Props {
  // Abre o formulário de novo saque (que fica na página, junto do cabeçalho e das linhas das lojas).
  onCreate: () => void;
}

// Aba Saques da página Lucro real (8.2; 12.7b): lista, total, edição e exclusão. Carrega os próprios dados (cache compartilhado).
export default function WithdrawalsSection({ onCreate }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const moneyLine = useMoneyLine();
  const toast = useToast();
  const invalidate = useInvalidate();

  const withdrawalsQuery = useQuery({ queryKey: queryKeys.withdrawals.all, queryFn: ({ signal }) => listWithdrawals(signal) });
  const storesQuery = useQuery({ queryKey: queryKeys.stores.all, queryFn: ({ signal }) => listStores(signal) });
  const data = withdrawalsQuery.data ?? null;
  const stores = storesQuery.data ?? null;
  const error = withdrawalsQuery.error ?? storesQuery.error;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setConfirmBusy(false);
    setConfirmError(null);
  }, []);
  const finish = useCallback((message: string) => {
    closeDialog();
    toast.show({ tone: 'success', message });
  }, [closeDialog, toast]);
  // Já excluído em outro lugar: só atualiza as telas.
  const gone = useCallback(() => {
    invalidate('withdrawal.delete');
    closeDialog();
    toast.show({ tone: 'info', message: t('withdrawals.gone') });
  }, [closeDialog, invalidate, toast, t]);

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

  const onEdit = useCallback((withdrawal: Withdrawal) => setDialog({ kind: 'edit', withdrawal }), []);
  const onDelete = useCallback((withdrawal: Withdrawal) => setDialog({ kind: 'delete', withdrawal }), []);
  const noWithdrawalStores = stores !== null && withdrawalStoreOptions(stores, null).length === 0;

  return (
    <div className={styles.section}>
      <div className={styles.toolbar}>
        <p className={styles.note}>{t('withdrawals.intro')}</p>
        <span className={styles.actions}>
          <ImportButton />
          <Button variant="primary" icon="plus" onClick={onCreate} disabled={noWithdrawalStores}>{t('withdrawals.new')}</Button>
        </span>
      </div>

      {noWithdrawalStores && (
        <Banner tone="warning" announce={false} action={{ label: t('withdrawals.goToStores'), href: '/stores/' }}>
          {t('withdrawals.noWithdrawalStores')}
        </Banner>
      )}

      {data && data.totals.count > 0 && (
        <p className={styles.total}>
          {t('withdrawals.total', {
            value: moneyLine({ cents: data.totals.netUsdCents, estimated: data.totals.estimated, approxCents: data.totals.approxCents, approxCurrency: data.totals.approxCurrency }),
          })}
        </p>
      )}

      {error !== null && (
        <ErrorState
          message={t('withdrawals.loadError', { reason: errorMessageFor(error, tLoose, locale) })}
          onRetry={() => {
            withdrawalsQuery.refetch();
            storesQuery.refetch();
          }}
          retrying={withdrawalsQuery.isFetching || storesQuery.isFetching}
        />
      )}

      {data === null && error === null && <Skeleton width="100%" height="6rem" />}

      {data !== null && error === null && (
        data.withdrawals.length === 0 ? (
          <EmptyState title={t('withdrawals.empty')} description={t('withdrawals.emptyHint')} />
        ) : (
          <WithdrawalsTable withdrawals={data.withdrawals} onEdit={onEdit} onDelete={onDelete} />
        )
      )}

      {dialog?.kind === 'edit' && (
        <WithdrawalFormModal withdrawal={dialog.withdrawal} stores={stores ?? []} onClose={closeDialog} onSaved={finish} onGone={gone} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('withdrawals.deleteTitle')}
          message={t('withdrawals.deleteMessage', { value: withdrawalAmountText(dialog.withdrawal, locale), date: formatDate(dialog.withdrawal.withdrawnAt, locale) })}
          confirmLabel={t('withdrawals.confirmDelete')}
          tone="danger"
          busy={confirmBusy}
          error={confirmError}
          onCancel={closeDialog}
          onConfirm={() => confirmDelete(dialog.withdrawal)}
        />
      )}
    </div>
  );
}
