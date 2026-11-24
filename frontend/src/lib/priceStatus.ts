// O que o indicador de preços diz (10.6, D365 item 5). Função pura: nada de texto aqui.
import type { MarketValueSummary } from '@/types/api';

export type PriceStatusKind = 'REFRESHING' | 'NOT_CONFIGURED' | 'FAILED' | 'UPDATED' | 'HIDDEN' | 'NEVER';

export interface PriceStatusView {
  kind: PriceStatusKind;
  // Quando os preços foram gravados pela última vez (`lastRefreshAt`); nulo se nunca.
  at: string | null;
  // Código do erro da última rodada (só em `FAILED`).
  errorCode: string | null;
}

// Precedência: rodando ganha de tudo; sem chave ganha de `FAILED`; `PARTIAL` aparece como `UPDATED`; sem unidades em estoque some.
export function priceStatusView({ summary, refreshing }: { summary: MarketValueSummary | null | undefined; refreshing: boolean; now?: Date }): PriceStatusView {
  if (refreshing || summary?.inProgress) return { kind: 'REFRESHING', at: summary?.lastRefreshAt ?? null, errorCode: null };
  if (!summary) return { kind: 'HIDDEN', at: null, errorCode: null };
  if (!summary.configured) return { kind: 'NOT_CONFIGURED', at: summary.lastRefreshAt, errorCode: null };
  if (summary.lastRun?.status === 'FAILED') return { kind: 'FAILED', at: summary.lastRefreshAt, errorCode: summary.lastRun.errorCode };
  if (summary.lastRefreshAt) return { kind: 'UPDATED', at: summary.lastRefreshAt, errorCode: null };
  if (summary.totals.unitCount === 0) return { kind: 'HIDDEN', at: null, errorCode: null };
  return { kind: 'NEVER', at: null, errorCode: null };
}
