// Formulário de loja (D156): conversões puras entre o texto digitado e o corpo da API.
// Percentuais são digitados em % ("2,5" = 0.025); centavos na moeda da loja ("0,30" = 30).
import type { Currency, SaleFeeRounding, SaleFeeType, Store, StoreCreateBody, StorePatchBody } from '@/types/api';
import { formatCentsInput, normalizeNumberText, parseMoneyToCents } from './numberInput';

// `rounded: true` só aparece quando o percentual digitado tinha mais casas do que o aceito (T85) e foi arredondado.
export type RateParse = { ok: true; rate: number | null; rounded?: true } | { ok: false };

// "2,5" -> 0.025. Vazio -> null (não configurado). Inválido, negativo ou >= 100 -> { ok: false }.
// `Math.round(p·1e4)/1e6` evita erro de ponto flutuante (2,5 * 0.01 = 0.025000000000000001).
export function percentTextToRate(text: string, language: string): RateParse {
  if (text.trim() === '') return { ok: true, rate: null };
  const normalized = normalizeNumberText(text, language);
  if (!/^\d+(\.\d+)?$/.test(normalized)) return { ok: false };
  const percent = Number(normalized);
  if (!Number.isFinite(percent) || percent >= 100) return { ok: false };
  const rate = Math.round(percent * 1e4) / 1e6;
  if (rate >= 1) return { ok: false };
  const scaled = percent * 1e4;
  return Math.abs(scaled - Math.round(scaled)) > 1e-6 ? { ok: true, rate, rounded: true } : { ok: true, rate };
}

// Algum percentual do formulário (venda ou saque) será arredondado ao salvar.
export function storeFormRounds(state: Pick<StoreFormState, 'saleFeeRateText' | 'withdrawalFeeRateText'>, language: string): boolean {
  return [state.saleFeeRateText, state.withdrawalFeeRateText].some((text) => {
    const parsed = percentTextToRate(text, language);
    return parsed.ok && parsed.rounded === true;
  });
}

// 0.025 -> "2,5" (até 4 casas no percentual, sem separador de milhar). null -> "".
export function rateToPercentText(rate: number | null, language: string): string {
  if (rate === null) return '';
  const percent = Math.round(rate * 1e6) / 1e4;
  return new Intl.NumberFormat(language, { maximumFractionDigits: 4, useGrouping: false }).format(percent);
}

export interface StoreFormState {
  name: string;
  currency: Currency;
  saleFeeType: SaleFeeType | '';
  saleFeeRateText: string;
  saleFeeRounding: SaleFeeRounding;
  saleMinFeeText: string;
  saleFixedFeeText: string;
  allowsWithdrawal: boolean;
  withdrawalFeeRateText: string;
  withdrawalFixedFeeText: string;
  isActive: boolean;
  isPrimary: boolean;
}

export function initialStoreFormState(): StoreFormState {
  return {
    name: '', currency: 'USD', saleFeeType: '', saleFeeRateText: '', saleFeeRounding: 'CEIL', saleMinFeeText: '',
    saleFixedFeeText: '', allowsWithdrawal: false, withdrawalFeeRateText: '', withdrawalFixedFeeText: '',
    isActive: true, isPrimary: false,
  };
}

export function storeFormFromStore(store: Store, language: string): StoreFormState {
  return {
    name: store.name,
    currency: store.currency,
    saleFeeType: store.saleFeeType ?? '',
    saleFeeRateText: rateToPercentText(store.saleFeeRate, language),
    saleFeeRounding: store.saleFeeRounding,
    saleMinFeeText: store.saleMinFeeCents === null ? '' : formatCentsInput(store.saleMinFeeCents, language),
    saleFixedFeeText: store.saleFixedFeeCents === 0 ? '' : formatCentsInput(store.saleFixedFeeCents, language),
    allowsWithdrawal: store.allowsWithdrawal,
    withdrawalFeeRateText: rateToPercentText(store.withdrawalFeeRate, language),
    withdrawalFixedFeeText: store.withdrawalFixedFeeCents === 0 ? '' : formatCentsInput(store.withdrawalFixedFeeCents, language),
    isActive: store.isActive,
    isPrimary: store.isPrimary,
  };
}

export type StoreFormField =
  | 'name' | 'saleFeeRate' | 'saleMinFeeCents' | 'saleFixedFeeCents' | 'withdrawalFeeRate' | 'withdrawalFixedFeeCents';

// Chaves de tradução dos erros locais (texto digitado que não vira número).
export type StoreFormErrors = Partial<Record<StoreFormField, string>>;

const RATE_ERROR = 'storeForm.invalidRate';
const MONEY_ERROR = 'storeForm.invalidMoney';

export function validateStoreForm(state: StoreFormState, language: string): StoreFormErrors {
  const errors: StoreFormErrors = {};
  if (state.name.trim() === '') errors.name = 'storeForm.nameRequired';
  if (!percentTextToRate(state.saleFeeRateText, language).ok) errors.saleFeeRate = RATE_ERROR;
  if (!percentTextToRate(state.withdrawalFeeRateText, language).ok) errors.withdrawalFeeRate = RATE_ERROR;
  if (state.saleMinFeeText.trim() !== '' && parseMoneyToCents(state.saleMinFeeText, language) === null) {
    errors.saleMinFeeCents = MONEY_ERROR;
  }
  if (state.saleFixedFeeText.trim() !== '' && parseMoneyToCents(state.saleFixedFeeText, language) === null) {
    errors.saleFixedFeeCents = MONEY_ERROR;
  }
  if (state.withdrawalFixedFeeText.trim() !== '' && parseMoneyToCents(state.withdrawalFixedFeeText, language) === null) {
    errors.withdrawalFixedFeeCents = MONEY_ERROR;
  }
  return errors;
}

const rateOf = (text: string, language: string): number | null => {
  const parsed = percentTextToRate(text, language);
  return parsed.ok ? parsed.rate : null;
};

// Vazio = não configurado (null) no mínimo; vazio = 0 nas taxas fixas.
const centsOrNull = (text: string, language: string): number | null =>
  text.trim() === '' ? null : parseMoneyToCents(text, language);
const centsOrZero = (text: string, language: string): number => centsOrNull(text, language) ?? 0;

// Corpo completo. Só use depois de `validateStoreForm` sem erros.
export function buildStoreCreateBody(state: StoreFormState, language: string): StoreCreateBody {
  return {
    name: state.name.trim(),
    currency: state.currency,
    saleFeeType: state.saleFeeType === '' ? null : state.saleFeeType,
    saleFeeRate: rateOf(state.saleFeeRateText, language),
    saleFeeRounding: state.saleFeeRounding,
    saleMinFeeCents: centsOrNull(state.saleMinFeeText, language),
    saleFixedFeeCents: centsOrZero(state.saleFixedFeeText, language),
    allowsWithdrawal: state.allowsWithdrawal,
    withdrawalFeeRate: rateOf(state.withdrawalFeeRateText, language),
    withdrawalFixedFeeCents: centsOrZero(state.withdrawalFixedFeeText, language),
    isActive: state.isActive,
    isPrimary: state.isPrimary,
  };
}

// Só os campos que mudaram em relação à loja original (o PATCH é parcial).
export function buildStorePatchBody(state: StoreFormState, original: Store, language: string): StorePatchBody {
  const full = buildStoreCreateBody(state, language);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(full) as (keyof StoreCreateBody)[]) {
    if (full[key] !== original[key]) patch[key] = full[key];
  }
  return patch as StorePatchBody;
}
