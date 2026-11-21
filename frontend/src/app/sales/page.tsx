'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
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
import { ApiRequestError, listSales, listStores } from '@/services/api';
import type { SalesList, Store } from '@/types/api';
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
  const { usdBrlRate, reloadFxRate } = usePreferences();

  const searchKey = searchParams.toString();
  const filters = useMemo(() => parseSalesFilters(new URLSearchParams(searchKey)), [searchKey]);

  const [data, setData] = useState<SalesList | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  const { openEdit, openUnsell, openDelete, openHistory, notice, dismissNotice, dialogs } = useItemDialogs(stores, reload);

  // Carrega vendas e lojas; trocar filtro, cotação ou recarregar cancela a requisição anterior.
  // O "hoje" dos períodos é calculado a cada carga (a página pode ficar aberta por dias).
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([listSales(toSalesApiQuery(filters, new Date()), controller.signal), listStores(controller.signal)])
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
  }, [filters, usdBrlRate, reloadToken]);

  // Ao voltar o foco da janela, relê a lista.
  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

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
