'use client';

import { useId } from 'react';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { formatDate, formatMoney } from '@/lib/format';
import type { ItemGroup, Store } from '@/types/api';
import { Badge } from './badges';
import ItemImage from './ItemImage';
import InventoryUnitRow, { UnitTableHead, type UnitRowHandlers } from './InventoryUnitRow';
import styles from './InventoryTable.module.css';
import groupStyles from './InventoryGroupTable.module.css';

interface Props extends UnitRowHandlers {
  groups: ItemGroup[];
  stores: Store[];
  // Chaves dos grupos expandidos: o estado vive na página e sobrevive às recargas (D277).
  expandedKeys: ReadonlySet<string>;
  onToggle: (key: string) => void;
  forSalePendingId?: number | null;
}

const COLUMNS = 6;

function GroupMoney({ group, cents, approxBrlCents }: { group: ItemGroup; cents: number; approxBrlCents: number | null }) {
  const t = useT();
  const locale = useLanguage();
  const main = formatMoney(cents, 'USD', locale);
  return (
    <div className={groupStyles.money} title={group.costUsesRecordedFx ? t('inventory.group.convertedCost') : undefined}>
      <span className={groupStyles.moneyMain}>{group.costUsesRecordedFx ? t('common.approx', { value: main }) : main}</span>
      {/* A dica do `title` não chega ao teclado nem ao leitor de tela (revisão da 8.8, item 6). */}
      {group.costUsesRecordedFx && <span className={groupStyles.srOnly}>{t('inventory.group.convertedCost')}</span>}
      {approxBrlCents !== null && (
        <small className={groupStyles.moneySide}>{t('common.approx', { value: formatMoney(approxBrlCents, 'BRL', locale) })}</small>
      )}
    </div>
  );
}

function SituationCell({ group }: { group: ItemGroup }) {
  const t = useT();
  const locale = useLanguage();
  const { stock } = group;
  const parts: string[] = [];
  if (stock.forSale > 0) parts.push(t('inventory.group.forSale', { count: stock.forSale }));
  if (stock.tradeLocked > 0) {
    parts.push(
      t('inventory.group.tradeLocked', {
        count: stock.tradeLocked,
        date: stock.nextUnlockAt ? formatDate(stock.nextUnlockAt, locale) : t('common.none'),
      }),
    );
  }
  if (stock.offSale > 0) parts.push(t('inventory.group.offSale', { count: stock.offSale }));
  return (
    <ul className={groupStyles.situation}>
      {parts.map((text) => <li key={text}>{text}</li>)}
    </ul>
  );
}

function GroupRow({
  group, stores, expanded, onToggle, forSalePendingId, handlers,
}: {
  group: ItemGroup;
  stores: Store[];
  expanded: boolean;
  onToggle: (key: string) => void;
  forSalePendingId: number | null;
  handlers: UnitRowHandlers;
}) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const id = useId();
  const unitsId = `${id}-units`;

  const details: string[] = [];
  if (group.variant && group.variant !== 'NORMAL') details.push(tLoose(`enums.variant.${group.variant}`));
  const exteriorLabel = group.exterior ? tLoose(`enums.exterior.${group.exterior}`) : null;
  if (group.exterior) details.push(tLoose(`enums.exteriorShort.${group.exterior}`));
  if (group.phase) details.push(group.phase);

  const classes = [styles.row, groupStyles.groupRow];
  if (group.stagnantCount > 0) classes.push(styles.stagnant);
  const toggleLabel = t(expanded ? 'inventory.group.collapse' : 'inventory.group.expand', { name: group.name });

  return (
    <>
      <tr className={classes.join(' ')}>
        <td>
          <div className={groupStyles.imageCell}>
            <button
              type="button"
              className={groupStyles.toggle}
              aria-expanded={expanded}
              aria-controls={unitsId}
              aria-label={toggleLabel}
              title={toggleLabel}
              onClick={() => onToggle(group.key)}
            >
              <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
            </button>
            <ItemImage category={group.category} url={group.catalog?.imageUrl} />
          </div>
        </td>
        <td>
          <div className={styles.itemCell}>
            <strong className={styles.name}>{group.name}</strong>
            {details.length > 0 && (
              <span className={styles.details} title={exteriorLabel ?? undefined}>{details.join(' · ')}</span>
            )}
            <span className={styles.badges}>
              <Badge>{tLoose(`enums.category.${group.category}`)}</Badge>
              {group.stagnantCount > 0 && (
                <Badge tone="danger">{tPlural('inventory.group.stagnant', group.stagnantCount)}</Badge>
              )}
            </span>
          </div>
        </td>
        <td className={groupStyles.number}>{group.quantity}</td>
        <td className={styles.nowrap}>
          <GroupMoney group={group} cents={group.avgCostUsdCents} approxBrlCents={group.approxBrl?.avgCostCents ?? null} />
        </td>
        <td className={styles.nowrap}>
          <GroupMoney group={group} cents={group.totalCostUsdCents} approxBrlCents={group.approxBrl?.totalCostCents ?? null} />
        </td>
        <td><SituationCell group={group} /></td>
      </tr>
      {expanded && (
        <tr id={unitsId} className={groupStyles.unitsRow}>
          <td colSpan={COLUMNS} className={groupStyles.unitsCell}>
            <div className={groupStyles.units}>
              <table className={styles.table}>
                <UnitTableHead />
                <tbody>
                  {group.units.map((unit) => (
                    <InventoryUnitRow key={unit.id} item={unit} stores={stores} forSalePendingId={forSalePendingId} {...handlers} />
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// Visão agrupada (D277): uma linha por chave do itemStats; ao expandir, as unidades com as ações atuais.
export default function InventoryGroupTable({
  groups, stores, expandedKeys, onToggle, forSalePendingId = null, ...handlers
}: Props) {
  const t = useT();
  return (
    <div className={styles.scroll}>
      <table className={`${styles.table} ${groupStyles.groupTable}`}>
        <thead>
          <tr>
            <th scope="col"><span className={styles.srOnly}>{t('inventory.columns.image')}</span></th>
            <th scope="col">{t('inventory.columns.item')}</th>
            <th scope="col">{t('inventory.columns.quantity')}</th>
            <th scope="col">{t('inventory.columns.avgCost')}</th>
            <th scope="col">{t('inventory.columns.totalCost')}</th>
            <th scope="col">{t('inventory.columns.situation')}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <GroupRow
              key={group.key}
              group={group}
              stores={stores}
              expanded={expandedKeys.has(group.key)}
              onToggle={onToggle}
              forSalePendingId={forSalePendingId}
              handlers={handlers}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
