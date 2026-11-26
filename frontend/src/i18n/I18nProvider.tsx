'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePreferences } from '@/components/PreferencesProvider';
import type { Language } from '@/types/api';
import { BASE_DICTIONARY, loadDictionary, type Dictionary } from './dictionaries';
import { htmlLangFor } from './htmlLang';
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

// Espera antes de tentar de novo um dicionário que falhou ao carregar.
const DICTIONARY_RETRY_MS = 15000;

const I18nContext = createContext<I18nContextValue | null>(null);

interface LoadedDictionary {
  language: Language;
  messages: Dictionary;
}

// Contexto do StaticI18nProvider (o I18nProvider monta o dele inline, ao lado do carregamento sob demanda).
function buildContextValue(language: Language, messages: Dictionary): I18nContextValue {
  const locale = intlLocaleOf(language);
  const tLoose: LooseTranslator = (key, params) => translate(messages, key, params, BASE_DICTIONARY);
  const tPlural = (key: string, count: number, params?: TranslateParams) =>
    translatePlural(messages, key, count, locale, params, BASE_DICTIONARY);
  return { language, t: tLoose as Translator, tLoose, tPlural };
}

// Provedor sem usePreferences nem carregamento sob demanda (D370, 12.3a): o idioma e o dicionário vêm por props. Serve aos testes
// de componente e ao guia /design (várias colunas em idiomas diferentes). Sem messages, usa o inglês; texto ausente cai no inglês.
export function StaticI18nProvider({ language, messages, children }: { language: Language; messages?: Dictionary; children: ReactNode }) {
  const value = useMemo<I18nContextValue>(() => buildContextValue(language, messages ?? BASE_DICTIONARY), [language, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { language, ready, languageSettled } = usePreferences();
  // O inglês (base e reserva) já está carregado; os outros idiomas chegam sob demanda (`import()` dinâmico).
  const [loaded, setLoaded] = useState<LoadedDictionary>({ language: BASE_LANGUAGE, messages: BASE_DICTIONARY });
  // Idioma cujo `import()` falhou (null = nenhum): a tela segue no idioma já carregado (a base), sem travar, e tenta de novo
  // quando a janela volta ao foco ou depois de alguns segundos. Trocar de idioma também recomeça a tentativa.
  const [failedFor, setFailedFor] = useState<Language | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (loaded.language === language) return;
    let cancelled = false;
    loadDictionary(language)
      .then((messages) => {
        if (cancelled) return;
        setFailedFor(null);
        setLoaded({ language, messages });
      })
      .catch(() => {
        if (!cancelled) setFailedFor(language);
      });
    return () => {
      cancelled = true;
    };
  }, [language, loaded.language, attempt]);

  useEffect(() => {
    if (failedFor === null || failedFor !== language) return;
    const retry = () => setAttempt((n) => n + 1);
    const timer = setTimeout(retry, DICTIONARY_RETRY_MS);
    window.addEventListener('focus', retry);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', retry);
    };
  }, [failedFor, language, attempt]);

  // Pronto = o dicionário do idioma escolhido está carregado, ou o carregamento falhou (segue em inglês, sem prender a tela).
  const dictionaryReady = loaded.language === language || failedFor === language;

  // `lang` do <html> (B5, 11.11): o idioma do dicionário carregado, e não o escolhido. Se o dicionário falhar, a tela está em inglês e
  // o atributo diz inglês (leitor de tela, hifenização e fonte por idioma). Enquanto carrega, vale o que o script de abertura pôs.
  useEffect(() => {
    if (!ready) return;
    const lang = htmlLangFor(loaded.language, dictionaryReady);
    if (lang !== null) document.documentElement.setAttribute('lang', lang);
  }, [ready, dictionaryReady, loaded.language]);

  const value = useMemo<I18nContextValue>(() => {
    const messages = loaded.messages;
    // O idioma exposto é o do dicionário carregado: número/data e texto nunca ficam desencontrados durante o import().
    const locale = intlLocaleOf(loaded.language);
    const tLoose: LooseTranslator = (key, params) => translate(messages, key, params, BASE_DICTIONARY);
    const tPlural = (key: string, count: number, params?: TranslateParams) =>
      translatePlural(messages, key, count, locale, params, BASE_DICTIONARY);
    return { language: loaded.language, t: tLoose as Translator, tLoose, tPlural };
  }, [loaded]);

  // Depois de renderizar no idioma certo (preferências lidas e dicionário carregado), mostra a página (ver script de bootstrap).
  useEffect(() => {
    if (ready && languageSettled && dictionaryReady) document.documentElement.classList.remove('i18n-pending');
  }, [ready, languageSettled, dictionaryReady, language]);

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
// Código do idioma do dicionário carregado (ex.: para escolher o nome do item em pt-BR).
export const useLanguage = (): Language => useI18n().language;
// Locale do `Intl` (números, moedas, datas): sempre o do registro, nunca o código do idioma.
export const useLocale = (): string => intlLocaleOf(useI18n().language);
