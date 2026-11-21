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
import { getSettings, refreshFxRate, updateFxRate, updatePreferences } from '@/services/api';
import type { FxRateSource, FxRefreshResult, FxRefreshSource, Language, Settings, ThemeChoice } from '@/types/api';

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
  // Origem da cotação (null = nunca definida), data/hora na fonte, data da última gravação e fonte do botão (D162).
  fxSource: FxRateSource | null;
  rateQuotedAt: string | null;
  fxRateUpdatedAt: string | null;
  fxRefreshSource: FxRefreshSource;
  // Salva a fonte do botão "atualizar cotação" na hora; rejeita com o erro da API.
  saveFxRefreshSource: (source: FxRefreshSource) => Promise<void>;
  // Busca a cotação na fonte salva e grava direto; rejeita com o erro da API.
  refreshFxRate: () => Promise<FxRefreshResult>;
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
  const [fxSource, setFxSource] = useState<FxRateSource | null>(null);
  const [rateQuotedAt, setRateQuotedAt] = useState<string | null>(null);
  const [fxRateUpdatedAt, setFxRateUpdatedAt] = useState<string | null>(null);
  const [fxRefreshSource, setFxRefreshSource] = useState<FxRefreshSource>('AWESOMEAPI');
  // Campos trocados localmente: a resposta tardia do GET /settings não os sobrescreve.
  const touched = useRef({ theme: false, language: false });

  const applyFx = useCallback(
    (settings: Pick<Settings, 'usdBrlRate' | 'usdBrlRateSource' | 'rateQuotedAt' | 'usdBrlRateUpdatedAt' | 'fxRefreshSource'>) => {
      setUsdBrlRate(settings.usdBrlRate);
      setFxSource(settings.usdBrlRateSource);
      setRateQuotedAt(settings.rateQuotedAt);
      setFxRateUpdatedAt(settings.usdBrlRateUpdatedAt);
      setFxRefreshSource(settings.fxRefreshSource);
    },
    [],
  );

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
        applyFx(settings);
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
  }, [applyFx]);

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
    applyFx(await updateFxRate(rate));
  }, [applyFx]);

  const saveFxRefreshSource = useCallback(async (source: FxRefreshSource) => {
    applyFx(await updatePreferences({ fxRefreshSource: source }));
  }, [applyFx]);

  const refreshFx = useCallback(async () => {
    const result = await refreshFxRate();
    applyFx(result.settings);
    return result;
  }, [applyFx]);

  const reloadFxRate = useCallback(() => {
    getSettings()
      .then(applyFx)
      .catch(() => {
        // Backend fora do ar: o indicador de status já mostra o problema.
      });
  }, [applyFx]);

  const value = useMemo(
    () => ({
      theme, language, ready, saveError, setTheme, setLanguage, usdBrlRate, saveFxRate, fxSource, rateQuotedAt,
      fxRateUpdatedAt, fxRefreshSource, saveFxRefreshSource, refreshFxRate: refreshFx, reloadFxRate,
    }),
    [theme, language, ready, saveError, setTheme, setLanguage, usdBrlRate, saveFxRate, fxSource, rateQuotedAt,
      fxRateUpdatedAt, fxRefreshSource, saveFxRefreshSource, refreshFx, reloadFxRate],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences deve ser usado dentro de PreferencesProvider');
  return ctx;
}
