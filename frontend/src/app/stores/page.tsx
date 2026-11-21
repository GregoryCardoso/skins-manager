'use client';

import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import StoreFormModal from '@/components/StoreFormModal';
import StoresTable from '@/components/StoresTable';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { ApiRequestError, deleteStore, listStores, updateStore } from '@/services/api';
import type { Store } from '@/types/api';
import styles from './page.module.css';

type Dialog = { kind: 'create' } | { kind: 'edit'; store: Store } | { kind: 'delete'; store: Store };

export default function StoresPage() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const language = useLanguage();

  const [stores, setStores] = useState<Store[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    listStores(controller.signal)
      .then((list) => {
        setStores(list);
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
      setActionError(null);
      reload();
    },
    [closeDialog, reload],
  );

  const storeGone = useCallback(() => finish(t('stores.storeGone')), [finish, t]);

  // Ativar/desativar e "tornar principal" não pedem confirmação: são reversíveis.
  const runInline = (store: Store, body: { isActive: boolean } | { isPrimary: true }, message: string) => {
    setBusyId(store.id);
    setActionError(null);
    updateStore(store.id, body)
      .then(() => {
        setBusyId(null);
        setNotice(message);
        reload();
      })
      .catch((err: unknown) => {
        setBusyId(null);
        if (err instanceof ApiRequestError && err.code === 'STORE_NOT_FOUND') {
          storeGone();
          return;
        }
        setActionError(errorMessageFor(err, tLoose, language));
        reload();
      });
  };

  const onToggleActive = (store: Store) =>
    runInline(
      store,
      { isActive: !store.isActive },
      t(store.isActive ? 'stores.deactivated' : 'stores.activated', { name: store.name }),
    );
  const onMakePrimary = (store: Store) => runInline(store, { isPrimary: true }, t('stores.madePrimary', { name: store.name }));

  const confirmDelete = (store: Store) => {
    setConfirmBusy(true);
    setConfirmError(null);
    deleteStore(store.id)
      .then(() => finish(t('stores.deleted', { name: store.name })))
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'STORE_NOT_FOUND') {
          storeGone();
          return;
        }
        setConfirmBusy(false);
        setConfirmError(errorMessageFor(err, tLoose, language));
      });
  };

  return (
    <>
      <div className={styles.titleRow}>
        <h1>{t('stores.title')}</h1>
        {stores && <span className={styles.count} aria-live="polite">{tPlural('stores.count', stores.length)}</span>}
      </div>

      <div className={styles.toolbar}>
        <p className={styles.note}>{t('stores.feeChangeNote')}</p>
        <button type="button" className={styles.primaryButton} onClick={() => setDialog({ kind: 'create' })}>
          {t('stores.new')}
        </button>
      </div>

      {notice && (
        <div className={styles.notice} role="status">
          <span>{notice}</span>
          <button type="button" className={styles.retry} onClick={() => setNotice(null)}>{t('common.close')}</button>
        </div>
      )}

      {actionError && (
        <div className={styles.error} role="alert">
          <p>{actionError}</p>
          <button type="button" className={styles.retry} onClick={() => setActionError(null)}>{t('common.close')}</button>
        </div>
      )}

      {error !== null && (
        <div className={styles.error} role="alert">
          <p>{t('stores.loadError', { reason: errorMessageFor(error, tLoose, language) })}</p>
          <button type="button" className={styles.retry} onClick={reload}>{t('common.retry')}</button>
        </div>
      )}

      {stores === null && error === null && <p className={styles.muted}>{t('common.loading')}</p>}

      {stores !== null && error === null && (
        <div className={loading ? styles.dim : undefined} aria-busy={loading}>
          {stores.length === 0 ? (
            <div className={styles.empty}><p>{t('stores.empty')}</p></div>
          ) : (
            <StoresTable
              stores={stores}
              busyId={busyId}
              onEdit={(store) => setDialog({ kind: 'edit', store })}
              onToggleActive={onToggleActive}
              onMakePrimary={onMakePrimary}
              onDelete={(store) => setDialog({ kind: 'delete', store })}
            />
          )}
        </div>
      )}

      {dialog?.kind === 'create' && <StoreFormModal onClose={closeDialog} onSaved={finish} onGone={storeGone} />}
      {dialog?.kind === 'edit' && <StoreFormModal store={dialog.store} onClose={closeDialog} onSaved={finish} onGone={storeGone} />}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('stores.deleteTitle')}
          message={t('stores.deleteMessage', { name: dialog.store.name })}
          confirmLabel={t('stores.confirmDelete')}
          danger
          busy={confirmBusy}
          error={confirmError}
          onCancel={closeDialog}
          onConfirm={() => confirmDelete(dialog.store)}
        />
      )}
    </>
  );
}
