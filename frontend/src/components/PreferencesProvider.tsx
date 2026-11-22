'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_INVENTORY_VIEW,
  DEFAULT_LANGUAGE,
  INVENTORY_VIEW_STORAGE_KEY,
  LANGUAGE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  effectiveTheme,
  isThemeChoice,
  readCachedPreferences,
  readInventoryView,
  toResolvedTheme,
  writeCachedPreferences,
  writeInventoryView,
} from '@/lib/preferences';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { getSettings, refreshFxRate, updateFxRate, updatePreferences } from '@/services/api';
import type { FxRateSource, FxRefreshResult, FxRefreshSource, InventoryView, Language, Settings, ThemeChoice } from '@/types/api';

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
  // Visão do inventário (D276): o banco prevalece; a troca é otimista e volta ao valor anterior se o PATCH falhar.
  inventoryView: InventoryView;
  setInventoryView: (view: InventoryView) => void;
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
  // Relê a cotação do servidor (usado ao tentar de novo depois de o backend ter ficado fora do ar).
  reloadFxRate: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>('LIGHT');
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [inventoryView, setInventoryViewState] = useState<InventoryView>(DEFAULT_INVENTORY_VIEW);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [usdBrlRate, setUsdBrlRate] = useState<number | null>(null);
  const [fxSource, setFxSource] = useState<FxRateSource | null>(null);
  const [rateQuotedAt, setRateQuotedAt] = useState<string | null>(null);
  const [fxRateUpdatedAt, setFxRateUpdatedAt] = useState<string | null>(null);
  const [fxRefreshSource, setFxRefreshSource] = useState<FxRefreshSource>('AWESOMEAPI');
  // Campos trocados localmente: a resposta tardia do GET /settings não os sobrescreve.
  const touched = useRef({ theme: false, language: false, inventoryView: false });
  const invalidate = useInvalidate();
  // As configurações vêm do cache compartilhado (D259): mudar cotação, limites ou preferências as invalida.
  const settingsQuery = useQuery({ queryKey: queryKeys.settings.all, queryFn: ({ signal }) => getSettings(signal) });
  const settingsData = settingsQuery.data;

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
    setInventoryViewState(readInventoryView());
    setReady(true);

    const onStorage = (event: StorageEvent) => {
      if (event.key === INVENTORY_VIEW_STORAGE_KEY) setInventoryViewState(readInventoryView());
      if (event.key !== THEME_STORAGE_KEY && event.key !== LANGUAGE_STORAGE_KEY) return;
      const fresh = readCachedPreferences();
      if (fresh.theme) setThemeState(fresh.theme);
      if (fresh.language) setLanguageState(fresh.language);
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Cada vez que as configurações chegam (ou são recarregadas), aplica cotação, tema e idioma.
  useEffect(() => {
    if (!settingsData) return;
    let systemDark = false;
    try {
      systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      // sem matchMedia: claro
    }
    applyFx(settingsData);
    // 'SYSTEM' no banco (padrão ou valor antigo) = sem preferência: tema do sistema e cache limpo.
    if (!touched.current.theme) setThemeState(effectiveTheme(settingsData.theme, systemDark));
    if (!touched.current.language) setLanguageState(settingsData.language);
    // O banco prevalece sobre o cache (D276), salvo uma troca em andamento.
    if (!touched.current.inventoryView && settingsData.inventoryView) {
      setInventoryViewState(settingsData.inventoryView);
      writeInventoryView(settingsData.inventoryView);
    }
    writeCachedPreferences({
      theme: touched.current.theme ? undefined : isThemeChoice(settingsData.theme) ? settingsData.theme : null,
      language: touched.current.language ? undefined : settingsData.language,
    });
  }, [settingsData, applyFx]);

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
      .then(() => {
        setSaveError(null);
        invalidate('settings.preferences');
      })
      .catch((error: unknown) => setSaveError(error));
  }, [invalidate]);

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

  // Troca otimista (D276): estado e cache na hora; se o PATCH falhar, os dois voltam ao valor anterior e o erro fica em saveError.
  const inventoryViewRef = useRef(inventoryView);
  inventoryViewRef.current = inventoryView;
  const setInventoryView = useCallback(
    (next: InventoryView) => {
      const previous = inventoryViewRef.current;
      if (next === previous) return;
      touched.current.inventoryView = true;
      inventoryViewRef.current = next;
      setInventoryViewState(next);
      writeInventoryView(next);
      updatePreferences({ inventoryView: next })
        .then(() => {
          touched.current.inventoryView = false;
          setSaveError(null);
          invalidate('settings.preferences');
        })
        .catch((error: unknown) => {
          touched.current.inventoryView = false;
          inventoryViewRef.current = previous;
          setInventoryViewState(previous);
          writeInventoryView(previous);
          setSaveError(error);
        });
    },
    [invalidate],
  );

  const saveFxRate = useCallback(async (rate: number) => {
    applyFx(await updateFxRate(rate));
    invalidate('settings.fx');
  }, [applyFx, invalidate]);

  const saveFxRefreshSource = useCallback(async (source: FxRefreshSource) => {
    applyFx(await updatePreferences({ fxRefreshSource: source }));
    invalidate('settings.fx');
  }, [applyFx, invalidate]);

  const refreshFx = useCallback(async () => {
    const result = await refreshFxRate();
    applyFx(result.settings);
    invalidate('settings.fx');
    return result;
  }, [applyFx, invalidate]);

  // Relê as configurações (ex.: tentar de novo depois de o backend ter ficado fora do ar).
  const reloadFxRate = useCallback(() => {
    invalidate('settings.preferences');
  }, [invalidate]);

  const value = useMemo(
    () => ({
      theme, language, ready, saveError, setTheme, setLanguage, inventoryView, setInventoryView, usdBrlRate, saveFxRate, fxSource, rateQuotedAt,
      fxRateUpdatedAt, fxRefreshSource, saveFxRefreshSource, refreshFxRate: refreshFx, reloadFxRate,
    }),
    [theme, language, ready, saveError, setTheme, setLanguage, inventoryView, setInventoryView, usdBrlRate, saveFxRate, fxSource, rateQuotedAt,
      fxRateUpdatedAt, fxRefreshSource, saveFxRefreshSource, refreshFx, reloadFxRate],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences deve ser usado dentro de PreferencesProvider');
  return ctx;
}
