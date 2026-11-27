// Seleção única do inventário (D370, 12.5b): um conjunto de ids de unidades na página, nas duas visões. Funções puras.
import type { ItemGroup, ItemView, SaleState } from '@/types/api';

// Limite do validador de `POST /api/items/bulk/*` (itemIds de 1 a 500).
export const MAX_BULK_IDS = 500;

export type BulkDirection = 'OFF_SALE' | 'FOR_SALE';

// Na aba "À venda" a ação move para o holding; na aba "Holding", volta para a venda.
export function selectionDirection(saleState: SaleState): BulkDirection {
  return saleState === 'OFF_SALE' ? 'FOR_SALE' : 'OFF_SALE';
}

// Só sobram na seleção as unidades que ainda estão na tela (depois de uma recarga ou de um filtro).
export function pruneSelection(selected: ReadonlySet<number>, visibleIds: ReadonlySet<number>): ReadonlySet<number> {
  let changed = false;
  const next = new Set<number>();
  for (const id of selected) {
    if (visibleIds.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : selected;
}

export function unitIdsOf(groups: readonly ItemGroup[]): Set<number> {
  return new Set(groups.flatMap((group) => group.units.map((unit) => unit.id)));
}

export function itemIdsOf(items: readonly ItemView[]): Set<number> {
  return new Set(items.map((item) => item.id));
}

export type GroupSelectionState = 'all' | 'some' | 'none';

// Quantas unidades do grupo, na tela, estão marcadas.
export function groupSelectionState(group: ItemGroup, selected: ReadonlySet<number>): GroupSelectionState {
  const total = group.units.length;
  const chosen = group.units.filter((unit) => selected.has(unit.id)).length;
  if (chosen === 0) return 'none';
  return chosen === total ? 'all' : 'some';
}

// Marca ou desmarca todas as unidades do grupo que estão na tela. Não toca nas de outros grupos.
export function setGroupSelected(selected: ReadonlySet<number>, group: ItemGroup, checked: boolean): Set<number> {
  const next = new Set(selected);
  for (const unit of group.units) {
    if (checked) next.add(unit.id);
    else next.delete(unit.id);
  }
  return next;
}

// Substitui, na seleção, só as unidades de `scopeIds` pelas de `ids` (a caixa "selecionar todas" de uma tabela de unidades).
export function replaceScoped(selected: ReadonlySet<number>, scopeIds: readonly number[], ids: ReadonlySet<number>): Set<number> {
  const next = new Set(selected);
  for (const id of scopeIds) {
    if (ids.has(id)) next.add(id);
    else next.delete(id);
  }
  return next;
}

// O que as tabelas recebem da página: a seleção única e como alterá-la. Sem isto (undefined), a tabela não tem caixas.
export interface InventorySelection {
  selected: ReadonlySet<number>;
  onChange: (next: ReadonlySet<number>) => void;
}
