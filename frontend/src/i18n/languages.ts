// Registro único de idiomas do frontend (D369, 11.1). Acrescentar um idioma = um JSON em `src/i18n/`, uma entrada aqui, uma entrada
// em `loadDictionary` (dictionaries.ts) e uma entrada em `MESSAGES` do desktop (desktop/src/i18n.js), sem migração. Um idioma só entra
// neste registro (e, portanto, no seletor) quando o arquivo dele está completo: o teste `i18n.languages.parity.test.ts` roda sobre o registro.
// O inglês é o idioma base: referência das chaves (tipo `MessageKey`) e reserva quando falta um texto.

export interface LanguageInfo {
  // Código gravado nas configurações (`settings.language`) e usado como nome do arquivo de tradução.
  readonly code: string;
  // Nome do idioma escrito nele mesmo, sem tradução (aparece no seletor).
  readonly nativeName: string;
  // Locale do `Intl` (números, moedas, datas, plural).
  readonly intlLocale: string;
  // Pasta do idioma na CSGO-API (nomes dos itens; usado a partir da 11.5).
  readonly catalogFolder: string;
}

export const LANGUAGE_REGISTRY = [
  { code: 'en', nativeName: 'English', intlLocale: 'en', catalogFolder: 'en' },
  { code: 'pt-BR', nativeName: 'Português (Brasil)', intlLocale: 'pt-BR', catalogFolder: 'pt-BR' },
] as const satisfies readonly LanguageInfo[];

export type Language = (typeof LANGUAGE_REGISTRY)[number]['code'];

// Idioma base: o do HTML pré-gerado, o das chaves e a reserva de qualquer texto ausente.
export const BASE_LANGUAGE: Language = 'en';

export const LANGUAGES: readonly Language[] = LANGUAGE_REGISTRY.map((entry) => entry.code);

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

export function languageInfo(code: string): LanguageInfo {
  return LANGUAGE_REGISTRY.find((entry) => entry.code === code) ?? LANGUAGE_REGISTRY[0];
}

// Locale do `Intl` de um código (desconhecido -> o do inglês).
export function intlLocaleOf(code: string): string {
  return languageInfo(code).intlLocale;
}

// Idioma do sistema/navegador -> um idioma disponível. Percorre a lista em ordem de preferência (ex.: `navigator.languages`):
// primeiro o código exato (sem diferenciar maiúsculas, "_" = "-"), depois o mesmo idioma de outra região ("pt-PT" -> "pt-BR").
// O chinês tradicional (zh-TW, zh-HK, zh-MO, zh-Hant) nunca vira o simplificado. Sem correspondência, `fallback` (o inglês).
// ATENÇÃO: a função é serializada no script do <head> (bootstrapScript) e precisa ser autossuficiente: não referencie nada de fora.
export function matchLanguage(locales: readonly string[], available: readonly string[], fallback: string): string {
  for (const raw of locales) {
    if (typeof raw !== 'string') continue;
    const wanted = raw.trim().replace(/_/g, '-').toLowerCase();
    if (wanted === '') continue;
    const exact = available.find((code) => code.toLowerCase() === wanted);
    if (exact) return exact;
    const parts = wanted.split('-');
    const base = parts[0];
    if (base === 'zh' && parts.slice(1).some((part) => part === 'hant' || part === 'tw' || part === 'hk' || part === 'mo')) continue;
    const sameBase = available.filter((code) => code.toLowerCase().split('-')[0] === base);
    if (sameBase.length > 0) return sameBase.find((code) => code.toLowerCase() === base) || sameBase[0];
  }
  return fallback;
}

// Idioma inicial de uma instalação nova: o do navegador/Windows, se for um dos disponíveis; senão, o inglês.
export function detectLanguage(locales: readonly string[]): Language {
  return matchLanguage(locales, LANGUAGES, BASE_LANGUAGE) as Language;
}

export function browserLocales(): string[] {
  try {
    if (typeof navigator === 'undefined') return [];
    const list = Array.isArray(navigator.languages) ? [...navigator.languages] : [];
    if (navigator.language) list.push(navigator.language);
    return list;
  } catch {
    return [];
  }
}
