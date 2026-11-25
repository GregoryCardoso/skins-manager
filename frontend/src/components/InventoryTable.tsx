'use client';

import type { ItemView, Store } from '@/types/api';
import styles from './InventoryTable.module.css';
import InventoryUnitRow, { UnitTableHead, type UnitRowHandlers } from './InventoryUnitRow';

interface Props extends UnitRowHandlers {
  items: ItemView[];
  stores: Store[];
  forSalePendingId?: number | null;
  // Linha apontada por `?item=<id>` (destaque).
  highlightedItemId?: number | null;
  // Colunas de valor de mercado (somem com o filtro "Vendido").
  showMarket?: boolean;
}

export default function InventoryTable({ items, stores, forSalePendingId = null, highlightedItemId = null, showMarket = true, ...handlers }: Props) {
  return (
    <div className={styles.scroll} data-wide-table="">
      <table className={styles.table}>
        <UnitTableHead showMarket={showMarket} />
        <tbody>
          {items.map((item) => (
            <InventoryUnitRow
              key={item.id}
              item={item}
              stores={stores}
              forSalePendingId={forSalePendingId}
              highlighted={highlightedItemId === item.id}
              showMarket={showMarket}
              {...handlers}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
