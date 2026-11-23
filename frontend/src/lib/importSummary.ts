// Resumo da importação (9.2, D318): linhas de contagem, grupos de entradas, chave do motivo e link para o lançamento.
// Funções puras (sem React nem rede); o texto é montado na tela com as chaves i18n.
import type { ImportBatchCounts, ImportEntryView } from '@/types/api';

// Ordem e chave (`imports.counts.<key>`) de cada linha do resumo.
export const COUNT_LINES = [
  'purchasesCreated', 'matched', 'review', 'reverted', 'failed', 'unknownState', 'deferredSales', 'known', 'notTransferred', 'beforeCutoff',
] as const;
export type CountKey = (typeof COUNT_LINES)[number];

export interface CountLine {
  key: CountKey;
  count: number;
}

// Só as contagens maiores que zero, na ordem fixa.
export function summaryLines(counts: ImportBatchCounts): CountLine[] {
  return COUNT_LINES.map((key) => ({ key, count: counts[key] })).filter((line) => line.count > 0);
}

// "Nada novo": nada foi criado, ligado nem exige atenção (as contagens de já importadas e de antes do corte não contam).
export function isNothingNew(counts: ImportBatchCounts): boolean {
  return counts.purchasesCreated + counts.salesCreated + counts.matched + counts.review + counts.reverted + counts.failed + counts.unknownState === 0;
}

export type EntryGroupKey = 'CREATED' | 'MATCHED' | 'POSSIBLE_DUPLICATE' | 'REVERTED' | 'FAILED';

export interface EntryGroup {
  key: EntryGroupKey;
  entries: ImportEntryView[];
}

const GROUP_ORDER: readonly EntryGroupKey[] = ['POSSIBLE_DUPLICATE', 'REVERTED', 'FAILED', 'CREATED', 'MATCHED'];

// Estado desconhecido entra no grupo "Não importadas" (as pendências que exigem conferência vêm primeiro).
function groupOf(entry: ImportEntryView): EntryGroupKey {
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

// Link para o lançamento no app (o item, no inventário); vendas e outros tipos chegam nas próximas partes.
export function entryLink(entry: ImportEntryView): string | null {
  if (entry.entityType === 'ITEM_PURCHASE' && entry.entityId !== null) return `/?item=${entry.entityId}`;
  return null;
}

// Parâmetro `?item=<id>` da página do inventário: inteiro positivo ou null (não é filtro).
export function parseItemParam(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,12}$/.test(value)) return null;
  const id = Number(value);
  return id >= 1 ? id : null;
}
