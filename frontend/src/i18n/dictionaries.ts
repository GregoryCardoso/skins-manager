import en from './en.json';
import type { Language } from './languages';

export type Dictionary = typeof en;

// Dicionários sob demanda (D369): o inglês (base e reserva) fica sempre carregado; os demais são importados só quando o idioma é
// usado (`import()` dinâmico, compatível com `output: 'export'`). Acrescentar um idioma = uma linha aqui.
const LOADERS: Record<Language, () => Promise<Dictionary>> = {
  en: () => Promise.resolve(en),
  'pt-BR': () => import('./pt-BR.json').then((module) => module.default as Dictionary),
};

export const BASE_DICTIONARY: Dictionary = en;

export function loadDictionary(language: Language): Promise<Dictionary> {
  return LOADERS[language]();
}
