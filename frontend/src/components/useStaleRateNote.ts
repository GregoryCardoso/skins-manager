'use client';

import { useLocale, useT } from '@/i18n/I18nProvider';
import { formatDate } from '@/lib/format';
import { isFxRateStale } from '@/lib/fxRates';
import type { FxRateEntry } from '@/types/api';
import { usePreferences } from './PreferencesProvider';

// Texto da "cotação velha" para o `staleRateNote` do Money (12.7b, P9). Usa a regra atual do frontend (`isFxRateStale`: fonte automática
// com a data na fonte além de 3 dias); nada novo no backend. Sem cotação velha, devolve `undefined` (o Money não mostra o relógio).
export function useStaleRateNote(entry: Pick<FxRateEntry, 'source' | 'quotedAt'> | null, now: Date = new Date()): string | undefined {
  const t = useT();
  const locale = useLocale();
  if (!entry || !entry.quotedAt || !isFxRateStale(entry, now)) return undefined;
  return t('profit.staleRate', { date: formatDate(entry.quotedAt, locale) });
}

// Aviso de cotação velha para os "≈" da moeda de conversão (inventário e vendas, 12.12 M2): usa a cotação da moeda de conversão escolhida.
// `hasApprox` falso (sem "≈" na célula) não mostra nada. Fora do PreferencesProvider (testes de componentes soltos) devolve `undefined`.
export function useDisplayStaleRateNote(hasApprox: boolean = true, now: Date = new Date()): string | undefined {
  // O contexto é lido sempre (a ordem dos hooks não muda); fora do provider o usePreferences lança, e aí não há aviso.
  let prefs: ReturnType<typeof usePreferences> | null = null;
  try {
    prefs = usePreferences();
  } catch {
    prefs = null;
  }
  const rates = prefs && Array.isArray(prefs.fxRates) ? prefs.fxRates : [];
  const entry = rates.find((e) => e.currency === prefs?.displayCurrency) ?? null;
  const note = useStaleRateNote(entry, now);
  return hasApprox ? note : undefined;
}
