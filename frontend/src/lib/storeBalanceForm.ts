// Formulário de saldo da loja (D204): conversões puras entre o texto digitado e o corpo da API.
// O saldo digitado é o DISPONÍVEL, na moeda da loja (o que aparece no site da loja).
import { localInputToIso, nowLocalInput } from '@/lib/dateInput';
import { parseMoneyToCents } from '@/lib/numberInput';
import type { StoreBalanceCreateBody } from '@/types/api';

export interface StoreBalanceFormState {
  // Saldo disponível na moeda da loja; 0 é permitido.
  amountText: string;
  // datetime-local (hora local)
  recordedAt: string;
}

export type StoreBalanceFormField = 'balanceCents' | 'recordedAt';

// Chaves de tradução dos erros locais.
export type StoreBalanceFormErrors = Partial<Record<StoreBalanceFormField, string>>;

// Saldo novo: data padrão = agora.
export function initialStoreBalanceState(now: Date = new Date()): StoreBalanceFormState {
  return { amountText: '', recordedAt: nowLocalInput(now) };
}

export function validateStoreBalanceForm(state: StoreBalanceFormState, language: string): StoreBalanceFormErrors {
  const errors: StoreBalanceFormErrors = {};
  if (state.amountText.trim() === '') errors.balanceCents = 'storeBalances.form.amountRequired';
  else if (parseMoneyToCents(state.amountText, language) === null) errors.balanceCents = 'storeBalances.form.invalidMoney';
  if (state.recordedAt.trim() === '' || localInputToIso(state.recordedAt) === null) errors.recordedAt = 'storeBalances.form.invalidDate';
  return errors;
}

// Corpo da requisição. Só use depois de `validateStoreBalanceForm` sem erros.
export function buildStoreBalanceBody(state: StoreBalanceFormState, storeId: number, language: string): StoreBalanceCreateBody {
  return {
    storeId,
    balanceCents: parseMoneyToCents(state.amountText, language) ?? 0,
    recordedAt: localInputToIso(state.recordedAt) ?? '',
  };
}
