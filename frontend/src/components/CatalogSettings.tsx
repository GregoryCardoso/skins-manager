'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDateTime, formatInteger } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { getCatalogStatus, refreshCatalog } from '@/services/api';
import type { CatalogSource, CatalogStatus } from '@/types/api';
import styles from './settings.module.css';

const SOURCES: CatalogSource[] = ['SKINS', 'STICKERS', 'CRATES', 'KEYCHAINS', 'AGENTS', 'PATCHES'];

// Total do catálogo, contagens por fonte e data da última atualização.
export function CatalogSummary({ status }: { status: CatalogStatus }) {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      <p className={styles.catalogTotal}>{t('catalog.total', { total: formatInteger(status.total, locale) })}</p>
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
  const locale = useLocale();
  const invalidate = useInvalidate();
  const statusQuery = useQuery({ queryKey: queryKeys.catalog.status, queryFn: ({ signal }) => getCatalogStatus(signal) });
  const status = statusQuery.data ?? null;
  const loadError = statusQuery.error ?? null;
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [info, setInfo] = useState<{ total: number; skipped: number; linked: number; skippedLanguages: string[] } | null>(null);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshError(null);
    setInfo(null);
    refreshCatalog()
      .then((result) => {
        // Atualizar o catálogo muda o status, os itens e as vendas (imagens e vínculos, D259).
        invalidate('catalog.refresh');
        setInfo({ total: result.total, skipped: result.skipped, linked: result.linkedLegacyItems, skippedLanguages: (result.skippedLanguages ?? []).map((s) => s.language) });
      })
      .catch((err: unknown) => setRefreshError(err))
      .finally(() => setRefreshing(false));
  }, [invalidate]);

  return (
    <section className={styles.card} aria-labelledby="settings-catalog-title">
      <h2 id="settings-catalog-title" className={styles.cardTitle}>{t('settings.catalog.title')}</h2>
      {status ? (
        <CatalogSummary status={status} />
      ) : loadError ? (
        <p className={styles.error} role="alert">{errorMessageFor(loadError, tLoose, locale)}</p>
      ) : (
        <p className={styles.muted}>{t('common.loading')}</p>
      )}
      <div className={styles.row}>
        <button type="button" className={styles.button} onClick={onRefresh} disabled={refreshing}>
          {refreshing ? t('catalog.refreshing') : t('catalog.refresh')}
        </button>
      </div>
      {info && (
        <p className={styles.ok} role="status">
          {t('catalog.refreshDone', {
            total: formatInteger(info.total, locale),
            skipped: formatInteger(info.skipped, locale),
            linked: formatInteger(info.linked, locale),
          })}
        </p>
      )}
      {info && info.skippedLanguages.length > 0 && (
        <p className={styles.muted} role="status">
          {t('catalog.refreshSkippedLanguages', { languages: info.skippedLanguages.join(', ') })}
        </p>
      )}
      {refreshError !== null && <p className={styles.error} role="alert">{errorMessageFor(refreshError, tLoose, locale)}</p>}
    </section>
  );
}
