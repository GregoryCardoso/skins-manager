'use client';

import { useState, type ReactNode } from 'react';
import { useLocale, useT, useTPlural } from '@/i18n/I18nProvider';
import { formatDate, formatMoney, formatRate } from '@/lib/format';
import { itemDisplayName } from '@/lib/itemName';
import type { SalesFilters } from '@/lib/salesQuery';
import type { ItemView, Store } from '@/types/api';
import { useDisplayStaleRateNote } from './useStaleRateNote';
import { PurchaseStoreCell, SaleItemCell, SaleMoney } from './SaleCells';
import SaleReleaseNote from './SaleReleaseNote';
import SaleTurnoverCell from './SaleTurnoverCell';
import ItemRowActions, { type UnitRowHandlers } from './inventory/ItemRowActions';
import { UnitCostCell } from './inventory/UnitCells';
import Badge from './ui/Badge';
import DataTable, { DetailsRow, HiddenColumnsList, type Column, type SortOrder } from './ui/DataTable';
import HelpTip from './ui/HelpTip';
import Money from './ui/Money';
import { TurnoverLegend, type TurnoverLimits } from './ui/TurnoverRule';
import styles from './sales.module.css';

// A tabela de vendas tem 10 colunas. Com os limites padrão do DataTable, numa janela de 1440 a coluna de ações ficaria atrás da rolagem
// (o mesmo problema do inventário). Aqui a prioridade 2 (tempo até vender) sai abaixo de 1010 px de tabela e a 3 (lojas, custo e preço
// de venda) abaixo de 1530 px; o que sai vai para a linha expandida.
export const SALES_HIDE_AT = { 2: 1010, 3: 1530 } as const;

export interface SalesTableProps {
  items: ItemView[];
  stores: Store[];
  limits: TurnoverLimits;
  handlers: Pick<UnitRowHandlers, 'onEdit' | 'onUnsell' | 'onDelete' | 'onHistory' | 'onComponents'>;
  // Ordem pedida à API (a tabela nunca ordena).
  sort: SalesFilters['sort'];
  order: SalesFilters['order'];
  onSortChange: (sort: SalesFilters['sort'], order: SalesFilters['order']) => void;
  // Linha apontada por `?item=<id>` (link do resumo da importação): destaque.
  highlightedItemId?: number | null;
  density?: 'compact' | 'comfortable';
  loading?: boolean;
  empty?: ReactNode;
}

const noop = () => undefined;

export default function SalesTable({
  items, stores, limits, handlers, sort, order, onSortChange, highlightedItemId = null, density = 'compact', loading = false, empty,
}: SalesTableProps) {
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const staleRateNote = useDisplayStaleRateNote();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const unitHandlers: UnitRowHandlers = {
    onEdit: handlers.onEdit,
    onComponents: handlers.onComponents,
    onUnsell: handlers.onUnsell,
    onDelete: handlers.onDelete,
    onHistory: handlers.onHistory,
    onSell: noop,
    onOffSale: noop,
    onForSale: noop,
  };
  const storeName = (id: number | null) => (id !== null ? stores.find((s) => s.id === id)?.name : undefined);
  const none = <span className={styles.muted}>{t('common.none')}</span>;

  const columns: Column<ItemView>[] = [
    { id: 'item', header: t('sales.columns.item'), priority: 1, minWidth: '14rem', cell: (item) => <SaleItemCell item={item} /> },
    { id: 'purchaseStore', header: t('sales.columns.purchaseStore'), priority: 3, cell: (item) => <PurchaseStoreCell item={item} stores={stores} /> },
    { id: 'saleStore', header: t('sales.columns.saleStore'), priority: 3, cell: (item) => storeName(item.saleStoreId) ?? none },
    {
      id: 'cost',
      header: t('sales.columns.cost'),
      priority: 3,
      cell: (item) => {
        const info = item.saleInfo;
        if (!info) return <span>{formatMoney(item.purchasePriceCents, item.purchaseCurrency, locale)}</span>;
        if (info.inheritedCostUsdCents !== 0) return <UnitCostCell item={item} />;
        return (
          <SaleMoney
            cents={item.purchasePriceCents}
            currency={item.purchaseCurrency}
            usdCents={info.purchaseCostUsdCents}
            approxCents={info.approx.purchaseCost}
            approxCurrency={info.approxCurrency}
            rateNote={info.fxUsed.purchase !== null ? formatRate(info.fxUsed.purchase, locale, item.purchaseCurrency) : null}
          />
        );
      },
    },
    {
      id: 'salePrice',
      header: t('sales.columns.salePrice'),
      priority: 3,
      cell: (item) => {
        const info = item.saleInfo;
        if (!info || item.salePriceCents === null) return none;
        const saleCurrency = item.saleCurrency ?? 'USD';
        return (
          <SaleMoney
            cents={item.salePriceCents}
            currency={saleCurrency}
            usdCents={info.salePriceUsdCents}
            approxCents={info.approx.salePrice}
            approxCurrency={info.approxCurrency}
            rateNote={info.fxUsed.sale !== null ? t('sales.saleRateNote', { rate: formatRate(info.fxUsed.sale, locale, saleCurrency) }) : null}
          />
        );
      },
    },
    {
      id: 'netReceived',
      header: t('sales.columns.netReceived'),
      priority: 1,
      minWidth: '8rem',
      cell: (item) => {
        const info = item.saleInfo;
        if (!info || item.netReceivedCents === null) return none;
        return (
          <span className={styles.stack}>
            <SaleMoney
              cents={item.netReceivedCents}
              currency={item.saleCurrency ?? 'USD'}
              usdCents={info.netReceivedUsdCents}
              approxCents={info.approx.netReceived}
              approxCurrency={info.approxCurrency}
            />
            {item.netReceivedManual && <span className={styles.muted}>{t('sales.manualNet')}</span>}
            <SaleReleaseNote item={item} />
          </span>
        );
      },
    },
    {
      id: 'profit',
      header: t('sales.columns.profit'),
      priority: 1,
      minWidth: '8rem',
      cell: (item) => {
        const info = item.saleInfo;
        const profit = info ? info.netReceivedUsdCents - info.purchaseCostUsdCents : item.saleProfitUsdCents;
        if (!info || profit === null) return none;
        return (
          <span className={styles.stack}>
            <Money size="sm" signed cents={profit} currency="USD" approxCents={info.approx.profit} approxCurrency={info.approxCurrency} staleRateNote={info.approx.profit !== null ? staleRateNote : undefined} />
            {info.usesRecordedFx && (
              <span className={styles.nowrap}>
                <Badge tone="info">{t('sales.fxBadge')}</Badge>{' '}
                <HelpTip topic={t('sales.fxBadge')}>
                  {t('sales.fxTitle', {
                    sale: info.fxUsed.sale === null ? t('common.none') : formatRate(info.fxUsed.sale, locale, item.saleCurrency ?? 'BRL'),
                    purchase: info.fxUsed.purchase === null ? t('common.none') : formatRate(info.fxUsed.purchase, locale, item.purchaseCurrency),
                  })}
                </HelpTip>
              </span>
            )}
          </span>
        );
      },
    },
    {
      id: 'soldAt',
      header: t('sales.columns.soldAt'),
      priority: 1,
      sortable: true,
      firstOrder: 'desc',
      cell: (item) => <span className={styles.nowrap}>{item.soldAt ? formatDate(item.soldAt, locale) : t('common.none')}</span>,
    },
    {
      id: 'turnover',
      header: t('sales.columns.days'),
      priority: 2,
      sortable: true,
      minWidth: '9rem',
      cell: (item) => <SaleTurnoverCell item={item} limits={limits} />,
    },
    {
      id: 'actions',
      header: t('sales.columns.actions'),
      hideHeader: true,
      align: 'end',
      stickyEnd: true,
      priority: 1,
      cell: (item) => <ItemRowActions item={item} handlers={unitHandlers} />,
    },
  ];

  const sortColumn = sort === 'turnaround' ? 'turnover' : 'soldAt';

  return (
    <DataTable<ItemView>
      hideAt={SALES_HIDE_AT}
      caption={t('sales.title')}
      columns={columns}
      rows={items}
      getRowId={(item) => String(item.id)}
      density={density}
      sort={{ columnId: sortColumn, order }}
      onSortChange={(columnId, next: SortOrder) => onSortChange(columnId === 'turnover' ? 'turnaround' : 'soldAt', next)}
      rowLabel={(item) => itemDisplayName(item)}
      highlightedId={highlightedItemId === null ? null : String(highlightedItemId)}
      expandable={{
        isExpanded: (id) => open.has(id),
        onToggle: (id) =>
          setOpen((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }),
        rowLabel: (item) => itemDisplayName(item),
        renderExpanded: (item, hidden, context) => {
          const aging = item.aging;
          const held = 'daysHeld' in aging ? aging.daysHeld : null;
          const info = item.saleInfo;
          const showFx = info?.usesRecordedFx === true;
          return (
            <DetailsRow colSpan={context.colSpan}>
              <HiddenColumnsList row={item} columns={hidden} />
              <ul className={styles.expanded}>
                {held !== null && <li>{t('sales.daysHeld', { days: tPlural('common.dayCount', held) })}</li>}
                {showFx && info && (
                  <li>
                    {t('sales.expandedFx', {
                      sale: info.fxUsed.sale === null ? t('common.none') : formatRate(info.fxUsed.sale, locale, item.saleCurrency ?? 'BRL'),
                      purchase: info.fxUsed.purchase === null ? t('common.none') : formatRate(info.fxUsed.purchase, locale, item.purchaseCurrency),
                    })}
                  </li>
                )}
              </ul>
            </DetailsRow>
          );
        },
      }}
      loading={loading}
      empty={empty}
      footer={
        <div className={styles.footer}>
          <TurnoverLegend variant="sale" limits={limits} />
          <p className={styles.footerNote}>{t('sales.turnover.header')}</p>
        </div>
      }
    />
  );
}
