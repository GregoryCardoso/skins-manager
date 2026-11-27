'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, deleteDeposit, listDeposits, listStores } from '@/services/api';
import type { Deposit } from '@/types/api';
import DepositFormModal from './DepositFormModal';
import DepositsTable from './DepositsTable';
import ImportButton from './ImportButton';
import { useMoneyLine } from './MoneyApprox';
import styles from './moneySection.module.css';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import Skeleton from './ui/Skeleton';
import { useToast } from './ui/Toast';

type Dialog = { kind: 'edit'; deposit: Deposit } | { kind: 'delete'; deposit: Deposit };

interface Props {
  // Abre o formulário de novo aporte (que fica na página, junto do cabeçalho e das linhas das lojas).
  onCreate: () => void;
}

// Aba Aportes da página Lucro real (12.7b): lista, total, edição e exclusão. Carrega os próprios dados (cache compartilhado).
export default function DepositsSection({ onCreate }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const moneyLine = useMoneyLine();
  const toast = useToast();
  const invalidate = useInvalidate();

  const depositsQuery = useQuery({ queryKey: queryKeys.deposits.all, queryFn: ({ signal }) => listDeposits(signal) });
  const storesQuery = useQuery({ queryKey: queryKeys.stores.all, queryFn: ({ signal }) => listStores(signal) });
  const data = depositsQuery.data ?? null;
  const error = depositsQuery.error ?? storesQuery.error;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Valor creditado do aporte para mensagens (US$); aporte legado: o valor gravado em outra moeda. Só formata.
  const depositValueText = (deposit: Deposit) => {
    if (deposit.amountStoreCents !== null) return formatMoney(deposit.amountStoreCents, 'USD', locale);
    return deposit.amountBrlCents === null ? '' : formatMoney(deposit.amountBrlCents, deposit.amountBrlCurrency ?? 'BRL', locale);
  };

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
    invalidate('deposit.delete');
    closeDialog();
    toast.show({ tone: 'info', message: t('deposits.gone') });
  }, [closeDialog, invalidate, toast, t]);

  const confirmDelete = (deposit: Deposit) => {
    setConfirmBusy(true);
    setConfirmError(null);
    deleteDeposit(deposit.id)
      .then(() => {
        invalidate('deposit.delete');
        finish(t('deposits.deleted', { value: depositValueText(deposit) }));
      })
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'DEPOSIT_NOT_FOUND') {
          gone();
          return;
        }
        setConfirmBusy(false);
        setConfirmError(errorMessageFor(err, tLoose, locale));
      });
  };

  const onEdit = useCallback((deposit: Deposit) => setDialog({ kind: 'edit', deposit }), []);
  const onDelete = useCallback((deposit: Deposit) => setDialog({ kind: 'delete', deposit }), []);

  return (
    <div className={styles.section}>
      <div className={styles.toolbar}>
        <p className={styles.note}>{t('deposits.intro')}</p>
        <span className={styles.actions}>
          <ImportButton />
          <Button variant="primary" icon="plus" onClick={onCreate}>{t('deposits.new')}</Button>
        </span>
      </div>

      {data && data.totals.count > 0 && (
        <p className={styles.total}>
          {t('deposits.total', {
            value: moneyLine({ cents: data.totals.amountUsdCents, estimated: data.totals.estimated, approxCents: data.totals.approxCents, approxCurrency: data.totals.approxCurrency }),
          })}
          {(data.totals.feeCents ?? 0) > 0 && ` ${t('deposits.totalFees', { value: formatMoney(data.totals.feeCents ?? 0, 'USD', locale) })}`}
        </p>
      )}

      {error !== null && (
        <ErrorState
          message={t('deposits.loadError', { reason: errorMessageFor(error, tLoose, locale) })}
          onRetry={() => {
            depositsQuery.refetch();
            storesQuery.refetch();
          }}
          retrying={depositsQuery.isFetching || storesQuery.isFetching}
        />
      )}

      {data === null && error === null && <Skeleton width="100%" height="6rem" />}

      {data !== null && error === null && (
        data.deposits.length === 0 ? (
          <EmptyState title={t('deposits.empty')} description={t('deposits.emptyHint')} action={<Button onClick={onCreate}>{t('deposits.new')}</Button>} />
        ) : (
          <DepositsTable deposits={data.deposits} onEdit={onEdit} onDelete={onDelete} />
        )
      )}

      {dialog?.kind === 'edit' && (
        <DepositFormModal deposit={dialog.deposit} stores={storesQuery.data ?? []} onClose={closeDialog} onSaved={finish} onGone={gone} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('deposits.deleteTitle')}
          message={t('deposits.deleteMessage', { value: depositValueText(dialog.deposit), date: formatDate(dialog.deposit.depositedAt, locale) })}
          confirmLabel={t('deposits.confirmDelete')}
          tone="danger"
          busy={confirmBusy}
          error={confirmError}
          onCancel={closeDialog}
          onConfirm={() => confirmDelete(dialog.deposit)}
        />
      )}
    </div>
  );
}
