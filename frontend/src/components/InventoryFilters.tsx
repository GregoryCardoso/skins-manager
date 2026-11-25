'use client';

import { useId } from 'react';
import { useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import {
  CATEGORIES, STATUS_FILTERS, hasActiveFilters, isStagnantDisabled,
  type AgeOrder, type CategoryFilter, type InventoryFilters as Filters, type StatusFilter,
} from '@/lib/inventoryQuery';
import styles from './InventoryFilters.module.css';

interface Props {
  filters: Filters;
  slowItemDays: number;
  loading: boolean;
  onChange: (next: Filters) => void;
  onClear: () => void;
  onRefresh: () => void;
}

export default function InventoryFilters({ filters, slowItemDays, loading, onChange, onClear, onRefresh }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const id = useId();
  // "Só agarrados" não vale para vendidos nem para a aba "Fora de venda" dos itens em estoque (D266).
  const stagnantDisabled = isStagnantDisabled(filters);

  return (
    <form className={styles.bar} onSubmit={(event) => event.preventDefault()} aria-label={t('filters.label')}>
      <label className={styles.field} htmlFor={`${id}-status`}>
        <span>{t('filters.status')}</span>
        <select
          id={`${id}-status`}
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value as StatusFilter })}
        >
          {STATUS_FILTERS.map((value) => (
            <option key={value} value={value}>
              {value === 'ALL' ? t('filters.statusAll') : tLoose(`enums.status.${value}`)}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field} htmlFor={`${id}-category`}>
        <span>{t('filters.category')}</span>
        <select
          id={`${id}-category`}
          value={filters.category}
          onChange={(e) => onChange({ ...filters, category: e.target.value as CategoryFilter })}
        >
          <option value="ALL">{t('filters.categoryAll')}</option>
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>{tLoose(`enums.category.${value}`)}</option>
          ))}
        </select>
      </label>

      <label className={styles.field} htmlFor={`${id}-order`}>
        <span>{t('filters.order')}</span>
        <select
          id={`${id}-order`}
          value={filters.order}
          onChange={(e) => onChange({ ...filters, order: e.target.value as AgeOrder })}
        >
          <option value="desc">{t('filters.orderDesc')}</option>
          <option value="asc">{t('filters.orderAsc')}</option>
        </select>
      </label>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={filters.stagnant && !stagnantDisabled}
          disabled={stagnantDisabled}
          onChange={(e) => onChange({ ...filters, stagnant: e.target.checked })}
        />
        <span>{t('filters.stagnantOnly', { days: tPlural('common.dayCount', slowItemDays) })}</span>
      </label>

      <div className={styles.actions}>
        {hasActiveFilters(filters) && (
          <button type="button" className={styles.button} onClick={onClear}>{t('inventory.clearFilters')}</button>
        )}
        <button type="button" className={styles.button} onClick={onRefresh} disabled={loading}>
          {t('common.refresh')}
        </button>
      </div>
    </form>
  );
}
