// Interpreta um número digitado ("5,40" em pt-BR, "5.40" em en). Devolve null se inválido ou <= 0.
export function parseDecimalInput(text: string, language: string): number | null {
  const raw = text.trim().replace(/\s+/g, '');
  if (raw === '') return null;
  let normalized: string;
  if (language === 'pt-BR') {
    // "1.234,56" -> "1234.56"; aceita também "5.40" quando não há vírgula.
    normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  } else {
    // "1,234.56" -> "1234.56"; aceita também "5,40" quando não há ponto.
    normalized = raw.includes('.') ? raw.replace(/,/g, '') : raw.replace(',', '.');
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Texto para preencher o campo de edição no formato do idioma.
export function formatDecimalInput(value: number, language: string): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 6, useGrouping: false }).format(value);
}
