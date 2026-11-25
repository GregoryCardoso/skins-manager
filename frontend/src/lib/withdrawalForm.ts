// Formulário de saque (D203, D207, E8-Q12): conversões puras entre o texto digitado e o corpo da API.
// O frontend não calcula a taxa: só pré-preenche com a sugestão do backend enquanto o campo não foi "tocado".
import { isoToLocalInput, localInputToIso, nowLocalInput } from '@/lib/dateInput';
import { formatMoney } from '@/lib/format';
import { hasNoDecimals } from '@/lib/currencies';
import { formatCentsInput, parseMoneyToCents } from '@/lib/numberInput';
import type { Store, Withdrawal, WithdrawalCreateBody, WithdrawalPatchBody } from '@/types/api';

export interface WithdrawalFormState {
  storeId: number | null;
  // Valor sacado, na moeda da loja escolhida.
  amountText: string;
  // Taxa paga na moeda da loja; vazio = "não informada".
  feeText: string;
  // true depois que o usuário edita a taxa (ou ao editar um saque com taxa gravada): a sugestão não a sobrescreve mais.
  feeTouched: boolean;
  // Valor recebido na conta, em R$: opcional e só informativo (8.5); vazio = não informado.
  receivedText: string;
  // datetime-local (hora local)
  withdrawnAt: string;
  note: string;
}

// Moedas dos campos (D369, 11.4): `store` = a da loja (valor sacado e taxa paga); `received` = a do valor recebido informativo.
// JPY, KRW e CLP só aceitam inteiros. Ausente = duas casas decimais.
export interface WithdrawalCurrencies {
  store?: string;
  received?: string;
}

export type WithdrawalFormField = 'storeId' | 'amountStoreCents' | 'feeCents' | 'amountBrlCents' | 'withdrawnAt';

// Chaves de tradução dos erros locais.
export type WithdrawalFormErrors = Partial<Record<WithdrawalFormField, string>>;

// Saque novo: data padrão = agora; sem loja escolhida.
export function initialWithdrawalState(now: Date = new Date()): WithdrawalFormState {
  return { storeId: null, amountText: '', feeText: '', feeTouched: false, receivedText: '', withdrawnAt: nowLocalInput(now), note: '' };
}

// Edição: o que está gravado manda. A taxa gravada (ou limpa de propósito) não é sobrescrita pela sugestão;
// só um saque antigo sem loja ainda não "tocou" a taxa (a loja e o valor serão escolhidos agora).
export function withdrawalFormFromWithdrawal(withdrawal: Withdrawal, language: string): WithdrawalFormState {
  return {
    storeId: withdrawal.storeId,
    amountText: withdrawal.amountStoreCents === null ? '' : formatCentsInput(withdrawal.amountStoreCents, language, withdrawal.currency ?? undefined),
    feeText: withdrawal.feeCents === null ? '' : formatCentsInput(withdrawal.feeCents, language, withdrawal.currency ?? undefined),
    feeTouched: !withdrawal.legacyWithoutStore,
    receivedText: withdrawal.amountBrlCents === null ? '' : formatCentsInput(withdrawal.amountBrlCents, language, withdrawal.amountBrlCurrency ?? 'BRL'),
    withdrawnAt: isoToLocalInput(withdrawal.withdrawnAt),
    note: withdrawal.note ?? '',
  };
}

// Valor do saque para mensagens: o sacado na moeda da loja; saque antigo sem loja, o valor em R$ gravado. Só formata.
export function withdrawalAmountText(withdrawal: Withdrawal, language: string): string {
  if (withdrawal.amountStoreCents !== null && withdrawal.currency !== null) {
    return formatMoney(withdrawal.amountStoreCents, withdrawal.currency, language);
  }
  return withdrawal.amountBrlCents === null ? '' : formatMoney(withdrawal.amountBrlCents, withdrawal.amountBrlCurrency ?? 'BRL', language);
}

// Lojas do formulário: só as ativas que permitem saque; na edição, a loja já gravada continua na lista.
export function withdrawalStoreOptions(stores: Store[], currentStoreId: number | null): Store[] {
  return stores.filter((store) => (store.isActive && store.allowsWithdrawal) || (currentStoreId !== null && store.id === currentStoreId));
}

// Digitar na taxa marca o campo como "tocado" (inclusive esvaziá-lo): daí em diante a sugestão não o altera.
export function editFee(state: WithdrawalFormState, feeText: string): WithdrawalFormState {
  return { ...state, feeText, feeTouched: true };
}

// Parâmetros da consulta de sugestão, ou null quando ela não deve acontecer (taxa tocada, sem loja ou sem valor válido).
export function feeSuggestionRequest(state: WithdrawalFormState, language: string, storeCurrency?: string): { storeId: number; amountStoreCents: number } | null {
  if (state.feeTouched || state.storeId === null) return null;
  const amountStoreCents = parseMoneyToCents(state.amountText, language, storeCurrency);
  if (amountStoreCents === null || amountStoreCents <= 0) return null;
  return { storeId: state.storeId, amountStoreCents };
}

// Aplica a sugestão do backend (nula = loja sem taxa, ou sem pedido válido: o campo volta a vazio).
// Taxa tocada nunca é sobrescrita, mesmo que a resposta chegue depois da edição.
export function applyFeeSuggestion(state: WithdrawalFormState, suggestedFeeCents: number | null, language: string, storeCurrency?: string): WithdrawalFormState {
  if (state.feeTouched) return state;
  const feeText = suggestedFeeCents === null ? '' : formatCentsInput(suggestedFeeCents, language, storeCurrency);
  return feeText === state.feeText ? state : { ...state, feeText };
}

export function validateWithdrawalForm(state: WithdrawalFormState, language: string, currencies: WithdrawalCurrencies = {}): WithdrawalFormErrors {
  const errors: WithdrawalFormErrors = {};
  if (state.storeId === null) errors.storeId = 'withdrawals.form.storeRequired';
  if (state.amountText.trim() === '') errors.amountStoreCents = 'withdrawals.form.amountRequired';
  else {
    const cents = parseMoneyToCents(state.amountText, language, currencies.store);
    if (cents === null || cents <= 0) errors.amountStoreCents = hasNoDecimals(currencies.store ?? '') ? 'withdrawals.form.invalidMoneyWhole' : 'withdrawals.form.invalidMoney';
  }
  // Taxa: vazia = não informada; 0 é permitido.
  if (state.feeText.trim() !== '' && parseMoneyToCents(state.feeText, language, currencies.store) === null) errors.feeCents = hasNoDecimals(currencies.store ?? '') ? 'withdrawals.form.invalidFeeWhole' : 'withdrawals.form.invalidFee';
  // Valor recebido em R$: opcional; quando informado, maior que zero.
  if (state.receivedText.trim() !== '') {
    const cents = parseMoneyToCents(state.receivedText, language, currencies.received);
    if (cents === null || cents <= 0) errors.amountBrlCents = hasNoDecimals(currencies.received ?? '') ? 'withdrawals.form.invalidMoneyWhole' : 'withdrawals.form.invalidMoney';
  }
  if (state.withdrawnAt.trim() === '' || localInputToIso(state.withdrawnAt) === null) errors.withdrawnAt = 'withdrawals.form.invalidDate';
  return errors;
}

// Corpo completo (vírgula -> centavos; taxa, valor recebido e nota vazios são omitidos). Só use depois de `validateWithdrawalForm` sem erros.
export function buildWithdrawalCreateBody(state: WithdrawalFormState, language: string, currencies: WithdrawalCurrencies = {}): WithdrawalCreateBody {
  const body: WithdrawalCreateBody = {
    storeId: state.storeId ?? 0,
    amountStoreCents: parseMoneyToCents(state.amountText, language, currencies.store) ?? 0,
    withdrawnAt: localInputToIso(state.withdrawnAt) ?? '',
  };
  if (state.receivedText.trim() !== '') body.amountBrlCents = parseMoneyToCents(state.receivedText, language, currencies.received) ?? 0;
  if (state.feeText.trim() !== '') body.feeCents = parseMoneyToCents(state.feeText, language, currencies.store) ?? 0;
  const note = state.note.trim();
  if (note !== '') body.note = note;
  return body;
}

// Só os campos que mudaram em relação ao saque original (o PATCH é parcial); taxa, valor recebido e nota esvaziados viram `null`.
// Num saque antigo sem loja, loja e valor sacado sempre diferem do original (nulos) e vão no corpo.
export function buildWithdrawalPatchBody(state: WithdrawalFormState, original: Withdrawal, language: string, currencies: WithdrawalCurrencies = {}): WithdrawalPatchBody {
  const patch: WithdrawalPatchBody = {};
  if (state.storeId !== null && state.storeId !== original.storeId) patch.storeId = state.storeId;
  const amountStore = parseMoneyToCents(state.amountText, language, currencies.store);
  // D221: trocar de loja sempre envia o valor sacado junto (a moeda da nova loja pode ser outra).
  if (amountStore !== null && (amountStore !== original.amountStoreCents || patch.storeId !== undefined)) patch.amountStoreCents = amountStore;
  // D221: trocar de loja também envia a taxa (o valor do campo, ou null se vazio), mesmo sem alteração.
  const storeChanged = patch.storeId !== undefined;
  if (state.feeText.trim() === '') {
    if (original.feeCents !== null || storeChanged) patch.feeCents = null;
  } else {
    const fee = parseMoneyToCents(state.feeText, language, currencies.store);
    if (fee !== null && (fee !== original.feeCents || storeChanged)) patch.feeCents = fee;
  }
  if (state.receivedText.trim() === '') {
    if (original.amountBrlCents !== null) patch.amountBrlCents = null;
  } else {
    const received = parseMoneyToCents(state.receivedText, language, currencies.received);
    if (received !== null && received !== original.amountBrlCents) patch.amountBrlCents = received;
  }
  if (state.withdrawnAt !== isoToLocalInput(original.withdrawnAt)) {
    const iso = localInputToIso(state.withdrawnAt);
    if (iso !== null) patch.withdrawnAt = iso;
  }
  const note = state.note.trim();
  if (note !== (original.note ?? '')) patch.note = note === '' ? null : note;
  return patch;
}
