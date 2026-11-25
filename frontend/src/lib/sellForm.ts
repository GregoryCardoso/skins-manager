// Lógica pura do formulário de venda (D117 + revisão D122). O cálculo do líquido é do backend
// (`GET /stores/:id/sale-quote`); aqui só se decide visibilidade, rótulos e o corpo enviado.
import { localInputToIso } from '@/lib/dateInput';
import { defaultRateFor } from '@/lib/itemForm';
import { formatCentsInput, formatDecimalInput, parseDecimalInput, parseMoneyToCents } from '@/lib/numberInput';
import type { ItemView, MinPrice, SellBody, Store } from '@/types/api';

export interface SellFormState {
  storeId: number | null;
  priceText: string;
  // datetime-local (hora local)
  soldAt: string;
  fxText: string;
  netText: string;
  // O usuário editou o líquido: ele deixa de acompanhar o preço e a prévia (D122).
  netTouched: boolean;
}

export type SellFormErrors = Partial<Record<string, string>>;
export type SellBuildResult = { ok: true; body: SellBody } | { ok: false; errors: SellFormErrors };

// Chave de tradução do rótulo do preço: ADDED = preço pago pelo comprador; senão preço de venda (D36).
export function priceLabelKey(store: Store | undefined): 'sellForm.salePriceAdded' | 'sellForm.salePriceDeducted' {
  return store?.saleFeeType === 'ADDED' ? 'sellForm.salePriceAdded' : 'sellForm.salePriceDeducted';
}

// Cotação em loja de qualquer moeda diferente de USD (2.9, D369).
export const needsFx = (store: Store | undefined): boolean => store !== undefined && store.currency !== 'USD';

export const feesConfigured = (store: Store | undefined): boolean => store?.saleFeesConfigured === true;

export type PriceReference =
  | { kind: 'none' }
  // Loja inativa não vem em `minPrices` (D36).
  | { kind: 'inactive' }
  | { kind: 'warning'; warningCode: MinPrice['warningCode']; warning: string | null }
  | { kind: 'price'; entry: MinPrice };

// Preço mínimo da loja escolhida, lido de `item.minPrices` (sem endpoint novo).
export function referenceFor(item: ItemView, store: Store | undefined): PriceReference {
  if (!store || !item.minPrices) return { kind: 'none' };
  const entry = item.minPrices.find((m) => m.storeId === store.id);
  if (!entry) return store.isActive ? { kind: 'none' } : { kind: 'inactive' };
  if (entry.minPriceCents === null) return { kind: 'warning', warningCode: entry.warningCode, warning: entry.warning };
  return { kind: 'price', entry };
}

export interface SellContext {
  stores: Store[];
  // Cotação do BRL (legado); desde a 11.4 o padrão de cada moeda vem de `rates`.
  usdBrlRate: number | null;
  rates?: Readonly<Record<string, number>>;
  language: string;
}

export function initialSellState(ctx: SellContext, nowLocal: string): SellFormState {
  const { stores, language } = ctx;
  const primary = stores.find((s) => s.isPrimary) ?? stores[0] ?? null;
  return {
    storeId: primary ? primary.id : null,
    priceText: '',
    soldAt: nowLocal,
    fxText: rateText(ctx, primary ?? undefined),
    netText: '',
    netTouched: false,
  };
}

const rateText = (ctx: SellContext, store: Store | undefined): string => {
  const rate = defaultRateFor(ctx, store?.currency);
  return rate !== null ? formatDecimalInput(rate, ctx.language) : '';
};

// Trocar de loja: pré-preenche a cotação (loja fora de USD) e devolve o líquido ao modo "acompanha o cálculo".
export function applySaleStore(state: SellFormState, storeId: number | null, ctx: SellContext): SellFormState {
  const store = ctx.stores.find((s) => s.id === storeId);
  const fxText = needsFx(store)
    ? (state.fxText.trim() !== '' ? state.fxText : rateText(ctx, store))
    : '';
  return { ...state, storeId, fxText, netText: '', netTouched: false };
}

// Texto do líquido calculado pela prévia (centavos na moeda da loja); sem prévia -> vazio.
export function netTextFromQuote(netReceivedCents: number | null, language: string, currency?: string): string {
  return netReceivedCents === null ? '' : formatCentsInput(netReceivedCents, language, currency);
}

// "Recalcular": volta a acompanhar o valor calculado.
export function recalculate(state: SellFormState, quoteNetCents: number | null, language: string, currency?: string): SellFormState {
  return { ...state, netTouched: false, netText: netTextFromQuote(quoteNetCents, language, currency) };
}

// Corpo da venda. `quoteNetCents`: último líquido calculado pela prévia (null se não há).
// Loja com taxa: `netReceivedCents` só vai se o usuário mudou o valor calculado.
// Loja sem taxa: sempre vai quando preenchido (o backend recusa a ausência com FEES_NOT_CONFIGURED no campo).
export function buildSellBody(
  state: SellFormState,
  ctx: SellContext,
  quoteNetCents: number | null,
): SellBuildResult {
  const errors: SellFormErrors = {};
  const store = ctx.stores.find((s) => s.id === state.storeId);
  if (!store) errors.saleStoreId = 'sellForm.chooseStore';

  let priceCents: number | null = null;
  if (state.priceText.trim() === '') errors.salePriceCents = 'sellForm.priceRequired';
  else {
    priceCents = parseMoneyToCents(state.priceText, ctx.language, store?.currency);
    if (priceCents === null || priceCents <= 0) errors.salePriceCents = 'itemForm.invalidMoney';
  }

  const soldIso = state.soldAt.trim() === '' ? null : localInputToIso(state.soldAt);
  if (soldIso === null) errors.soldAt = 'itemForm.invalidDate';

  let fxRate: number | null = null;
  if (needsFx(store) && state.fxText.trim() !== '') {
    fxRate = parseDecimalInput(state.fxText, ctx.language);
    if (fxRate === null) errors.fxRateAtSale = 'itemForm.invalidNumber';
  }

  let netCents: number | null = null;
  if (state.netText.trim() !== '') {
    netCents = parseMoneyToCents(state.netText, ctx.language, store?.currency);
    if (netCents === null || netCents <= 0) errors.netReceivedCents = 'itemForm.invalidMoney';
  }

  if (Object.keys(errors).length > 0 || !store || priceCents === null || soldIso === null) return { ok: false, errors };

  const body: SellBody = { saleStoreId: store.id, salePriceCents: priceCents, soldAt: soldIso };
  if (needsFx(store) && fxRate !== null) body.fxRateAtSale = fxRate;
  if (netCents !== null) {
    if (!feesConfigured(store)) body.netReceivedCents = netCents;
    else if (state.netTouched && netCents !== quoteNetCents) body.netReceivedCents = netCents;
  }
  return { ok: true, body };
}
