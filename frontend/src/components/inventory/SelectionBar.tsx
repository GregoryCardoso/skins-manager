'use client';

import { useId } from 'react';
import { useT, useTPlural } from '@/i18n/I18nProvider';
import { MAX_BULK_IDS, type BulkDirection } from '@/lib/inventorySelection';
import Button from '../ui/Button';
import Icon from '../ui/Icon';
import styles from './inventory.module.css';

// Dica fixa acima da tabela (visível sempre que há seleção possível): marcar várias unidades move todas juntas.
export function SelectionHint() {
  const t = useT();
  return (
    <p className={styles.selectionHint}>
      <Icon name="info" size={14} />
      <span>{t('inventory.bulk.hint')}</span>
    </p>
  );
}

interface Props {
  count: number;
  // Aba atual: "Mover para o holding" na aba à venda; "Voltar para a venda" no holding.
  direction: BulkDirection;
  onMove: () => void;
  onClear: () => void;
}

// Barra da seleção (D370, 12.5b): contagem, mover e limpar. Acima de 500 unidades o botão fica desabilitado e o motivo, visível.
// Fica colada no fim da área rolável da página (sticky), para não sumir em listas longas nem na janela compacta.
export default function SelectionBar({ count, direction, onMove, onClear }: Props) {
  const t = useT();
  const tPlural = useTPlural();
  const limitId = useId();
  if (count === 0) return null;
  const overLimit = count > MAX_BULK_IDS;
  return (
    <div className={styles.selectionBarFixed} role="region" aria-label={t('inventory.bulk.selectionBar')}>
      <span className={styles.selectionCount} aria-live="polite">
        {tPlural('inventory.bulk.selected', count)}
      </span>
      <Button
        variant="primary"
        size="sm"
        aria-disabled={overLimit ? true : undefined}
        aria-describedby={overLimit ? limitId : undefined}
        onClick={() => {
          if (!overLimit) onMove();
        }}
      >
        {t(direction === 'OFF_SALE' ? 'inventory.bulk.offSaleButton' : 'inventory.bulk.forSaleButton')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        {t('inventory.bulk.clearSelection')}
      </Button>
      {overLimit && (
        <span id={limitId} className={styles.selectionLimit} role="status">
          {t('inventory.bulk.limit', { max: MAX_BULK_IDS })}
        </span>
      )}
    </div>
  );
}
