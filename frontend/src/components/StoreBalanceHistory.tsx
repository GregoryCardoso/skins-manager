'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, deleteStoreBalanceEntry, listStoreBalances } from '@/services/api';
import type { StoreBalanceEntry, StoreBalanceSummary } from '@/types/api';
import ConfirmDialog from './ConfirmDialog';
import tableStyles from './DepositsTable.module.css';
import styles from './forms.module.css';
import Modal from './Modal';

interface Props {
  store: StoreBalanceSummary;
  onClose: () => void;
}

// Histórico da loja (D242, D247): conferências (com calculado, diferença e ajuste) e registros antigos,
// do mais recente para o mais antigo. Só exclusão (append-only).
export default function StoreBalanceHistory({ store, onClose }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const invalidate = useInvalidate();

  const query = useQuery({
    queryKey: queryKeys.storeBalances.history(store.storeId),
    queryFn: ({ signal }) => listStoreBalances(store.storeId, signal),
  });
  const entries: StoreBalanceEntry[] | null = query.data ? query.data.balances : null;
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const error = deleteError ?? (query.error ? errorMessageFor(query.error, tLoose, language) : null);
  const [confirming, setConfirming] = useState<StoreBalanceEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = useCallback((entry: StoreBalanceEntry) => {
    setBusy(true);
    setDeleteError(null);
    deleteStoreBalanceEntry(entry.id)
      .catch((err: unknown) => {
        // Já excluído em outro lugar: só recarrega a lista.
        if (err instanceof ApiRequestError && err.code === 'STORE_BALANCE_NOT_FOUND') return;
        setDeleteError(errorMessageFor(err, tLoose, language));
      })
      .finally(() => {
        setBusy(false);
        setConfirming(null);
        invalidate('balanceCheck.delete');
      });
  }, [tLoose, language, invalidate]);

  const money = (cents: number | null) => (cents === null ? '' : formatMoney(cents, store.currency, language));
  const kindLabel = (entry: StoreBalanceEntry) => t(entry.legacy ? 'storeBalances.kind.LEGACY' : 'storeBalances.kind.CHECK');

  return (
    <Modal title={t('storeBalances.history.title', { store: store.storeName })} onClose={onClose} wide>
      {error && <div className={styles.topError} role="alert">{error}</div>}
      {entries === null && error === null && <p className={styles.muted}>{t('common.loading')}</p>}
      {entries !== null && entries.length === 0 && <p className={styles.muted}>{t('storeBalances.history.empty')}</p>}
      {entries !== null && entries.length > 0 && (
        <div className={tableStyles.scroll}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th scope="col">{t('storeBalances.history.date')}</th>
                <th scope="col">{t('storeBalances.history.type')}</th>
                <th scope="col">{t('storeBalances.history.real')}</th>
                <th scope="col">{t('storeBalances.history.computed')}</th>
                <th scope="col">{t('storeBalances.history.difference')}</th>
                <th scope="col">{t('storeBalances.history.adjustment')}</th>
                <th scope="col">{t('storeBalances.history.noteColumn')}</th>
                <th scope="col">{t('storeBalances.history.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className={tableStyles.row}>
                  <td className={tableStyles.date}>{formatDate(entry.recordedAt, language)}</td>
                  <td>{kindLabel(entry)}</td>
                  <td className={tableStyles.amount}>{money(entry.balanceCents)}</td>
                  <td className={tableStyles.amount}>{money(entry.computedCents)}</td>
                  <td className={tableStyles.amount}>{money(entry.differenceCents)}</td>
                  <td className={tableStyles.amount}>{money(entry.adjustmentCents)}</td>
                  <td>{entry.note ?? ''}</td>
                  <td>
                    <button
                      type="button"
                      className={`${tableStyles.button} ${tableStyles.danger}`}
                      onClick={() => setConfirming(entry)}
                      disabled={busy}
                    >
                      {t('storeBalances.history.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.hint}>{t('storeBalances.history.note')}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={onClose}>{t('common.close')}</button>
      </div>

      {confirming && (
        <ConfirmDialog
          title={t('storeBalances.history.deleteTitle')}
          message={t('storeBalances.history.deleteMessage')}
          confirmLabel={t('storeBalances.history.confirmDelete')}
          danger
          busy={busy}
          onConfirm={() => remove(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </Modal>
  );
}
