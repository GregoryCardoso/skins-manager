export type Theme = 'SYSTEM' | 'LIGHT' | 'DARK';
export type Language = 'pt-BR' | 'en';
export type ResolvedTheme = 'light' | 'dark';

export interface ApiErrorBody {
  code: string;
  message: string;
}
export type ApiEnvelope<T> = { success: true; data: T } | { success: false; error: ApiErrorBody };

export interface HealthStatus {
  status: 'ok';
  timestamp: string;
}

export type CatalogSource = 'SKINS' | 'STICKERS' | 'CRATES' | 'KEYCHAINS' | 'AGENTS';
export interface CatalogStatus {
  catalogUpdatedAt: string | null;
  countsBySource: Record<CatalogSource, number>;
  total: number;
}
export interface CatalogRefreshResult extends CatalogStatus {
  skipped: number;
  linkedLegacyItems: number;
}

export interface Settings {
  usdBrlRate: number | null;
  usdBrlRateUpdatedAt: string | null;
  catalogUpdatedAt: string | null;
  theme: Theme;
  language: Language;
  updatedAt: string | null;
}
export interface PreferencesPatch {
  theme?: Theme;
  language?: Language;
}
