'use client';

import type { ReactNode } from 'react';
import { useLanguage, useT } from '@/i18n/I18nProvider';
import { formatDate } from '@/lib/format';
import type { ItemView } from '@/types/api';
import styles from './ItemActions.module.css';

interface Props {
  item: ItemView;
  onEdit: (item: ItemView) => void;
  onSell: (item: ItemView) => void;
  onUnsell: (item: ItemView) => void;
  onDelete: (item: ItemView) => void;
  // Ação extra no fim (ex.: "Inspecionar").
  children?: ReactNode;
}

// Botões por situação do item (D118): EM_ESTOQUE -> Editar, Vender, Excluir; VENDIDO -> Editar, Desfazer venda, Excluir.
// "Vender" fica desabilitado em trade lock (D74); o backend continua sendo a fonte da regra.
export default function ItemActions({ item, onEdit, onSell, onUnsell, onDelete, children }: Props) {
  const t = useT();
  const locale = useLanguage();
  const sold = item.status === 'VENDIDO';
  const locked = !sold && item.tradeLock.isLocked;
  const lockHint = locked && item.tradeLock.tradeUnlockAt
    ? t('inventory.actions.lockedHint', { date: formatDate(item.tradeLock.tradeUnlockAt, locale) })
    : undefined;

  return (
    <div className={styles.actions}>
      <button type="button" className={styles.button} onClick={() => onEdit(item)}>{t('inventory.actions.edit')}</button>
      {sold ? (
        <button type="button" className={styles.button} onClick={() => onUnsell(item)}>{t('inventory.actions.unsell')}</button>
      ) : (
        <button type="button" className={styles.button} onClick={() => onSell(item)} disabled={locked} title={lockHint}>
          {t('inventory.actions.sell')}
        </button>
      )}
      <button type="button" className={`${styles.button} ${styles.danger}`} onClick={() => onDelete(item)}>
        {t('inventory.actions.delete')}
      </button>
      {children}
    </div>
  );
}
