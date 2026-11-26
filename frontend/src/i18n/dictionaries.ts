import en from './en.json';

export type Dictionary = typeof en;

// Dicionários sob demanda (D369): o inglês (base e reserva) fica sempre carregado; os demais são importados só quando o idioma é
// usado (`import()` dinâmico, compatível com `output: 'export'`). Acrescentar um idioma = uma linha aqui.
const LOADERS: Partial<Record<string, () => Promise<Dictionary>>> = {
  en: () => Promise.resolve(en),
  'pt-BR': () => import('./pt-BR.json').then((module) => module.default as Dictionary),
  es: () => import('./es.json').then((module) => module.default as Dictionary),
  fr: () => import('./fr.json').then((module) => module.default as Dictionary),
  it: () => import('./it.json').then((module) => module.default as Dictionary),
  de: () => import('./de.json').then((module) => module.default as Dictionary),
  ru: () => import('./ru.json').then((module) => module.default as Dictionary),
  tr: () => import('./tr.json').then((module) => module.default as Dictionary),
  pl: () => import('./pl.json').then((module) => module.default as Dictionary),
  uk: () => import('./uk.json').then((module) => module.default as Dictionary),
  'zh-CN': () => import('./zh-CN.json').then((module) => module.default as Dictionary),
  ja: () => import('./ja.json').then((module) => module.default as Dictionary),
  ko: () => import('./ko.json').then((module) => module.default as Dictionary),
};

export const BASE_DICTIONARY: Dictionary = en;

// Idioma sem loader (ex.: um backup de versão mais nova com um idioma que este app ainda não tem) devolve o inglês, sem lançar erro.
export function loadDictionary(language: string): Promise<Dictionary> {
  const loader = Object.prototype.hasOwnProperty.call(LOADERS, language) ? LOADERS[language] : undefined;
  return loader ? loader() : Promise.resolve(BASE_DICTIONARY);
}
