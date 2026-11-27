'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AboutSettings from '@/components/AboutSettings';
import AgingSettings from '@/components/AgingSettings';
import BackupSettings from '@/components/BackupSettings';
import CatalogSettings from '@/components/CatalogSettings';
import FxRateSettings from '@/components/FxRateSettings';
import IntegrationsSettings from '@/components/IntegrationsSettings';
import { usePreferences } from '@/components/PreferencesProvider';
import PreferencesSettings from '@/components/PreferencesSettings';
import Skeleton from '@/components/ui/Skeleton';
import Tabs, { TabPanel } from '@/components/ui/Tabs';
import { useBelow } from '@/components/ui/useMediaQuery';
import { useLocale, useT, useTPlural } from '@/i18n/I18nProvider';
import { queryKeys } from '@/lib/queryKeys';
import { SETTINGS_SECTIONS, sectionFromHash, settingsStatuses, type SettingsSectionId } from '@/lib/settingsStatus';
import { getBackupInfo, getCatalogStatus, getCsfloatIntegration, getHealth } from '@/services/api';
import type { Settings } from '@/types/api';
import styles from './SettingsIndex.module.css';

interface Props {
  settings: Settings | null;
}

const TITLE_KEY: Record<SettingsSectionId, string> = {
  preferences: 'settings.preferences.title',
  fx: 'settings.fx.title',
  aging: 'settings.aging.title',
  integrations: 'settings.integrations.title',
  backup: 'settings.backup.title',
  catalog: 'settings.catalog.title',
  about: 'settings.about.title',
};

// Índice de Configurações (12.8): uma coluna de abas à esquerda (em cima, com rolagem, nas janelas estreitas) com o estado de cada
// seção na segunda linha, sem precisar abrir a seção. A seção aberta vai para o hash da URL (`#fx`); `#csfloat` (links antigos) abre
// Integrações e rola até o cartão do CSFloat.
export default function SettingsIndex({ settings }: Props) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const { theme, language } = usePreferences();
  const horizontal = useBelow('narrow');
  const [section, setSection] = useState<SettingsSectionId>('preferences');
  const pendingScroll = useRef<string | null>(null);

  // Se uma consulta falhar (error), só a linha de estado daquela seção fica sem texto; cada seção trata o seu próprio erro.
  const csfloat = useQuery({ queryKey: queryKeys.integrations.csfloat, queryFn: ({ signal }) => getCsfloatIntegration(signal) });
  const catalog = useQuery({ queryKey: queryKeys.catalog.status, queryFn: ({ signal }) => getCatalogStatus(signal) });
  const health = useQuery({ queryKey: queryKeys.health.all, queryFn: ({ signal }) => getHealth(signal) });
  const backupInfo = useQuery({ queryKey: queryKeys.backupInfo.all, queryFn: ({ signal }) => getBackupInfo(signal) });

  const applyHash = useCallback(() => {
    const target = sectionFromHash(window.location.hash);
    pendingScroll.current = target.scrollTo;
    setSection(target.section);
  }, []);

  useEffect(() => {
    applyHash();
    window.addEventListener('hashchange', applyHash);
    window.addEventListener('popstate', applyHash);
    return () => {
      window.removeEventListener('hashchange', applyHash);
      window.removeEventListener('popstate', applyHash);
    };
  }, [applyHash]);

  // Depois de abrir Integrações por `#csfloat`, o cartão só existe quando a aba monta: rola então.
  useEffect(() => {
    if (pendingScroll.current === null || section !== 'integrations') return;
    const id = pendingScroll.current;
    pendingScroll.current = null;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView?.({ block: 'start' }));
  }, [section]);

  const choose = (value: string) => {
    const next = SETTINGS_SECTIONS.find((id) => id === value) ?? 'preferences';
    pendingScroll.current = null;
    setSection(next);
    window.history.replaceState(window.history.state, '', `#${next}`);
  };

  const statuses = useMemo(
    () =>
      settingsStatuses({
        t: t as (key: string, params?: Record<string, string | number>) => string,
        tPlural,
        locale,
        now: new Date(),
        theme,
        language,
        settings,
        csfloat: csfloat.data ?? null,
        catalog: catalog.data ?? null,
        version: health.data?.version ?? null,
        backupFolderReady: backupInfo.data !== undefined,
      }),
    [t, tPlural, locale, theme, language, settings, csfloat.data, catalog.data, health.data, backupInfo.data],
  );

  const items = SETTINGS_SECTIONS.map((id) => ({
    value: id,
    label: (t as (key: string) => string)(TITLE_KEY[id]),
    description: statuses[id] ?? undefined,
  }));

  const renderSection = (id: SettingsSectionId): ReactNode => {
    switch (id) {
      case 'preferences':
        return <PreferencesSettings />;
      case 'fx':
        return <FxRateSettings />;
      case 'aging':
        return settings ? <AgingSettings settings={settings} /> : <Skeleton height="10rem" radius="md" />;
      case 'integrations':
        return <IntegrationsSettings />;
      case 'backup':
        return <BackupSettings />;
      case 'catalog':
        return <CatalogSettings />;
      default:
        return <AboutSettings />;
    }
  };

  return (
    <Tabs
      label={t('settings.index.label')}
      value={section}
      onChange={choose}
      items={items}
      orientation={horizontal ? 'horizontal' : 'vertical'}
      className={styles.tabs}
    >
      {SETTINGS_SECTIONS.map((id) => (
        <TabPanel key={id} value={id}>
          {renderSection(id)}
        </TabPanel>
      ))}
    </Tabs>
  );
}
