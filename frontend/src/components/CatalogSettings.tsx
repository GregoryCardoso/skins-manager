'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDateTime, formatInteger } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { getCatalogStatus, refreshCatalog } from '@/services/api';
import type { CatalogSource, CatalogStatus } from '@/types/api';
import styles from './CatalogSettings.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import ErrorState from './ui/ErrorState';
import Panel from './ui/Panel';
import Skeleton from './ui/Skeleton';
import { useToast } from './ui/Toast';

const SOURCES: CatalogSource[] = ['SKINS', 'STICKERS', 'CRATES', 'KEYCHAINS', 'AGENTS', 'PATCHES'];

// Total do catálogo, contagens por fonte e data da última atualização.
export function CatalogSummary({ status }: { status: CatalogStatus }) {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      <p className={styles.total}>{t('catalog.total', { total: formatInteger(status.total, locale) })}</p>
      <ul className={styles.counts}>
        {SOURCES.map((source) => (
          <li key={source}>
            {t(`catalog.source.${source}`)}: {formatInteger(status.countsBySource[source] ?? 0, locale)}
          </li>
        ))}
      </ul>
      <p className={styles.muted}>
        {status.catalogUpdatedAt
          ? t('catalog.updatedAt', { date: formatDateTime(status.catalogUpdatedAt, locale) })
          : t('catalog.neverUpdated')}
      </p>
    </>
  );
}

// Catálogo de itens (D152): status, contagens e o botão "atualizar catálogo" (movido do painel de status).
export default function CatalogSettings() {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const toast = useToast();
  const statusQuery = useQuery({ queryKey: queryKeys.catalog.status, queryFn: ({ signal }) => getCatalogStatus(signal) });
  const status = statusQuery.data ?? null;
  const loadError = statusQuery.error ?? null;
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [skippedLanguages, setSkippedLanguages] = useState<string[]>([]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshError(null);
    setSkippedLanguages([]);
    refreshCatalog()
      .then((result) => {
        // Atualizar o catálogo muda o status, os itens e as vendas (imagens e vínculos, D259).
        invalidate('catalog.refresh');
        setSkippedLanguages((result.skippedLanguages ?? []).map((s) => s.language));
        toast.show({
          tone: 'success',
          message: t('catalog.refreshDone', {
            total: tPlural('catalog.itemsCount', result.total, { count: formatInteger(result.total, locale) }),
            skipped: formatInteger(result.skipped, locale),
            linked: formatInteger(result.linkedLegacyItems, locale),
          }),
        });
      })
      .catch((err: unknown) => setRefreshError(err))
      .finally(() => setRefreshing(false));
  }, [invalidate, locale, t, tPlural, toast]);

  return (
    <Panel
      title={t('settings.catalog.title')}
      actions={<Button variant="primary" icon="refresh" loading={refreshing} onClick={onRefresh}>{refreshing ? t('catalog.refreshing') : t('catalog.refresh')}</Button>}
    >
      <div className={styles.stack}>
        {status ? (
          <CatalogSummary status={status} />
        ) : loadError ? (
          <ErrorState message={errorMessageFor(loadError, tLoose, locale)} onRetry={() => void statusQuery.refetch()} retrying={statusQuery.isFetching} />
        ) : (
          <Skeleton lines={3} />
        )}
        {skippedLanguages.length > 0 && (
          <Banner tone="info">{t('catalog.refreshSkippedLanguages', { languages: skippedLanguages.join(', ') })}</Banner>
        )}
        {refreshError !== null && <Banner tone="danger" onDismiss={() => setRefreshError(null)}>{errorMessageFor(refreshError, tLoose, locale)}</Banner>}
      </div>
    </Panel>
  );
}
