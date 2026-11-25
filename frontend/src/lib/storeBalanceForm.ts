// Formulário de conferência de saldo (D242, D247): conversões puras entre o texto digitado e o corpo da API.
// O valor digitado é o saldo REAL visto no site da loja, na moeda da loja. O cálculo e a diferença vêm do backend.
import { localInputToIso, nowLocalInput } from '@/lib/dateInput';
import { parseMoneyToCents } from '@/lib/numberInput';
import type { StoreBalanceCheckBody } from '@/types/api';

export interface StoreBalanceFormState {
  // Saldo real na moeda da loja; 0 é permitido.
  amountText: string;
  // datetime-local (hora local)
  recordedAt: string;
  // Observação do ajuste (obrigatória só ao ajustar).
  noteText: string;
}

export type StoreBalanceFormField = 'balanceCents' | 'recordedAt' | 'note';

// Chaves de tradução dos erros locais.
export type StoreBalanceFormErrors = Partial<Record<StoreBalanceFormField, string>>;

// Conferência nova: data padrão = agora.
export function initialStoreBalanceState(now: Date = new Date()): StoreBalanceFormState {
  return { amountText: '', recordedAt: nowLocalInput(now), noteText: '' };
}

// `adjust`: a observação passa a ser obrigatória (E8-Q23).
export function validateStoreBalanceForm(
  state: StoreBalanceFormState,
  language: string,
  { adjust = false, currency }: { adjust?: boolean; currency?: string } = {},
): StoreBalanceFormErrors {
  const errors: StoreBalanceFormErrors = {};
  if (state.amountText.trim() === '') errors.balanceCents = 'storeBalances.form.amountRequired';
  else if (parseMoneyToCents(state.amountText, language, currency) === null) errors.balanceCents = 'storeBalances.form.invalidMoney';
  if (state.recordedAt.trim() === '' || localInputToIso(state.recordedAt) === null) errors.recordedAt = 'storeBalances.form.invalidDate';
  if (adjust && state.noteText.trim() === '') errors.note = 'errors.ADJUSTMENT_NOTE_REQUIRED';
  return errors;
}

// Consulta da prévia (valor e data válidos); `null` enquanto o formulário estiver incompleto ou inválido.
export function buildCheckPreviewQuery(
  state: StoreBalanceFormState, storeId: number, language: string, currency?: string,
): { storeId: number; balanceCents: number; recordedAt: string } | null {
  const balanceCents = parseMoneyToCents(state.amountText, language, currency);
  const recordedAt = localInputToIso(state.recordedAt);
  if (state.amountText.trim() === '' || balanceCents === null || recordedAt === null) return null;
  return { storeId, balanceCents, recordedAt };
}

// Corpo da requisição. Só use depois de `validateStoreBalanceForm` sem erros.
export function buildStoreBalanceBody(
  state: StoreBalanceFormState, storeId: number, language: string, adjust = false, currency?: string,
): StoreBalanceCheckBody {
  const note = state.noteText.trim();
  return {
    storeId,
    balanceCents: parseMoneyToCents(state.amountText, language, currency) ?? 0,
    recordedAt: localInputToIso(state.recordedAt) ?? '',
    adjust,
    ...(note !== '' ? { note } : {}),
  };
}
