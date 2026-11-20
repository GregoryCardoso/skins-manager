'use client';

import { useEffect, useId, useState } from 'react';
import { useT, useTLoose } from '@/i18n/I18nProvider';
import {
  SALES_PERIODS, SALES_SORT_OPTIONS, hasActiveSalesFilters, parseDayString,
  type SalesFilters as Filters, type SalesPeriod,
} from '@/lib/salesQuery';
import type { Store } from '@/types/api';
import styles from './SalesFilters.module.css';

interface Props {
  filters: Filters;
  stores: Store[];
  loading: boolean;
  onChange: (next: Filters) => void;
  onClear: () => void;
  onRefresh: () => void;
}

export default function SalesFilters({ filters, stores, loading, onChange, onClear, onRefresh }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const id = useId();

  // Datas do período personalizado: rascunho local; só intervalos válidos vão para a URL.
  const [draftFrom, setDraftFrom] = useState(filters.from ?? '');
  const [draftTo, setDraftTo] = useState(filters.to ?? '');
  useEffect(() => {
    setDraftFrom(filters.from ?? '');
    setDraftTo(filters.to ?? '');
  }, [filters.from, filters.to]);

  const invalidRange = draftFrom !== '' && draftTo !== '' && draftFrom > draftTo;

  const changeDate = (side: 'from' | 'to', value: string) => {
    const nextFrom = side === 'from' ? value : draftFrom;
    const nextTo = side === 'to' ? value : draftTo;
    if (side === 'from') setDraftFrom(value);
    else setDraftTo(value);
    if (nextFrom !== '' && nextTo !== '' && nextFrom > nextTo) return;
    onChange({ ...filters, from: parseDayString(nextFrom || null), to: parseDayString(nextTo || null) });
  };

  return (
    <form className={styles.bar} onSubmit={(event) => event.preventDefault()} aria-label={t('salesFilters.label')}>
      <label className={styles.field} htmlFor={`${id}-store`}>
        <span>{t('salesFilters.store')}</span>
        <select
          id={`${id}-store`}
          value={filters.storeId ?? ''}
          onChange={(e) => onChange({ ...filters, storeId: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">{t('salesFilters.storeAll')}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.isActive ? s.name : `${s.name} (${t('salesFilters.inactive')})`}</option>
          ))}
        </select>
      </label>

      <label className={styles.field} htmlFor={`${id}-period`}>
        <span>{t('salesFilters.period')}</span>
        <select
          id={`${id}-period`}
          value={filters.period}
          onChange={(e) => onChange({ ...filters, period: e.target.value as SalesPeriod })}
        >
          {SALES_PERIODS.map((p) => <option key={p} value={p}>{tLoose(`salesFilters.periods.${p}`)}</option>)}
        </select>
      </label>

      {filters.period === 'CUSTOM' && (
        <>
          <label className={styles.field} htmlFor={`${id}-from`}>
            <span>{t('salesFilters.from')}</span>
            <input
              id={`${id}-from`}
              type="date"
              value={draftFrom}
              aria-invalid={invalidRange}
              onChange={(e) => changeDate('from', e.target.value)}
            />
          </label>
          <label className={styles.field} htmlFor={`${id}-to`}>
            <span>{t('salesFilters.to')}</span>
            <input
              id={`${id}-to`}
              type="date"
              value={draftTo}
              aria-invalid={invalidRange}
              onChange={(e) => changeDate('to', e.target.value)}
            />
          </label>
          {invalidRange && <span className={styles.invalid} role="alert">{t('salesFilters.invalidRange')}</span>}
        </>
      )}

      <label className={styles.field} htmlFor={`${id}-sort`}>
        <span>{t('salesFilters.sort')}</span>
        <select
          id={`${id}-sort`}
          value={`${filters.sort}:${filters.order}`}
          onChange={(e) => {
            const option = SALES_SORT_OPTIONS.find((o) => o.value === e.target.value);
            if (option) onChange({ ...filters, sort: option.sort, order: option.order });
          }}
        >
          {SALES_SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{tLoose(o.key)}</option>)}
        </select>
      </label>

      <div className={styles.actions}>
        {hasActiveSalesFilters(filters) && (
          <button type="button" className={styles.button} onClick={onClear}>{t('sales.clearFilters')}</button>
        )}
        <button type="button" className={styles.button} onClick={onRefresh} disabled={loading}>
          {t('sales.refresh')}
        </button>
      </div>
    </form>
  );
}
