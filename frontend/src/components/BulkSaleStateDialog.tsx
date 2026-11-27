'use client';

import { useId, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { parseBulkQuantity } from '@/lib/bulkSaleState';
import { useInvalidate } from '@/lib/useInvalidate';
import { bulkMarkForSale, bulkMarkOffSale } from '@/services/api';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import NumberField from './ui/NumberField';
import styles from './BulkSaleStateDialog.module.css';

export type BulkDirection = 'OFF_SALE' | 'FOR_SALE';

interface Props {
  direction: BulkDirection;
  // Nome do item (lote por grupo); na seleção de unidades de vários itens fica de fora.
  name?: string;
  // Por grupo: a chave e quantas unidades há para mover. Por seleção: os ids marcados.
  target: { groupKey: string; available: number } | { itemIds: number[] };
  onClose: () => void;
  onDone: () => void;
}

// Mover para o holding / voltar para a venda em lote (9.5.1a, D332; visual novo na 12.5b): uma chamada atômica e uma única invalidação
// no fim. O contrato (props e chamadas à API) é o mesmo de antes.
export default function BulkSaleStateDialog({ direction, name, target, onClose, onDone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const formId = useId();
  const byGroup = 'groupKey' in target;
  const max = byGroup ? target.available : target.itemIds.length;
  const [quantityText, setQuantityText] = useState(String(max));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quantityError, setQuantityError] = useState<string | null>(null);

  const toHolding = direction === 'OFF_SALE';
  const quantity = byGroup ? parseBulkQuantity(quantityText, max) : max;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (quantity === null) {
      setQuantityError(t('inventory.bulk.invalidQuantity', { max }));
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
    <Dialog
      title={t(toHolding ? 'inventory.bulk.offSaleTitle' : 'inventory.bulk.forSaleTitle')}
      size="sm"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            {t(toHolding ? 'inventory.bulk.offSaleConfirm' : 'inventory.bulk.forSaleConfirm')}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        {name && (
          <p className={styles.name}>
            <strong>{name}</strong>
          </p>
        )}
        {byGroup ? (
          <>
            <NumberField
              kind="integer"
              label={t('inventory.bulk.quantity', { max })}
              value={quantityText}
              onValueChange={(text) => {
                setQuantityText(text);
                setQuantityError(null);
              }}
              error={quantityError}
              hint={t(toHolding ? 'inventory.bulk.whichOffSale' : 'inventory.bulk.whichForSale')}
              disabled={busy}
              autoFocus
            />
          </>
        ) : (
          <p>{tPlural('inventory.bulk.selectedCount', max)}</p>
        )}
        {!toHolding && <p className={styles.hint}>{t('inventory.bulk.turnoverRestarts')}</p>}
        {error && <Banner tone="danger">{error}</Banner>}
      </form>
    </Dialog>
  );
}
