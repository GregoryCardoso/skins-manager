// Formulário de aporte (D202, D207): conversões puras entre o texto digitado e o corpo da API.
// O frontend não soma nem converte nada; o valor é sempre em R$ e a loja é só informativa.
import { isoToLocalInput, localInputToIso, nowLocalInput } from '@/lib/dateInput';
import { formatCentsInput, parseMoneyToCents } from '@/lib/numberInput';
import type { Deposit, DepositCreateBody, DepositPatchBody } from '@/types/api';

export interface DepositFormState {
  amountText: string;
  // datetime-local (hora local)
  depositedAt: string;
  storeId: number | null;
  note: string;
}

export type DepositFormField = 'amountBrlCents' | 'depositedAt';

// Chaves de tradução dos erros locais.
export type DepositFormErrors = Partial<Record<DepositFormField, string>>;

// Aporte novo: data padrão = agora.
export function initialDepositState(now: Date = new Date()): DepositFormState {
  return { amountText: '', depositedAt: nowLocalInput(now), storeId: null, note: '' };
}

export function depositFormFromDeposit(deposit: Deposit, language: string): DepositFormState {
  return {
    amountText: formatCentsInput(deposit.amountBrlCents, language),
    depositedAt: isoToLocalInput(deposit.depositedAt),
    storeId: deposit.storeId,
    note: deposit.note ?? '',
  };
}

export function validateDepositForm(state: DepositFormState, language: string): DepositFormErrors {
  const errors: DepositFormErrors = {};
  if (state.amountText.trim() === '') errors.amountBrlCents = 'deposits.form.amountRequired';
  else {
    const cents = parseMoneyToCents(state.amountText, language);
    if (cents === null || cents <= 0) errors.amountBrlCents = 'deposits.form.invalidMoney';
  }
  if (state.depositedAt.trim() === '' || localInputToIso(state.depositedAt) === null) {
    errors.depositedAt = 'deposits.form.invalidDate';
  }
  return errors;
}

// Corpo completo (vírgula -> centavos; loja e nota vazias são omitidas). Só use depois de `validateDepositForm` sem erros.
export function buildDepositCreateBody(state: DepositFormState, language: string): DepositCreateBody {
  const body: DepositCreateBody = {
    amountBrlCents: parseMoneyToCents(state.amountText, language) ?? 0,
    depositedAt: localInputToIso(state.depositedAt) ?? '',
  };
  if (state.storeId !== null) body.storeId = state.storeId;
  const note = state.note.trim();
  if (note !== '') body.note = note;
  return body;
}

// Só os campos que mudaram em relação ao aporte original (o PATCH é parcial); loja e nota esvaziadas viram `null`.
export function buildDepositPatchBody(state: DepositFormState, original: Deposit, language: string): DepositPatchBody {
  const patch: DepositPatchBody = {};
  const cents = parseMoneyToCents(state.amountText, language);
  if (cents !== null && cents !== original.amountBrlCents) patch.amountBrlCents = cents;
  if (state.depositedAt !== isoToLocalInput(original.depositedAt)) {
    const iso = localInputToIso(state.depositedAt);
    if (iso !== null) patch.depositedAt = iso;
  }
  if (state.storeId !== original.storeId) patch.storeId = state.storeId;
  const note = state.note.trim();
  if (note !== (original.note ?? '')) patch.note = note === '' ? null : note;
  return patch;
}
