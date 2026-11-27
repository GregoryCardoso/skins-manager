'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocale, useT } from '@/i18n/I18nProvider';
import { formatDateTime } from '@/lib/format';
import { getDesktopBridge, type DesktopAppInfo, type UpdateCheckResult } from '@/lib/desktop';
import { queryKeys } from '@/lib/queryKeys';
import { getHealth } from '@/services/api';
import styles from './settings.module.css';

// Card "Sobre" (D181): versão do app e atualização. A verificação só existe no desktop (instalador/portátil).
export default function AboutSettings() {
  const t = useT();
  const locale = useLocale();
  const healthQuery = useQuery({ queryKey: queryKeys.health.all, queryFn: ({ signal }) => getHealth(signal) });
  const version = healthQuery.data?.version ?? null;
  const [info, setInfo] = useState<DesktopAppInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (bridge) bridge.getAppInfo().then(setInfo).catch(() => setInfo(null));
  }, []);

  const mode = info?.mode ?? null;
  const canCheck = mode === 'installer' || mode === 'portable';

  const onCheck = () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setChecking(true);
    setFailed(false);
    setResult(null);
    bridge
      .checkForUpdates()
      .then(setResult)
      .catch(() => setFailed(true))
      .finally(() => setChecking(false));
  };

  let statusText: string | null = null;
  if (result) {
    const v = result.latestVersion ?? '';
    if (result.status === 'up-to-date') statusText = t('settings.about.upToDate');
    else if (result.status === 'available') {
      statusText = t(result.mode === 'portable' ? 'settings.about.availablePortable' : 'settings.about.available', {
        version: v,
      });
    } else if (result.status === 'downloading') {
      statusText = t('settings.about.downloading', { percent: result.percent ?? 0 });
    } else if (result.status === 'ready') statusText = t('settings.about.ready', { version: v });
    else if (result.status === 'busy') statusText = t('settings.about.busy');
    else if (result.status === 'disabled') statusText = t('settings.about.disabled');
    else statusText = t('settings.about.error');
  }

  return (
    <section className={styles.card} aria-labelledby="settings-about-title">
      <h2 id="settings-about-title" className={styles.cardTitle}>{t('settings.about.title')}</h2>
      <p>
        {version ? t('settings.about.version', { version }) : t('settings.about.versionUnknown')}
        {mode === 'installer' && ` · ${t('settings.about.modeInstaller')}`}
        {mode === 'portable' && ` · ${t('settings.about.modePortable')}`}
      </p>

      <p data-testid="about-connection">
        {t('status.server')}:{' '}
        {healthQuery.data
          ? `${t('status.online')} · ${t('status.lastResponse', { time: formatDateTime(healthQuery.data.timestamp, locale) })}`
          : healthQuery.isError
            ? t('status.offline')
            : t('common.loading')}
      </p>
      <div className={styles.row}>
        <button type="button" className={styles.button} onClick={() => void healthQuery.refetch()} disabled={healthQuery.isFetching}>
          {healthQuery.isFetching ? t('status.checking') : t('status.recheck')}
        </button>
      </div>

      {canCheck ? (
        <>
          <div className={styles.row}>
            <button type="button" className={styles.button} onClick={onCheck} disabled={checking}>
              {checking ? t('settings.about.checking') : t('settings.about.check')}
            </button>
          </div>
          {statusText !== null && (
            <p className={result?.status === 'error' ? styles.error : styles.ok} role="status">{statusText}</p>
          )}
          {failed && <p className={styles.error} role="alert">{t('settings.about.error')}</p>}
          <p className={styles.muted}>
            {t(mode === 'portable' ? 'settings.about.notePortable' : 'settings.about.noteInstaller')}
          </p>
        </>
      ) : (
        <p className={styles.muted}>{t(mode === 'dev' ? 'settings.about.disabled' : 'settings.about.manualUpdate')}</p>
      )}
    </section>
  );
}
