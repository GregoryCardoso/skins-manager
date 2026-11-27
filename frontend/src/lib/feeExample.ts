// Exemplo ao vivo da taxa de uma loja (12.8): monta os parâmetros do `GET /stores/fee-preview` a partir do formulário. A conta é do backend.
import type { StoreFeePreviewQuery } from '@/types/api';
import { percentTextToRate, type StoreFormState } from './storeForm';
import { parseMoneyToCents } from './numberInput';

export type FeeExampleInput =
  | { status: 'notConfigured' }
  // Tipo ou taxa ainda inválidos ou valores que não viram número: nada a pedir (os erros aparecem nos campos).
  | { status: 'incomplete' }
  | { status: 'ready'; query: StoreFeePreviewQuery };

// `priceText` vazio = o backend escolhe o preço de exemplo (~US$ 10 na moeda da loja).
export function feeExampleInput(state: StoreFormState, priceText: string, language: string): FeeExampleInput {
  if (state.saleFeeType === '' && state.saleFeeRateText.trim() === '') return { status: 'notConfigured' };
  if (state.saleFeeType === '') return { status: 'incomplete' };
  const rate = percentTextToRate(state.saleFeeRateText, language);
  if (!rate.ok || rate.rate === null) return { status: 'incomplete' };

  const cents = (text: string, allowEmpty: true): number | null | undefined => {
    if (text.trim() === '') return allowEmpty ? null : undefined;
    const parsed = parseMoneyToCents(text, language, state.currency);
    return parsed === null ? undefined : parsed;
  };
  const min = cents(state.saleMinFeeText, true);
  const fixed = cents(state.saleFixedFeeText, true);
  const price = cents(priceText, true);
  if (min === undefined || fixed === undefined || price === undefined) return { status: 'incomplete' };
  if (price === 0) return { status: 'incomplete' };

  return {
    status: 'ready',
    query: {
      currency: state.currency,
      saleFeeType: state.saleFeeType,
      rate: rate.rate,
      rounding: state.saleFeeRounding,
      minCents: min,
      fixedCents: fixed ?? 0,
      priceCents: price,
    },
  };
}

// Parte da chave do exemplo (todos os parâmetros): respostas fora de ordem nunca se misturam no cache (`queryKeys.stores.feePreview`).
export function feeExampleKey(query: StoreFeePreviewQuery | null): readonly unknown[] {
  if (query === null) return ['idle'];
  return [query.currency, query.saleFeeType, query.rate, query.rounding ?? null, query.minCents ?? null, query.fixedCents ?? null, query.priceCents ?? null];
}
