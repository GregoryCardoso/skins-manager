'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useMemo } from 'react';
import { useItemDialogs } from '@/components/ItemDialogs';
import { usePreferences } from '@/components/PreferencesProvider';
import SalesFilters from '@/components/SalesFilters';
import SalesSummary from '@/components/SalesSummary';
import SalesTable from '@/components/SalesTable';
import SystemStatus from '@/components/SystemStatus';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import {
  DEFAULT_SALES_FILTERS, hasActiveSalesFilters, parseSalesFilters, toSalesApiQuery, toSalesSearchString,
  type SalesFilters as Filters,
} from '@/lib/salesQuery';
import { queryKeys } from '@/lib/queryKeys';
import { ApiRequestError, listSales, listStores } from '@/services/api';
import styles from './page.module.css';

const CONNECTION_ERRORS = ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'];

function SalesView() {
  const t = useT();
  const tPlural = useTPlural();
  const tLoose = useTLoose();
  const language = useLanguage();
  const router = useRouter();
  const pathname = usePathname() ?? '/sales';
  const searchParams = useSearchParams();
  const { reloadFxRate } = usePreferences();

  const searchKey = searchParams.toString();
  const filters = useMemo(() => parseSalesFilters(new URLSearchParams(searchKey)), [searchKey]);

  // Vendas e lojas vêm do cache compartilhado (D259). A chave leva os filtros; o "hoje" dos períodos é calculado a cada
  // busca (a página pode ficar aberta por dias).
  const salesQuery = useQuery({
    queryKey: queryKeys.sales.list(filters),
    queryFn: ({ signal }) => listSales(toSalesApiQuery(filters, new Date()), signal),
    placeholderData: keepPreviousData,
  });
  const storesQuery = useQuery({ queryKey: queryKeys.stores.all, queryFn: ({ signal }) => listStores(signal) });
  const data = salesQuery.data ?? null;
  const stores = storesQuery.data ?? [];
  const error = salesQuery.error ?? storesQuery.error;
  const loading = salesQuery.isFetching || storesQuery.isFetching;
  const reload = useCallback(() => {
    salesQuery.refetch();
    storesQuery.refetch();
  }, [salesQuery, storesQuery]);
  const { openEdit, openUnsell, openDelete, openHistory, notice, dismissNotice, dialogs } = useItemDialogs(stores);

  const setFilters = useCallback(
    (next: Filters) => {
      const qs = toSalesSearchString(next);
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
        <h1>{t('sales.title')}</h1>
        <SystemStatus />
        <button type="button" className={styles.retry} onClick={retryAfterOutage}>{t('common.retry')}</button>
      </>
    );
  }

  const filtered = hasActiveSalesFilters(filters);

  return (
    <>
      <div className={styles.titleRow}>
        <h1>{t('sales.title')}</h1>
        {data && <span className={styles.count} aria-live="polite">{tPlural('sales.count', data.meta.count)}</span>}
      </div>

      {notice && (
        <div className={styles.notice} role="status">
          <span>{notice}</span>
          <button type="button" className={styles.retry} onClick={dismissNotice}>{t('common.close')}</button>
        </div>
      )}

      <SalesFilters
        filters={filters}
        stores={stores}
        loading={loading}
        onChange={setFilters}
        onClear={() => setFilters(DEFAULT_SALES_FILTERS)}
        onRefresh={reload}
      />

      {error !== null && (
        <div className={styles.error} role="alert">
          <p>{t('sales.loadError', { reason: errorMessageFor(error, tLoose, language) })}</p>
          <button type="button" className={styles.retry} onClick={reload}>{t('common.retry')}</button>
        </div>
      )}

      {data === null && error === null && <p className={styles.muted}>{t('common.loading')}</p>}

      {data !== null && error === null && (
        <div className={loading ? styles.dim : undefined} aria-busy={loading}>
          <SalesSummary summary={data.summary} />
          {data.items.length === 0 ? (
            <div className={styles.empty}>
              <p>{filtered ? t('sales.emptyFiltered') : t('sales.empty')}</p>
              {filtered && (
                <button type="button" className={styles.retry} onClick={() => setFilters(DEFAULT_SALES_FILTERS)}>
                  {t('sales.clearFilters')}
                </button>
              )}
            </div>
          ) : (
            <SalesTable
              items={data.items}
              stores={stores}
              onEdit={openEdit}
              onUnsell={openUnsell}
              onDelete={openDelete}
              onHistory={openHistory}
            />
          )}
        </div>
      )}

      {dialogs}
    </>
  );
}

export default function SalesPage() {
  const t = useT();
  return (
    <Suspense fallback={<p>{t('common.loading')}</p>}>
      <SalesView />
    </Suspense>
  );
}
