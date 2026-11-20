'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import InventoryFilters from '@/components/InventoryFilters';
import InventoryTable from '@/components/InventoryTable';
import { usePreferences } from '@/components/PreferencesProvider';
import { useItemDialogs } from '@/components/ItemDialogs';
import SystemStatus from '@/components/SystemStatus';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import {
  DEFAULT_FILTERS, hasActiveFilters, parseFilters, toApiQuery, toSearchString, type InventoryFilters as Filters,
} from '@/lib/inventoryQuery';
import { ApiRequestError, listItems, listStores } from '@/services/api';
import type { ItemList, Store } from '@/types/api';
import styles from './page.module.css';

const CONNECTION_ERRORS = ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'];

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

  const { openCreate, openEdit, openSell, openUnsell, openDelete, openHistory, notice, dismissNotice, dialogs } =
    useItemDialogs(stores, reload);

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
        <button type="button" className={styles.newItem} onClick={openCreate}>
          {t('inventory.actions.newItem')}
        </button>
      </div>

      {notice && (
        <div className={styles.notice} role="status">
          <span>{notice}</span>
          <button type="button" className={styles.retry} onClick={dismissNotice}>{t('common.close')}</button>
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
            onEdit={openEdit}
            onSell={openSell}
            onUnsell={openUnsell}
            onDelete={openDelete}
            onHistory={openHistory}
          />
        </div>
      )}

      {dialogs}
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
