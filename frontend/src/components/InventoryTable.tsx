'use client';

import type { ReactNode } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { unitColumns, INVENTORY_HIDE_AT } from '@/lib/inventoryColumns';
import { replaceScoped, type InventorySelection } from '@/lib/inventorySelection';
import { itemDisplayName } from '@/lib/itemName';
import type { ItemView, Store } from '@/types/api';
import DataTable, { type SortOrder } from './ui/DataTable';
import { TurnoverLegend, type TurnoverLimits } from './ui/TurnoverRule';
import type { UnitRowHandlers } from './inventory/ItemRowActions';
import { isLockedStock, isStuck } from './inventory/UnitCells';

export interface InventoryTableProps {
  items: ItemView[];
  stores: Store[];
  handlers: UnitRowHandlers;
  limits: TurnoverLimits;
  forSalePendingId?: number | null;
  // Linha apontada por `?item=<id>` (destaque).
  highlightedItemId?: number | null;
  // Colunas de valor de mercado (somem com o filtro "Vendido").
  showMarket?: boolean;
  density: 'compact' | 'comfortable';
  order: SortOrder;
  onOrderChange: (order: SortOrder) => void;
  loading?: boolean;
  empty?: ReactNode;
  // Seleção única da página (12.5b); sem ela, não há caixas.
  selection?: InventorySelection;
}

// Visão individual (D370, 12.5a): uma unidade por linha, sobre o DataTable. A ordem (por dias à venda) pede a API; nada é ordenado aqui.
export default function InventoryTable({
  items, stores, handlers, limits, forSalePendingId = null, highlightedItemId = null, showMarket = true, density, order, onOrderChange, loading = false, empty, selection,
}: InventoryTableProps) {
  const t = useT();
  const columns = unitColumns({ t, stores, limits, handlers, forSalePendingId, showMarket });
  return (
    <DataTable<ItemView>
      hideAt={INVENTORY_HIDE_AT}
      caption={t('inventory.title')}
      columns={columns}
      rows={items}
      getRowId={(item) => String(item.id)}
      density={density}
      sort={{ columnId: 'turnover', order }}
      onSortChange={(_, next) => onOrderChange(next)}
      rowTone={(item) => (isStuck(item) ? 'stuck' : isLockedStock(item) ? 'lock' : undefined)}
      rowLabel={(item) => itemDisplayName(item)}
      highlightedId={highlightedItemId === null ? null : String(highlightedItemId)}
      selection={
        selection
          ? {
              selectedIds: new Set([...selection.selected].map(String)),
              onChange: (ids) => selection.onChange(replaceScoped(selection.selected, items.map((item) => item.id), new Set([...ids].map(Number)))),
              rowLabel: (item) => itemDisplayName(item),
              ariaLabel: (item) => t('inventory.bulk.selectUnit', { name: itemDisplayName(item), id: item.id }),
            }
          : undefined
      }
      loading={loading}
      empty={empty}
      footer={<TurnoverLegend limits={limits} />}
    />
  );
}
