// Pendências da importação (9.5.1b, D327 a D331): o formulário de "Lançar compra" e as ações em lote. Funções puras.
import type { ImportEntryAction, ImportEntryView, Store } from '@/types/api';
import { hasNoDecimals } from '@/lib/currencies';
import { addDaysToLocalInput, localInputToDate, localInputToIso } from './dateInput';
import { isAmbiguousDecimal, parseDecimalInput, parseMoneyToCents } from './numberInput';

export interface LaunchFormState {
  storeId: number | null;
  price: string;
  fxRate: string;
  acquiredAt: string; // datetime-local
  tradeUnlockAt: string; // datetime-local (vazio = sem trade lock)
  // O usuário mexeu no fim do trade lock: a data da compra não o recalcula mais.
  unlockEdited: boolean;
}

export interface LaunchPurchaseBody {
  purchaseStoreId: number;
  purchasePriceCents: number;
  fxRateAtPurchase?: number;
  acquiredAt: string;
  tradeUnlockAt: string | null;
}

// Loja inicial: a primeira ativa que não é a da integração (a compra costuma ter sido em outra loja); senão, a primeira.
export function initialLaunchState(stores: readonly Store[], integrationStoreId: number | null): LaunchFormState {
  const active = stores.filter((s) => s.isActive);
  const store = active.find((s) => s.id !== integrationStoreId) ?? active[0] ?? null;
  return { storeId: store ? store.id : null, price: '', fxRate: '', acquiredAt: '', tradeUnlockAt: '', unlockEdited: false };
}

// Data da compra: o fim do trade lock acompanha (compra + 7 dias, o padrão do cadastro, D161) até o usuário editá-lo.
export function setLaunchAcquiredAt(state: LaunchFormState, acquiredAt: string): LaunchFormState {
  if (state.unlockEdited) return { ...state, acquiredAt };
  const unlock = localInputToDate(acquiredAt) === null ? '' : addDaysToLocalInput(acquiredAt, 7);
  return { ...state, acquiredAt, tradeUnlockAt: unlock };
}

export type LaunchErrors = Partial<Record<'store' | 'price' | 'fxRate' | 'acquiredAt' | 'tradeUnlockAt', string>>;

// Corpo do "Lançar compra" (ou os erros, por campo, como chaves i18n). As datas contra a venda são conferidas no backend.
export function buildLaunchBody(
  state: LaunchFormState, stores: readonly Store[], language: string,
): { ok: true; purchase: LaunchPurchaseBody } | { ok: false; errors: LaunchErrors } {
  const errors: LaunchErrors = {};
  const store = stores.find((s) => s.id === state.storeId) ?? null;
  if (!store) errors.store = 'imports.launch.storeRequired';
  const priceCents = parseMoneyToCents(state.price, language, store?.currency);
  if (priceCents === null || priceCents < 0) {
    // Moeda sem centavos (moedas sem casas decimais) com valor digitado: mensagem própria; vazio ou negativo segue o texto geral.
    const wholeOnly = priceCents === null && state.price.trim() !== '' && store !== null && hasNoDecimals(store.currency);
    errors.price = wholeOnly ? 'imports.launch.priceInvalidWhole' : 'imports.launch.priceRequired';
  }
  let fxRate: number | null = null;
  if (store && store.currency !== 'USD' && state.fxRate.trim() !== '') {
    fxRate = parseDecimalInput(state.fxRate, language);
    if (fxRate === null || fxRate <= 0) errors.fxRate = isAmbiguousDecimal(state.fxRate, language) ? 'fx.ambiguousInput' : 'imports.launch.fxInvalid';
  }
  const acquiredIso = localInputToIso(state.acquiredAt);
  if (acquiredIso === null) errors.acquiredAt = 'imports.launch.dateRequired';
  let unlockIso: string | null = null;
  if (state.tradeUnlockAt.trim() !== '') {
    unlockIso = localInputToIso(state.tradeUnlockAt);
    if (unlockIso === null) errors.tradeUnlockAt = 'imports.launch.dateInvalid';
  }
  if (Object.keys(errors).length > 0 || !store || priceCents === null || acquiredIso === null) return { ok: false, errors };
  const purchase: LaunchPurchaseBody = { purchaseStoreId: store.id, purchasePriceCents: priceCents, acquiredAt: acquiredIso, tradeUnlockAt: unlockIso };
  if (fxRate !== null) purchase.fxRateAtPurchase = fxRate;
  return { ok: true, purchase };
}

// Ações que valem em lote (D330).
export type BulkEntryAction = 'MARK_WON' | 'IGNORE' | 'REOPEN';
export const BULK_ENTRY_ACTIONS: readonly BulkEntryAction[] = ['MARK_WON', 'IGNORE', 'REOPEN'];

export function bulkActionsOf(entry: ImportEntryView): BulkEntryAction[] {
  return (entry.allowedActions ?? []).filter((action): action is BulkEntryAction => (BULK_ENTRY_ACTIONS as readonly ImportEntryAction[]).includes(action));
}

// Ações em lote que valem para TODAS as selecionadas, na ordem dos botões.
export function commonBulkActions(entries: readonly ImportEntryView[]): BulkEntryAction[] {
  if (entries.length === 0) return [];
  return BULK_ENTRY_ACTIONS.filter((action) => entries.every((entry) => bulkActionsOf(entry).includes(action)));
}
