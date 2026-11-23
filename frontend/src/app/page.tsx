'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ImportButton from '@/components/ImportButton';
import InventoryFilters from '@/components/InventoryFilters';
import InventoryGroupTable from '@/components/InventoryGroupTable';
import InventoryTable from '@/components/InventoryTable';
import InventoryViewToggle from '@/components/InventoryViewToggle';
import { usePreferences } from '@/components/PreferencesProvider';
import { useItemDialogs } from '@/components/ItemDialogs';
import SystemStatus from '@/components/SystemStatus';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import {
  clearedFilters, hasActiveFilters, isGroupedAvailable, parseFilters, toApiQuery, toGroupQuery, toSearchString, type InventoryFilters as Filters,
} from '@/lib/inventoryQuery';
import { inventoryCountText } from '@/lib/inventoryCount';
import { parseItemParam } from '@/lib/importSummary';
import { queryKeys } from '@/lib/queryKeys';
import { ApiRequestError, listItemGroups, listItems, listStores } from '@/services/api';
import styles from './page.module.css';

const CONNECTION_ERRORS = ['NETWORK_ERROR', 'TIMEOUT', 'INVALID_RESPONSE'];

function InventoryPageContent() {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();
  const { reloadFxRate, inventoryView, setInventoryView } = usePreferences();

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
  const isEmpty = grouped ? groupsData?.groups.length === 0 : itemsData?.items.length === 0;
  const hasRows = grouped ? (groupsData?.groups.length ?? 0) > 0 : (itemsData?.items.length ?? 0) > 0;
  const reload = useCallback(() => {
    activeQuery.refetch();
    storesQuery.refetch();
  }, [activeQuery, storesQuery]);

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
    const row = document.getElementById(`item-row-${focusItemId}`);
    if (row) {
      scrolledFor.current = focusItemId;
      row.scrollIntoView({ block: 'center' });
    }
  }, [focusItemId, itemsData, groupsData, expandedKeys]);

  const {
    openCreate, openEdit, openSell, openUnsell, openDelete, openHistory, openOffSale, putForSale, forSalePendingId, notice, dismissNotice, dialogs,
  } = useItemDialogs(stores);

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
        {data && (
          <span className={styles.count} aria-live="polite">
            {grouped && groupsData
              ? inventoryCountText(groupsData.meta.count, groupsData.meta.groupCount, tLoose)
              : inventoryCountText(data.meta.count, null, tLoose)}
          </span>
        )}
        <div className={styles.titleActions}>
          <ImportButton />
          <button type="button" className={styles.newItem} onClick={openCreate}>
            {t('inventory.actions.newItem')}
          </button>
        </div>
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
        onClear={() => setFilters(clearedFilters(filters))}
        onRefresh={reload}
      />

      <InventoryViewToggle value={inventoryView} onChange={setInventoryView} disabled={!groupedAvailable} />

      {filters.status === 'EM_ESTOQUE' && (
        <div className={styles.tabs} role="tablist" aria-label={t('inventory.title')}>
          {(['FOR_SALE', 'OFF_SALE'] as const).map((state) => {
            const count = data ? (state === 'FOR_SALE' ? data.meta.saleStateCounts.forSale : data.meta.saleStateCounts.offSale) : 0;
            const selected = filters.saleState === state;
            return (
              <button
                key={state}
                type="button"
                role="tab"
                aria-selected={selected}
                title={state === 'OFF_SALE' ? t('inventory.tabs.offSaleHint') : undefined}
                className={selected ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => setFilters({ ...filters, saleState: state, stagnant: state === 'OFF_SALE' ? false : filters.stagnant })}
              >
                {t(state === 'FOR_SALE' ? 'inventory.tabs.forSale' : 'inventory.tabs.offSale', { count })}
              </button>
            );
          })}
        </div>
      )}

      {filters.status === 'EM_ESTOQUE' && filters.saleState === 'OFF_SALE' && (
        <p className={styles.muted}>{t('inventory.tabs.offSaleHint')}</p>
      )}

      {error !== null && (
        <div className={styles.error} role="alert">
          <p>{t('inventory.loadError', { reason: errorMessageFor(error, tLoose, language) })}</p>
          <button type="button" className={styles.retry} onClick={reload}>{t('common.retry')}</button>
        </div>
      )}

      {data === null && error === null && <p className={styles.muted}>{t('common.loading')}</p>}

      {data !== null && isEmpty && error === null && (
        <div className={styles.empty}>
          <p>
            {filtered
              ? t('inventory.emptyFiltered')
              : filters.status === 'EM_ESTOQUE' && filters.saleState === 'OFF_SALE' ? t('inventory.offSaleEmpty') : t('inventory.empty')}
          </p>
          {filtered && (
            <button type="button" className={styles.retry} onClick={() => setFilters(clearedFilters(filters))}>
              {t('inventory.clearFilters')}
            </button>
          )}
        </div>
      )}

      {data !== null && hasRows && (
        <div className={loading ? styles.dim : undefined} aria-busy={loading}>
          {grouped && groupsData ? (
            <InventoryGroupTable
              groups={groupsData.groups}
              stores={stores}
              expandedKeys={expandedKeys}
              onToggle={toggleGroup}
              onEdit={openEdit}
              onSell={openSell}
              onUnsell={openUnsell}
              onDelete={openDelete}
              onHistory={openHistory}
              onOffSale={openOffSale}
              onForSale={putForSale}
              forSalePendingId={forSalePendingId}
              highlightedItemId={focusItemId}
              saleState={filters.saleState}
            />
          ) : itemsData && (
            <InventoryTable
              items={itemsData.items}
              stores={stores}
              onEdit={openEdit}
              onSell={openSell}
              onUnsell={openUnsell}
              onDelete={openDelete}
              onHistory={openHistory}
              onOffSale={openOffSale}
              onForSale={putForSale}
              forSalePendingId={forSalePendingId}
              highlightedItemId={focusItemId}
            />
          )}
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
      <InventoryPageContent />
    </Suspense>
  );
}
