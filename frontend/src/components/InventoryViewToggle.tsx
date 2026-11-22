'use client';

import { useT } from '@/i18n/I18nProvider';
import type { InventoryView } from '@/types/api';
import styles from './InventoryViewToggle.module.css';

interface Props {
  value: InventoryView;
  onChange: (view: InventoryView) => void;
  // Desabilitado com "Vendido"/"Todos" (a visão agrupada vale só para o estoque, E8-Q35).
  disabled?: boolean;
}

const OPTIONS: readonly InventoryView[] = ['GROUPED', 'INDIVIDUAL'];

// Controle segmentado "Agrupado | Individual" (D277): radiogroup operável pelo teclado (setas, Tab, Espaço).
export default function InventoryViewToggle({ value, onChange, disabled = false }: Props) {
  const t = useT();
  const hint = disabled ? t('inventory.view.onlyInStock') : undefined;
  return (
    <div className={styles.wrap} title={hint}>
      <span className={styles.label} id="inventory-view-label">{t('inventory.view.label')}</span>
      <div className={styles.group} role="radiogroup" aria-labelledby="inventory-view-label" aria-disabled={disabled}>
        {OPTIONS.map((option) => {
          const selected = value === option;
          return (
            <label key={option} className={`${styles.option} ${selected ? styles.selected : ''} ${disabled ? styles.disabled : ''}`}>
              <input
                type="radio"
                name="inventory-view"
                className={styles.input}
                value={option}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option)}
              />
              {t(option === 'GROUPED' ? 'inventory.view.grouped' : 'inventory.view.individual')}
            </label>
          );
        })}
      </div>
      {disabled && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
