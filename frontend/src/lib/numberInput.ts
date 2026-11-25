import { LANGUAGE_REGISTRY } from '@/i18n/languages';

// O idioma usa vírgula como separador decimal? Vem do `Intl` do locale do registro (D369), e não de uma lista de idiomas:
// de, fr, es, ru, pl, uk, tr, it, pt-BR... usam vírgula; en, ja, ko e zh-CN usam ponto.
export function usesCommaDecimal(language: string): boolean {
  try {
    // Idioma do registro: o locale dele. Outro código (idiomas ainda fora do registro): ele mesmo, se o Intl o conhece; senão, o inglês.
    const entry = LANGUAGE_REGISTRY.find((item) => item.code === language);
    const locale = entry ? entry.intlLocale : Intl.NumberFormat.supportedLocalesOf([language]).length > 0 ? language : 'en';
    const parts = new Intl.NumberFormat(locale).formatToParts(1.5);
    return parts.find((part) => part.type === 'decimal')?.value === ',';
  } catch {
    return false;
  }
}

// Interpreta um número digitado ("5,40" em pt-BR, "5.40" em en). Devolve null se inválido ou <= 0.
export function parseDecimalInput(text: string, language: string): number | null {
  const raw = text.trim().replace(/\s+/g, '');
  if (raw === '') return null;
  let normalized: string;
  if (usesCommaDecimal(language)) {
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

// Normaliza o texto digitado para o formato "1234.56" (ponto decimal), sem validar o resto.
export function normalizeNumberText(text: string, language: string): string {
  const raw = text.trim().replace(/\s+/g, '');
  if (usesCommaDecimal(language)) return raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  return raw.includes('.') ? raw.replace(/,/g, '') : raw.replace(',', '.');
}

// Dinheiro digitado -> centavos inteiros ("1,25" / "1.25" -> 125; "1.234,56" em pt-BR -> 123456).
// Zero é aceito (custo 0). Mais de 2 casas decimais, negativo ou texto -> null (nunca arredonda em silêncio).
export function parseMoneyToCents(text: string, language: string): number | null {
  const normalized = normalizeNumberText(text, language);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) ? cents : null;
}

// Centavos -> texto de edição no formato do idioma, sempre com 2 casas ("1,25" / "1.25").
export function formatCentsInput(cents: number, language: string): string {
  return new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(cents / 100);
}

// Float digitado (>= 0, qualquer quantidade de casas). A faixa é validada pelo backend. Inválido -> null.
export function parseFloatInput(text: string, language: string): number | null {
  const normalized = normalizeNumberText(text, language);
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// Inteiro sem sinal (paint seed). Inválido -> null.
export function parseIntegerInput(text: string): number | null {
  const raw = text.trim();
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
