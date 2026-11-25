'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePreferences } from '@/components/PreferencesProvider';
import type { Language } from '@/types/api';
import { BASE_DICTIONARY, loadDictionary, type Dictionary } from './dictionaries';
import { BASE_LANGUAGE, intlLocaleOf } from './languages';
import { translate, translatePlural, type MessageKey, type TranslateParams } from './translate';

type Translator = (key: MessageKey, params?: TranslateParams) => string;
type LooseTranslator = (key: string, params?: TranslateParams) => string;

interface I18nContextValue {
  language: Language;
  t: Translator;
  // Para chaves montadas dinamicamente (ex.: `errors.${code}`).
  tLoose: LooseTranslator;
  // Plural pelas categorias do `Intl.PluralRules` do idioma: `key` aponta para um objeto com `one`, `few`, `many`, `other`...
  tPlural: (key: string, count: number, params?: TranslateParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface LoadedDictionary {
  language: Language;
  messages: Dictionary;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { language, ready } = usePreferences();
  // O inglês (base e reserva) já está carregado; os outros idiomas chegam sob demanda (`import()` dinâmico).
  const [loaded, setLoaded] = useState<LoadedDictionary>({ language: BASE_LANGUAGE, messages: BASE_DICTIONARY });

  useEffect(() => {
    if (loaded.language === language) return;
    let cancelled = false;
    loadDictionary(language)
      .then((messages) => {
        if (!cancelled) setLoaded({ language, messages });
      })
      .catch(() => {
        // Sem o arquivo do idioma: segue em inglês (a base), nunca com a tela quebrada.
        if (!cancelled) setLoaded({ language, messages: BASE_DICTIONARY });
      });
    return () => {
      cancelled = true;
    };
  }, [language, loaded.language]);

  const dictionaryReady = loaded.language === language;

  const value = useMemo<I18nContextValue>(() => {
    const messages = loaded.messages;
    const locale = intlLocaleOf(loaded.language);
    const tLoose: LooseTranslator = (key, params) => translate(messages, key, params, BASE_DICTIONARY);
    const tPlural = (key: string, count: number, params?: TranslateParams) =>
      translatePlural(messages, key, count, locale, params, BASE_DICTIONARY);
    return { language, t: tLoose as Translator, tLoose, tPlural };
  }, [language, loaded]);

  // Depois de renderizar no idioma certo (preferências lidas e dicionário carregado), mostra a página (ver script de bootstrap).
  useEffect(() => {
    if (ready && dictionaryReady) document.documentElement.classList.remove('i18n-pending');
  }, [ready, dictionaryReady, language]);

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
export const useLanguage = (): Language => useI18n().language;
