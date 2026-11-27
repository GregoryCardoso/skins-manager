'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { CURRENCY_GROUP_IDS, CURRENCY_PINNED, currencyComboboxOptions, currencySymbol, isCurrencyCode, moneyErrorParams } from '@/lib/currencies';
import { resolveErrorTarget } from '@/lib/formErrors';
import { parseIntegerInput } from '@/lib/numberInput';
import {
  buildStoreCreateBody, buildStorePatchBody, initialStoreFormState, storeFormFromStore, storeFormRounds, validateStoreForm,
  type StoreFormState,
} from '@/lib/storeForm';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, createStore, updateStore } from '@/services/api';
import type { SaleFeeRounding, SaleFeeType, Store } from '@/types/api';
import FeeExample from './FeeExample';
import styles from './StoreFormModal.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Checkbox from './ui/Checkbox';
import Combobox from './ui/Combobox';
import Dialog from './ui/Dialog';
import Disclosure from './ui/Disclosure';
import FormErrorSummary, { type FormErrorItem } from './ui/FormErrorSummary';
import NumberField from './ui/NumberField';
import Select from './ui/Select';
import TextField from './ui/TextField';

const BASE_FIELDS = [
  'name', 'currency', 'saleFeeType', 'saleFeeRate', 'saleFeeRounding', 'saleMinFeeCents', 'saleFixedFeeCents',
  'allowsWithdrawal', 'withdrawalFeeRate', 'withdrawalFixedFeeCents', 'saleHoldDays', 'isActive',
] as const;
const ROUNDINGS: SaleFeeRounding[] = ['CEIL', 'ROUND', 'FLOOR'];
const FEE_TYPES: SaleFeeType[] = ['DEDUCTED', 'ADDED'];
const FEE_NONE = 'NONE';
const FORM_ID = 'store-form';

type Section = 'sale' | 'hold' | 'withdrawal' | 'status';
// Em qual seção cada campo mora (nome e moeda ficam sempre à vista). Quem tem erro numa seção recolhida a abre.
const SECTION_OF: Record<string, Section | null> = {
  name: null, currency: null,
  saleFeeType: 'sale', saleFeeRate: 'sale', saleFeeRounding: 'sale', saleMinFeeCents: 'sale', saleFixedFeeCents: 'sale',
  saleHoldDays: 'hold',
  allowsWithdrawal: 'withdrawal', withdrawalFeeRate: 'withdrawal', withdrawalFixedFeeCents: 'withdrawal',
  isActive: 'status', isPrimary: 'status',
};

interface Props {
  // Sem `store` = nova loja.
  store?: Store;
  onClose: () => void;
  onSaved: (message: string) => void;
  onGone: () => void;
}

export default function StoreFormModal({ store, onClose, onSaved, onGone }: Props) {
  const invalidate = useInvalidate();
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const editing = store !== undefined;

  const [state, setState] = useState<StoreFormState>(() => (store ? storeFormFromStore(store, locale) : initialStoreFormState()));
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [showSummary, setShowSummary] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Record<Section, boolean>>({ sale: true, hold: false, withdrawal: false, status: false });

  const patch = (partial: Partial<StoreFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (...fields: string[]) =>
    setErrors((e) => (fields.some((f) => e[f]) ? { ...e, ...Object.fromEntries(fields.map((f) => [f, undefined])) } : e));

  const currencyLocked = editing && store.inUse;
  const primaryLocked = editing && store.isPrimary;
  const withdrawalOff = !state.allowsWithdrawal;
  // Símbolo da moeda da loja nos rótulos das taxas fixas (11.4): segue a moeda escolhida.
  const currencyLabel = currencySymbol(state.currency, locale);

  const currencyOptions = useMemo(() => currencyComboboxOptions(locale), [locale]);
  const currencyGroups = useMemo(() => CURRENCY_GROUP_IDS.map((id) => ({ id, label: t(`currency.groups.${id}` as 'currency.groups.america') })), [t]);

  const fieldLabel = (field: string): string => {
    switch (field) {
      case 'saleMinFeeCents': return t('storeForm.saleMinFee', { currency: currencyLabel });
      case 'saleFixedFeeCents': return t('storeForm.saleFixedFee', { currency: currencyLabel });
      case 'withdrawalFixedFeeCents': return t('storeForm.withdrawalFixedFee', { currency: currencyLabel });
      case 'saleHoldDays': return t('stores.saleHoldDays');
      default: {
        const label = tLoose(`storeForm.${field}`);
        return label === `storeForm.${field}` ? field : label;
      }
    }
  };

  const reveal = (fields: string[]) =>
    setOpen((current) => {
      const next = { ...current };
      for (const field of fields) {
        const section = SECTION_OF[field];
        if (section) next[section] = true;
      }
      return next;
    });

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'STORE_NOT_FOUND' && editing) {
      onGone();
      return;
    }
    const message = errorMessageFor(err, tLoose, locale);
    const fields = editing ? BASE_FIELDS : [...BASE_FIELDS, 'isPrimary'];
    const { target, topLabelField } = resolveErrorTarget(err, fields);
    if (target) {
      setErrors({ [target]: message });
      setTopError(null);
      setShowSummary(true);
      reveal([target]);
    } else {
      const label = topLabelField ? tLoose(`fields.${topLabelField}`) : null;
      setErrors({});
      setShowSummary(false);
      setTopError(label && label !== `fields.${topLabelField}` ? `${label}: ${message}` : message);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setTopError(null);
    const local = validateStoreForm(state, locale);
    if (Object.keys(local).length > 0) {
      const translated: Partial<Record<string, string>> = {};
      for (const [field, key] of Object.entries(local)) translated[field] = tLoose(key, moneyErrorParams(locale, state.currency));
      setErrors(translated);
      setShowSummary(true);
      reveal(Object.keys(translated));
      return;
    }
    setErrors({});
    setShowSummary(false);
    if (store) {
      const body = buildStorePatchBody(state, store, locale);
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      setSaving(true);
      updateStore(store.id, body)
        .then((saved) => {
          invalidate('store.update');
          onSaved(t('storeForm.updated', { name: saved.name }));
        })
        .catch((err: unknown) => {
          setSaving(false);
          showApiError(err);
        });
      return;
    }
    setSaving(true);
    createStore(buildStoreCreateBody(state, locale))
      .then((saved) => {
        invalidate('store.create');
        onSaved(t('storeForm.created', { name: saved.name }));
      })
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  const summaryItems: FormErrorItem[] = showSummary
    ? Object.entries(errors)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
        .map(([field, message]) => ({ field, label: fieldLabel(field), message }))
    : [];

  const holdDays = parseIntegerInput(state.saleHoldDaysText);
  const holdSummary = holdDays !== null && holdDays > 0 ? tPlural('storesTable.saleHoldDays', holdDays) : t('storesTable.saleHoldNone');
  const withdrawalSummary = state.allowsWithdrawal
    ? state.withdrawalFeeRateText.trim() !== '' ? `${state.withdrawalFeeRateText.trim()}%` : t('storesTable.withdrawalRateUnknown')
    : t('storesTable.withdrawalNo');
  const statusSummary = [state.isActive ? t('storesTable.active') : t('storesTable.inactive'), state.isPrimary || (editing && store.isPrimary) ? t('storesTable.primary') : null]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <Dialog
      title={editing ? t('storeForm.editTitle', { name: store.name }) : t('storeForm.createTitle')}
      size="lg"
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
        </>
      }
    >
      <form id={FORM_ID} className={styles.form} onSubmit={submit} noValidate>
        <FormErrorSummary errors={summaryItems} />
        {topError && <Banner tone="danger">{topError}</Banner>}
        <Banner tone="info">{t('storeForm.feeChangeNote')}</Banner>
        {storeFormRounds(state, locale) && <Banner tone="info">{t('storeForm.roundedNote')}</Banner>}

        <section className={styles.section} aria-label={t('storeForm.sections.identity')}>
          <h3 className={styles.sectionTitle}>{t('storeForm.sections.identity')}</h3>
          <div className={styles.grid}>
            <TextField
              label={t('storeForm.name')}
              name="name"
              value={state.name}
              maxLength={50}
              autoFocus
              error={errors.name}
              onChange={(value) => {
                patch({ name: value });
                clearError('name');
              }}
            />
            <Combobox
              label={t('storeForm.currency')}
              name="currency"
              value={state.currency}
              options={currencyOptions}
              groups={currencyGroups}
              pinned={[...CURRENCY_PINNED]}
              disabled={currencyLocked}
              hint={currencyLocked ? t('storeForm.currencyLocked') : undefined}
              error={errors.currency}
              onChange={(value) => {
                if (value !== null && isCurrencyCode(value)) patch({ currency: value });
                clearError('currency', 'saleMinFeeCents', 'saleFixedFeeCents', 'withdrawalFixedFeeCents');
              }}
            />
          </div>
        </section>

        <Disclosure label={t('storeForm.saleFeeSection')} open={open.sale} onOpenChange={(value) => setOpen((o) => ({ ...o, sale: value }))}>
          <div className={styles.sectionBody}>
            <div className={styles.grid}>
              <Select
                label={t('storeForm.saleFeeType')}
                name="saleFeeType"
                value={state.saleFeeType === '' ? FEE_NONE : state.saleFeeType}
                error={errors.saleFeeType}
                options={[{ value: FEE_NONE, label: t('storeForm.notConfigured') }, ...FEE_TYPES.map((type) => ({ value: type, label: tLoose(`storeForm.feeType.${type}`) }))]}
                onChange={(value) => {
                  patch({ saleFeeType: value === 'DEDUCTED' || value === 'ADDED' ? value : '' });
                  clearError('saleFeeType');
                }}
              />
              <NumberField
                kind="decimal"
                label={t('storeForm.saleFeeRate')}
                name="saleFeeRate"
                value={state.saleFeeRateText}
                hint={t('storeForm.percentHint')}
                suggestAmbiguous={false}
                error={errors.saleFeeRate}
                onValueChange={(text) => {
                  patch({ saleFeeRateText: text });
                  clearError('saleFeeRate', 'saleFeeType');
                }}
              />
              <Select
                label={t('storeForm.saleFeeRounding')}
                name="saleFeeRounding"
                value={state.saleFeeRounding}
                error={errors.saleFeeRounding}
                options={ROUNDINGS.map((r) => ({ value: r, label: tLoose(`storeForm.rounding.${r}`) }))}
                onChange={(value) => patch({ saleFeeRounding: ROUNDINGS.find((r) => r === value) ?? 'CEIL' })}
              />
              <NumberField
                kind="money"
                currency={state.currency}
                label={t('storeForm.saleMinFee', { currency: currencyLabel })}
                name="saleMinFeeCents"
                value={state.saleMinFeeText}
                hint={t('storeForm.emptyIsNone')}
                error={errors.saleMinFeeCents}
                onValueChange={(text) => {
                  patch({ saleMinFeeText: text });
                  clearError('saleMinFeeCents');
                }}
              />
              <NumberField
                kind="money"
                currency={state.currency}
                label={t('storeForm.saleFixedFee', { currency: currencyLabel })}
                name="saleFixedFeeCents"
                value={state.saleFixedFeeText}
                hint={t('storeForm.emptyIsZero')}
                error={errors.saleFixedFeeCents}
                onValueChange={(text) => {
                  patch({ saleFixedFeeText: text });
                  clearError('saleFixedFeeCents');
                }}
              />
            </div>
            <FeeExample key={state.currency} state={state} />
          </div>
        </Disclosure>

        <Disclosure
          label={`${t('storeForm.balanceSection')} · ${holdSummary}`}
          open={open.hold}
          onOpenChange={(value) => setOpen((o) => ({ ...o, hold: value }))}
        >
          <div className={styles.sectionBody}>
            <NumberField
              kind="integer"
              label={t('stores.saleHoldDays')}
              name="saleHoldDays"
              value={state.saleHoldDaysText}
              hint={t('stores.saleHoldDaysHint')}
              error={errors.saleHoldDays}
              onValueChange={(text) => {
                patch({ saleHoldDaysText: text });
                clearError('saleHoldDays');
              }}
            />
          </div>
        </Disclosure>

        <Disclosure
          label={`${t('storeForm.withdrawalSection')} · ${withdrawalSummary}`}
          open={open.withdrawal}
          onOpenChange={(value) => setOpen((o) => ({ ...o, withdrawal: value }))}
        >
          <div className={styles.sectionBody}>
            <Checkbox
              label={t('storeForm.allowsWithdrawal')}
              name="allowsWithdrawal"
              checked={state.allowsWithdrawal}
              hint={withdrawalOff ? t('storeForm.withdrawalOffHint') : undefined}
              error={errors.allowsWithdrawal}
              onChange={(checked) => patch({ allowsWithdrawal: checked })}
            />
            <div className={styles.grid}>
              <NumberField
                kind="decimal"
                label={t('storeForm.withdrawalFeeRate')}
                name="withdrawalFeeRate"
                value={state.withdrawalFeeRateText}
                hint={t('storeForm.percentHint')}
                suggestAmbiguous={false}
                disabled={withdrawalOff}
                error={errors.withdrawalFeeRate}
                onValueChange={(text) => {
                  patch({ withdrawalFeeRateText: text });
                  clearError('withdrawalFeeRate');
                }}
              />
              <NumberField
                kind="money"
                currency={state.currency}
                label={t('storeForm.withdrawalFixedFee', { currency: currencyLabel })}
                name="withdrawalFixedFeeCents"
                value={state.withdrawalFixedFeeText}
                hint={t('storeForm.emptyIsZero')}
                disabled={withdrawalOff}
                error={errors.withdrawalFixedFeeCents}
                onValueChange={(text) => {
                  patch({ withdrawalFixedFeeText: text });
                  clearError('withdrawalFixedFeeCents');
                }}
              />
            </div>
          </div>
        </Disclosure>

        <Disclosure label={`${t('storeForm.sections.status')} · ${statusSummary}`} open={open.status} onOpenChange={(value) => setOpen((o) => ({ ...o, status: value }))}>
          <div className={styles.sectionBody}>
            <Checkbox
              label={t('storeForm.isActive')}
              name="isActive"
              checked={state.isActive}
              disabled={primaryLocked}
              hint={primaryLocked ? t('storeForm.primaryCannotDeactivate') : undefined}
              error={errors.isActive}
              onChange={(checked) => {
                patch({ isActive: checked });
                clearError('isActive');
              }}
            />
            {!editing && (
              <Checkbox
                label={t('storeForm.isPrimary')}
                name="isPrimary"
                checked={state.isPrimary}
                error={errors.isPrimary}
                onChange={(checked) => {
                  patch({ isPrimary: checked });
                  clearError('isPrimary');
                }}
              />
            )}
          </div>
        </Disclosure>
      </form>
    </Dialog>
  );
}
