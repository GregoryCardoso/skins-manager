'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import ImportButton from '@/components/ImportButton';
import { useItemDialogs } from '@/components/ItemDialogs';
import SalesFilters from '@/components/SalesFilters';
import SalesSummary from '@/components/SalesSummary';
import SalesTable from '@/components/SalesTable';
import PageSkeleton from '@/components/layout/PageSkeleton';
import PageHeader from '@/components/ui/PageHeader';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import {
  DEFAULT_SALES_FILTERS, hasActiveSalesFilters, parseSalesFilters, toSalesApiQuery, toSalesSearchString,
  type SalesFilters as Filters,
} from '@/lib/salesQuery';
import { parseItemParam } from '@/lib/importSummary';
import { queryKeys } from '@/lib/queryKeys';
import { listSales, listStores } from '@/services/api';
import styles from './page.module.css';

function SalesView() {
  const t = useT();
  const tPlural = useTPlural();
  const tLoose = useTLoose();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname() ?? '/sales';
  const searchParams = useSearchParams();
  
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

  // `?item=<id>` (link "Ver nas vendas" do resumo da importação): não é filtro. Rola até a linha uma vez e a destaca.
  const focusItemId = parseItemParam(searchParams.get('item'));
  const scrolledFor = useRef<number | null>(null);
  useEffect(() => {
    if (focusItemId === null) {
      scrolledFor.current = null;
      return;
    }
    if (scrolledFor.current === focusItemId) return;
    const row = document.getElementById(`item-row-${focusItemId}`);
    if (row) {
      scrolledFor.current = focusItemId;
      row.scrollIntoView({ block: 'center' });
    }
  }, [focusItemId, data]);

  const setFilters = useCallback(
    (next: Filters) => {
      const qs = toSalesSearchString(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const filtered = hasActiveSalesFilters(filters);

  return (
    <>
      <PageHeader
        title={t('sales.title')}
        subtitle={data ? tPlural('sales.count', data.meta.count) : undefined}
        liveSubtitle
        actions={<ImportButton />}
      />

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
          <p>{t('sales.loadError', { reason: errorMessageFor(error, tLoose, locale) })}</p>
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
              highlightedItemId={focusItemId}
            />
          )}
        </div>
      )}

      {dialogs}
    </>
  );
}

export default function SalesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SalesView />
    </Suspense>
  );
}
