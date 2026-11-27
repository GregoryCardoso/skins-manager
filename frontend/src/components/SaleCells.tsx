'use client';

import { useLocale, useT } from '@/i18n/I18nProvider';
import { formatMoney } from '@/lib/format';
import type { Currency, ItemView, Store } from '@/types/api';
import ItemImage from './ItemImage';
import { ItemNameCell } from './inventory/ItemNameCell';
import Badge from './ui/Badge';
import { useDisplayStaleRateNote } from './useStaleRateNote';
import Money from './ui/Money';
import styles from './sales.module.css';

// Imagem + nome e selos (a mesma célula do inventário, sem o selo "Vendido").
export function SaleItemCell({ item }: { item: ItemView }) {
  return (
    <div className={styles.itemRow}>
      <ItemImage category={item.category} url={item.catalog?.imageUrl} />
      <ItemNameCell item={item} hideSoldBadge />
    </div>
  );
}

// Valor na moeda da operação (D125). Em US$, o "≈" na moeda de conversão (cotação atual, só ilustrativo). Em outra moeda, o valor em
// US$ pela cotação gravada, com "=" (não é aproximado) e a nota da cotação. Tudo vem pronto da API.
export function SaleMoney({
  cents, currency, usdCents, approxCents, approxCurrency, rateNote = null,
}: {
  cents: number;
  currency: Currency;
  usdCents: number;
  approxCents: number | null;
  approxCurrency: string;
  rateNote?: string | null;
}) {
  const locale = useLocale();
  const staleRateNote = useDisplayStaleRateNote(approxCents !== null);
  if (currency === 'USD') {
    return <Money size="sm" cents={cents} currency="USD" approxCents={approxCents} approxCurrency={approxCurrency} staleRateNote={staleRateNote} />;
  }
  return (
    <span className={styles.stack}>
      <Money size="sm" cents={cents} currency={currency} />
      <span className={styles.muted}>
        {`= ${formatMoney(usdCents, 'USD', locale)}`}
        {rateNote ? ` · ${rateNote}` : ''}
      </span>
    </span>
  );
}

export function PurchaseStoreCell({ item, stores }: { item: ItemView; stores: Store[] }) {
  const t = useT();
  const name = item.purchaseStoreId !== null ? stores.find((s) => s.id === item.purchaseStoreId)?.name : undefined;
  if (item.acquisitionType === 'GANHEI') {
    return (
      <span className={styles.stack}>
        <Badge tone="profit">{t('inventory.ganhei')}</Badge>
        {item.originDetail && <span className={styles.muted}>{item.originDetail}</span>}
      </span>
    );
  }
  return <span>{name ?? t('common.none')}</span>;
}
