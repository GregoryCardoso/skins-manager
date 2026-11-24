'use client';

import { useLanguage, useT } from '@/i18n/I18nProvider';
import { formatMoney } from '@/lib/format';
import type { ItemView } from '@/types/api';
import styles from './InventoryTable.module.css';

// Custo da unidade (10.3, D362). Sem componentes aplicados do estoque é o preço de compra na moeda da compra, como sempre; com eles
// mostra o custo efetivo em US$ (o próprio mais o dos componentes) e quanto veio dos componentes.
export default function CostCell({ item }: { item: ItemView }) {
  const t = useT();
  const locale = useLanguage();
  const inherited = item.cost.inheritedUsdCents;
  if (inherited <= 0) return <>{formatMoney(item.purchasePriceCents, item.purchaseCurrency, locale)}</>;
  const note = t('operations.costIncludes', { value: formatMoney(inherited, 'USD', locale) });
  return (
    <span className={styles.stack} title={note}>
      <span>{item.cost.estimated ? '≈ ' : ''}{formatMoney(item.cost.effectiveUsdCents, 'USD', locale)}</span>
      <span className={styles.muted}>{note}</span>
    </span>
  );
}
