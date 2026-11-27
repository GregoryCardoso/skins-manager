// Colunas das duas visões do inventário (D370, 12.5a), com `priority` para o DataTable. Só apresentação: nenhum valor é calculado aqui.
// Prioridade 1 = sempre visível; 2 = some com a tabela < 720 px; 3 = some com a tabela < 960 px (vai para a linha expandida).
import type { ReactNode } from 'react';
import type { useT } from '@/i18n/I18nProvider';
import { forSaleCount, holdingCount } from '@/lib/bulkSaleState';
import { formatDate } from '@/lib/format';
import type { ItemGroup, ItemView, SaleState, Store } from '@/types/api';
import GroupRowActions, { type GroupActionHandlers } from '@/components/inventory/GroupRowActions';
import ItemRowActions, { type UnitRowHandlers } from '@/components/inventory/ItemRowActions';
import { GroupNameCell, ItemNameCell } from '@/components/inventory/ItemNameCell';
import MinPriceSummary, { GroupMinPrice } from '@/components/inventory/MinPriceSummary';
import { DaysInInventoryCell, StoreCell, TurnoverCell, UnitCostCell } from '@/components/inventory/UnitCells';
import styles from '@/components/inventory/inventory.module.css';
import ItemImage from '@/components/ItemImage';
import { GroupMarketCell, GroupUnrealizedCell, UnitMarketCell, UnitUnrealizedCell } from '@/components/MarketValueCell';
import HelpTip from '@/components/ui/HelpTip';
import Money from '@/components/ui/Money';
import type { Column } from '@/components/ui/DataTable';
import type { TurnoverLimits } from '@/components/ui/TurnoverRule';

type Translate = ReturnType<typeof useT>;

export interface UnitColumnsDeps {
  t: Translate;
  stores: Store[];
  limits: TurnoverLimits;
  handlers: UnitRowHandlers;
  forSalePendingId: number | null;
  // Colunas de valor de mercado (somem com o filtro "Vendido").
  showMarket: boolean;
}

export interface GroupColumnsDeps {
  t: Translate;
  locale: string;
  stores: Store[];
  limits: TurnoverLimits;
  groupHandlers: GroupActionHandlers;
  saleState: SaleState;
  expandedKeys: ReadonlySet<string>;
  showMarket: boolean;
}

function imageColumn<R extends { category: ItemView['category']; catalog?: ItemView['catalog'] }>(header: string): Column<R> {
  return {
    id: 'image',
    header,
    hideHeader: true,
    priority: 1,
    width: '4.5rem',
    cell: (row) => <ItemImage category={row.category} url={row.catalog?.imageUrl} />,
  };
}

// Visão individual e unidades expandidas de um grupo.
export function unitColumns(deps: UnitColumnsDeps): Column<ItemView>[] {
  const { t, stores, limits, handlers, forSalePendingId, showMarket } = deps;
  const columns: Column<ItemView>[] = [
    imageColumn<ItemView>(t('inventory.columns.image')),
    { id: 'item', header: t('inventory.columns.item'), priority: 1, minWidth: '12rem', cell: (item) => <ItemNameCell item={item} /> },
    { id: 'store', header: t('inventory.columns.store'), priority: 2, cell: (item) => <StoreCell item={item} stores={stores} /> },
    { id: 'cost', header: t('inventory.columns.cost'), priority: 2, cell: (item) => <UnitCostCell item={item} /> },
  ];
  if (showMarket) {
    columns.push(
      { id: 'marketValue', header: t('inventory.columns.marketValue'), priority: 3, cell: (item) => <UnitMarketCell marketValue={item.marketValue} /> },
      { id: 'unrealized', header: t('inventory.columns.unrealized'), priority: 3, cell: (item) => <UnitUnrealizedCell marketValue={item.marketValue} /> },
    );
  }
  columns.push(
    {
      id: 'minPrice',
      header: t('inventory.columns.minPrice'),
      priority: 1,
      minWidth: '8rem',
      cell: (item) =>
        item.status === 'VENDIDO' ? <span className={styles.muted}>{t('common.none')}</span> : <MinPriceSummary minPrices={item.minPrices} stores={stores} showOthers />,
    },
    { id: 'turnover', header: t('inventory.columns.turnover'), priority: 1, sortable: true, firstOrder: 'desc', minWidth: '9rem', cell: (item) => <TurnoverCell item={item} limits={limits} /> },
    { id: 'days', header: t('inventory.columns.days'), priority: 3, cell: (item) => <DaysInInventoryCell item={item} /> },
    {
      id: 'actions',
      header: t('inventory.columns.actions'),
      hideHeader: true,
      align: 'end',
      stickyEnd: true,
      priority: 1,
      cell: (item) => <ItemRowActions item={item} handlers={handlers} forSalePendingId={forSalePendingId} />,
    },
  );
  return columns;
}

function GroupMoney({ group, cents, approxCents }: { group: ItemGroup; cents: number; approxCents: number | null }): ReactNode {
  return (
    <Money
      size="sm"
      cents={cents}
      currency="USD"
      estimated={group.costUsesRecordedFx}
      estimatedBadge={false}
      approxCents={approxCents}
      approxCurrency={group.approxCurrency}
    />
  );
}

function CostWithHelp({ group, cents, approxCents, topic, help }: { group: ItemGroup; cents: number; approxCents: number | null; topic: string; help: string }) {
  return (
    <span className={styles.cellWithHelp}>
      <GroupMoney group={group} cents={cents} approxCents={approxCents} />
      {group.costUsesRecordedFx && <HelpTip topic={topic}>{help}</HelpTip>}
    </span>
  );
}

// Quantidade do grupo: o total, a divisão à venda / holding e a próxima liberação do trade lock.
function QuantityCell({ group, t, locale }: { group: ItemGroup; t: Translate; locale: string }) {
  const { stock } = group;
  return (
    <div className={styles.stack}>
      <strong>{group.quantity}</strong>
      <span className={styles.muted}>{t('inventory.group.quantitySplit', { forSale: forSaleCount(group), holding: holdingCount(group) })}</span>
      {stock.tradeLocked > 0 && (
        <span className={styles.muted}>
          {t('inventory.group.tradeLocked', { count: stock.tradeLocked, date: stock.nextUnlockAt ? formatDate(stock.nextUnlockAt, locale) : t('common.none') })}
        </span>
      )}
    </div>
  );
}

// O inventário tem até 12 colunas: com os limites padrão do DataTable (960 e 720), a tabela passa da largura numa janela de 1440 e a
// coluna de ações fica atrás da rolagem. Aqui as de prioridade 3 somem abaixo de 1280 px de tabela e as de prioridade 2 abaixo de 1000.
export const INVENTORY_HIDE_AT = { 2: 1000, 3: 1280 } as const;

// Visão agrupada. O preço mínimo e a régua são os da primeira unidade na ordem da API (a que posiciona o grupo, 2.11).
export function groupColumns(deps: GroupColumnsDeps): Column<ItemGroup>[] {
  const { t, locale, stores, limits, groupHandlers, saleState, expandedKeys, showMarket } = deps;
  const first = (group: ItemGroup): ItemView | undefined => group.units[0];
  const columns: Column<ItemGroup>[] = [
    imageColumn<ItemGroup>(t('inventory.columns.image')),
    { id: 'item', header: t('inventory.columns.item'), priority: 1, minWidth: '12rem', cell: (group) => <GroupNameCell group={group} /> },
    { id: 'quantity', header: t('inventory.columns.quantity'), priority: 1, minWidth: '9rem', cell: (group) => <QuantityCell group={group} t={t} locale={locale} /> },
    {
      id: 'minPrice',
      header: t('inventory.columns.minPrice'),
      priority: 1,
      minWidth: '8rem',
      cell: (group) => (group.units.length > 0 ? <GroupMinPrice units={group.units} stores={stores} /> : <span className={styles.muted}>{t('common.none')}</span>),
    },
    {
      id: 'turnover',
      header: t('inventory.columns.turnover'),
      priority: 1,
      sortable: true,
      firstOrder: 'desc',
      minWidth: '9rem',
      cell: (group) => {
        const unit = first(group);
        return unit ? <TurnoverCell item={unit} limits={limits} /> : <span className={styles.muted}>{t('common.none')}</span>;
      },
    },
    {
      id: 'avgCost',
      header: t('inventory.columns.avgCost'),
      priority: 2,
      cell: (group) => (
        <CostWithHelp group={group} cents={group.avgCostUsdCents} approxCents={group.approx?.avgCostCents ?? null} topic={t('inventory.columns.avgCost')} help={t('inventory.help.convertedCost')} />
      ),
    },
    {
      id: 'totalCost',
      header: t('inventory.columns.totalCost'),
      priority: 3,
      cell: (group) => (
        <CostWithHelp group={group} cents={group.totalCostUsdCents} approxCents={group.approx?.totalCostCents ?? null} topic={t('inventory.columns.totalCost')} help={t('inventory.help.convertedCost')} />
      ),
    },
  ];
  if (showMarket) {
    columns.push(
      { id: 'marketValue', header: t('inventory.columns.marketValue'), priority: 3, cell: (group) => <GroupMarketCell totals={group.marketValue} /> },
      { id: 'unrealized', header: t('inventory.columns.unrealized'), priority: 3, cell: (group) => <GroupUnrealizedCell totals={group.marketValue} /> },
    );
  }
  columns.push({
    id: 'actions',
    header: t('inventory.columns.actions'),
    hideHeader: true,
    align: 'end',
    stickyEnd: true,
    priority: 1,
    cell: (group) => <GroupRowActions group={group} saleState={saleState} expanded={expandedKeys.has(group.key)} handlers={groupHandlers} />,
  });
  return columns;
}
