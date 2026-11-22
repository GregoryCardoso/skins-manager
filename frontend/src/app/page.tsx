'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useMemo } from 'react';
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
import { queryKeys } from '@/lib/queryKeys';
import { ApiRequestError, listItems, listStores } from '@/services/api';
import styles from './page.module.css';

const CONNECTION_ERRORS = ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'];

function InventoryView() {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();
  const { reloadFxRate } = usePreferences();

  const searchKey = searchParams.toString();
  const filters = useMemo(() => parseFilters(new URLSearchParams(searchKey)), [searchKey]);
  const apiQuery = useMemo(() => toApiQuery(filters), [filters]);

  // Itens e lojas vêm do cache compartilhado (D259): qualquer ação que mude o dinheiro os invalida.
  // Trocar o filtro mantém a lista anterior na tela (esmaecida) até a nova chegar; o foco da janela recarrega (D258).
  const itemsQuery = useQuery({
    queryKey: queryKeys.items.list(apiQuery),
    queryFn: ({ signal }) => listItems(apiQuery, signal),
    placeholderData: keepPreviousData,
  });
  const storesQuery = useQuery({ queryKey: queryKeys.stores.all, queryFn: ({ signal }) => listStores(signal) });
  const data = itemsQuery.data ?? null;
  const stores = storesQuery.data ?? [];
  const error = itemsQuery.error ?? storesQuery.error;
  const loading = itemsQuery.isFetching || storesQuery.isFetching;
  const reload = useCallback(() => {
    itemsQuery.refetch();
    storesQuery.refetch();
  }, [itemsQuery, storesQuery]);

  const { openCreate, openEdit, openSell, openUnsell, openDelete, openHistory, notice, dismissNotice, dialogs } =
    useItemDialogs(stores);

  const setFilters = useCallback(
    (next: Filters) => {
      const qs = toSearchString(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  // Ao tentar de novo, relê também a cotação (que pode não ter carregado com o backend fora do ar).
  const retryAfterOutage = () => {
    reloadFxRate();
    reload();
  };

  const connectionProblem = error instanceof ApiRequestError && CONNECTION_ERRORS.includes(error.code);
  if (connectionProblem) {
    return (
      <>
        <h1>{t('inventory.title')}</h1>
        <SystemStatus />
        <button type="button" className={styles.retry} onClick={retryAfterOutage}>{t('common.retry')}</button>
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
