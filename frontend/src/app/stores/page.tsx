'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import StoreCard from '@/components/StoreCard';
import StoreFormModal from '@/components/StoreFormModal';
import Banner from '@/components/ui/Banner';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import PageHeader from '@/components/ui/PageHeader';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { queryKeys } from '@/lib/queryKeys';
import { focusSteamChoice } from '@/lib/storeSummary';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, deleteStore, getSettings, listStores, setSteamStore, updateStore } from '@/services/api';
import type { Store } from '@/types/api';
import styles from './page.module.css';

type Dialog = { kind: 'create' } | { kind: 'edit'; store: Store } | { kind: 'delete'; store: Store };

export default function StoresPage() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const toast = useToast();

  const invalidate = useInvalidate();
  const query = useQuery({ queryKey: queryKeys.stores.all, queryFn: ({ signal }) => listStores(signal) });
  const settingsQuery = useQuery({ queryKey: queryKeys.settings.all, queryFn: ({ signal }) => getSettings(signal) });
  const stores = query.data ?? null;
  const error = query.error ?? null;
  const loading = query.isFetching;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const say = useCallback((tone: 'success' | 'info' | 'danger', message: string) => {
    toast.show({ tone, message });
  }, [toast]);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setConfirmBusy(false);
    setConfirmError(null);
  }, []);

  const finish = useCallback(
    (message: string) => {
      closeDialog();
      say('success', message);
    },
    [closeDialog, say],
  );

  const storeGone = useCallback(() => {
    invalidate('store.delete');
    closeDialog();
    say('info', t('stores.storeGone'));
  }, [closeDialog, invalidate, say, t]);

  // Ativar/desativar e "tornar principal" não pedem confirmação: são reversíveis.
  const runInline = (store: Store, body: { isActive: boolean } | { isPrimary: true }, message: string) => {
    setBusyId(store.id);
    updateStore(store.id, body)
      .then(() => {
        setBusyId(null);
        say('success', message);
        invalidate('store.update');
      })
      .catch((err: unknown) => {
        setBusyId(null);
        if (err instanceof ApiRequestError && err.code === 'STORE_NOT_FOUND') {
          storeGone();
          return;
        }
        say('danger', errorMessageFor(err, tLoose, locale));
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
    const clearing = store.isSteamStore === true;
    setSteamStore(clearing ? null : store.id)
      .then(() => {
        setBusyId(null);
        say('success', clearing ? t('stores.steamCleared') : t('stores.steamSaved', { name: store.name }));
        invalidate('settings.steamStore');
      })
      .catch((err: unknown) => {
        setBusyId(null);
        if (err instanceof ApiRequestError && err.code === 'STORE_NOT_FOUND') {
          storeGone();
          return;
        }
        say('danger', errorMessageFor(err, tLoose, locale));
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

  // Dica da Steam: some quando uma loja já foi escolhida (P6).
  const showSteamTip = stores !== null && stores.length > 0 && settingsQuery.data !== undefined && settingsQuery.data.steamStoreId === null;

  return (
    <>
      <PageHeader
        title={t('stores.title')}
        subtitle={stores ? tPlural('stores.count', stores.length) : undefined}
        liveSubtitle
        actions={<Button variant="primary" icon="plus" onClick={() => setDialog({ kind: 'create' })}>{t('stores.new')}</Button>}
      />

      <div className={styles.stack}>
        <p className={styles.note}>{t('stores.feeChangeNote')}</p>

        {showSteamTip && (
          <Banner
            tone="info"
            title={t('stores.steamTip.title')}
            action={{ label: t('stores.steamTip.action'), onClick: () => focusSteamChoice(document, stores) }}
          >
            {t('stores.steamTip.body')}
          </Banner>
        )}

        {error !== null && (
          <ErrorState
            message={t('stores.loadError', { reason: errorMessageFor(error, tLoose, locale) })}
            onRetry={() => void query.refetch()}
            retrying={loading}
          />
        )}

        {stores === null && error === null && (
          <div className={styles.grid} aria-busy="true">
            <Skeleton height="9rem" radius="md" />
            <Skeleton height="9rem" radius="md" />
            <Skeleton height="9rem" radius="md" />
          </div>
        )}

        {stores !== null && error === null && (
          stores.length === 0 ? (
            <EmptyState
              icon="stores"
              title={t('stores.empty')}
              action={<Button variant="primary" icon="plus" onClick={() => setDialog({ kind: 'create' })}>{t('stores.new')}</Button>}
            />
          ) : (
            <ul className={`${styles.grid} ${loading ? styles.dim : ''}`} aria-busy={loading}>
              {stores.map((store) => (
                <li key={store.id} className={styles.cell} data-store-id={store.id}>
                  <StoreCard
                    store={store}
                    busy={busyId === store.id}
                    onEdit={(s) => setDialog({ kind: 'edit', store: s })}
                    onToggleActive={onToggleActive}
                    onMakePrimary={onMakePrimary}
                    onToggleSteam={onToggleSteam}
                    onDelete={(s) => setDialog({ kind: 'delete', store: s })}
                  />
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {dialog?.kind === 'create' && <StoreFormModal onClose={closeDialog} onSaved={finish} onGone={storeGone} />}
      {dialog?.kind === 'edit' && <StoreFormModal store={dialog.store} onClose={closeDialog} onSaved={finish} onGone={storeGone} />}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('stores.deleteTitle')}
          message={t('stores.deleteMessage', { name: dialog.store.name })}
          confirmLabel={t('stores.confirmDelete')}
          tone="danger"
          busy={confirmBusy}
          error={confirmError}
          onCancel={closeDialog}
          onConfirm={() => confirmDelete(dialog.store)}
        />
      )}
    </>
  );
}
