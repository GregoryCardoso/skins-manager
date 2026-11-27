'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import StoreFormModal from '@/components/StoreFormModal';
import StoresTable from '@/components/StoresTable';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, deleteStore, listStores, setSteamStore, updateStore } from '@/services/api';
import type { Store } from '@/types/api';
import PageHeader from '@/components/ui/PageHeader';
import styles from './page.module.css';

type Dialog = { kind: 'create' } | { kind: 'edit'; store: Store } | { kind: 'delete'; store: Store };

export default function StoresPage() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();

  const invalidate = useInvalidate();
  const query = useQuery({ queryKey: queryKeys.stores.all, queryFn: ({ signal }) => listStores(signal) });
  const stores = query.data ?? null;
  const error = query.error ?? null;
  const loading = query.isFetching;
  const reload = () => {
    query.refetch();
  };
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
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
      setActionError(null);
    },
    [closeDialog],
  );

  const storeGone = useCallback(() => {
    invalidate('store.delete');
    finish(t('stores.storeGone'));
  }, [finish, invalidate, t]);

  // Ativar/desativar e "tornar principal" não pedem confirmação: são reversíveis.
  const runInline = (store: Store, body: { isActive: boolean } | { isPrimary: true }, message: string) => {
    setBusyId(store.id);
    setActionError(null);
    updateStore(store.id, body)
      .then(() => {
        setBusyId(null);
        setNotice(message);
        invalidate('store.update');
      })
      .catch((err: unknown) => {
        setBusyId(null);
        if (err instanceof ApiRequestError && err.code === 'STORE_NOT_FOUND') {
          storeGone();
          return;
        }
        setActionError(errorMessageFor(err, tLoose, locale));
        invalidate('store.update');
      });
  };

  const onToggleActive = (store: Store) =>
    runInline(
      store,
      { isActive: !store.isActive },
      t(store.isActive ? 'stores.deactivated' : 'stores.activated', { name: store.name }),
    );
  const onMakePrimary = (store: Store) => runInline(store, { isPrimary: true }, t('stores.madePrimary', { name: store.name }));

  // Loja Steam do app (10.4, D363): escolher esta loja, ou limpar a escolha se ela já é a Steam. Reversível: sem confirmação.
  const onToggleSteam = (store: Store) => {
    setBusyId(store.id);
    setActionError(null);
    const clearing = store.isSteamStore === true;
    setSteamStore(clearing ? null : store.id)
      .then(() => {
        setBusyId(null);
        setNotice(clearing ? t('stores.steamCleared') : t('stores.steamSaved', { name: store.name }));
        invalidate('settings.steamStore');
      })
      .catch((err: unknown) => {
        setBusyId(null);
        if (err instanceof ApiRequestError && err.code === 'STORE_NOT_FOUND') {
          storeGone();
          return;
        }
        setActionError(errorMessageFor(err, tLoose, locale));
        invalidate('settings.steamStore');
      });
  };

  const confirmDelete = (store: Store) => {
    setConfirmBusy(true);
    setConfirmError(null);
    deleteStore(store.id)
      .then(() => {
        invalidate('store.delete');
        finish(t('stores.deleted', { name: store.name }));
      })
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'STORE_NOT_FOUND') {
          storeGone();
          return;
        }
        setConfirmBusy(false);
        setConfirmError(errorMessageFor(err, tLoose, locale));
      });
  };

  return (
    <>
      <PageHeader title={t('stores.title')} subtitle={stores ? tPlural('stores.count', stores.length) : undefined} liveSubtitle />

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
          <p>{t('stores.loadError', { reason: errorMessageFor(error, tLoose, locale) })}</p>
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
              onToggleSteam={onToggleSteam}
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
