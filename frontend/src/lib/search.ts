// Busca local sem acento e sem caixa (D370, 12.3a): o Combobox compara o texto digitado com rótulo, valor e palavras-chave.
// Funciona em CJK (sem segmentar palavras: é busca "contém") e trata o İ/ı do turco.
export function normalizeForSearch(text: string, locale: string): string {
  let lower: string;
  try {
    lower = text.toLocaleLowerCase(locale);
  } catch {
    lower = text.toLowerCase();
  }
  // NFD separa as letras dos acentos (\p{M}); o "ı" turco (sem ponto) não decompõe, então vira "i" nos dois lados da comparação.
  return lower.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').replace(/ı/g, 'i').trim();
}

// O texto digitado (já normalizado) está contido em algum dos campos? Consulta vazia casa com tudo.
export function matchesSearch(query: string, fields: readonly string[], locale: string): boolean {
  const needle = normalizeForSearch(query, locale);
  if (needle === '') return true;
  return fields.some((field) => normalizeForSearch(field, locale).includes(needle));
}
