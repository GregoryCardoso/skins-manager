'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  readCachedPreferences,
  resolveTheme,
  writeCachedPreferences,
} from '@/lib/preferences';
import { getSettings, updatePreferences } from '@/services/api';
import type { Language, Theme } from '@/types/api';

interface PreferencesContextValue {
  theme: Theme;
  language: Language;
  // Falso até o cache ser lido (o estado inicial é o do HTML pré-gerado, para evitar erro de hidratação).
  ready: boolean;
  // Último erro ao salvar a preferência no servidor (null = ok).
  saveError: unknown;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: Language) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('SYSTEM');
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [systemDark, setSystemDark] = useState(false);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  // Campos trocados localmente: a resposta tardia do GET /settings não os sobrescreve.
  const touched = useRef({ theme: false, language: false });

  useEffect(() => {
    const cached = readCachedPreferences();
    if (cached.theme) setThemeState(cached.theme);
    if (cached.language) setLanguageState(cached.language);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(media.matches);
    setReady(true);

    const onMediaChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onMediaChange);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== LANGUAGE_STORAGE_KEY) return;
      const fresh = readCachedPreferences();
      if (fresh.theme) setThemeState(fresh.theme);
      if (fresh.language) setLanguageState(fresh.language);
    };
    window.addEventListener('storage', onStorage);

    const controller = new AbortController();
    getSettings(controller.signal)
      .then((settings) => {
        if (!touched.current.theme) setThemeState(settings.theme);
        if (!touched.current.language) setLanguageState(settings.language);
        writeCachedPreferences({
          theme: touched.current.theme ? undefined : settings.theme,
          language: touched.current.language ? undefined : settings.language,
        });
      })
      .catch(() => {
        // Backend fora do ar: segue com o cache/sistema; o painel de status mostra o problema.
      });

    return () => {
      controller.abort();
      media.removeEventListener('change', onMediaChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const resolved = resolveTheme(theme, systemDark);
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;
    root.setAttribute('lang', language);
  }, [ready, theme, language, systemDark]);

  const save = useCallback((patch: { theme?: Theme; language?: Language }) => {
    writeCachedPreferences(patch);
    updatePreferences(patch)
      .then(() => setSaveError(null))
      .catch((error: unknown) => setSaveError(error));
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      touched.current.theme = true;
      setThemeState(next);
      save({ theme: next });
    },
    [save],
  );

  const setLanguage = useCallback(
    (next: Language) => {
      touched.current.language = true;
      setLanguageState(next);
      save({ language: next });
    },
    [save],
  );

  const value = useMemo(
    () => ({ theme, language, ready, saveError, setTheme, setLanguage }),
    [theme, language, ready, saveError, setTheme, setLanguage],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences deve ser usado dentro de PreferencesProvider');
  return ctx;
}
