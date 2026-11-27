'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useLocale, useT } from '@/i18n/I18nProvider';
import { groupBulkAction } from '@/lib/bulkSaleState';
import { groupColumns, unitColumns, INVENTORY_HIDE_AT } from '@/lib/inventoryColumns';
import { groupSelectionState, replaceScoped, setGroupSelected, type InventorySelection } from '@/lib/inventorySelection';
import { firstSellableUnit } from '@/lib/itemRowActions';
import { itemDisplayName } from '@/lib/itemName';
import type { ItemGroup, ItemView, SaleState, Store } from '@/types/api';
import BulkSaleStateDialog, { type BulkDirection } from './BulkSaleStateDialog';
import DataTable, { DetailsRow, HiddenColumnsList, type SortOrder } from './ui/DataTable';
import { TurnoverLegend, type TurnoverLimits } from './ui/TurnoverRule';
import type { GroupActionHandlers } from './inventory/GroupRowActions';
import type { UnitRowHandlers } from './inventory/ItemRowActions';
import { isLockedStock, isStuck } from './inventory/UnitCells';
import styles from './inventory/inventory.module.css';

export interface InventoryGroupTableProps {
  groups: ItemGroup[];
  stores: Store[];
  handlers: UnitRowHandlers;
  limits: TurnoverLimits;
  // Chaves dos grupos expandidos: o estado vive na página e sobrevive às recargas (D277).
  expandedKeys: ReadonlySet<string>;
  onToggle: (key: string) => void;
  forSalePendingId?: number | null;
  // Linha apontada por `?item=<id>` (destaque).
  highlightedItemId?: number | null;
  // Aba atual (9.5.1a): decide a ação em lote da linha ("Mover para o holding" ou "Voltar para a venda").
  saleState?: SaleState;
  showMarket?: boolean;
  density: 'compact' | 'comfortable';
  order: SortOrder;
  onOrderChange: (order: SortOrder) => void;
  loading?: boolean;
  empty?: ReactNode;
  // Seleção única da página (12.5b): a caixa da linha do grupo marca as unidades do grupo que estão na tela.
  selection?: InventorySelection;
}

type BulkTarget = { groupKey: string; available: number };

// Visão agrupada (D277, D370 12.5a/12.5b): uma linha por chave do itemStats; ao expandir, as unidades numa tabela própria, com a mesma
// régua e as mesmas ações. A seleção é a única da página; o lote por quantidade continua no menu do grupo.
export default function InventoryGroupTable({
  groups, stores, handlers, limits, expandedKeys, onToggle, forSalePendingId = null, highlightedItemId = null, saleState = 'FOR_SALE', showMarket = true,
  density, order, onOrderChange, loading = false, empty, selection,
}: InventoryGroupTableProps) {
  const t = useT();
  const locale = useLocale();
  const [dialog, setDialog] = useState<{ direction: BulkDirection; name: string; target: BulkTarget } | null>(null);

  const groupHandlers: GroupActionHandlers = useMemo(
    () => ({
      onToggle,
      onSellGroup: (group) => {
        const unit = firstSellableUnit(group);
        if (unit) handlers.onSell(unit);
      },
      onBulk: (group, direction) => {
        const bulk = groupBulkAction(group, saleState);
        if (bulk) setDialog({ direction, name: itemDisplayName(group), target: { groupKey: group.key, available: bulk.available } });
      },
    }),
    [handlers, onToggle, saleState],
  );

  const columns = groupColumns({ t, locale, stores, limits, groupHandlers, saleState, expandedKeys, showMarket });
  const unitCols = unitColumns({ t, stores, limits, handlers, forSalePendingId, showMarket });
  const groupByKey = useMemo(() => new Map(groups.map((group) => [group.key, group])), [groups]);

  const renderExpanded = (group: ItemGroup, hidden: typeof columns, context: { colSpan: number }) => {
    const unitIds = group.units.map((unit) => unit.id);
    return (
      <DetailsRow colSpan={context.colSpan}>
        <HiddenColumnsList row={group} columns={hidden} />
        <div className={styles.unitsWrap}>
          <DataTable<ItemView>
            hideAt={INVENTORY_HIDE_AT}
            className={styles.nested}
            caption={t('inventory.group.expand', { name: itemDisplayName(group) })}
            columns={unitCols}
            rows={group.units}
            getRowId={(unit) => String(unit.id)}
            density={density}
            rowTone={(unit) => (isStuck(unit) ? 'stuck' : isLockedStock(unit) ? 'lock' : undefined)}
            rowLabel={(unit) => itemDisplayName(unit)}
            highlightedId={highlightedItemId === null ? null : String(highlightedItemId)}
            selection={
              selection
                ? {
                    selectedIds: new Set(unitIds.filter((id) => selection.selected.has(id)).map(String)),
                    onChange: (ids) => selection.onChange(replaceScoped(selection.selected, unitIds, new Set([...ids].map(Number)))),
                    rowLabel: (unit) => itemDisplayName(unit),
                    ariaLabel: (unit) => t('inventory.bulk.selectUnit', { name: itemDisplayName(unit), id: unit.id }),
                  }
                : undefined
            }
          />
        </div>
      </DetailsRow>
    );
  };

  return (
    <>
      <DataTable<ItemGroup>
        hideAt={INVENTORY_HIDE_AT}
        caption={t('inventory.title')}
        columns={columns}
        rows={groups}
        getRowId={(group) => group.key}
        density={density}
        sort={{ columnId: 'turnover', order }}
        onSortChange={(_, next) => onOrderChange(next)}
        expandable={{
          isExpanded: (key) => expandedKeys.has(key),
          onToggle,
          rowLabel: (group) => itemDisplayName(group),
          renderExpanded,
        }}
        selection={
          selection
            ? {
                selectedIds: new Set(groups.filter((group) => groupSelectionState(group, selection.selected) === 'all').map((group) => group.key)),
                onChange: (keys) => {
                  let next: ReadonlySet<number> = selection.selected;
                  for (const group of groups) {
                    const state = groupSelectionState(group, next);
                    const wanted = keys.has(group.key);
                    if (wanted && state !== 'all') next = setGroupSelected(next, group, true);
                    else if (!wanted && state === 'all') next = setGroupSelected(next, group, false);
                  }
                  selection.onChange(next);
                },
                rowLabel: (group) => itemDisplayName(group),
                ariaLabel: (group) => t('inventory.bulk.selectGroup', { name: itemDisplayName(group) }),
                isIndeterminate: (group) => groupSelectionState(groupByKey.get(group.key) ?? group, selection.selected) === 'some',
              }
            : undefined
        }
        rowTone={(group) => (group.stagnantCount > 0 ? 'stuck' : undefined)}
        loading={loading}
        empty={empty}
        footer={<TurnoverLegend limits={limits} />}
      />
      {dialog && <BulkSaleStateDialog direction={dialog.direction} name={dialog.name} target={dialog.target} onClose={() => setDialog(null)} onDone={() => setDialog(null)} />}
    </>
  );
}
