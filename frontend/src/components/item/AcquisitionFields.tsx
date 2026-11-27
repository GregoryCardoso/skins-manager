'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import {
  addSevenDays, setAcquiredAt, setAcquisitionType, setTradeUnlockAt,
  type FieldVisibility, type FormErrors, type ItemFormState,
} from '@/lib/itemForm';
import { formatDecimalInput } from '@/lib/numberInput';
import { launchStoreOptions } from '@/lib/storeOptions';
import type { AcquisitionType, Currency, ItemView, Store } from '@/types/api';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Disclosure from '../ui/Disclosure';
import HelpTip from '../ui/HelpTip';
import NumberField from '../ui/NumberField';
import SegmentedControl from '../ui/SegmentedControl';
import Select from '../ui/Select';
import TextField from '../ui/TextField';
import styles from './item.module.css';

interface BaseProps {
  state: ItemFormState;
  patch: (partial: Partial<ItemFormState>) => void;
  errors: FormErrors;
  vis: FieldVisibility;
  stores: Store[];
  item?: ItemView;
  onStoreChange: (value: string) => void;
  // Unidade criada por uma operação: tipo, loja e data só para leitura (2.1).
  generated: boolean;
  disabled: boolean;
}

interface Props extends BaseProps {
  setState: Dispatch<SetStateAction<ItemFormState>>;
  clearError: (field: string) => void;
  // Moeda da loja de compra (USD sem loja) e a cotação padrão dela, para a dica.
  priceCurrency: Currency;
  defaultFx: number | null;
  // Moeda da loja mudou nesta edição: o preço antigo não vale mais (D52).
  currencyChangedTo: Currency | null;
}

const NO_STORE = '__none__';

// Loja obrigatória (compra: sem opção vazia) ou informativa (ganhei: com "—").
function StoreSelect({ state, errors, stores, item, onStoreChange, generated, disabled, informative }: BaseProps & { informative: boolean }) {
  const t = useT();
  const choices = launchStoreOptions(stores, [item?.purchaseStoreId, state.purchaseStoreId]);
  const label = (store: Store) => (store.isActive ? store.name : `${store.name} (${t('itemForm.storeInactive')})`);
  return (
    <Select
      label={informative ? t('itemForm.purchaseStoreInformative') : t('itemForm.purchaseStore')}
      name="purchaseStoreId"
      value={state.purchaseStoreId === null ? (informative ? NO_STORE : '') : String(state.purchaseStoreId)}
      error={errors.purchaseStoreId}
      disabled={disabled || generated}
      required={!informative}
      onChange={(value) => onStoreChange(value === NO_STORE ? '' : value)}
      options={[
        ...(informative ? [{ value: NO_STORE, label: t('common.none') }] : []),
        ...choices.map((store) => ({ value: String(store.id), label: label(store) })),
      ]}
    />
  );
}

// Aquisição do item (12.6a): Compra/Ganhei, loja, preço, cotação e datas. No Ganhei não há preço nem cotação (o custo é US$ 0,00) e a
// data se chama "Data em que recebeu". Nenhuma regra nova: `lib/itemForm` decide o que aparece.
export default function AcquisitionFields(props: Props) {
  const { state, setState, patch, errors, clearError, vis, priceCurrency, defaultFx, currencyChangedTo, generated, disabled } = props;
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const lockedHint = t('itemForm.generatedLockedHint');
  const dateLabel = vis.receivedDateLabel ? t('itemForm.receivedAt') : t('itemForm.acquiredAt');

  return (
    <>
      {state.acquisitionType === 'GERADO' ? (
        <div className={styles.lockedValue}>
          <span className={styles.lockedLabel}>{t('itemForm.acquisitionType')}</span>
          <Badge tone="info">{tLoose('enums.acquisitionType.GERADO')}</Badge>
          <HelpTip topic={t('itemForm.acquisitionType')}>{lockedHint}</HelpTip>
        </div>
      ) : (
        <div className={styles.row}>
          <span className={styles.lockedLabel}>{t('itemForm.acquisitionType')}</span>
          <SegmentedControl<AcquisitionType>
            label={t('itemForm.acquisitionType')}
            value={state.acquisitionType}
            disabled={disabled || generated}
            onChange={(type) => setState((s) => setAcquisitionType(s, type))}
            options={(['COMPRA', 'GANHEI'] as const).map((type) => ({ value: type, label: tLoose(`enums.acquisitionType.${type}`) }))}
          />
          {generated && <HelpTip topic={t('itemForm.acquisitionType')}>{lockedHint}</HelpTip>}
        </div>
      )}

      <div className={styles.grid}>
        {state.acquisitionType === 'COMPRA' && (
          generated ? (
            <div className={styles.inlineAction}>
              <StoreSelect {...props} informative={false} />
              <HelpTip topic={t('itemForm.purchaseStore')}>{lockedHint}</HelpTip>
            </div>
          ) : (
            <StoreSelect {...props} informative={false} />
          )
        )}

        {vis.price && (
          <NumberField
            kind="money"
            currency={priceCurrency}
            label={t('itemForm.purchasePrice', { currency: priceCurrency })}
            name="purchasePriceCents"
            value={state.priceText}
            error={errors.purchasePriceCents}
            required
            disabled={disabled}
            hint={currencyChangedTo && state.priceText === '' ? t('itemForm.priceReenter', { currency: currencyChangedTo }) : null}
            onValueChange={(text) => {
              patch({ priceText: text });
              clearError('purchasePriceCents');
            }}
          />
        )}

        {state.acquisitionType === 'GANHEI' && (
          <div className={styles.costNote}>
            <span className={styles.lockedLabel}>{t('itemForm.purchasePrice', { currency: 'USD' })}</span>
            <span className={styles.muted}>{t('itemForm.ganheiCost')}</span>
          </div>
        )}

        {vis.fx && (
          <NumberField
            kind="decimal"
            label={t('itemForm.fxRateAtPurchase', { currency: priceCurrency })}
            name="fxRateAtPurchase"
            value={state.fxText}
            error={errors.fxRateAtPurchase}
            disabled={disabled}
            hint={defaultFx !== null ? t('itemForm.fxRateDefault', { rate: formatDecimalInput(defaultFx, locale) }) : null}
            onValueChange={(text) => {
              patch({ fxText: text });
              clearError('fxRateAtPurchase');
            }}
          />
        )}

        <TextField
          label={dateLabel}
          name="acquiredAt"
          type="datetime-local"
          value={state.acquiredAt}
          error={errors.acquiredAt}
          disabled={disabled || generated}
          trailing={generated ? <HelpTip topic={dateLabel}>{lockedHint}</HelpTip> : undefined}
          onChange={(value) => {
            setState((s) => setAcquiredAt(s, value));
            clearError('acquiredAt');
          }}
        />

        <TextField
          label={t('itemForm.tradeUnlockAt')}
          name="tradeUnlockAt"
          type="datetime-local"
          value={state.tradeUnlockAt}
          error={errors.tradeUnlockAt}
          disabled={disabled}
          trailing={
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setState((s) => addSevenDays(s))}>
              {t('itemForm.plus7Days')}
            </Button>
          }
          onChange={(value) => {
            setState((s) => setTradeUnlockAt(s, value));
            clearError('tradeUnlockAt');
          }}
        />
      </div>
    </>
  );
}

interface DetailsProps extends BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// "Mais detalhes": origem, ID do ativo e, no item ganho, a loja informativa (o valor gravado é preservado, regra 2.1). O erro de um
// campo daqui abre este bloco (`revealFor`, lib/formErrors).
export function AcquisitionDetails(props: DetailsProps) {
  const { state, patch, errors, vis, disabled, open, onOpenChange } = props;
  const t = useT();
  return (
    <Disclosure label={t('common.moreDetails')} open={open} onOpenChange={onOpenChange}>
      <div className={styles.grid}>
        {vis.informativeStoreInDetails && (
          <div className={styles.full}>
            <StoreSelect {...props} informative />
          </div>
        )}
        <TextField
          label={t('itemForm.originDetail')}
          name="originDetail"
          optional
          value={state.originDetail}
          error={errors.originDetail}
          disabled={disabled}
          onChange={(value) => patch({ originDetail: value })}
        />
        <TextField
          label={t('itemForm.assetId')}
          name="assetId"
          optional
          value={state.assetId}
          error={errors.assetId}
          disabled={disabled}
          onChange={(value) => patch({ assetId: value })}
        />
      </div>
    </Disclosure>
  );
}
