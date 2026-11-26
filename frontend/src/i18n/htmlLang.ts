// Idioma do atributo `lang` do <html> (B5, 11.11): o do dicionário realmente carregado; `null` = ainda carregando (nada a mudar).
export function htmlLangFor(loadedLanguage: string, dictionaryReady: boolean): string | null {
  return dictionaryReady ? loadedLanguage : null;
}
