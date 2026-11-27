'use client';

import { useEffect, useRef, useState } from 'react';
import { useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import {
  CATEGORIES, MAX_SEARCH_LENGTH, STATUS_FILTERS, hasActiveFilters, isStagnantDisabled,
  type CategoryFilter, type InventoryFilters, type StatusFilter,
} from '@/lib/inventoryQuery';
import type { InventoryDensity, InventoryView } from '@/types/api';
import Button from '../ui/Button';
import Chip from '../ui/Chip';
import Select from '../ui/Select';
import SegmentedControl from '../ui/SegmentedControl';
import TextField from '../ui/TextField';
import styles from './inventory.module.css';

interface Props {
  filters: InventoryFilters;
  slowItemDays: number;
  loading: boolean;
  // Visão (Agrupado/Individual): a escolha salva e se a agrupada vale agora (só com o status "Em estoque", E8-Q35).
  view: InventoryView;
  groupedAvailable: boolean;
  onViewChange: (view: InventoryView) => void;
  density: InventoryDensity;
  onDensityChange: (density: InventoryDensity) => void;
  onChange: (next: InventoryFilters) => void;
  onClear: () => void;
  onRefresh: () => void;
}

// Pausa depois da última tecla antes de a busca ir para a URL (e, por ela, para a API).
export const SEARCH_DEBOUNCE_MS = 300;

// Barra de filtros do inventário (D370, 12.5a): busca pelo nome (12.5b), status e categoria em selects, "Só encalhados" em chip, visão, densidade e atualizar.
// A ordem fica no cabeçalho "Giro" da tabela.
export default function InventoryToolbar({
  filters, slowItemDays, loading, view, groupedAvailable, onViewChange, density, onDensityChange, onChange, onClear, onRefresh,
}: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  // "Só encalhados" não vale para vendidos nem para a aba "Holding" (D266).
  const stagnantDisabled = isStagnantDisabled(filters);
  const shownView: InventoryView = groupedAvailable ? view : 'INDIVIDUAL';

  // Busca: o texto digitado fica local e vai para a URL depois de uma pausa (ou no Enter); mudanças vindas da URL ("Limpar filtros") voltam ao campo.
  const [draft, setDraft] = useState(filters.search);
  const latest = useRef({ filters, onChange });
  latest.current = { filters, onChange };
  const commit = (text: string) => {
    const next = text.trim().slice(0, MAX_SEARCH_LENGTH);
    if (next !== latest.current.filters.search) latest.current.onChange({ ...latest.current.filters, search: next });
  };
  useEffect(() => {
    setDraft((current) => (current.trim() === filters.search ? current : filters.search));
  }, [filters.search]);
  useEffect(() => {
    if (draft.trim() === latest.current.filters.search) return;
    const timer = setTimeout(() => commit(draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  return (
    <form
      className={styles.toolbar}
      onSubmit={(event) => {
        event.preventDefault();
        commit(draft);
      }}
      aria-label={t('filters.label')}
    >
      <TextField
        className={styles.searchField}
        type="search"
        leadingIcon="search"
        label={t('inventory.toolbar.search')}
        value={draft}
        onChange={setDraft}
        maxLength={MAX_SEARCH_LENGTH}
        name="q"
      />
      <Select
        label={t('filters.status')}
        value={filters.status}
        onChange={(value) => onChange({ ...filters, status: value as StatusFilter })}
        options={STATUS_FILTERS.map((value) => ({ value, label: value === 'ALL' ? t('filters.statusAll') : tLoose(`enums.status.${value}`) }))}
      />
      <Select
        label={t('filters.category')}
        value={filters.category}
        onChange={(value) => onChange({ ...filters, category: value as CategoryFilter })}
        options={[
          { value: 'ALL', label: t('filters.categoryAll') },
          ...CATEGORIES.map((value) => ({ value, label: tLoose(`enums.category.${value}`) })),
        ]}
      />
      <div className={styles.chips} role="group" aria-label={t('filters.label')}>
        <Chip
          tone="stuck"
          pressed={filters.stagnant && !stagnantDisabled}
          disabled={stagnantDisabled}
          onPressedChange={(pressed) => onChange({ ...filters, stagnant: pressed })}
        >
          {t('filters.stagnantOnly', { days: tPlural('common.dayCount', slowItemDays) })}
        </Chip>
        {hasActiveFilters(filters) && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            {t('inventory.clearFilters')}
          </Button>
        )}
      </div>

      <span className={styles.toolbarSpacer} />

      <div className={styles.toolbarGroup}>
        <div className={styles.controlLabel}>
          <span>{t('inventory.view.label')}</span>
          <SegmentedControl<InventoryView>
            label={t('inventory.view.label')}
            value={shownView}
            onChange={onViewChange}
            disabled={!groupedAvailable}
            options={[
              { value: 'GROUPED', label: t('inventory.view.grouped') },
              { value: 'INDIVIDUAL', label: t('inventory.view.individual') },
            ]}
          />
        </div>
        <div className={styles.controlLabel}>
          <span>{t('inventory.density.label')}</span>
          <SegmentedControl<InventoryDensity>
            label={t('inventory.density.label')}
            value={density}
            onChange={onDensityChange}
            iconOnlyBelow="narrow"
            options={[
              { value: 'COMPACT', label: t('inventory.density.compact'), icon: 'rows3' },
              { value: 'COMFORTABLE', label: t('inventory.density.comfortable'), icon: 'rows2' },
            ]}
          />
        </div>
        <Button icon="refresh" iconOnlyBelow="narrow" loading={loading} onClick={onRefresh}>
          {t('common.refresh')}
        </Button>
      </div>
      {!groupedAvailable && <span className={styles.hint}>{t('inventory.view.onlyInStock')}</span>}
    </form>
  );
}
