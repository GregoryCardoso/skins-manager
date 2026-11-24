// O que as células de valor de mercado mostram (10.6, D365 item 6). Funções puras: só escolhem o estado e repassam os números que o
// backend já calculou; nada é somado nem convertido aqui. Stickers e patches nunca entram no valor (são só informativos).
import type { MarketValue, MarketValueReason, MarketValueTotals, NetUnavailableReason } from '@/types/api';

export type UnitMarketCellView =
  | { kind: 'NONE' }
  | {
    kind: 'OK';
    usdCents: number;
    brlCents: number | null;
    pricedAt: string | null;
    stale: boolean;
    incomplete: boolean;
    parts: { itemCents: number | null; hangingCents: number | null; stickersInfoCents: number; patchesInfoCents: number };
  }
  | { kind: 'NO_PRICE'; reason: 'NOT_FETCHED' | 'NOT_FOUND' }
  | { kind: 'NOT_PRICEABLE'; reason: Exclude<MarketValueReason, 'NOT_FETCHED' | 'NOT_FOUND'> };

export function unitMarketCell(marketValue: MarketValue | null | undefined): UnitMarketCellView {
  if (!marketValue) return { kind: 'NONE' };
  if (marketValue.status === 'OK' && marketValue.marketValueUsdCents !== null) {
    return {
      kind: 'OK',
      usdCents: marketValue.marketValueUsdCents,
      brlCents: marketValue.approxBrl.marketValue,
      pricedAt: marketValue.pricedAt,
      stale: marketValue.isStale,
      incomplete: !marketValue.isComplete,
      parts: {
        itemCents: marketValue.parts.baseCents,
        hangingCents: marketValue.parts.hangingCents,
        stickersInfoCents: marketValue.parts.stickersInfoCents,
        patchesInfoCents: marketValue.parts.patchesInfoCents,
      },
    };
  }
  if (marketValue.status === 'NO_PRICE') return { kind: 'NO_PRICE', reason: marketValue.reason === 'NOT_FOUND' ? 'NOT_FOUND' : 'NOT_FETCHED' };
  if (marketValue.status === 'NOT_PRICEABLE') {
    const reason = marketValue.reason;
    return { kind: 'NOT_PRICEABLE', reason: reason === null || reason === 'NOT_FETCHED' || reason === 'NOT_FOUND' ? 'NOT_PRICEABLE' : reason };
  }
  return { kind: 'NONE' };
}

export type Sign = 'POSITIVE' | 'NEGATIVE' | 'ZERO';
export const signOf = (cents: number): Sign => (cents > 0 ? 'POSITIVE' : cents < 0 ? 'NEGATIVE' : 'ZERO');

export type UnrealizedCellView =
  | { kind: 'NONE' }
  | { kind: 'NET'; cents: number; brlCents: number | null; sign: Sign; grossCents: number | null }
  | { kind: 'NET_UNAVAILABLE'; reason: NetUnavailableReason | null; grossCents: number | null };

// Principal = líquido da taxa de venda da loja da integração (2.13). Sem o líquido: "—" com o motivo e o bruto na dica (E-P2-Q57).
export function unitUnrealizedCell(marketValue: MarketValue | null | undefined): UnrealizedCellView {
  if (!marketValue || marketValue.status !== 'OK' || marketValue.costUsdCents === null) return { kind: 'NONE' };
  if (marketValue.unrealizedNetUsdCents !== null) {
    return {
      kind: 'NET',
      cents: marketValue.unrealizedNetUsdCents,
      brlCents: marketValue.approxBrl.unrealizedNet,
      sign: signOf(marketValue.unrealizedNetUsdCents),
      grossCents: marketValue.unrealizedUsdCents,
    };
  }
  return { kind: 'NET_UNAVAILABLE', reason: marketValue.netUnavailableReason ?? 'NET_NOT_COMPUTABLE', grossCents: marketValue.unrealizedUsdCents };
}

export type GroupMarketCellView =
  | { kind: 'NONE' }
  | { kind: 'NO_PRICE'; unpricedUnits: number; notPriceableUnits: number }
  | { kind: 'NOT_PRICEABLE'; unpricedUnits: number; notPriceableUnits: number }
  | { kind: 'OK'; usdCents: number; brlCents: number | null; pricedUnits: number; unitCount: number; partial: boolean; staleUnits: number };

export function groupMarketCell(totals: MarketValueTotals | null | undefined): GroupMarketCellView {
  if (!totals || totals.unitCount === 0) return { kind: 'NONE' };
  if (totals.pricedUnits === 0) {
    // Nenhuma unidade com preço: "sem avaliação" só quando todas são inavaliáveis; senão "sem preço".
    const allNotPriceable = totals.unpricedUnits === 0 && totals.notPriceableUnits > 0;
    const counts = { unpricedUnits: totals.unpricedUnits, notPriceableUnits: totals.notPriceableUnits };
    return allNotPriceable ? { kind: 'NOT_PRICEABLE', ...counts } : { kind: 'NO_PRICE', ...counts };
  }
  return {
    kind: 'OK',
    usdCents: totals.marketValueUsdCents,
    brlCents: totals.approxBrl.marketValue,
    pricedUnits: totals.pricedUnits,
    unitCount: totals.unitCount,
    partial: totals.pricedUnits < totals.unitCount,
    staleUnits: totals.staleUnits,
  };
}

export type GroupUnrealizedCellView =
  | { kind: 'NONE' }
  | { kind: 'NET'; cents: number; brlCents: number | null; sign: Sign; partial: boolean; grossCents: number }
  | { kind: 'NET_UNAVAILABLE'; grossCents: number };

// Soma só das unidades com preço. `netUnits = pricedUnits` -> completo; entre 0 e `pricedUnits` -> parcial; 0 -> "—" com o bruto na dica.
export function groupUnrealizedCell(totals: MarketValueTotals | null | undefined): GroupUnrealizedCellView {
  if (!totals || totals.unitCount === 0 || totals.pricedUnits === 0) return { kind: 'NONE' };
  if (totals.netUnits === 0) return { kind: 'NET_UNAVAILABLE', grossCents: totals.unrealizedUsdCents };
  return {
    kind: 'NET',
    cents: totals.unrealizedNetUsdCents,
    brlCents: totals.approxBrl.unrealizedNet,
    sign: signOf(totals.unrealizedNetUsdCents),
    partial: totals.netUnits < totals.pricedUnits,
    grossCents: totals.unrealizedUsdCents,
  };
}

export interface TabSummaryView {
  usdCents: number;
  brlCents: number | null;
  // Não realizado líquido; nulo quando nenhuma unidade tem líquido.
  netCents: number | null;
  netBrlCents: number | null;
  netSign: Sign | null;
  pricedUnits: number;
  unitCount: number;
}

// Linha de resumo acima da tabela (T102). Some sem unidades ou sem nenhuma com preço.
export function tabSummary(totals: MarketValueTotals | null | undefined): TabSummaryView | null {
  if (!totals || totals.unitCount === 0 || totals.pricedUnits === 0) return null;
  const hasNet = totals.netUnits > 0;
  return {
    usdCents: totals.marketValueUsdCents,
    brlCents: totals.approxBrl.marketValue,
    netCents: hasNet ? totals.unrealizedNetUsdCents : null,
    netBrlCents: hasNet ? totals.approxBrl.unrealizedNet : null,
    netSign: hasNet ? signOf(totals.unrealizedNetUsdCents) : null,
    pricedUnits: totals.pricedUnits,
    unitCount: totals.unitCount,
  };
}

export type ProfitCardView =
  | { kind: 'NO_PRICE' }
  | { kind: 'OK'; usdCents: number; brlCents: number | null; pricedUnits: number; unitCount: number; staleUnits: number };

// Card de valor do Lucro real: sem unidade com preço, "sem preço", nunca US$ 0,00.
export function profitValueCard(totals: MarketValueTotals): ProfitCardView {
  if (totals.pricedUnits === 0) return { kind: 'NO_PRICE' };
  return {
    kind: 'OK', usdCents: totals.marketValueUsdCents, brlCents: totals.approxBrl.marketValue,
    pricedUnits: totals.pricedUnits, unitCount: totals.unitCount, staleUnits: totals.staleUnits,
  };
}

export type ProfitUnrealizedView =
  | { kind: 'NO_PRICE' }
  | { kind: 'UNAVAILABLE'; grossCents: number }
  | { kind: 'NET'; cents: number; brlCents: number | null; sign: Sign; partial: boolean; grossCents: number };

// Card "Lucro não realizado": líquido; sem nenhum líquido, "indisponível" com o bruto na dica; parcial com "(parcial)".
export function profitUnrealizedCard(totals: MarketValueTotals): ProfitUnrealizedView {
  if (totals.pricedUnits === 0) return { kind: 'NO_PRICE' };
  if (totals.netUnits === 0) return { kind: 'UNAVAILABLE', grossCents: totals.unrealizedUsdCents };
  return {
    kind: 'NET', cents: totals.unrealizedNetUsdCents, brlCents: totals.approxBrl.unrealizedNet, sign: signOf(totals.unrealizedNetUsdCents),
    partial: totals.netUnits < totals.pricedUnits, grossCents: totals.unrealizedUsdCents,
  };
}
