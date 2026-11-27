'use client';

import { useT } from '@/i18n/I18nProvider';
import { itemDisplayName } from '@/lib/itemName';
import { groupRowActions, type DisabledReason, type ItemActionId } from '@/lib/itemRowActions';
import type { ItemGroup, SaleState } from '@/types/api';
import ReasonButton from './ReasonButton';
import Menu, { type MenuEntry } from '../ui/Menu';
import styles from './inventory.module.css';

export interface GroupActionHandlers {
  // Vender pelo grupo: abre a venda da primeira unidade que pode ser vendida (o seletor de unidade chega na 12.6).
  onSellGroup: (group: ItemGroup) => void;
  onToggle: (key: string) => void;
  // Lote do grupo: abre o diálogo com a quantidade (BulkSaleStateDialog).
  onBulk: (group: ItemGroup, direction: 'OFF_SALE' | 'FOR_SALE') => void;
}

interface Props {
  group: ItemGroup;
  saleState: SaleState;
  expanded: boolean;
  handlers: GroupActionHandlers;
}

// Ações da linha do grupo: principal + "Mais ações" (D370, 12.5a). As regras estão em `lib/itemRowActions`.
export default function GroupRowActions({ group, saleState, expanded, handlers }: Props) {
  const t = useT();
  const { primary, menu } = groupRowActions(group, saleState);
  const name = itemDisplayName(group);

  const labelOf = (id: ItemActionId): string => {
    switch (id) {
      case 'sell': return t('inventory.actions.sell');
      case 'viewUnits': return expanded ? t('inventory.group.collapse', { name }) : t('inventory.actions.viewUnits');
      case 'bulkOffSale': return t('inventory.bulk.offSaleButton');
      case 'bulkForSale': return t('inventory.bulk.forSaleButton');
      default: return id;
    }
  };
  const reasonText = (reason: DisabledReason | undefined): string | undefined => (reason === 'NO_SELLABLE_UNIT' ? t('inventory.actions.noSellableUnit') : undefined);
  const run = (id: ItemActionId) => {
    if (id === 'sell') handlers.onSellGroup(group);
    else if (id === 'viewUnits') handlers.onToggle(group.key);
    else if (id === 'bulkOffSale') handlers.onBulk(group, 'OFF_SALE');
    else if (id === 'bulkForSale') handlers.onBulk(group, 'FOR_SALE');
  };

  const entries: MenuEntry[] = menu.map((action) => ({
    id: action.id,
    label: labelOf(action.id),
    disabled: action.disabled,
    disabledReason: reasonText(action.disabledReason),
    onSelect: () => run(action.id),
  }));

  return (
    <div className={styles.actions}>
      {primary && (
        <ReasonButton
          disabled={Boolean(primary.disabled)}
          reason={reasonText(primary.disabledReason)}
          variant={primary.id === 'sell' ? 'primary' : 'secondary'}
          onClick={() => run(primary.id)}
        >
          {labelOf(primary.id)}
        </ReasonButton>
      )}
      <Menu label={t('inventory.actions.moreFor', { name })} items={entries} />
    </div>
  );
}
