import { ApiRequestError } from '@/services/api';

// Mapa de reserva (D113): código do erro -> campo do formulário, quando o backend não informa `field`.
export const FALLBACK_FIELD_BY_CODE: Record<string, string> = {
  FEES_NOT_CONFIGURED: 'saleStoreId',
  NET_RECEIVED_NEGATIVE: 'salePriceCents',
  NET_RECEIVED_ABOVE_PRICE: 'netReceivedCents',
  EXTERIOR_MISMATCH: 'exterior',
  CATALOG_ITEM_REQUIRED: 'catalogId',
  CATALOG_ITEM_NOT_FOUND: 'catalogId',
  PURCHASE_STORE_REQUIRED: 'purchaseStoreId',
  PURCHASE_PRICE_REQUIRED: 'purchasePriceCents',
  GANHEI_COST_NOT_ALLOWED: 'purchasePriceCents',
  INVALID_FLOAT: 'floatValue',
  INVALID_PAINT_SEED: 'paintSeed',
  INVALID_VARIANT: 'variant',
  INVALID_EXTERIOR: 'exterior',
  INVALID_CATEGORY: 'category',
  ACQUIRED_AT_IN_FUTURE: 'acquiredAt',
  SOLD_AT_IN_FUTURE: 'soldAt',
  SOLD_BEFORE_ACQUIRED: 'soldAt',
  INVALID_FX_RATE: 'fxRateAtSale',
};

export interface ErrorTarget {
  // Campo do formulário que mostra o erro; null = topo do formulário.
  target: string | null;
  // Campo da API quando o erro é de um campo que o formulário não tem (vira rótulo no topo).
  topLabelField: string | null;
}

// Decide onde mostrar o erro: `error.field` (se o campo está visível) -> mapa de reserva -> topo.
// `formFields` deve conter só os campos visíveis no momento; erro de campo oculto vai para o topo com o rótulo do campo.
export function resolveErrorTarget(error: unknown, formFields: readonly string[]): ErrorTarget {
  if (!(error instanceof ApiRequestError)) return { target: null, topLabelField: null };
  if (error.field && formFields.includes(error.field)) return { target: error.field, topLabelField: null };
  if (!error.field) {
    const fallback = FALLBACK_FIELD_BY_CODE[error.code];
    if (fallback && formFields.includes(fallback)) return { target: fallback, topLabelField: null };
    if (fallback) return { target: null, topLabelField: fallback };
  }
  return { target: null, topLabelField: error.field ?? null };
}
