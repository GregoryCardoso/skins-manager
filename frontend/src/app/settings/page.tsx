'use client';

import { useQuery } from '@tanstack/react-query';
import SettingsIndex from '@/components/settings/SettingsIndex';
import ErrorState from '@/components/ui/ErrorState';
import PageHeader from '@/components/ui/PageHeader';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { queryKeys } from '@/lib/queryKeys';
import { getSettings } from '@/services/api';
import styles from './page.module.css';

export default function SettingsPage() {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const query = useQuery({ queryKey: queryKeys.settings.all, queryFn: ({ signal }) => getSettings(signal) });
  const settings = query.data ?? null;
  const error = query.error ?? null;

  return (
    <>
      <PageHeader title={t('settings.title')} />

      <div className={styles.stack}>
        {error !== null && (
          <ErrorState
            message={t('settings.loadError', { reason: errorMessageFor(error, tLoose, locale) })}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        )}
        <SettingsIndex settings={settings} />
      </div>
    </>
  );
}
