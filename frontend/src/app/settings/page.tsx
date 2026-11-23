'use client';

import { useQuery } from '@tanstack/react-query';
import AboutSettings from '@/components/AboutSettings';
import AgingSettings from '@/components/AgingSettings';
import BackupSettings from '@/components/BackupSettings';
import CatalogSettings from '@/components/CatalogSettings';
import FxRateSettings from '@/components/FxRateSettings';
import IntegrationsSettings from '@/components/IntegrationsSettings';
import PreferencesSettings from '@/components/PreferencesSettings';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { queryKeys } from '@/lib/queryKeys';
import { getSettings } from '@/services/api';
import styles from './page.module.css';

export default function SettingsPage() {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const query = useQuery({ queryKey: queryKeys.settings.all, queryFn: ({ signal }) => getSettings(signal) });
  const settings = query.data ?? null;
  const error = query.error ?? null;

  return (
    <>
      <h1>{t('settings.title')}</h1>

      {error !== null && (
        <div className={styles.error} role="alert">
          <p>{t('settings.loadError', { reason: errorMessageFor(error, tLoose, language) })}</p>
          <button type="button" className={styles.retry} onClick={() => {
              query.refetch();
            }}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {settings === null && error === null && <p className={styles.muted}>{t('common.loading')}</p>}

      <FxRateSettings />
      <PreferencesSettings />
      {settings && <AgingSettings settings={settings} />}
      <CatalogSettings />
      <IntegrationsSettings />
      <BackupSettings />
      <AboutSettings />
    </>
  );
}
