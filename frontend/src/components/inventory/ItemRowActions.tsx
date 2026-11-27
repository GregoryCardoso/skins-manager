'use client';

import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate } from '@/lib/format';
import { itemDisplayName } from '@/lib/itemName';
import { rowActions, type DisabledReason, type ItemActionId, type RowAction } from '@/lib/itemRowActions';
import { isHttpsLink } from '@/lib/safeUrl';
import type { ItemView } from '@/types/api';
import Button from '../ui/Button';
import Menu, { type MenuEntry } from '../ui/Menu';
import type { IconName } from '../ui/Icon';
import styles from './inventory.module.css';

export interface UnitRowHandlers {
  onEdit: (item: ItemView) => void;
  // `units`: só a linha do grupo passa (a venda mostra o seletor de unidade, 12.6b).
  onSell: (item: ItemView, units?: ItemView[]) => void;
  onUnsell: (item: ItemView) => void;
  onDelete: (item: ItemView) => void;
  onHistory: (item: ItemView) => void;
  onOffSale: (item: ItemView) => void;
  onForSale: (item: ItemView) => void;
  onApply?: (item: ItemView) => void;
  // Abre a edição já no painel "Componentes" (12.6a).
  onComponents?: (item: ItemView) => void;
  onOpen?: (item: ItemView) => void;
  onRegisterKey?: (keyName: string) => void;
  onDetach?: (item: ItemView) => void;
}

interface Props {
  item: ItemView;
  handlers: UnitRowHandlers;
  // "Colocar à venda" em andamento: o botão fica carregando (evita clique duplo).
  forSalePendingId?: number | null;
}

// Rótulo da ação "Abrir…" por tipo (caixa, terminal, cápsula, pacote).
function openLabelKey(item: ItemView): string {
  const kind = item.openable?.kind;
  if (kind === 'CASE') return 'inventory.actions.openCase';
  if (kind === 'TERMINAL') return 'inventory.actions.openTerminal';
  return item.category === 'CAPSULA' ? 'inventory.actions.openCapsule' : 'inventory.actions.openPackage';
}

// Uma ação principal + o menu "Mais ações" (D370, 12.5a). As regras de quais ações existem estão em `lib/itemRowActions`.
export default function ItemRowActions({ item, handlers, forSalePendingId = null }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const { primary, menu } = rowActions(item);
  const name = itemDisplayName(item);

  const lockDate = item.tradeLock.tradeUnlockAt ? formatDate(item.tradeLock.tradeUnlockAt, locale) : '';
  const reasonText = (reason: DisabledReason | undefined): string | undefined => {
    if (reason === 'TRADE_LOCK') return t('inventory.actions.lockedHint', { date: lockDate });
    if (reason === 'NEEDS_KEY' || reason === 'NEEDS_KEY_OTHER') {
      return t(reason === 'NEEDS_KEY_OTHER' ? 'inventory.actions.openNeedsKeyOther' : 'inventory.actions.openNeedsKey', { keyName: item.openable?.requiredKeyName ?? '' });
    }
    return undefined;
  };

  const labelOf = (id: ItemActionId): string => {
    switch (id) {
      case 'sell': return t('inventory.actions.sell');
      case 'forSale': return t('inventory.actions.forSale');
      case 'offSale': return t('inventory.actions.offSale');
      case 'edit': return t('inventory.actions.edit');
      case 'components': return t('inventory.actions.components');
      case 'apply': return t('inventory.actions.apply');
      case 'detach': return t('inventory.actions.detach');
      case 'open': return tLoose(openLabelKey(item));
      case 'registerKey': return t('inventory.actions.registerKey');
      case 'inspect': return t('inventory.inspect');
      case 'history': return t('inventory.actions.history');
      case 'unsell': return t('inventory.actions.unsell');
      case 'delete': return t('inventory.actions.delete');
      default: return id;
    }
  };

  const run = (id: ItemActionId) => {
    switch (id) {
      case 'sell': return handlers.onSell(item);
      case 'forSale': return handlers.onForSale(item);
      case 'offSale': return handlers.onOffSale(item);
      case 'edit': return handlers.onEdit(item);
      case 'components': return handlers.onComponents?.(item);
      case 'apply': return handlers.onApply?.(item);
      case 'detach': return handlers.onDetach?.(item);
      case 'open': return handlers.onOpen?.(item);
      case 'registerKey': return item.openable?.requiredKeyName ? handlers.onRegisterKey?.(item.openable.requiredKeyName) : undefined;
      case 'history': return handlers.onHistory(item);
      case 'unsell': return handlers.onUnsell(item);
      case 'delete': return handlers.onDelete(item);
      default: return undefined;
    }
  };

  // Só mostra o que o inventário sabe tratar (alguns manipuladores são opcionais).
  const supported = (action: RowAction): boolean => {
    if (action.id === 'components') return handlers.onComponents !== undefined;
    if (action.id === 'apply') return handlers.onApply !== undefined;
    if (action.id === 'detach') return handlers.onDetach !== undefined;
    if (action.id === 'open') return handlers.onOpen !== undefined;
    if (action.id === 'registerKey') return handlers.onRegisterKey !== undefined;
    return true;
  };

  const entries: MenuEntry[] = [];
  for (const action of menu.filter(supported)) {
    if (action.id === 'delete') entries.push({ type: 'separator' });
    const icon: IconName | undefined = action.id === 'inspect' ? 'externalLink' : undefined;
    entries.push({
      id: action.id,
      label: labelOf(action.id),
      icon,
      tone: action.id === 'delete' ? 'danger' : undefined,
      disabled: action.disabled,
      disabledReason: reasonText(action.disabledReason),
      ...(action.id === 'inspect' && item.inspectLink
        ? { href: item.inspectLink, external: isHttpsLink(item.inspectLink) }
        : { onSelect: () => run(action.id) }),
    });
  }

  const primaryBusy = primary?.id === 'forSale' && forSalePendingId === item.id;
  return (
    <div className={styles.actions}>
      {primary && (
        <Button
          size="sm"
          variant={primary.id === 'sell' ? 'primary' : 'secondary'}
          loading={primaryBusy}
          aria-disabled={primary.disabled ? true : undefined}
          onClick={() => {
            if (!primary.disabled) run(primary.id);
          }}
        >
          {labelOf(primary.id)}
        </Button>
      )}
      <Menu label={t('inventory.actions.moreFor', { name })} items={entries} />
    </div>
  );
}
