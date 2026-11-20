'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage, useT } from '@/i18n/I18nProvider';
import { formatDateTime, formatInteger } from '@/lib/format';
import { getCatalogStatus, getHealth } from '@/services/api';
import type { CatalogStatus } from '@/types/api';
import { usePreferences } from './PreferencesProvider';
import styles from './SystemStatusIndicator.module.css';
import SystemStatus from './SystemStatus';

type State = 'checking' | 'online' | 'offline';

// Indicador compacto no cabeçalho (D103): ponto + texto; o clique abre o painel completo.
export default function SystemStatusIndicator() {
  const t = useT();
  const locale = useLanguage();
  const { reloadFxRate } = usePreferences();
  const [state, setState] = useState<State>('checking');
  const [catalog, setCatalog] = useState<CatalogStatus | null>(null);
  const [open, setOpen] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const wasOnline = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const check = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((prev) => (prev === 'online' ? prev : 'checking'));
    getHealth(controller.signal)
      .then(() => {
        setState('online');
        if (!wasOnline.current) reloadFxRate();
        wasOnline.current = true;
        return getCatalogStatus(controller.signal).then(setCatalog);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        wasOnline.current = false;
        setState('offline');
      });
  }, [reloadFxRate]);

  useEffect(() => {
    check();
    window.addEventListener('focus', check);
    return () => {
      window.removeEventListener('focus', check);
      controllerRef.current?.abort();
    };
  }, [check]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const label = t(state === 'online' ? 'statusIndicator.online' : state === 'offline' ? 'statusIndicator.offline' : 'statusIndicator.checking');
  const catalogText =
    state === 'online' && catalog ? t('statusIndicator.catalog', { total: formatInteger(catalog.total, locale) }) : null;
  const catalogTitle =
    catalog?.catalogUpdatedAt ? t('catalog.updatedAt', { date: formatDateTime(catalog.catalogUpdatedAt, locale) }) : undefined;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.button}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={catalogTitle ?? t('statusIndicator.details')}
      >
        <span className={`${styles.dot} ${styles[state]}`} aria-hidden="true" />
        <span>{label}</span>
        {catalogText && <span className={styles.catalog}>· {catalogText}</span>}
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label={t('status.title')}>
          <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label={t('statusIndicator.close')}>×</button>
          <SystemStatus />
        </div>
      )}
    </div>
  );
}
