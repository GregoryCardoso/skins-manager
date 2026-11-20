import type { Language, ResolvedTheme, Theme } from '@/types/api';

export const THEME_STORAGE_KEY = 'sm.theme';
export const LANGUAGE_STORAGE_KEY = 'sm.language';
export const THEMES: readonly Theme[] = ['SYSTEM', 'LIGHT', 'DARK'];
export const LANGUAGES: readonly Language[] = ['pt-BR', 'en'];
// Idioma do HTML pré-gerado pelo export estático.
export const DEFAULT_LANGUAGE: Language = 'pt-BR';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

export function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === 'LIGHT') return 'light';
  if (theme === 'DARK') return 'dark';
  return systemPrefersDark ? 'dark' : 'light';
}

// Ciclo do botão: Sistema -> Claro -> Escuro -> Sistema.
export function nextTheme(theme: Theme): Theme {
  if (theme === 'SYSTEM') return 'LIGHT';
  if (theme === 'LIGHT') return 'DARK';
  return 'SYSTEM';
}

export interface CachedPreferences {
  theme?: Theme;
  language?: Language;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readCachedPreferences(storage: StorageLike | null = defaultStorage()): CachedPreferences {
  const result: CachedPreferences = {};
  if (!storage) return result;
  try {
    const theme = storage.getItem(THEME_STORAGE_KEY);
    const language = storage.getItem(LANGUAGE_STORAGE_KEY);
    if (isTheme(theme)) result.theme = theme;
    if (isLanguage(language)) result.language = language;
  } catch {
    // localStorage indisponível: segue sem cache.
  }
  return result;
}

export function writeCachedPreferences(
  prefs: CachedPreferences,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    if (prefs.theme) storage.setItem(THEME_STORAGE_KEY, prefs.theme);
    if (prefs.language) storage.setItem(LANGUAGE_STORAGE_KEY, prefs.language);
  } catch {
    // Sem permissão/espaço: o banco continua sendo a fonte da verdade.
  }
}

export interface BootstrapEnv {
  doc?: { documentElement: { setAttribute(n: string, v: string): void; classList: { add(c: string): void; remove(c: string): void }; style: { colorScheme: string } } };
  storage?: StorageLike | null;
  matchMedia?: ((query: string) => { matches: boolean }) | null;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
}

// Serializado em um <script> inline no <head> (roda antes da pintura): precisa ser AUTOSSUFICIENTE,
// sem referência a nada fora do corpo da função. Nunca lança.
export function bootstrapPreferences(env?: BootstrapEnv): void {
  try {
    const e = env || {};
    const doc = e.doc || document;
    const root = doc.documentElement;
    let storage: StorageLike | null = null;
    try {
      storage = e.storage !== undefined ? e.storage : localStorage;
    } catch {
      storage = null;
    }
    let theme = 'SYSTEM';
    let language = 'pt-BR';
    try {
      if (storage) {
        const t = storage.getItem('sm.theme');
        const l = storage.getItem('sm.language');
        if (t === 'SYSTEM' || t === 'LIGHT' || t === 'DARK') theme = t;
        if (l === 'pt-BR' || l === 'en') language = l;
      }
    } catch {
      // ignora
    }
    let dark = false;
    try {
      const mm = e.matchMedia !== undefined ? e.matchMedia : window.matchMedia.bind(window);
      dark = !!mm && mm('(prefers-color-scheme: dark)').matches;
    } catch {
      // ignora
    }
    const resolved = theme === 'DARK' || (theme === 'SYSTEM' && dark) ? 'dark' : 'light';
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;
    root.setAttribute('lang', language);
    if (language !== 'pt-BR') {
      root.classList.add('i18n-pending');
      const schedule = e.setTimeoutFn || setTimeout;
      schedule(() => root.classList.remove('i18n-pending'), 3000);
    }
  } catch {
    // Nunca quebra a página.
  }
}

export function bootstrapScript(): string {
  return `(${bootstrapPreferences.toString()})()`;
}
