'use client';

import { useEffect, useState } from 'react';
import { useT, useTLoose } from '@/i18n/I18nProvider';
import {
  SALES_PERIODS, SALES_SORT_OPTIONS, hasActiveSalesFilters, parseDayString,
  type SalesFilters as Filters, type SalesPeriod,
} from '@/lib/salesQuery';
import type { Store } from '@/types/api';
import Button from './ui/Button';
import Select from './ui/Select';
import TextField from './ui/TextField';
import styles from './sales.module.css';

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
    <form className={styles.filters} onSubmit={(event) => event.preventDefault()} aria-label={t('salesFilters.label')}>
      <Select
        label={t('salesFilters.store')}
        value={filters.storeId === null ? 'ALL' : String(filters.storeId)}
        onChange={(value) => onChange({ ...filters, storeId: value === 'ALL' ? null : Number(value) })}
        options={[
          { value: 'ALL', label: t('salesFilters.storeAll') },
          ...stores.map((s) => ({ value: String(s.id), label: s.isActive ? s.name : `${s.name} (${t('salesFilters.inactive')})` })),
        ]}
      />
      <Select
        label={t('salesFilters.period')}
        value={filters.period}
        onChange={(value) => onChange({ ...filters, period: value as SalesPeriod })}
        options={SALES_PERIODS.map((p) => ({ value: p, label: tLoose(`salesFilters.periods.${p}`) }))}
      />
      {filters.period === 'CUSTOM' && (
        <>
          <TextField label={t('salesFilters.from')} type="date" value={draftFrom} onChange={(value) => changeDate('from', value)} />
          <TextField label={t('salesFilters.to')} type="date" value={draftTo} onChange={(value) => changeDate('to', value)} error={invalidRange ? t('salesFilters.invalidRange') : null} />
        </>
      )}
      <Select
        label={t('salesFilters.sort')}
        value={`${filters.sort}:${filters.order}`}
        onChange={(value) => {
          const option = SALES_SORT_OPTIONS.find((o) => o.value === value);
          if (option) onChange({ ...filters, sort: option.sort, order: option.order });
        }}
        options={SALES_SORT_OPTIONS.map((o) => ({ value: o.value, label: tLoose(o.key) }))}
      />
      <div className={styles.filterActions}>
        {hasActiveSalesFilters(filters) && (
          <Button size="sm" variant="ghost" onClick={onClear}>{t('sales.clearFilters')}</Button>
        )}
        <Button icon="refresh" loading={loading} onClick={onRefresh}>{t('sales.refresh')}</Button>
      </div>
    </form>
  );
}
