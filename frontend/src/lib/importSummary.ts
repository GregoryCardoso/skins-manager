// Resumo da importação (9.2 e 9.3, D318): linhas de contagem, grupos de entradas, chave do motivo e link para o lançamento.
// Funções puras (sem React nem rede); o texto é montado na tela com as chaves i18n.
import type { ImportBatchCounts, ImportEntryAction, ImportEntryView } from '@/types/api';

// Ordem e chave (`imports.counts.<key>`) de cada linha do resumo.
export const COUNT_LINES = [
  'purchasesCreated', 'salesCreated', 'matched', 'review', 'reverted', 'withoutPurchase', 'failed', 'unknownState', 'revertedBeforeImport',
  'deferredSales', 'known', 'notTransferred', 'beforeCutoff',
] as const;
export type CountKey = (typeof COUNT_LINES)[number];

export interface CountLine {
  key: CountKey;
  count: number;
}

// Só as contagens maiores que zero, na ordem fixa.
export function summaryLines(counts: ImportBatchCounts): CountLine[] {
  return COUNT_LINES.map((key) => ({ key, count: counts[key] ?? 0 })).filter((line) => line.count > 0);
}

// "Nada novo": nada foi criado, ligado nem exige atenção (as contagens de já importadas e de antes do corte não contam).
export function isNothingNew(counts: ImportBatchCounts): boolean {
  return (
    counts.purchasesCreated + counts.salesCreated + counts.matched + counts.review + counts.reverted + counts.failed + counts.unknownState
    + counts.withoutPurchase === 0
  );
}

export type EntryGroupKey = 'CREATED' | 'MATCHED' | 'POSSIBLE_DUPLICATE' | 'REVERTED' | 'WITHOUT_PURCHASE' | 'FAILED';

export interface EntryGroup {
  key: EntryGroupKey;
  entries: ImportEntryView[];
}

const GROUP_ORDER: readonly EntryGroupKey[] = ['POSSIBLE_DUPLICATE', 'REVERTED', 'WITHOUT_PURCHASE', 'FAILED', 'CREATED', 'MATCHED'];

// Venda importada sem unidade em estoque (E9-Q12): grupo próprio "Venda sem compra no app".
export const WITHOUT_PURCHASE_REASON = 'PURCHASE_NOT_FOUND';

// Estado desconhecido entra no grupo "Não importadas" (as pendências que exigem conferência vêm primeiro).
function groupOf(entry: ImportEntryView): EntryGroupKey {
  if (entry.outcome === 'FAILED' && entry.reasonCode === WITHOUT_PURCHASE_REASON) return 'WITHOUT_PURCHASE';
  return entry.outcome === 'UNKNOWN_STATE' ? 'FAILED' : entry.outcome;
}

// Agrupa as entradas, omitindo os grupos vazios.
export function groupEntries(entries: readonly ImportEntryView[]): EntryGroup[] {
  return GROUP_ORDER.map((key) => ({ key, entries: entries.filter((entry) => groupOf(entry) === key) })).filter((group) => group.entries.length > 0);
}

// Chave i18n do motivo (`imports.reasons.<código>`), ou null se a entrada não traz motivo.
export function reasonKey(entry: ImportEntryView): string | null {
  return entry.reasonCode ? `imports.reasons.${entry.reasonCode}` : null;
}

// Link para o lançamento no app: a compra no inventário e a venda na página de vendas; aportes e saques chegam na 9.6.
export function entryLink(entry: ImportEntryView): string | null {
  if (entry.entityId === null) return null;
  if (entry.entityType === 'ITEM_PURCHASE') return `/?item=${entry.entityId}`;
  if (entry.entityType === 'ITEM_SALE') return `/sales?item=${entry.entityId}`;
  return null;
}

// Ações de uma pendência ainda aberta (9.4, D301), na ordem dos botões. Resolvida, ou sem ação: lista vazia.
const ACTIONS_BY_OUTCOME: Partial<Record<ImportEntryView['outcome'], readonly ImportEntryAction[]>> = {
  REVERTED: ['REMOVE', 'KEEP'],
  POSSIBLE_DUPLICATE: ['CREATE', 'LINK', 'IGNORE'],
  FAILED: ['IGNORE'],
  UNKNOWN_STATE: ['IGNORE'],
};

export function entryActions(entry: ImportEntryView): readonly ImportEntryAction[] {
  if (entry.resolution !== null) return [];
  return ACTIONS_BY_OUTCOME[entry.outcome] ?? [];
}

// Texto da confirmação de "Remover lançamento": venda (desfaz a venda) ou compra (exclui o item); manual ligado avisa.
export function removeConfirmKey(entry: ImportEntryView): string {
  const kind = entry.entityType === 'ITEM_SALE' ? 'sale' : 'purchase';
  return `imports.actions.removeConfirm.${kind}${entry.linkKind === 'MATCHED' ? 'Manual' : ''}`;
}

// Rótulo do link (`imports.seeInInventory` ou `imports.seeInSales`).
export function entryLinkLabelKey(entry: ImportEntryView): 'imports.seeInInventory' | 'imports.seeInSales' {
  return entry.entityType === 'ITEM_SALE' ? 'imports.seeInSales' : 'imports.seeInInventory';
}

// Parâmetro `?item=<id>` da página do inventário: inteiro positivo ou null (não é filtro).
export function parseItemParam(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,12}$/.test(value)) return null;
  const id = Number(value);
  return id >= 1 ? id : null;
}
