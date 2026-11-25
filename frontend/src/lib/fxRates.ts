// Cotações por moeda na tela de configurações (D369, 11.3): puro e testável. Quais moedas aparecem, em que ordem, o que é uma cotação
// "antiga" e quais moedas a atualização ao abrir o app percorre. O frontend não calcula nada de dinheiro (D74): só escolhe o que mostrar.
import type { FxRateEntry, FxRefreshSource } from '@/types/api';

// Cotação de fonte automática com data na fonte mais velha que isto é "antiga" (destaque discreto). Três dias cobrem um fim de semana
// (a sexta vale até a segunda); UAH, KZT e CNY costumam vir com a data de dias atrás.
export const FX_STALE_AFTER_DAYS = 3;

const DAY_MS = 86_400_000;

// Dias inteiros desde a data (nulo sem data ou inválida; nunca negativo).
export function fxRateAgeDays(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
}

// "Antiga": cotação de fonte automática (a digitada à mão não tem data na fonte) com a data na fonte além do limite.
export function isFxRateStale(entry: Pick<FxRateEntry, 'source' | 'quotedAt'> | null, now: Date): boolean {
  if (!entry || entry.source === null || entry.source === 'MANUAL') return false;
  const age = fxRateAgeDays(entry.quotedAt, now);
  return age !== null && age > FX_STALE_AFTER_DAYS;
}

export interface FxRow {
  currency: string;
  // Cotação gravada (nula = nunca houve, ou a linha existe sem valor).
  entry: FxRateEntry | null;
  rate: number | null;
  // É a moeda de conversão escolhida (vai primeiro, com selo).
  isDisplay: boolean;
  stale: boolean;
  ageDays: number | null;
  // Fontes que o botão "atualizar" aceita: o BRL tem as duas (comercial e PTAX); as demais só a comercial.
  sources: readonly FxRefreshSource[];
}

export function fxSourcesFor(currency: string): readonly FxRefreshSource[] {
  return currency === 'BRL' ? ['AWESOMEAPI', 'PTAX'] : ['AWESOMEAPI'];
}

// Uma linha por moeda que precisa de cotação (`requiredFxCurrencies`), a de conversão primeiro e as outras em ordem alfabética.
export function buildFxRows(required: readonly string[], rates: readonly FxRateEntry[], displayCurrency: string, now: Date): FxRow[] {
  const byCurrency = new Map(rates.map((entry) => [entry.currency, entry]));
  const rows = [...new Set(required)].filter((currency) => currency !== 'USD').map((currency): FxRow => {
    const entry = byCurrency.get(currency) ?? null;
    return {
      currency,
      entry,
      rate: entry?.rate ?? null,
      isDisplay: currency === displayCurrency,
      stale: isFxRateStale(entry, now),
      ageDays: entry ? fxRateAgeDays(entry.quotedAt, now) : null,
      sources: fxSourcesFor(currency),
    };
  });
  return rows.sort((a, b) => Number(b.isDisplay) - Number(a.isDisplay) || a.currency.localeCompare(b.currency));
}

// Moedas que a atualização ao abrir o app percorre, em série: todas as necessárias, menos a digitada à mão (nunca sobrescrita, D338).
export function currenciesToAutoRefresh(required: readonly string[], rates: readonly FxRateEntry[]): string[] {
  const manual = new Set(rates.filter((entry) => entry.source === 'MANUAL').map((entry) => entry.currency));
  return [...new Set(required)].filter((currency) => currency !== 'USD' && !manual.has(currency)).sort();
}

// Cotações gravadas como mapa moeda -> cotação (só as que têm valor): o padrão dos formulários de compra e venda (11.4).
export function ratesRecord(fxRates: ReadonlyArray<{ currency: string; rate: number | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of fxRates) if (entry.rate !== null && entry.rate > 0) out[entry.currency] = entry.rate;
  return out;
}
