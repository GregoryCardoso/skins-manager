// Frases do cartão da loja (12.8): só formatação dos campos que a API já devolve. Nenhuma conta de taxa aqui (a conta é do backend).
import type { Store } from '@/types/api';
import { formatMoney } from './format';
import { rateToPercentText } from './storeForm';

type Translate = (key: string, params?: Record<string, string | number>) => string;
type TranslatePlural = (key: string, count: number, params?: Record<string, string | number>) => string;

export interface StoreSummaryTranslators {
  t: Translate;
  tPlural: TranslatePlural;
  locale: string;
}

// "2% deducted from the price · minimum US$ 0.03 · fixed US$ 0.10" (o arredondamento é uma linha própria do cartão). Sem tipo ou taxa: null
// (a taxa fica nula, nunca 0).
export function saleFeeSentence(store: Store, { t, locale }: StoreSummaryTranslators): string | null {
  if (store.saleFeeType === null || store.saleFeeRate === null) return null;
  const parts = [t(`stores.card.saleFeeSentence.${store.saleFeeType}`, { rate: rateToPercentText(store.saleFeeRate, locale) })];
  if (store.saleMinFeeCents !== null) parts.push(t('storesTable.minFee', { value: formatMoney(store.saleMinFeeCents, store.currency, locale) }));
  if (store.saleFixedFeeCents > 0) parts.push(t('storesTable.fixedFee', { value: formatMoney(store.saleFixedFeeCents, store.currency, locale) }));
  return parts.join(' · ');
}

// "No" ou "Yes, 1% · fixed US$ 0.25".
export function withdrawalSentence(store: Store, { t, locale }: StoreSummaryTranslators): string {
  if (!store.allowsWithdrawal) return t('storesTable.withdrawalNo');
  const parts = [store.withdrawalFeeRate === null ? t('storesTable.withdrawalRateUnknown') : `${rateToPercentText(store.withdrawalFeeRate, locale)}%`];
  if (store.withdrawalFixedFeeCents > 0) parts.push(t('storesTable.fixedFee', { value: formatMoney(store.withdrawalFixedFeeCents, store.currency, locale) }));
  return t('storesTable.withdrawalYes', { detail: parts.join(' · ') });
}

// "Immediate" ou "3 days".
export function saleHoldSentence(store: Pick<Store, 'saleHoldDays'>, { t, tPlural }: StoreSummaryTranslators): string {
  return store.saleHoldDays > 0 ? tPlural('storesTable.saleHoldDays', store.saleHoldDays) : t('storesTable.saleHoldNone');
}

export type StoreActionId = 'toggleActive' | 'makePrimary' | 'toggleSteam' | 'delete';

// Motivo pelo qual cada ação do menu "Mais ações" está indisponível (chave de tradução), ou null quando está disponível.
// Só a regra visual que a API já aplica (loja principal, em uso, inativa).
export function storeActionReasons(store: Pick<Store, 'isPrimary' | 'isActive' | 'inUse'>): Record<StoreActionId, string | null> {
  return {
    toggleActive: store.isPrimary && store.isActive ? 'storesTable.reasons.primaryNeeded' : null,
    makePrimary: store.isPrimary ? 'storesTable.reasons.alreadyPrimary' : !store.isActive ? 'storesTable.reasons.activateFirst' : null,
    toggleSteam: null,
    delete: store.isPrimary ? 'storesTable.reasons.primaryNeeded' : store.inUse ? 'storesTable.reasons.inUse' : null,
  };
}

// Foca o menu "Mais ações" do cartão da Steam (ou do primeiro): é onde está "Usar como minha loja Steam" (dica da Steam, 12.8).
export function focusSteamChoice(root: ParentNode, stores: Pick<Store, 'id' | 'name'>[]): void {
  const candidate = stores.find((store) => /steam/i.test(store.name)) ?? stores[0];
  if (!candidate) return;
  root.querySelector(`[data-store-id="${candidate.id}"]`)?.querySelector<HTMLElement>('[data-store-menu]')?.focus();
}
