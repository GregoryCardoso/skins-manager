'use client';

import { useId, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { parseBulkQuantity } from '@/lib/bulkSaleState';
import { useInvalidate } from '@/lib/useInvalidate';
import { bulkMarkForSale, bulkMarkOffSale } from '@/services/api';
import forms from './forms.module.css';
import Modal from './Modal';

export type BulkDirection = 'OFF_SALE' | 'FOR_SALE';

interface Props {
  direction: BulkDirection;
  name: string;
  // Por grupo: a chave e quantas unidades há para mover. Por seleção: os ids marcados.
  target: { groupKey: string; available: number } | { itemIds: number[] };
  onClose: () => void;
  onDone: () => void;
}

// Mover para o holding / voltar para a venda em lote (9.5.1a, D332): uma chamada atômica e uma única invalidação no fim.
export default function BulkSaleStateDialog({ direction, name, target, onClose, onDone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const quantityId = useId();
  const byGroup = 'groupKey' in target;
  const max = byGroup ? target.available : target.itemIds.length;
  const [quantityText, setQuantityText] = useState(String(max));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toHolding = direction === 'OFF_SALE';
  const quantity = byGroup ? parseBulkQuantity(quantityText, max) : max;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (quantity === null) {
      setError(t('inventory.bulk.invalidQuantity', { max }));
      return;
    }
    setBusy(true);
    setError(null);
    const body = byGroup ? { groupKey: target.groupKey, quantity } : { itemIds: target.itemIds };
    (toHolding ? bulkMarkOffSale(body) : bulkMarkForSale(body))
      .then(() => invalidate(toHolding ? 'item.offSaleBulk' : 'item.backOnSaleBulk'))
      .then(() => onDone())
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setBusy(false));
  };

  return (
    <Modal title={t(toHolding ? 'inventory.bulk.offSaleTitle' : 'inventory.bulk.forSaleTitle')} onClose={onClose} busy={busy}>
      <form className={forms.form} onSubmit={submit}>
        <p><strong>{name}</strong></p>
        {byGroup ? (
          <>
            <label className={forms.field} htmlFor={quantityId}>
              <span>{t('inventory.bulk.quantity', { max })}</span>
              <input
                id={quantityId}
                type="number"
                min={1}
                max={max}
                step={1}
                value={quantityText}
                onChange={(event) => setQuantityText(event.target.value)}
                disabled={busy}
                autoFocus
              />
            </label>
            <p className={forms.hint}>{t(toHolding ? 'inventory.bulk.whichOffSale' : 'inventory.bulk.whichForSale')}</p>
          </>
        ) : (
          <p>{t('inventory.bulk.selectedCount', { count: max })}</p>
        )}
        {!toHolding && <p className={forms.hint}>{t('inventory.bulk.turnoverRestarts')}</p>}
        {error && <div className={forms.topError} role="alert">{error}</div>}
        <div className={forms.actions}>
          <button type="button" className={forms.button} onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className={`${forms.button} ${forms.primary}`} disabled={busy}>
            {busy ? t('common.saving') : t(toHolding ? 'inventory.bulk.offSaleConfirm' : 'inventory.bulk.forSaleConfirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
