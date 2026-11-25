'use client';

import type { ReactNode } from 'react';
import { useLocale, useT } from '@/i18n/I18nProvider';
import { formatDate } from '@/lib/format';
import type { ItemView } from '@/types/api';
import styles from './ItemActions.module.css';

interface Props {
  item: ItemView;
  onEdit: (item: ItemView) => void;
  onSell: (item: ItemView) => void;
  onUnsell: (item: ItemView) => void;
  onDelete: (item: ItemView) => void;
  onHistory?: (item: ItemView) => void;
  // Só no inventário (D266): "Não está à venda" (com confirmação) e "Colocar à venda" (direto).
  onOffSale?: (item: ItemView) => void;
  onForSale?: (item: ItemView) => void;
  // "Aplicar do estoque" (10.3): só em unidade em estoque de uma categoria que aceita componentes.
  onApply?: (item: ItemView) => void;
  // "Abrir caixa/cápsula/pacote/terminal" (10.4, D363) e o atalho "Cadastrar chave" da caixa sem chave compatível.
  onOpen?: (item: ItemView) => void;
  onRegisterKey?: (keyName: string) => void;
  // "Separar chaveiro/slab" (10.7, D366): só em arma em estoque com um pendurado separável.
  onDetach?: (item: ItemView) => void;
  // "Colocar à venda" em andamento: o botão fica desabilitado (evita clique duplo).
  forSaleBusy?: boolean;
  // Ação extra no fim (ex.: "Inspecionar").
  children?: ReactNode;
}

// Botões por situação do item (D118): EM_ESTOQUE -> Editar, Vender, Excluir; VENDIDO -> Editar, Desfazer venda, Excluir.
// "Vender" fica desabilitado em trade lock (D74); o backend continua sendo a fonte da regra.
export default function ItemActions({ item, onEdit, onSell, onUnsell, onDelete, onHistory, onOffSale, onForSale, onApply, onOpen, onRegisterKey, onDetach, forSaleBusy = false, children }: Props) {
  const t = useT();
  const locale = useLocale();
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
      {item.saleState === 'FOR_SALE' && onOffSale && (
        <button type="button" className={styles.button} onClick={() => onOffSale(item)}>{t('inventory.actions.offSale')}</button>
      )}
      {item.saleState === 'OFF_SALE' && onForSale && (
        <button type="button" className={styles.button} onClick={() => onForSale(item)} disabled={forSaleBusy} aria-busy={forSaleBusy}>
          {t('inventory.actions.forSale')}
        </button>
      )}
      {item.canReceiveComponents && onApply && (
        <button type="button" className={styles.button} onClick={() => onApply(item)}>{t('inventory.actions.apply')}</button>
      )}
      {onDetach && item.status === 'EM_ESTOQUE' && item.components.some((c) => c.detachable) && (
        <button type="button" className={styles.button} onClick={() => onDetach(item)}>{t('inventory.actions.detach')}</button>
      )}
      {item.openable && onOpen && (() => {
        const { kind, compatibleKeys, requiredKeyName, otherKeysInStock } = item.openable;
        const label = kind === 'CASE'
          ? t('inventory.actions.openCase')
          : kind === 'TERMINAL'
            ? t('inventory.actions.openTerminal')
            : item.category === 'CAPSULA' ? t('inventory.actions.openCapsule') : t('inventory.actions.openPackage');
        const needsKey = kind === 'CASE' && compatibleKeys === 0;
        const reason = needsKey
          ? t(otherKeysInStock > 0 ? 'inventory.actions.openNeedsKeyOther' : 'inventory.actions.openNeedsKey', { keyName: requiredKeyName ?? '' })
          : undefined;
        return (
          <>
            <button type="button" className={styles.button} onClick={() => onOpen(item)} disabled={needsKey} title={reason}>{label}</button>
            {needsKey && <span className={styles.reason}>{reason}</span>}
            {needsKey && onRegisterKey && requiredKeyName && (
              <button type="button" className={styles.button} onClick={() => onRegisterKey(requiredKeyName)}>{t('inventory.actions.registerKey')}</button>
            )}
          </>
        );
      })()}
      <button type="button" className={`${styles.button} ${styles.danger}`} onClick={() => onDelete(item)}>
        {t('inventory.actions.delete')}
      </button>
      {onHistory && (
        <button type="button" className={styles.button} onClick={() => onHistory(item)}>{t('inventory.actions.history')}</button>
      )}
      {children}
    </div>
  );
}
