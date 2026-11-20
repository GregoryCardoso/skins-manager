'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  effectiveTheme,
  isThemeChoice,
  readCachedPreferences,
  toResolvedTheme,
  writeCachedPreferences,
} from '@/lib/preferences';
import { getSettings, updateFxRate, updatePreferences } from '@/services/api';
import type { Language, ThemeChoice } from '@/types/api';

interface PreferencesContextValue {
  // Tema exibido (D112): a escolha salva ou, sem escolha, o do sistema lido ao abrir o app.
  theme: ThemeChoice;
  language: Language;
  // Falso até o cache ser lido (o estado inicial é o do HTML pré-gerado, para evitar erro de hidratação).
  ready: boolean;
  // Último erro ao salvar a preferência no servidor (null = ok).
  saveError: unknown;
  setTheme: (theme: ThemeChoice) => void;
  setLanguage: (language: Language) => void;
  // Cotação USD→BRL (D107): null = não definida (ou ainda não carregada).
  usdBrlRate: number | null;
  // Grava a cotação no servidor; rejeita com o erro da API (para o chamador mostrar a mensagem).
  saveFxRate: (rate: number) => Promise<void>;
  // Relê a cotação do servidor (usado quando o backend volta a responder).
  reloadFxRate: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>('LIGHT');
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [usdBrlRate, setUsdBrlRate] = useState<number | null>(null);
  // Campos trocados localmente: a resposta tardia do GET /settings não os sobrescreve.
  const touched = useRef({ theme: false, language: false });

  useEffect(() => {
    // Tema do sistema lido uma vez, só como valor inicial; o app não acompanha mudanças do Windows (D112).
    let systemDark = false;
    try {
      systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      // sem matchMedia: claro
    }
    const cached = readCachedPreferences();
    setThemeState(effectiveTheme(cached.theme, systemDark));
    if (cached.language) setLanguageState(cached.language);
    setReady(true);

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
        setUsdBrlRate(settings.usdBrlRate);
        // 'SYSTEM' no banco (padrão ou valor antigo) = sem preferência: tema do sistema e cache limpo.
        if (!touched.current.theme) setThemeState(effectiveTheme(settings.theme, systemDark));
        if (!touched.current.language) setLanguageState(settings.language);
        writeCachedPreferences({
          theme: touched.current.theme ? undefined : isThemeChoice(settings.theme) ? settings.theme : null,
          language: touched.current.language ? undefined : settings.language,
        });
      })
      .catch(() => {
        // Backend fora do ar: segue com o cache/sistema; o painel de status mostra o problema.
      });

    return () => {
      controller.abort();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const resolved = toResolvedTheme(theme);
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;
    root.setAttribute('lang', language);
  }, [ready, theme, language]);

  const save = useCallback((patch: { theme?: ThemeChoice; language?: Language }) => {
    writeCachedPreferences(patch);
    updatePreferences(patch)
      .then(() => setSaveError(null))
      .catch((error: unknown) => setSaveError(error));
  }, []);

  const setTheme = useCallback(
    (next: ThemeChoice) => {
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

  const saveFxRate = useCallback(async (rate: number) => {
    const settings = await updateFxRate(rate);
    setUsdBrlRate(settings.usdBrlRate);
  }, []);

  const reloadFxRate = useCallback(() => {
    getSettings()
      .then((settings) => setUsdBrlRate(settings.usdBrlRate))
      .catch(() => {
        // Backend fora do ar: o indicador de status já mostra o problema.
      });
  }, []);

  const value = useMemo(
    () => ({ theme, language, ready, saveError, setTheme, setLanguage, usdBrlRate, saveFxRate, reloadFxRate }),
    [theme, language, ready, saveError, setTheme, setLanguage, usdBrlRate, saveFxRate, reloadFxRate],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences deve ser usado dentro de PreferencesProvider');
  return ctx;
}
