import type { TranslateParams } from '@/i18n/translate';

type Translate = (key: string, params?: TranslateParams) => string;
type TranslatePlural = (key: string, count: number, params?: TranslateParams) => string;

// Título do inventário: "N itens" na visão individual e "N itens em M grupos" na agrupada (revisão de textos 11.6, seção 13).
// Cada parte é uma frase de plural (`itemCount`, `groupsCount`) e `countInGroups` as junta na ordem de cada idioma.
// Sem itens, só a frase "Nenhum item" (sem "em 0 grupos"). `groups` nulo = visão individual.
export function inventoryCountText(count: number, groups: number | null, t: Translate, tPlural: TranslatePlural): string {
  const items = tPlural('inventory.itemCount', count);
  if (groups === null || count === 0) return items;
  return t('inventory.countInGroups', { items, groups: tPlural('inventory.groupsCount', groups) });
}
