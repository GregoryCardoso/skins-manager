import type { TranslateParams } from '@/i18n/translate';

type Translate = (key: string, params?: TranslateParams) => string;

// Título do inventário (revisão da 8.8, item 1): "N itens" na visão individual e "N itens em M grupos" na agrupada.
// O 0 e o 1 são tratados à parte, porque `Intl.PluralRules('pt-BR')` classifica o 0 como "one" ("0 item em 0 grupo").
// `groups` nulo = visão individual.
export function inventoryCountText(count: number, groups: number | null, t: Translate): string {
  if (count === 0) return t('inventory.count', { count });
  if (groups === null) return count === 1 ? t('inventory.countOne', { count }) : t('inventory.count', { count });
  if (count === 1) return t('inventory.groupCount.one', { count, groups });
  if (groups === 1) return t('inventory.groupCount.inOneGroup', { count, groups });
  return t('inventory.groupCount.other', { count, groups });
}
