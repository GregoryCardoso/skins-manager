export function formatDateTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}

export function formatInteger(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

export function formatMoney(cents: number, currency: 'USD' | 'BRL', locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

// Valor aproximado na outra moeda (calculado no backend, D101); sempre 2 casas decimais (D104).
export function formatApprox(approx: { currency: 'USD' | 'BRL'; cents: number }, locale: string): string {
  return formatMoney(approx.cents, approx.currency, locale);
}

// Float exatamente como gravado, sem arredondar.
export function formatFloat(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 20, useGrouping: false }).format(value);
}

export function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export interface RemainingParts {
  d: number;
  h: number;
  min: number;
}

// Mesmas regras de D39: minutos com `ceil` (nunca 0 enquanto bloqueado).
export function formatRemaining(ms: number): RemainingParts {
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  return { d: Math.floor(totalMin / 1440), h: Math.floor((totalMin % 1440) / 60), min: totalMin % 60 };
}

// Omite unidades zeradas à esquerda: "3h 0min", "1d 5h 0min", "12min".
export function remainingToText(parts: RemainingParts, units: { d: string; h: string; min: string }): string {
  const out: string[] = [];
  if (parts.d > 0) out.push(`${parts.d}${units.d}`);
  if (parts.d > 0 || parts.h > 0) out.push(`${parts.h}${units.h}`);
  out.push(`${parts.min}${units.min}`);
  return out.join(' ');
}

// Cotação em reais com 2 a 4 casas decimais ("R$ 5,40", "R$ 5,4123").
export function formatRate(rate: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(rate);
}

// Razão (0,7754 -> "77,5%") com uma casa decimal, no idioma da tela.
export function formatPercent(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(ratio);
}
