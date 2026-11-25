import { formatDate, formatRate } from './format';
import type { FxRateSource } from '@/types/api';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface FxRateInfo {
  rate: number;
  // Moeda da cotação ("unidades desta moeda por 1 US$"); sem ela, BRL (o caso do aviso do lucro real, que fala do BRL).
  currency?: string;
  source: FxRateSource | null;
  // Data/hora da cotação na fonte (nula com origem MANUAL) e da última gravação (edição manual).
  quotedAt: string | null;
  updatedAt: string | null;
}

// Rótulo curto da fonte ("Comercial", "PTAX", "Manual"); null sem fonte (D162).
export function fxSourceShort(source: FxRateSource | null, t: Translate): string | null {
  return source ? t(`fx.sourceShort.${source}`) : null;
}

// Nome completo da fonte, para a dica.
export function fxSourceName(source: FxRateSource | null, t: Translate): string | null {
  return source ? t(`fx.sourceName.${source}`) : null;
}

// Data/hora da cotação (dica do cabeçalho): data da fonte, ou "editada em" com a gravação manual.
export function fxDateText(info: Pick<FxRateInfo, 'source' | 'quotedAt' | 'updatedAt'>, locale: string, t: Translate): string | null {
  if (info.source === 'MANUAL') {
    return info.updatedAt ? t('fx.editedAt', { date: formatDate(info.updatedAt, locale) }) : null;
  }
  return info.quotedAt ? formatDate(info.quotedAt, locale) : null;
}

// Exibição sempre com fonte e data/hora (D162):
// "R$ 5,1254 · Comercial · 20/11/2026 12:00", "R$ 5,3012 · PTAX de 19/11/2026 13:04" ou "R$ 5,50 · Manual · editada em 20/11/2026 10:15".
export function describeFxRate(info: FxRateInfo, locale: string, t: Translate): string {
  const parts = [formatRate(info.rate, locale, info.currency ?? 'BRL')];
  if (info.source === 'PTAX') {
    parts.push(info.quotedAt ? t('fx.ptaxOf', { date: formatDate(info.quotedAt, locale) }) : t('fx.sourceShort.PTAX'));
    return parts.join(' · ');
  }
  const short = fxSourceShort(info.source, t);
  if (short) parts.push(short);
  const date = fxDateText(info, locale, t);
  if (date) parts.push(date);
  return parts.join(' · ');
}
