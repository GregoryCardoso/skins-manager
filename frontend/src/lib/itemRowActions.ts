// Ações de uma linha do inventário (D370, 12.5a): uma ação principal e o menu "Mais ações". PURA: só lê campos que a API já devolve
// (`status`, `saleState`, `tradeLock`, `canReceiveComponents`, `components`, `openable`, `inspectLink`). Nenhuma regra nova.
import type { ItemGroup, ItemView, SaleState } from '@/types/api';
import { groupBulkAction } from '@/lib/bulkSaleState';
import { isSafeInspectLink } from '@/lib/safeUrl';

export type ItemActionId =
  | 'sell'
  | 'forSale'
  | 'offSale'
  | 'edit'
  | 'apply'
  | 'detach'
  | 'open'
  | 'registerKey'
  | 'inspect'
  | 'history'
  | 'unsell'
  | 'delete'
  | 'viewUnits'
  | 'bulkOffSale'
  | 'bulkForSale';

// `TRADE_LOCK`: vender só depois da liberação. `NEEDS_KEY` / `NEEDS_KEY_OTHER`: a caixa não tem chave compatível em estoque.
export type DisabledReason = 'TRADE_LOCK' | 'NEEDS_KEY' | 'NEEDS_KEY_OTHER' | 'NO_SELLABLE_UNIT';

export interface RowAction {
  id: ItemActionId;
  disabled?: boolean;
  disabledReason?: DisabledReason;
}

export interface RowActions {
  primary: RowAction | null;
  // Na ordem do menu. "Excluir" fica por último (o componente põe o separador antes dele).
  menu: RowAction[];
}

const act = (id: ItemActionId, extra: Partial<RowAction> = {}): RowAction => ({ id, ...extra });

// Unidade (linha da visão individual ou unidade expandida de um grupo).
export function rowActions(item: ItemView): RowActions {
  if (item.status === 'VENDIDO') {
    return { primary: null, menu: [act('edit'), act('unsell'), act('history'), act('delete')] };
  }
  if (item.status !== 'EM_ESTOQUE') {
    return { primary: null, menu: [act('edit'), act('history'), act('delete')] };
  }
  const locked = item.tradeLock.isLocked;
  const holding = item.saleState === 'OFF_SALE';
  const sell = act('sell', locked ? { disabled: true, disabledReason: 'TRADE_LOCK' } : {});

  const common: RowAction[] = [act('edit')];
  if (item.canReceiveComponents) common.push(act('apply'));
  if (item.components.some((component) => component.detachable)) common.push(act('detach'));
  if (item.openable) {
    const needsKey = item.openable.kind === 'CASE' && item.openable.compatibleKeys === 0;
    common.push(
      needsKey ? act('open', { disabled: true, disabledReason: item.openable.otherKeysInStock > 0 ? 'NEEDS_KEY_OTHER' : 'NEEDS_KEY' }) : act('open'),
    );
    if (needsKey && item.openable.requiredKeyName) common.push(act('registerKey'));
  }

  const tail: RowAction[] = [];
  if (isSafeInspectLink(item.inspectLink)) tail.push(act('inspect'));
  tail.push(act('history'), act('delete'));

  if (holding) return { primary: act('forSale'), menu: [sell, ...common, ...tail] };
  return { primary: sell, menu: [...common, act('offSale'), ...tail] };
}

// Linha do grupo (visão agrupada). Aba "À venda": Vender (a primeira unidade que pode ser vendida) e mover o lote para o holding;
// aba "Holding": voltar o lote para a venda.
export function groupRowActions(group: ItemGroup, saleState: SaleState): RowActions {
  const bulk = groupBulkAction(group, saleState);
  const bulkId: ItemActionId | null = bulk ? (bulk.direction === 'OFF_SALE' ? 'bulkOffSale' : 'bulkForSale') : null;
  if (saleState === 'OFF_SALE') {
    return { primary: bulkId ? act(bulkId) : null, menu: [act('viewUnits')] };
  }
  const sellable = firstSellableUnit(group) !== null;
  return {
    primary: act('sell', sellable ? {} : { disabled: true, disabledReason: 'NO_SELLABLE_UNIT' }),
    menu: [act('viewUnits'), ...(bulkId ? [act(bulkId)] : [])],
  };
}

// Padrão da venda pelo grupo: a primeira unidade, na ordem da API, que não está em trade lock nem no holding. É só um padrão de tela:
// o backend continua recusando a venda em trade lock.
export function firstSellableUnit(group: ItemGroup): ItemView | null {
  return group.units.find((unit) => unit.status === 'EM_ESTOQUE' && unit.saleState !== 'OFF_SALE' && !unit.tradeLock.isLocked) ?? null;
}
