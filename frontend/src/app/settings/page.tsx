'use client';

import { useEffect, useState } from 'react';
import AgingSettings from '@/components/AgingSettings';
import CatalogSettings from '@/components/CatalogSettings';
import FxRateSettings from '@/components/FxRateSettings';
import PreferencesSettings from '@/components/PreferencesSettings';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { ApiRequestError, getSettings } from '@/services/api';
import type { Settings } from '@/types/api';
import styles from './page.module.css';

export default function SettingsPage() {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getSettings(controller.signal)
      .then((data) => {
        setSettings(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof ApiRequestError && err.code === 'ABORTED')) return;
        setError(err);
      });
    return () => controller.abort();
  }, [reloadToken]);

  return (
    <>
      <h1>{t('settings.title')}</h1>

      {error !== null && (
        <div className={styles.error} role="alert">
          <p>{t('settings.loadError', { reason: errorMessageFor(error, tLoose, language) })}</p>
          <button type="button" className={styles.retry} onClick={() => setReloadToken((n) => n + 1)}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {settings === null && error === null && <p className={styles.muted}>{t('common.loading')}</p>}

      <FxRateSettings />
      <PreferencesSettings />
      {settings && <AgingSettings settings={settings} onSaved={setSettings} />}
      <CatalogSettings />
    </>
  );
}
