'use client';

import { useLocale, useT } from '@/i18n/I18nProvider';
import { formatDate } from '@/lib/format';
import { isFxRateStale } from '@/lib/fxRates';
import type { FxRateEntry } from '@/types/api';

// Texto da "cotação velha" para o `staleRateNote` do Money (12.7b, P9). Usa a regra atual do frontend (`isFxRateStale`: fonte automática
// com a data na fonte além de 3 dias); nada novo no backend. Sem cotação velha, devolve `undefined` (o Money não mostra o relógio).
export function useStaleRateNote(entry: Pick<FxRateEntry, 'source' | 'quotedAt'> | null, now: Date = new Date()): string | undefined {
  const t = useT();
  const locale = useLocale();
  if (!entry || !entry.quotedAt || !isFxRateStale(entry, now)) return undefined;
  return t('profit.staleRate', { date: formatDate(entry.quotedAt, locale) });
}
