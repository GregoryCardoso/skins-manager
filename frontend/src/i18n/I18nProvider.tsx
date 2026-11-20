'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { usePreferences } from '@/components/PreferencesProvider';
import type { Language } from '@/types/api';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translate, translatePlural, type MessageKey, type TranslateParams } from './translate';

const DICTIONARIES: Record<Language, unknown> = { 'pt-BR': ptBR, en };

type Translator = (key: MessageKey, params?: TranslateParams) => string;
type LooseTranslator = (key: string, params?: TranslateParams) => string;

interface I18nContextValue {
  language: Language;
  t: Translator;
  // Para chaves montadas dinamicamente (ex.: `errors.${code}`).
  tLoose: LooseTranslator;
  // Plural por Intl.PluralRules: `key` aponta para um objeto com `one` e `other`.
  tPlural: (key: string, count: number, params?: TranslateParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { language, ready } = usePreferences();

  const value = useMemo<I18nContextValue>(() => {
    const messages = DICTIONARIES[language];
    const tLoose: LooseTranslator = (key, params) => translate(messages, key, params);
    const tPlural = (key: string, count: number, params?: TranslateParams) =>
      translatePlural(messages, key, count, language, params);
    return { language, t: tLoose as Translator, tLoose, tPlural };
  }, [language]);

  // Depois de renderizar no idioma certo, mostra a página (ver script de bootstrap).
  useEffect(() => {
    if (ready) document.documentElement.classList.remove('i18n-pending');
  }, [ready, language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n deve ser usado dentro de I18nProvider');
  return ctx;
}

export const useT = (): Translator => useI18n().t;
export const useTLoose = (): LooseTranslator => useI18n().tLoose;
export const useTPlural = (): I18nContextValue['tPlural'] => useI18n().tPlural;
export const useLanguage =(): Language => useI18n().language;
