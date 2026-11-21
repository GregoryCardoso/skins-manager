'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import { ApiRequestError, deleteStoreBalance, listStoreBalances } from '@/services/api';
import type { StoreBalance, StoreBalanceSummary } from '@/types/api';
import tableStyles from './DepositsTable.module.css';
import styles from './forms.module.css';
import Modal from './Modal';

interface Props {
  store: StoreBalanceSummary;
  onClose: () => void;
  // Chamado depois de excluir um registro (o painel recarrega os saldos).
  onChanged: () => void;
}

// Histórico de saldos registrados da loja, do mais recente para o mais antigo; só exclusão (append-only, D204).
export default function StoreBalanceHistory({ store, onClose, onChanged }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();

  const [balances, setBalances] = useState<StoreBalance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listStoreBalances(store.storeId, controller.signal)
      .then((data) => {
        setBalances(data.balances);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof ApiRequestError && err.code === 'ABORTED')) return;
        setError(errorMessageFor(err, tLoose, language));
      });
    return () => controller.abort();
  }, [store.storeId, reloadToken, tLoose, language]);

  const remove = useCallback((balance: StoreBalance) => {
    setBusyId(balance.id);
    setError(null);
    deleteStoreBalance(balance.id)
      .catch((err: unknown) => {
        // Já excluído em outro lugar: só recarrega a lista.
        if (err instanceof ApiRequestError && err.code === 'STORE_BALANCE_NOT_FOUND') return;
        setError(errorMessageFor(err, tLoose, language));
      })
      .finally(() => {
        setBusyId(null);
        setConfirmId(null);
        setReloadToken((n) => n + 1);
        onChanged();
      });
  }, [tLoose, language, onChanged]);

  return (
    <Modal title={t('storeBalances.history.title', { store: store.storeName })} onClose={onClose} wide>
      {error && <div className={styles.topError} role="alert">{error}</div>}
      {balances === null && error === null && <p className={styles.muted}>{t('common.loading')}</p>}
      {balances !== null && balances.length === 0 && <p className={styles.muted}>{t('storeBalances.history.empty')}</p>}
      {balances !== null && balances.length > 0 && (
        <div className={tableStyles.scroll}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th scope="col">{t('storeBalances.history.date')}</th>
                <th scope="col">{t('storeBalances.history.amount')}</th>
                <th scope="col">{t('storeBalances.history.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((balance, index) => (
                <tr key={balance.id} className={tableStyles.row}>
                  <td className={tableStyles.date}>
                    {formatDate(balance.recordedAt, language)}
                    {index === 0 && <span className={tableStyles.muted}> ({t('storeBalances.history.current')})</span>}
                  </td>
                  <td className={tableStyles.amount}>{formatMoney(balance.balanceCents, store.currency, language)}</td>
                  <td>
                    {confirmId === balance.id ? (
                      <div className={tableStyles.actions}>
                        <button
                          type="button"
                          className={`${tableStyles.button} ${tableStyles.danger}`}
                          onClick={() => remove(balance)}
                          disabled={busyId === balance.id}
                        >
                          {t('storeBalances.history.confirmDelete')}
                        </button>
                        <button type="button" className={tableStyles.button} onClick={() => setConfirmId(null)} disabled={busyId === balance.id}>
                          {t('common.cancel')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={`${tableStyles.button} ${tableStyles.danger}`}
                        onClick={() => setConfirmId(balance.id)}
                        disabled={busyId !== null}
                      >
                        {t('storeBalances.history.delete')}
                      </button>
                    )}
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
    </Modal>
  );
}
