'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDateTime, formatInteger } from '@/lib/format';
import { getCatalogStatus, getHealth } from '@/services/api';
import type { CatalogSource, CatalogStatus, HealthStatus } from '@/types/api';
import styles from './SystemStatus.module.css';

const SOURCES: CatalogSource[] = ['SKINS', 'STICKERS', 'CRATES', 'KEYCHAINS', 'AGENTS'];

interface Loadable<T> {
  loading: boolean;
  data: T | null;
  error: unknown;
}

const initial = <T,>(): Loadable<T> => ({ loading: true, data: null, error: null });

export default function SystemStatus() {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLanguage();
  const [health, setHealth] = useState<Loadable<HealthStatus>>(initial);
  const [catalog, setCatalog] = useState<Loadable<CatalogStatus>>(initial);
  const controllerRef = useRef<AbortController | null>(null);

  const check = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setHealth((prev) => ({ ...prev, loading: true }));
    setCatalog((prev) => ({ ...prev, loading: true }));

    getHealth(controller.signal)
      .then((data) => setHealth({ loading: false, data, error: null }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setHealth({ loading: false, data: null, error });
      });
    getCatalogStatus(controller.signal)
      .then((data) => setCatalog({ loading: false, data, error: null }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setCatalog({ loading: false, data: null, error });
      });
  }, []);

  useEffect(() => {
    check();
    return () => controllerRef.current?.abort();
  }, [check]);

  const checking = health.loading || catalog.loading;

  return (
    <section className={styles.panel} aria-labelledby="status-title">
      <div className={styles.titleRow}>
        <h2 id="status-title" className={styles.title}>{t('status.title')}</h2>
        <button type="button" className={styles.button} onClick={check} disabled={checking}>
          {checking ? t('status.checking') : t('status.recheck')}
        </button>
      </div>

      <div className={styles.cards}>
        <article className={styles.card}>
          <h3 className={styles.cardTitle}>{t('status.server')}</h3>
          {health.data ? (
            <>
              <p className={styles.ok}>{t('status.online')}</p>
              <p className={styles.muted}>
                {t('status.lastResponse', { time: formatDateTime(health.data.timestamp, locale) })}
              </p>
            </>
          ) : health.error ? (
            <>
              <p className={styles.bad}>{t('status.offline')}</p>
              <p className={styles.error} role="alert">{errorMessageFor(health.error, tLoose)}</p>
            </>
          ) : (
            <p className={styles.muted}>{t('common.loading')}</p>
          )}
        </article>

        <article className={styles.card}>
          <h3 className={styles.cardTitle}>{t('catalog.title')}</h3>
          {catalog.data ? (
            <>
              <p>{t('catalog.total', { total: formatInteger(catalog.data.total, locale) })}</p>
              <ul className={styles.counts}>
                {SOURCES.map((source) => (
                  <li key={source}>
                    {t(`catalog.source.${source}`)}: {formatInteger(catalog.data?.countsBySource[source] ?? 0, locale)}
                  </li>
                ))}
              </ul>
              <p className={styles.muted}>
                {catalog.data.catalogUpdatedAt
                  ? t('catalog.updatedAt', { date: formatDateTime(catalog.data.catalogUpdatedAt, locale) })
                  : t('catalog.neverUpdated')}
              </p>
            </>
          ) : catalog.error ? (
            <p className={styles.error} role="alert">{errorMessageFor(catalog.error, tLoose)}</p>
          ) : (
            <p className={styles.muted}>{t('common.loading')}</p>
          )}

          <Link href="/settings/" className={styles.link}>{t('status.manageInSettings')}</Link>
        </article>
      </div>
    </section>
  );
}
