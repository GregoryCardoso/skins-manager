'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ImportButton from '@/components/ImportButton';
import InventoryGroupTable from '@/components/InventoryGroupTable';
import InventoryTable from '@/components/InventoryTable';
import BulkSaleStateDialog from '@/components/BulkSaleStateDialog';
import InventoryPosition from '@/components/inventory/InventoryPosition';
import InventoryToolbar from '@/components/inventory/InventoryToolbar';
import SelectionBar, { SelectionHint } from '@/components/inventory/SelectionBar';
import { MarketTabSummary } from '@/components/MarketValueCell';
import PriceStatusIndicator from '@/components/PriceStatusIndicator';
import { useMarketSummary } from '@/components/useMarketSummary';
import { usePreferences } from '@/components/PreferencesProvider';
import { useItemDialogs } from '@/components/ItemDialogs';
import PageSkeleton from '@/components/layout/PageSkeleton';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import PageHeader from '@/components/ui/PageHeader';
import Tabs from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import {
  clearedFilters, hasActiveFilters, isGroupedAvailable, parseFilters, toApiQuery, toGroupQuery, toSearchString, type InventoryFilters as Filters,
} from '@/lib/inventoryQuery';
import { inventoryCountText } from '@/lib/inventoryCount';
import { itemIdsOf, pruneSelection, selectionDirection, unitIdsOf, type InventorySelection } from '@/lib/inventorySelection';
import { parseItemParam } from '@/lib/importSummary';
import { queryKeys } from '@/lib/queryKeys';
import { listItemGroups, listItems, listStores } from '@/services/api';
import styles from './page.module.css';

function InventoryPageContent() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();
  const { inventoryView, setInventoryView, inventoryDensity, setInventoryDensity } = usePreferences();
  const toast = useToast();

  const { summary: marketSummary } = useMarketSummary();
  const searchKey = searchParams.toString();
  const filters = useMemo(() => parseFilters(new URLSearchParams(searchKey)), [searchKey]);
  const apiQuery = useMemo(() => toApiQuery(filters), [filters]);
  const groupQuery = useMemo(() => toGroupQuery(filters), [filters]);
  // Visão agrupada (D277): só com o status "Em estoque"; com "Vendido"/"Todos" a tabela é individual e a preferência não muda.
  const groupedAvailable = isGroupedAvailable(filters);
  const grouped = inventoryView === 'GROUPED' && groupedAvailable;
  // Grupos expandidos: só na página, sobrevivem às recargas (as chaves são estáveis) e não são salvos.
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = useCallback((key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Seleção única de unidades (12.5b), nas duas visões; só com o status "Em estoque" (com Vendido/Todos não há seleção).
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const selectionEnabled = filters.status === 'EM_ESTOQUE';
  // Trocar aba, filtro, busca ou visão limpa a seleção (a ordem não).
  const selectionScope = `${filters.status}|${filters.category}|${filters.stagnant}|${filters.saleState}|${filters.search}|${grouped}`;
  useEffect(() => {
    setSelected(new Set());
    setBulkOpen(false);
  }, [selectionScope]);

  // Itens e lojas vêm do cache compartilhado (D259): qualquer ação que mude o dinheiro os invalida.
  // Trocar o filtro mantém a lista anterior na tela (esmaecida) até a nova chegar; o foco da janela recarrega (D258).
  const itemsQuery = useQuery({
    queryKey: queryKeys.items.list(apiQuery),
    queryFn: ({ signal }) => listItems(apiQuery, signal),
    placeholderData: keepPreviousData,
    enabled: !grouped,
  });
  const groupsQuery = useQuery({
    queryKey: queryKeys.items.groups(groupQuery),
    queryFn: ({ signal }) => listItemGroups(groupQuery, signal),
    placeholderData: keepPreviousData,
    enabled: grouped,
  });
  const storesQuery = useQuery({ queryKey: queryKeys.stores.all, queryFn: ({ signal }) => listStores(signal) });
  const activeQuery = grouped ? groupsQuery : itemsQuery;
  const itemsData = itemsQuery.data ?? null;
  const groupsData = groupsQuery.data ?? null;
  // `meta` tem o mesmo formato nas duas visões (contagens das abas, limites e cotação).
  const data = grouped ? groupsData : itemsData;
  const stores = storesQuery.data ?? [];
  const error = activeQuery.error ?? storesQuery.error;
  const loading = activeQuery.isFetching || storesQuery.isFetching;
  const reload = useCallback(() => {
    activeQuery.refetch();
    storesQuery.refetch();
  }, [activeQuery, storesQuery]);

  // Depois de uma recarga, só ficam marcadas as unidades que ainda estão na tela.
  useEffect(() => {
    const visible = grouped ? (groupsData ? unitIdsOf(groupsData.groups) : null) : itemsData ? itemIdsOf(itemsData.items) : null;
    if (visible) setSelected((current) => pruneSelection(current, visible));
  }, [grouped, groupsData, itemsData]);

  // `?item=<id>` (link do resumo da importação): não é filtro. Expande o grupo do item (visão agrupada), rola até a linha uma vez
  // e a destaca.
  const focusItemId = parseItemParam(searchParams.get('item'));
  const scrolledFor = useRef<number | null>(null);
  useEffect(() => {
    if (focusItemId === null || !grouped || !groupsData) return;
    const group = groupsData.groups.find((g) => g.units.some((u) => u.id === focusItemId));
    if (group) setExpandedKeys((current) => (current.has(group.key) ? current : new Set(current).add(group.key)));
  }, [focusItemId, grouped, groupsData]);
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
  }, [focusItemId, itemsData, groupsData, expandedKeys]);

  // Mensagens de sucesso e de erro das ações viram avisos rápidos (o de erro fica até ser dispensado).
  const notify = useCallback((message: string, tone: 'success' | 'danger') => toast.show({ tone, message }), [toast]);
  const {
    openCreate, openEdit, openSell, openUnsell, openDelete, openHistory, openOffSale, openApply, openOpen, openDetach, openRegisterKey, putForSale, forSalePendingId, dialogs,
  } = useItemDialogs(stores, { notify });
  const handlers = {
    onEdit: openEdit,
    onSell: openSell,
    onUnsell: openUnsell,
    onDelete: openDelete,
    onHistory: openHistory,
    onOffSale: openOffSale,
    onForSale: putForSale,
    onApply: openApply,
    onOpen: openOpen,
    onDetach: openDetach,
    onRegisterKey: openRegisterKey,
  };

  const setFilters = useCallback(
    (next: Filters) => {
      const qs = toSearchString(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const slowItemDays = data?.meta.slowItemDays ?? 21;
  const limits = { fastTurnoverDays: data?.meta.fastTurnoverDays ?? 7, slowItemDays };
  const filtered = hasActiveFilters(filters);
  const density = inventoryDensity === 'COMFORTABLE' ? 'comfortable' : 'compact';
  const firstLoad = data === null && error === null;
  const selection: InventorySelection | undefined = selectionEnabled ? { selected, onChange: setSelected } : undefined;
  const direction = selectionDirection(filters.saleState);
  const inHolding = filters.status === 'EM_ESTOQUE' && filters.saleState === 'OFF_SALE';
  const showMarket = filters.status !== 'VENDIDO';
  const empty = filtered ? (
    <EmptyState
      icon="search"
      title={t('inventory.emptyFilteredTitle')}
      description={t('inventory.emptyFiltered')}
      action={<Button onClick={() => setFilters(clearedFilters(filters))}>{t('inventory.clearFilters')}</Button>}
    />
  ) : (
    <EmptyState icon="inventory" title={t('inventory.emptyTitle')} description={inHolding ? t('inventory.offSaleEmpty') : t('inventory.empty')} />
  );

  return (
    <>
      <PageHeader
        title={t('inventory.title')}
        subtitle={
          data
            ? grouped && groupsData
              ? inventoryCountText(groupsData.meta.count, groupsData.meta.groupCount, tLoose, tPlural)
              : inventoryCountText(data.meta.count, null, tLoose, tPlural)
            : undefined
        }
        liveSubtitle
        actions={
          <>
            <PriceStatusIndicator />
            <ImportButton />
            <Button variant="primary" icon="plus" onClick={openCreate}>
              {t('inventory.actions.newItem')}
            </Button>
          </>
        }
      />

      <InventoryToolbar
        filters={filters}
        slowItemDays={slowItemDays}
        loading={loading}
        view={inventoryView}
        groupedAvailable={groupedAvailable}
        onViewChange={setInventoryView}
        density={inventoryDensity}
        onDensityChange={(next) => {
          void setInventoryDensity(next);
        }}
        onChange={setFilters}
        onClear={() => setFilters(clearedFilters(filters))}
        onRefresh={reload}
      />

      {data?.meta.position && <InventoryPosition position={data.meta.position} />}

      {filters.status === 'EM_ESTOQUE' && (
        <Tabs
          label={t('inventory.title')}
          value={filters.saleState}
          onChange={(value) => {
            const state = value === 'OFF_SALE' ? 'OFF_SALE' : 'FOR_SALE';
            setFilters({ ...filters, saleState: state, stagnant: state === 'OFF_SALE' ? false : filters.stagnant });
          }}
          items={[
            { value: 'FOR_SALE', label: t('inventory.tabs.forSale', { count: data?.meta.saleStateCounts.forSale ?? 0 }) },
            { value: 'OFF_SALE', label: t('inventory.tabs.offSale', { count: data?.meta.saleStateCounts.offSale ?? 0 }) },
          ]}
        />
      )}

      {filters.status === 'EM_ESTOQUE' && marketSummary && (
        <MarketTabSummary
          totals={filters.saleState === 'OFF_SALE' ? marketSummary.byState.holding : marketSummary.byState.forSale}
          holding={filters.saleState === 'OFF_SALE'}
        />
      )}

      {inHolding && <p className={styles.muted}>{t('inventory.tabs.offSaleHint')}</p>}

      {selectionEnabled && error === null && <SelectionHint />}

      {error !== null && <ErrorState message={t('inventory.loadError', { reason: errorMessageFor(error, tLoose, locale) })} onRetry={reload} retrying={loading} />}

      {error === null && (
        <div className={loading && !firstLoad ? styles.dim : undefined} aria-busy={loading}>
          {grouped ? (
            <InventoryGroupTable
              groups={groupsData?.groups ?? []}
              stores={stores}
              handlers={handlers}
              limits={limits}
              expandedKeys={expandedKeys}
              onToggle={toggleGroup}
              forSalePendingId={forSalePendingId}
              highlightedItemId={focusItemId}
              saleState={filters.saleState}
              showMarket={showMarket}
              density={density}
              order={filters.order}
              onOrderChange={(order) => setFilters({ ...filters, order })}
              loading={firstLoad}
              empty={empty}
              selection={selection}
            />
          ) : (
            <InventoryTable
              items={itemsData?.items ?? []}
              stores={stores}
              handlers={handlers}
              limits={limits}
              forSalePendingId={forSalePendingId}
              highlightedItemId={focusItemId}
              showMarket={showMarket}
              density={density}
              order={filters.order}
              onOrderChange={(order) => setFilters({ ...filters, order })}
              loading={firstLoad}
              empty={empty}
              selection={selection}
            />
          )}
        </div>
      )}

      {selectionEnabled && <SelectionBar count={selected.size} direction={direction} onMove={() => setBulkOpen(true)} onClear={() => setSelected(new Set())} />}
      {bulkOpen && (
        <BulkSaleStateDialog
          direction={direction}
          target={{ itemIds: [...selected] }}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false);
            setSelected(new Set());
          }}
        />
      )}

      {dialogs}
    </>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InventoryPageContent />
    </Suspense>
  );
}
