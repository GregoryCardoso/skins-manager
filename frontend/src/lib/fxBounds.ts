// Faixa aceita para a cotação digitada à mão (12.8). A faixa vem do backend (`settings.fxManualRateBounds`); aqui só se compara e se
// formata. Quem valida de verdade é o servidor: o aviso local nunca bloqueia o envio.
import { intlLocaleOf } from '@/i18n/languages';

export interface FxBounds {
  min: number;
  max: number;
}

export type FxBoundsMap = Record<string, FxBounds> | undefined | null;

export function boundsFor(map: FxBoundsMap, currency: string): FxBounds | null {
  const entry = map?.[currency];
  return entry && Number.isFinite(entry.min) && Number.isFinite(entry.max) ? entry : null;
}

// "0,5" e "100"; "1.500" para valores grandes. Até 6 algarismos significativos, sem zeros à toa.
export function formatBound(value: number, locale: string): string {
  return new Intl.NumberFormat(intlLocaleOf(locale), { maximumSignificantDigits: 6 }).format(value);
}

export function boundsParams(bounds: FxBounds, locale: string): { min: string; max: string } {
  return { min: formatBound(bounds.min, locale), max: formatBound(bounds.max, locale) };
}

// Fora da faixa (só a comparação). Sem faixa conhecida ou sem número, nunca avisa.
export function isOutOfBounds(rate: number | null, bounds: FxBounds | null): boolean {
  if (rate === null || bounds === null) return false;
  return rate < bounds.min || rate > bounds.max;
}
