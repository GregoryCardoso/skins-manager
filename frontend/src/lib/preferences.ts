import { BASE_LANGUAGE, LANGUAGES, isLanguage, matchLanguage } from '@/i18n/languages';
import type { InventoryView, Language, ResolvedTheme, Theme, ThemeChoice } from '@/types/api';

// O registro de idiomas é `i18n/languages.ts` (D369); estes nomes continuam exportados aqui por compatibilidade.
export { LANGUAGES, isLanguage };

export const THEME_STORAGE_KEY = 'sm.theme';
export const LANGUAGE_STORAGE_KEY = 'sm.language';
// Só dois estados na interface (D112). 'SYSTEM' do banco = sem preferência.
export const THEME_CHOICES: readonly ThemeChoice[] = ['LIGHT', 'DARK'];
// Idioma do HTML pré-gerado pelo export estático: o base (inglês, D369).
export const DEFAULT_LANGUAGE: Language = BASE_LANGUAGE;

// Instalação nova (D369, E-P3-Q6): na primeira leitura das configurações, sem idioma no cache do navegador e com o banco ainda no
// padrão (inglês, sem escolha do usuário), vale o idioma do Windows/navegador, se for outro dos disponíveis. Em qualquer outro caso
// (cache presente, banco já em outro idioma, ou o sistema também em inglês) vale o banco: quem já usa o app não muda nada.
export function shouldAdoptDetectedLanguage(input: {
  firstSettingsLoad: boolean;
  languageCachedAtStart: boolean;
  savedLanguage: string;
  detectedLanguage: string;
}): boolean {
  return (
    input.firstSettingsLoad &&
    !input.languageCachedAtStart &&
    input.savedLanguage === BASE_LANGUAGE &&
    input.detectedLanguage !== BASE_LANGUAGE
  );
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

// Tema efetivo: a escolha salva vale sempre; sem escolha ('SYSTEM', ausente ou inválido),
// usa o tema do sistema operacional lido uma vez, como valor inicial.
export function effectiveTheme(saved: Theme | string | null | undefined, systemPrefersDark: boolean): ThemeChoice {
  if (isThemeChoice(saved)) return saved;
  return systemPrefersDark ? 'DARK' : 'LIGHT';
}

export function toResolvedTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === 'DARK' ? 'dark' : 'light';
}

// Botão de dois estados: Claro <-> Escuro.
export function nextTheme(theme: ThemeChoice): ThemeChoice {
  return theme === 'LIGHT' ? 'DARK' : 'LIGHT';
}

// Visão do inventário (D276): cache local para a tela abrir sem "piscar"; o banco prevalece.
export const INVENTORY_VIEW_STORAGE_KEY = 'sm.inventoryView';
export const DEFAULT_INVENTORY_VIEW: InventoryView = 'GROUPED';

export function isInventoryView(value: unknown): value is InventoryView {
  return value === 'GROUPED' || value === 'INDIVIDUAL';
}

export interface CachedPreferences {
  theme?: ThemeChoice;
  language?: Language;
}

// theme: null = remover a escolha do cache (o banco diz "sem preferência").
export interface CachedPreferencesPatch {
  theme?: ThemeChoice | null;
  language?: Language;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// 'SYSTEM' antigo no cache é ignorado (= sem preferência).
export function readCachedPreferences(storage: StorageLike | null = defaultStorage()): CachedPreferences {
  const result: CachedPreferences = {};
  if (!storage) return result;
  try {
    const theme = storage.getItem(THEME_STORAGE_KEY);
    const language = storage.getItem(LANGUAGE_STORAGE_KEY);
    if (isThemeChoice(theme)) result.theme = theme;
    if (isLanguage(language)) result.language = language;
  } catch {
    // localStorage indisponível: segue sem cache.
  }
  return result;
}

export function writeCachedPreferences(
  prefs: CachedPreferencesPatch,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    if (prefs.theme === null) storage.removeItem(THEME_STORAGE_KEY);
    else if (prefs.theme) storage.setItem(THEME_STORAGE_KEY, prefs.theme);
    if (prefs.language) storage.setItem(LANGUAGE_STORAGE_KEY, prefs.language);
  } catch {
    // Sem permissão/espaço: o banco continua sendo a fonte da verdade.
  }
}

// Cache ausente, inválido ou localStorage indisponível -> 'GROUPED'. Nunca lança.
export function readInventoryView(storage: StorageLike | null = defaultStorage()): InventoryView {
  if (!storage) return DEFAULT_INVENTORY_VIEW;
  try {
    const value = storage.getItem(INVENTORY_VIEW_STORAGE_KEY);
    return isInventoryView(value) ? value : DEFAULT_INVENTORY_VIEW;
  } catch {
    return DEFAULT_INVENTORY_VIEW;
  }
}

export function writeInventoryView(view: InventoryView, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(INVENTORY_VIEW_STORAGE_KEY, view);
  } catch {
    // Sem permissão/espaço: o banco continua sendo a fonte da verdade.
  }
}

export interface BootstrapEnv {
  doc?: { documentElement: { setAttribute(n: string, v: string): void; classList: { add(c: string): void; remove(c: string): void }; style: { colorScheme: string } } };
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  matchMedia?: ((query: string) => { matches: boolean }) | null;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  // Idiomas disponíveis, idioma base e a função que escolhe um idioma pela lista do navegador (o `bootstrapScript` injeta os três).
  languages?: readonly string[];
  baseLanguage?: string;
  pickLanguage?: (locales: readonly string[], available: readonly string[], fallback: string) => string;
  // Idiomas do navegador, em ordem de preferência (padrão: `navigator.languages`).
  navigatorLocales?: readonly string[] | null;
}

// Serializado em um <script> inline no <head> (roda antes da pintura): precisa ser AUTOSSUFICIENTE,
// sem referência a nada fora do corpo da função. Nunca lança.
export function bootstrapPreferences(env?: BootstrapEnv): void {
  try {
    const e = env || {};
    const doc = e.doc || document;
    const root = doc.documentElement;
    let storage: Pick<Storage, 'getItem' | 'setItem'> | null = null;
    try {
      storage = e.storage !== undefined ? e.storage : localStorage;
    } catch {
      storage = null;
    }
    // null = sem escolha salva (inclui 'SYSTEM' antigo): usa o tema do sistema.
    let theme: string | null = null;
    const available = e.languages || ['en'];
    const base = e.baseLanguage || 'en';
    let language = base;
    let storedLanguage: string | null = null;
    try {
      if (storage) {
        const t = storage.getItem('sm.theme');
        const l = storage.getItem('sm.language');
        if (t === 'LIGHT' || t === 'DARK') theme = t;
        if (l !== null && available.indexOf(l) >= 0) storedLanguage = l;
      }
    } catch {
      // ignora
    }
    // Sem idioma salvo (instalação nova ou cache limpo): o do navegador/Windows, se for um dos disponíveis; senão, o base.
    if (storedLanguage !== null) {
      language = storedLanguage;
    } else if (e.pickLanguage) {
      try {
        let locales: string[] = [];
        if (e.navigatorLocales !== undefined) {
          locales = e.navigatorLocales ? e.navigatorLocales.slice() : [];
        } else {
          if (Array.isArray(navigator.languages)) locales = navigator.languages.slice();
          if (navigator.language) locales.push(navigator.language);
        }
        language = e.pickLanguage(locales, available, base);
      } catch {
        language = base;
      }
    }
    let dark = false;
    if (theme === null) {
      try {
        const mm = e.matchMedia !== undefined ? e.matchMedia : window.matchMedia.bind(window);
        dark = !!mm && mm('(prefers-color-scheme: dark)').matches;
      } catch {
        // ignora
      }
    }
    const resolved = theme === 'DARK' || (theme === null && dark) ? 'dark' : 'light';
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;
    root.setAttribute('lang', language);
    if (language !== base) {
      root.classList.add('i18n-pending');
      const schedule = e.setTimeoutFn || setTimeout;
      schedule(() => root.classList.remove('i18n-pending'), 3000);
    }
  } catch {
    // Nunca quebra a página.
  }
}

export function bootstrapScript(): string {
  const env = `{ languages: ${JSON.stringify(LANGUAGES)}, baseLanguage: ${JSON.stringify(BASE_LANGUAGE)}, pickLanguage: ${matchLanguage.toString()} }`;
  return `(${bootstrapPreferences.toString()})(${env})`;
}
