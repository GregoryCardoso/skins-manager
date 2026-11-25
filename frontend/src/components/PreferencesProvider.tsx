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
  shouldAdoptDetectedLanguage,
  toResolvedTheme,
  writeCachedPreferences,
  writeInventoryView,
} from '@/lib/preferences';
import { BASE_LANGUAGE, browserLocales, detectLanguage, languageOrBase } from '@/i18n/languages';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { changeDisplayCurrency, getSettings, refreshFxRate, updateFxRate, updatePreferences } from '@/services/api';
import type {
  DisplayCurrencyChangeResult, FxRateEntry, FxRefreshResult, FxRefreshSource, InventoryView, Language, SteamStoreChoice, ThemeChoice,
} from '@/types/api';

interface PreferencesContextValue {
  // Tema exibido (D112): a escolha salva ou, sem escolha, o do sistema lido ao abrir o app.
  theme: ThemeChoice;
  language: Language;
  // Falso até o cache ser lido (o estado inicial é o do HTML pré-gerado, para evitar erro de hidratação).
  ready: boolean;
  // Verdadeiro quando o idioma ja e o definitivo: veio do cache ou as configuracoes ja responderam (ver i18n-pending).
  languageSettled: boolean;
  // Último erro ao salvar a preferência no servidor (null = ok).
  saveError: unknown;
  setTheme: (theme: ThemeChoice) => void;
  setLanguage: (language: Language) => void;
  // Visão do inventário (D276): o banco prevalece; a troca é otimista e volta ao valor anterior se o PATCH falhar.
  inventoryView: InventoryView;
  setInventoryView: (view: InventoryView) => void;
  // Moeda de conversão (D369): a do "≈". Instalação nova = USD (sem "≈"); banco existente = BRL. Enquanto as configurações não chegam, USD.
  displayCurrency: string;
  // Cotações gravadas por moeda e as moedas que precisam de cotação (a de conversão, as das lojas e, com legado, o BRL).
  fxRates: FxRateEntry[];
  requiredFxCurrencies: string[];
  // Troca a moeda de conversão (o modal já confirmou). Na 11.3 a loja Steam sempre fica como está ('KEEP'). Invalida as telas com dinheiro.
  changeDisplayCurrency: (currency: string, steamStore?: SteamStoreChoice) => Promise<DisplayCurrencyChangeResult>;
  // Cotação do BRL (D107), usada como padrão nos formulários de compra e venda em R$: null = não definida (ou ainda não carregada).
  usdBrlRate: number | null;
  // Grava a cotação de uma moeda no servidor; rejeita com o erro da API (para o chamador mostrar a mensagem).
  saveFxRate: (currency: string, rate: number) => Promise<void>;
  // Salva a fonte do botão "atualizar cotação" do BRL (AwesomeAPI ou PTAX) na hora; rejeita com o erro da API.
  saveFxRefreshSource: (source: FxRefreshSource) => Promise<void>;
  // Busca a cotação de uma moeda na fonte salva e grava direto; rejeita com o erro da API.
  refreshFxRate: (currency: string) => Promise<FxRefreshResult>;
  // Relê a cotação do servidor (usado ao tentar de novo depois de o backend ter ficado fora do ar).
  reloadFxRate: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>('LIGHT');
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [inventoryView, setInventoryViewState] = useState<InventoryView>(DEFAULT_INVENTORY_VIEW);
  const [ready, setReady] = useState(false);
  const [languageSettled, setLanguageSettled] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  // Campos trocados localmente: a resposta tardia do GET /settings não os sobrescreve.
  const touched = useRef({ theme: false, language: false, inventoryView: false });
  // Instalação nova (D369, E-P3-Q6): sem idioma no cache do navegador, o idioma inicial é o do Windows/navegador, se for um dos
  // disponíveis; senão, o inglês. Quem já usa o app tem o idioma no cache e no banco e não muda nada.
  const languageCachedAtStart = useRef(true);
  const detectedLanguage = useRef<Language>(BASE_LANGUAGE);
  const firstSettingsApplied = useRef(false);
  const saveDetectedLanguage = useRef<(language: Language) => void>(() => {});
  const invalidate = useInvalidate();
  // As configurações vêm do cache compartilhado (D259): mudar cotação, limites ou preferências as invalida.
  const settingsQuery = useQuery({ queryKey: queryKeys.settings.all, queryFn: ({ signal }) => getSettings(signal) });
  const settingsData = settingsQuery.data;
  // Moeda de conversão e cotações vêm direto do cache das configurações (sem cópia em estado): trocar a moeda ou a cotação invalida
  // `settings` e todas as telas leem o mesmo valor.
  const displayCurrency = settingsData?.displayCurrency ?? 'USD';
  const fxRates = useMemo(() => settingsData?.fxRates ?? [], [settingsData]);
  const requiredFxCurrencies = useMemo(() => settingsData?.requiredFxCurrencies ?? [], [settingsData]);
  const usdBrlRate = useMemo(() => fxRates.find((entry) => entry.currency === 'BRL')?.rate ?? null, [fxRates]);

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
    languageCachedAtStart.current = cached.language !== undefined;
    if (cached.language !== undefined) setLanguageSettled(true);
    detectedLanguage.current = detectLanguage(browserLocales());
    setLanguageState(cached.language ?? detectedLanguage.current);
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
    // 'SYSTEM' no banco (padrão ou valor antigo) = sem preferência: tema do sistema e cache limpo.
    if (!touched.current.theme) setThemeState(effectiveTheme(settingsData.theme, systemDark));
    if (!touched.current.language) {
      const detected = detectedLanguage.current;
      // O banco de uma instalação nova nasce em inglês (o padrão), sem escolha do usuário: vale o idioma do sistema.
      if (shouldAdoptDetectedLanguage({ firstSettingsLoad: !firstSettingsApplied.current, languageCachedAtStart: languageCachedAtStart.current, savedLanguage: settingsData.language, detectedLanguage: detected })) {
        touched.current.language = true;
        setLanguageState(detected);
        saveDetectedLanguage.current(detected);
      } else {
        // Idioma fora do registro (ex.: backup de uma versão mais nova): usa o inglês, nunca derruba a interface.
        setLanguageState(languageOrBase(settingsData.language));
      }
    }
    firstSettingsApplied.current = true;
    setLanguageSettled(true);
    // O banco prevalece sobre o cache (D276), salvo uma troca em andamento.
    if (!touched.current.inventoryView && settingsData.inventoryView) {
      setInventoryViewState(settingsData.inventoryView);
      writeInventoryView(settingsData.inventoryView);
    }
    writeCachedPreferences({
      theme: touched.current.theme ? undefined : isThemeChoice(settingsData.theme) ? settingsData.theme : null,
      language: touched.current.language ? undefined : languageOrBase(settingsData.language),
    });
  }, [settingsData]);

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

  saveDetectedLanguage.current = (next) => save({ language: next });

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
  // Só a resposta da última troca vale (revisão da 8.8, item 4): numa troca rápida (G→I→G), a resposta ou o erro de uma
  // troca anterior não zera `touched`, não recarrega e não desfaz para um valor que já não vale.
  const inventoryViewSeq = useRef(0);
  // Valor confirmado pelo backend (ou o inicial): é para ele que o rollback volta.
  const confirmedInventoryView = useRef(inventoryView);
  const setInventoryView = useCallback(
    (next: InventoryView) => {
      const previous = inventoryViewRef.current;
      if (next === previous) return;
      if (!touched.current.inventoryView) confirmedInventoryView.current = previous;
      const seq = ++inventoryViewSeq.current;
      touched.current.inventoryView = true;
      inventoryViewRef.current = next;
      setInventoryViewState(next);
      writeInventoryView(next);
      updatePreferences({ inventoryView: next })
        .then(() => {
          confirmedInventoryView.current = next;
          if (seq !== inventoryViewSeq.current) return;
          touched.current.inventoryView = false;
          setSaveError(null);
          invalidate('settings.preferences');
        })
        .catch((error: unknown) => {
          if (seq !== inventoryViewSeq.current) return;
          const fallback = confirmedInventoryView.current;
          touched.current.inventoryView = false;
          inventoryViewRef.current = fallback;
          setInventoryViewState(fallback);
          writeInventoryView(fallback);
          setSaveError(error);
        });
    },
    [invalidate],
  );

  const saveFxRate = useCallback(async (currency: string, rate: number) => {
    await updateFxRate(currency, rate);
    await invalidate('settings.fx');
  }, [invalidate]);

  const saveFxRefreshSource = useCallback(async (source: FxRefreshSource) => {
    await updatePreferences({ fxRefreshSource: source });
    await invalidate('settings.fx');
  }, [invalidate]);

  const refreshFx = useCallback(async (currency: string) => {
    const result = await refreshFxRate({ currency });
    await invalidate('settings.fx');
    return result;
  }, [invalidate]);

  // Trocar a moeda de conversão muda todo "≈" (itens, vendas, lojas, saldos e lucro real): recarrega tudo o que tem dinheiro.
  const changeCurrency = useCallback(async (currency: string, steamStore: SteamStoreChoice = 'KEEP') => {
    const result = await changeDisplayCurrency(currency, steamStore);
    await invalidate('settings.fx');
    return result;
  }, [invalidate]);

  // Relê as configurações (ex.: tentar de novo depois de o backend ter ficado fora do ar).
  const reloadFxRate = useCallback(() => {
    invalidate('settings.preferences');
  }, [invalidate]);

  const value = useMemo(
    () => ({
      theme, language, ready, languageSettled, saveError, setTheme, setLanguage, inventoryView, setInventoryView, displayCurrency, fxRates,
      requiredFxCurrencies, changeDisplayCurrency: changeCurrency, usdBrlRate, saveFxRate, saveFxRefreshSource, refreshFxRate: refreshFx, reloadFxRate,
    }),
    [theme, language, ready, languageSettled, saveError, setTheme, setLanguage, inventoryView, setInventoryView, displayCurrency, fxRates,
      requiredFxCurrencies, changeCurrency, usdBrlRate, saveFxRate, saveFxRefreshSource, refreshFx, reloadFxRate],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences deve ser usado dentro de PreferencesProvider');
  return ctx;
}
