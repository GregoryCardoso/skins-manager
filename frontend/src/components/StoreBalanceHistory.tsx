'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, deleteStoreBalanceEntry, listStoreBalances } from '@/services/api';
import type { StoreBalanceEntry, StoreBalanceSummary } from '@/types/api';
import styles from './moneyForms.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';
import DataTable, { type Column } from './ui/DataTable';
import Dialog from './ui/Dialog';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import Menu from './ui/Menu';
import Money from './ui/Money';

interface Props {
  store: StoreBalanceSummary;
  onClose: () => void;
}

// Histórico de conferências da loja (D242, D247; 12.7b): Dialog `lg` com a tabela (data, tipo, diferença e ações sempre à vista; real,
// calculado e ajuste na segunda faixa; observação na terceira). Do mais recente para o mais antigo. Só exclusão (append-only).
export default function StoreBalanceHistory({ store, onClose }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();

  const query = useQuery({
    queryKey: queryKeys.storeBalances.history(store.storeId),
    queryFn: ({ signal }) => listStoreBalances(store.storeId, signal),
  });
  const entries: StoreBalanceEntry[] | null = query.data ? query.data.balances : null;
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<StoreBalanceEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = useCallback((entry: StoreBalanceEntry) => {
    setBusy(true);
    setDeleteError(null);
    deleteStoreBalanceEntry(entry.id)
      .catch((err: unknown) => {
        // Já excluído em outro lugar: só recarrega a lista.
        if (err instanceof ApiRequestError && err.code === 'STORE_BALANCE_NOT_FOUND') return;
        setDeleteError(errorMessageFor(err, tLoose, locale));
      })
      .finally(() => {
        setBusy(false);
        setConfirming(null);
        invalidate('balanceCheck.delete');
      });
  }, [tLoose, locale, invalidate]);

  const money = (cents: number | null) => (cents === null ? <span>{t('common.none')}</span> : <Money size="sm" cents={cents} currency={store.currency} />);
  const kindLabel = (entry: StoreBalanceEntry) => t(entry.legacy ? 'storeBalances.kind.LEGACY' : 'storeBalances.kind.CHECK');

  const columns = useMemo<Column<StoreBalanceEntry>[]>(() => [
    { id: 'date', header: t('storeBalances.history.date'), cell: (entry) => formatDate(entry.recordedAt, locale), priority: 1 },
    { id: 'type', header: t('storeBalances.history.type'), cell: kindLabel, priority: 1 },
    {
      id: 'difference', header: t('storeBalances.history.difference'), align: 'end', priority: 1,
      cell: (entry) => (entry.differenceCents === null ? t('common.none') : <Money size="sm" signed cents={entry.differenceCents} currency={store.currency} align="end" />),
    },
    { id: 'real', header: t('storeBalances.history.real'), align: 'end', priority: 2, cell: (entry) => money(entry.balanceCents) },
    { id: 'computed', header: t('storeBalances.history.computed'), align: 'end', priority: 2, cell: (entry) => money(entry.computedCents) },
    { id: 'adjustment', header: t('storeBalances.history.adjustment'), align: 'end', priority: 2, cell: (entry) => money(entry.adjustmentCents) },
    { id: 'note', header: t('storeBalances.history.noteColumn'), priority: 3, cell: (entry) => entry.note ?? t('common.none') },
    {
      id: 'actions', header: t('storeBalances.history.actions'), hideHeader: true, align: 'end', priority: 1,
      cell: (entry) => (
        <Menu
          label={t('profit.rowActions', { date: formatDate(entry.recordedAt, locale) })}
          items={[{ id: 'delete', label: t('storeBalances.history.delete'), icon: 'close', tone: 'danger', disabled: busy, onSelect: () => setConfirming(entry) }]}
        />
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, locale, store.currency, busy]);

  return (
    <Dialog
      title={t('storeBalances.history.title', { store: store.storeName })}
      size="lg"
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      <div className={styles.stack}>
        {deleteError && <Banner tone="danger" onDismiss={() => setDeleteError(null)}>{deleteError}</Banner>}
        {query.error && <ErrorState message={errorMessageFor(query.error, tLoose, locale)} onRetry={() => query.refetch()} retrying={query.isFetching} />}
        {!query.error && (
          <DataTable
            caption={t('storeBalances.history.title', { store: store.storeName })}
            columns={columns}
            rows={entries ?? []}
            getRowId={(entry) => String(entry.id)}
            rowLabel={(entry) => formatDate(entry.recordedAt, locale)}
            loading={entries === null}
            empty={<EmptyState title={t('storeBalances.history.empty')} />}
          />
        )}
        <p className={styles.small}>{t('storeBalances.history.note')}</p>
      </div>

      {confirming && (
        <ConfirmDialog
          title={t('storeBalances.history.deleteTitle')}
          message={t('storeBalances.history.deleteMessage')}
          confirmLabel={t('storeBalances.history.confirmDelete')}
          tone="danger"
          busy={busy}
          onConfirm={() => remove(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </Dialog>
  );
}
