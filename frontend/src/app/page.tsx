'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import InventoryFilters from '@/components/InventoryFilters';
import InventoryTable from '@/components/InventoryTable';
import { usePreferences } from '@/components/PreferencesProvider';
import ItemFormModal from '@/components/ItemFormModal';
import SellItemModal from '@/components/SellItemModal';
import SystemStatus from '@/components/SystemStatus';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import {
  DEFAULT_FILTERS, hasActiveFilters, parseFilters, toApiQuery, toSearchString, type InventoryFilters as Filters,
} from '@/lib/inventoryQuery';
import { ApiRequestError, deleteItem, listItems, listStores, unsellItem } from '@/services/api';
import type { ItemList, ItemView, Store } from '@/types/api';
import styles from './page.module.css';

const CONNECTION_ERRORS = ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'];

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; item: ItemView }
  | { kind: 'sell'; item: ItemView }
  | { kind: 'delete'; item: ItemView }
  | { kind: 'unsell'; item: ItemView };

function InventoryView() {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();
  const { usdBrlRate } = usePreferences();

  const searchKey = searchParams.toString();
  const filters = useMemo(() => parseFilters(new URLSearchParams(searchKey)), [searchKey]);
  const apiKey = JSON.stringify(toApiQuery(filters));

  const [data, setData] = useState<ItemList | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setConfirmBusy(false);
    setConfirmError(null);
  }, []);

  // Sucesso de qualquer ação: fecha o modal, mostra a mensagem e recarrega a lista.
  const finish = useCallback(
    (message: string) => {
      closeDialog();
      setNotice(message);
      reload();
    },
    [closeDialog, reload],
  );

  // Item excluído em outra aba: avisa e recarrega.
  const itemGone = useCallback(() => finish(t('inventory.itemGone')), [finish, t]);

  const runConfirm = (action: Promise<unknown>, doneMessage: string) => {
    setConfirmBusy(true);
    setConfirmError(null);
    action
      .then(() => finish(doneMessage))
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.code === 'ITEM_NOT_FOUND') {
          itemGone();
          return;
        }
        setConfirmBusy(false);
        setConfirmError(errorMessageFor(err, tLoose, language));
      });
  };

  // Carrega itens e lojas; trocar filtro (ou cotação) cancela a requisição anterior.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([listItems(JSON.parse(apiKey), controller.signal), listStores(controller.signal)])
      .then(([list, storeList]) => {
        setData(list);
        setStores(storeList);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof ApiRequestError && err.code === 'ABORTED')) return;
        setError(err);
        setLoading(false);
      });
    return () => controller.abort();
  }, [apiKey, usdBrlRate, reloadToken]);

  // Ao voltar o foco da janela, relê a lista (o trade lock e a idade dependem do horário atual).
  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const setFilters = useCallback(
    (next: Filters) => {
      const qs = toSearchString(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const connectionProblem = error instanceof ApiRequestError && CONNECTION_ERRORS.includes(error.code);
  if (connectionProblem) {
    return (
      <>
        <h1>{t('inventory.title')}</h1>
        <SystemStatus />
        <button type="button" className={styles.retry} onClick={reload}>{t('common.retry')}</button>
      </>
    );
  }

  const slowItemDays = data?.meta.slowItemDays ?? 21;
  const filtered = hasActiveFilters(filters);

  return (
    <>
      <div className={styles.titleRow}>
        <h1>{t('inventory.title')}</h1>
        {data && <span className={styles.count} aria-live="polite">{t('inventory.count', { count: data.meta.count })}</span>}
        <button type="button" className={styles.newItem} onClick={() => setDialog({ kind: 'create' })}>
          {t('inventory.actions.newItem')}
        </button>
      </div>

      {notice && (
        <div className={styles.notice} role="status">
          <span>{notice}</span>
          <button type="button" className={styles.retry} onClick={() => setNotice(null)}>{t('common.close')}</button>
        </div>
      )}

      <InventoryFilters
        filters={filters}
        slowItemDays={slowItemDays}
        loading={loading}
        onChange={setFilters}
        onClear={() => setFilters(DEFAULT_FILTERS)}
        onRefresh={reload}
      />

      {error !== null && (
        <div className={styles.error} role="alert">
          <p>{t('inventory.loadError', { reason: errorMessageFor(error, tLoose, language) })}</p>
          <button type="button" className={styles.retry} onClick={reload}>{t('common.retry')}</button>
        </div>
      )}

      {data === null && error === null && <p className={styles.muted}>{t('common.loading')}</p>}

      {data !== null && data.items.length === 0 && error === null && (
        <div className={styles.empty}>
          <p>{filtered ? t('inventory.emptyFiltered') : t('inventory.empty')}</p>
          {filtered && (
            <button type="button" className={styles.retry} onClick={() => setFilters(DEFAULT_FILTERS)}>
              {t('inventory.clearFilters')}
            </button>
          )}
        </div>
      )}

      {data !== null && data.items.length > 0 && (
        <div className={loading ? styles.dim : undefined} aria-busy={loading}>
          <InventoryTable
            items={data.items}
            stores={stores}
            onEdit={(item) => setDialog({ kind: 'edit', item })}
            onSell={(item) => setDialog({ kind: 'sell', item })}
            onUnsell={(item) => setDialog({ kind: 'unsell', item })}
            onDelete={(item) => setDialog({ kind: 'delete', item })}
          />
        </div>
      )}

      {dialog?.kind === 'create' && (
        <ItemFormModal stores={stores} onClose={closeDialog} onSaved={finish} onGone={itemGone} />
      )}
      {dialog?.kind === 'edit' && (
        <ItemFormModal item={dialog.item} stores={stores} onClose={closeDialog} onSaved={finish} onGone={itemGone} />
      )}
      {dialog?.kind === 'sell' && (
        <SellItemModal item={dialog.item} stores={stores} onClose={closeDialog} onSold={finish} onGone={itemGone} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('confirm.deleteTitle')}
          message={t('confirm.deleteMessage', { name: dialog.item.name })}
          confirmLabel={t('confirm.confirmDelete')}
          danger
          busy={confirmBusy}
          error={confirmError}
          onCancel={closeDialog}
          onConfirm={() => runConfirm(deleteItem(dialog.item.id), t('confirm.deleted'))}
        />
      )}
      {dialog?.kind === 'unsell' && (
        <ConfirmDialog
          title={t('confirm.unsellTitle')}
          message={t('confirm.unsellMessage')}
          confirmLabel={t('confirm.confirmUnsell')}
          busy={confirmBusy}
          error={confirmError}
          onCancel={closeDialog}
          onConfirm={() => runConfirm(unsellItem(dialog.item.id), t('confirm.unsold'))}
        />
      )}
    </>
  );
}

export default function InventoryPage() {
  const t = useT();
  return (
    <Suspense fallback={<p>{t('common.loading')}</p>}>
      <InventoryView />
    </Suspense>
  );
}
