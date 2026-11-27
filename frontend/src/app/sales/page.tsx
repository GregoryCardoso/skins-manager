'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import ImportButton from '@/components/ImportButton';
import { useItemDialogs } from '@/components/ItemDialogs';
import SalesFilters from '@/components/SalesFilters';
import SalesSummary from '@/components/SalesSummary';
import SalesTable from '@/components/SalesTable';
import { usePreferences } from '@/components/PreferencesProvider';
import PageSkeleton from '@/components/layout/PageSkeleton';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
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
  const toast = useToast();
  const { inventoryDensity } = usePreferences();
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
  // Sucesso e erro das ações viram avisos rápidos (o de erro fica até ser dispensado). O desfazer venda mostra o efeito no saldo (12.6b).
  const notify = useCallback((message: string, tone: 'success' | 'danger') => toast.show({ tone, message }), [toast]);
  const { openEdit, openComponents, openUnsell, openDelete, openHistory, dialogs } = useItemDialogs(stores, { notify });

  // `?item=<id>` (link "Ver nas vendas" do resumo da importação): não é filtro. Rola até a linha uma vez e a destaca.
  const focusItemId = parseItemParam(searchParams.get('item'));
  const scrolledFor = useRef<number | null>(null);
  useEffect(() => {
    if (focusItemId === null) {
      scrolledFor.current = null;
      return;
    }
    if (scrolledFor.current === focusItemId) return;
    const row = document.querySelector(`tr[data-row-id="${focusItemId}"]`);
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
  const limits = { fastTurnoverDays: data?.meta.fastTurnoverDays ?? 7, slowItemDays: data?.meta.slowItemDays ?? 21 };
  const firstLoad = data === null && error === null;
  const empty = filtered ? (
    <EmptyState
      icon="search"
      title={t('sales.emptyFilteredTitle')}
      description={t('sales.emptyFiltered')}
      action={<Button onClick={() => setFilters(DEFAULT_SALES_FILTERS)}>{t('sales.clearFilters')}</Button>}
    />
  ) : (
    <EmptyState icon="sales" title={t('sales.emptyTitle')} description={t('sales.empty')} />
  );

  return (
    <>
      <PageHeader
        title={t('sales.title')}
        subtitle={data ? tPlural('sales.count', data.meta.count) : undefined}
        liveSubtitle
        actions={<ImportButton />}
      />

      <SalesFilters
        filters={filters}
        stores={stores}
        loading={loading}
        onChange={setFilters}
        onClear={() => setFilters(DEFAULT_SALES_FILTERS)}
        onRefresh={reload}
      />

      {error !== null && <ErrorState message={t('sales.loadError', { reason: errorMessageFor(error, tLoose, locale) })} onRetry={reload} retrying={loading} />}

      {error === null && (
        <div className={loading && !firstLoad ? styles.dim : undefined} aria-busy={loading}>
          {data !== null && <SalesSummary summary={data.summary} />}
          <SalesTable
            items={data?.items ?? []}
            stores={stores}
            limits={limits}
            handlers={{ onEdit: openEdit, onComponents: openComponents, onUnsell: openUnsell, onDelete: openDelete, onHistory: openHistory }}
            sort={filters.sort}
            order={filters.order}
            onSortChange={(sort, order) => setFilters({ ...filters, sort, order })}
            highlightedItemId={focusItemId}
            density={inventoryDensity === 'COMFORTABLE' ? 'comfortable' : 'compact'}
            loading={firstLoad}
            empty={empty}
          />
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
