// Formulário de aporte (D202, D227, D231): conversões puras entre o texto digitado e o corpo da API.
// O frontend não soma nem converte nada. O aporte é na moeda da loja (só lojas em USD, E8-Q16): o valor creditado
// é obrigatório; o valor pago em R$ é opcional e só informativo.
import { isoToLocalInput, localInputToIso, nowLocalInput } from '@/lib/dateInput';
import { formatCentsInput, parseMoneyToCents } from '@/lib/numberInput';
import type { Deposit, DepositCreateBody, DepositPatchBody, Store } from '@/types/api';

export interface DepositFormState {
  storeId: number | null;
  // Valor creditado na loja (US$).
  amountText: string;
  // Valor pago em R$ (opcional, só informativo).
  paidText: string;
  // Taxa do aporte em US$ (opcional, D311): entra no total colocado e no lucro real, não no saldo.
  feeText: string;
  // datetime-local (hora local)
  depositedAt: string;
  note: string;
}

export type DepositFormField = 'storeId' | 'amountStoreCents' | 'feeCents' | 'amountBrlCents' | 'depositedAt';

// Chaves de tradução dos erros locais.
export type DepositFormErrors = Partial<Record<DepositFormField, string>>;

// Aporte novo: data padrão = agora; sem loja escolhida.
export function initialDepositState(now: Date = new Date()): DepositFormState {
  return { storeId: null, amountText: '', paidText: '', feeText: '', depositedAt: nowLocalInput(now), note: '' };
}

// Edição: o gravado manda. Aporte legado (só R$): o valor pago vem pré-preenchido e a loja informativa só vem
// pré-selecionada se for em USD; o valor creditado fica vazio e obrigatório.
export function depositFormFromDeposit(deposit: Deposit, language: string): DepositFormState {
  const storeIsUsd = deposit.currency === 'USD';
  return {
    storeId: deposit.storeId !== null && storeIsUsd ? deposit.storeId : null,
    amountText: deposit.amountStoreCents === null ? '' : formatCentsInput(deposit.amountStoreCents, language),
    paidText: deposit.amountBrlCents === null ? '' : formatCentsInput(deposit.amountBrlCents, language),
    feeText: deposit.feeCents === null || deposit.feeCents === undefined ? '' : formatCentsInput(deposit.feeCents, language),
    depositedAt: isoToLocalInput(deposit.depositedAt),
    note: deposit.note ?? '',
  };
}

// Lojas do formulário (E8-Q16): só as ativas em USD; na edição, a loja gravada também, se for USD (mesmo inativa).
// Uma loja em R$ (ex.: Steam) nunca aparece.
export function depositStoreOptions(stores: Store[], deposit: Deposit | null): Store[] {
  const currentId = deposit ? deposit.storeId : null;
  return stores.filter((store) => store.currency === 'USD' && (store.isActive || (currentId !== null && store.id === currentId)));
}

// Aporte legado cuja loja informativa é em R$: o campo Loja fica vazio com um aviso.
export function legacyStoreIsNotUsd(deposit: Deposit): boolean {
  return deposit.legacy && deposit.storeId !== null && deposit.currency !== 'USD';
}

export function validateDepositForm(state: DepositFormState, language: string): DepositFormErrors {
  const errors: DepositFormErrors = {};
  if (state.storeId === null) errors.storeId = 'deposits.form.storeRequired';
  if (state.amountText.trim() === '') errors.amountStoreCents = 'deposits.form.amountRequired';
  else {
    const cents = parseMoneyToCents(state.amountText, language);
    if (cents === null || cents <= 0) errors.amountStoreCents = 'deposits.form.invalidMoney';
  }
  if (state.paidText.trim() !== '') {
    const cents = parseMoneyToCents(state.paidText, language);
    if (cents === null || cents <= 0) errors.amountBrlCents = 'deposits.form.invalidMoney';
  }
  if (state.feeText.trim() !== '') {
    const cents = parseMoneyToCents(state.feeText, language);
    if (cents === null || cents < 0) errors.feeCents = 'deposits.form.invalidFee';
  }
  if (state.depositedAt.trim() === '' || localInputToIso(state.depositedAt) === null) {
    errors.depositedAt = 'deposits.form.invalidDate';
  }
  return errors;
}

// Corpo completo (vírgula -> centavos; valor pago e nota vazios são omitidos). Só use depois de `validateDepositForm` sem erros.
export function buildDepositCreateBody(state: DepositFormState, language: string): DepositCreateBody {
  const body: DepositCreateBody = {
    storeId: state.storeId ?? 0,
    amountStoreCents: parseMoneyToCents(state.amountText, language) ?? 0,
    depositedAt: localInputToIso(state.depositedAt) ?? '',
  };
  if (state.paidText.trim() !== '') body.amountBrlCents = parseMoneyToCents(state.paidText, language) ?? 0;
  if (state.feeText.trim() !== '') body.feeCents = parseMoneyToCents(state.feeText, language) ?? 0;
  const note = state.note.trim();
  if (note !== '') body.note = note;
  return body;
}

// Só os campos que mudaram em relação ao aporte original (o PATCH é parcial); valor pago e nota esvaziados viram `null`.
// Aporte legado: qualquer edição exige loja e valor creditado no registro mesclado (D224), então os dois sempre vão.
export function buildDepositPatchBody(state: DepositFormState, original: Deposit, language: string): DepositPatchBody {
  const patch: DepositPatchBody = {};
  const legacy = original.legacy;
  if (state.storeId !== null && (legacy || state.storeId !== original.storeId)) patch.storeId = state.storeId;
  const credited = parseMoneyToCents(state.amountText, language);
  if (credited !== null && (legacy || credited !== original.amountStoreCents)) patch.amountStoreCents = credited;
  if (state.paidText.trim() === '') {
    if (original.amountBrlCents !== null) patch.amountBrlCents = null;
  } else {
    const paid = parseMoneyToCents(state.paidText, language);
    if (paid !== null && paid !== original.amountBrlCents) patch.amountBrlCents = paid;
  }
  if (state.feeText.trim() === '') {
    if (original.feeCents !== null && original.feeCents !== undefined) patch.feeCents = null;
  } else {
    const fee = parseMoneyToCents(state.feeText, language);
    if (fee !== null && fee !== (original.feeCents ?? null)) patch.feeCents = fee;
  }
  if (state.depositedAt !== isoToLocalInput(original.depositedAt)) {
    const iso = localInputToIso(state.depositedAt);
    if (iso !== null) patch.depositedAt = iso;
  }
  const note = state.note.trim();
  if (note !== (original.note ?? '')) patch.note = note === '' ? null : note;
  return patch;
}
