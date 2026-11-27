// Linha de estado de cada seção de Configurações (12.8), a partir das consultas que já existem. Só monta texto: nenhuma regra nova.
import { buildFxRows } from './fxRates';
import { currencySymbol } from './currencies';
import { formatDate, formatInteger } from './format';
import type { CatalogStatus, IntegrationView, Settings, ThemeChoice } from '@/types/api';
import { languageInfo } from '@/i18n/languages';

export const SETTINGS_SECTIONS = ['preferences', 'fx', 'aging', 'integrations', 'backup', 'catalog', 'about'] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

type Translate = (key: string, params?: Record<string, string | number>) => string;
type TranslatePlural = (key: string, count: number, params?: Record<string, string | number>) => string;

export interface SettingsStatusInput {
  t: Translate;
  tPlural: TranslatePlural;
  locale: string;
  now: Date;
  theme: ThemeChoice;
  language: string;
  settings: Settings | null;
  csfloat: Pick<IntegrationView, 'hasApiKey' | 'openEntriesCount'> | null;
  catalog: CatalogStatus | null;
  version: string | null;
  backupFolderReady: boolean;
}

// Texto curto (uma linha) por seção; `null` enquanto o dado não chegou (a seção só não mostra o estado).
export function settingsStatuses(input: SettingsStatusInput): Record<SettingsSectionId, string | null> {
  const { t, tPlural, locale, settings, csfloat, catalog } = input;
  return {
    preferences: [t(`theme.${input.theme}`), languageInfo(input.language).nativeName, settings ? currencySymbol(settings.displayCurrency, locale) : null]
      .filter((part): part is string => part !== null)
      .join(' · '),
    fx: fxStatus(input),
    aging: settings
      ? t('settings.status.aging', { fast: tPlural('ui.turnover.daysShort', settings.fastTurnoverDays), slow: tPlural('ui.turnover.daysShort', settings.slowItemDays) })
      : null,
    integrations: csfloat
      ? csfloat.hasApiKey
        ? [t('settings.status.csfloatConnected'), csfloat.openEntriesCount > 0 ? tPlural('settings.status.csfloatReview', csfloat.openEntriesCount) : null]
            .filter((part): part is string => part !== null)
            .join(' · ')
        : t('settings.status.csfloatNoKey')
      : null,
    backup: input.backupFolderReady ? t('settings.status.backupFolder') : null,
    catalog: catalog
      ? catalog.catalogUpdatedAt
        ? t('settings.status.catalog', { total: formatInteger(catalog.total, locale), date: formatDate(catalog.catalogUpdatedAt, locale) })
        : t('catalog.neverUpdated')
      : null,
    about: input.version ? `v${input.version}` : null,
  };
}

function fxStatus({ t, tPlural, now, settings }: SettingsStatusInput): string | null {
  if (!settings) return null;
  const rows = buildFxRows(settings.requiredFxCurrencies, settings.fxRates, settings.displayCurrency, now);
  if (rows.length === 0) return null;
  const missing = rows.find((row) => row.rate === null);
  if (missing) return t('settings.status.fxMissing', { currency: missing.currency });
  const stale = rows.filter((row) => row.stale).length;
  const count = tPlural('settings.status.fxCount', rows.length);
  return stale > 0 ? `${count} · ${tPlural('settings.status.fxStale', stale)}` : count;
}

// `#csfloat` (links antigos) abre Integrações e rola até o cartão. Os demais hashes são o nome da seção.
export function sectionFromHash(hash: string): { section: SettingsSectionId; scrollTo: string | null } {
  const name = hash.replace(/^#/, '').toLowerCase();
  if (name === 'csfloat') return { section: 'integrations', scrollTo: 'csfloat' };
  const found = SETTINGS_SECTIONS.find((id) => id === name);
  return { section: found ?? 'preferences', scrollTo: null };
}
