'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import DepositFormModal from '@/components/DepositFormModal';
import DepositsTable from '@/components/DepositsTable';
import StoreBalancesPanel from '@/components/StoreBalancesPanel';
import SummaryCards from '@/components/SummaryCards';
import WithdrawalsSection from '@/components/WithdrawalsSection';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { useMoneyLine } from '@/components/MoneyApprox';
import { formatDate, formatMoney } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, deleteDeposit, listDeposits, listStores } from '@/services/api';
import type { Deposit } from '@/types/api';
import styles from './page.module.css';

type Dialog = { kind: 'create' } | { kind: 'edit'; deposit: Deposit } | { kind: 'delete'; deposit: Deposit };

// 8.1: Aportes; 8.2: Saques; 8.3: Saldos; 8.4: resumo (SummaryCards) no topo.
export default function ProfitPage() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const language = useLanguage();
  const moneyLine = useMoneyLine();
  // Valor creditado do aporte para mensagens (US$); aporte legado: o R$ gravado. Só formata.
  const depositValueText = (deposit: Deposit) => {
    if (deposit.amountStoreCents !== null) return formatMoney(deposit.amountStoreCents, 'USD', language);
    return deposit.amountBrlCents === null ? '' : formatMoney(deposit.amountBrlCents, 'BRL', language);
  };

  const invalidate = useInvalidate();
  // Aportes e lojas vêm do cache compartilhado; o que muda (aportes, saques, saldos, itens) o invalida (D259, D260).
  const depositsQuery = useQuery({ queryKey: queryKeys.deposits.all, queryFn: ({ signal }) => listDeposits(signal) });
  const storesQuery = useQuery({ queryKey: queryKeys.stores.all, queryFn: ({ signal }) => listStores(signal) });
  const data = depositsQuery.data ?? null;
  const stores = storesQuery.data ?? [];
  const error = depositsQuery.error ?? storesQuery.error;
  const loading = depositsQuery.isFetching || storesQuery.isFetching;
  const reload = () => {
    depositsQuery.refetch();
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
  const depositGone = useCallback(() => {
    invalidate('deposit.delete');
    finish(t('deposits.gone'));
  }, [finish, invalidate, t]);

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

      <SummaryCards />

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
          <p className={styles.total}>
            {t('deposits.total', {
              value: moneyLine({ cents: data.totals.amountUsdCents, estimated: data.totals.estimated, approxCents: data.totals.approxBrlCents }),
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

      <WithdrawalsSection />

      <StoreBalancesPanel />

      {dialog?.kind === 'create' && <DepositFormModal stores={stores} onClose={closeDialog} onSaved={finish} onGone={depositGone} />}
      {dialog?.kind === 'edit' && (
        <DepositFormModal deposit={dialog.deposit} stores={stores} onClose={closeDialog} onSaved={finish} onGone={depositGone} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('deposits.deleteTitle')}
          message={t('deposits.deleteMessage', {
            value: depositValueText(dialog.deposit),
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
