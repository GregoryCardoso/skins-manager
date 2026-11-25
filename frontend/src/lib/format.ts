import { hasNoDecimals } from '@/lib/currencies';

export function formatDateTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}

export function formatInteger(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

// Valor em "centavos" (1/100 da unidade) de qualquer das 17 moedas. JPY, KRW e CLP saem sem casas decimais (o valor já vem do backend
// arredondado para a unidade); as demais, com 2.
export function formatMoney(cents: number, currency: string, locale: string): string {
  const digits = hasNoDecimals(currency) ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {};
  return new Intl.NumberFormat(locale, { style: 'currency', currency, ...digits }).format(cents / 100);
}

// Valor aproximado na moeda de conversão (calculado no backend, D101): 2 casas (D104), 0 nas moedas sem casas.
export function formatApprox(approx: { currency: string; cents: number }, locale: string): string {
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

// Cotação ("unidades da moeda por 1 US$") na moeda dela, com 2 a 4 casas decimais ("R$ 5,40", "R$ 5,4123", "¥ 151,23"). Sem moeda, BRL.
export function formatRate(rate: number, locale: string, currency: string = 'BRL'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(rate);
}

// Razão (0,7754 -> "77,5%") com uma casa decimal, no idioma da tela.
export function formatPercent(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(ratio);
}

export type AgoUnit = 'LESS_THAN_MINUTE' | 'MINUTES' | 'HOURS' | 'DAYS';

// Há quanto tempo (puro): menos de 1 min, minutos, horas, dias. Data no futuro (relógio adiantado) ou inválida -> "menos de 1 min".
export function agoParts(iso: string, now: Date): { unit: AgoUnit; count: number } {
  const time = Date.parse(iso);
  const diff = Number.isNaN(time) ? 0 : now.getTime() - time;
  if (diff < 60000) return { unit: 'LESS_THAN_MINUTE', count: 0 };
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return { unit: 'MINUTES', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'HOURS', count: hours };
  return { unit: 'DAYS', count: Math.floor(hours / 24) };
}

const AGO_KEYS: Record<AgoUnit, string> = {
  LESS_THAN_MINUTE: 'common.ago.lessThanMinute',
  MINUTES: 'common.ago.minutes',
  HOURS: 'common.ago.hours',
  DAYS: 'common.ago.days',
};

// "5 min", "3 h", "2 d" ou "menos de 1 min", pelo `t` do idioma (as chaves `common.ago.*`). Sem relógio próprio: quem chama recalcula
// a cada renderização.
export function formatAgo(iso: string, now: Date, t: (key: string, params?: Record<string, string | number>) => string): string {
  const { unit, count } = agoParts(iso, now);
  return t(AGO_KEYS[unit], { count });
}
