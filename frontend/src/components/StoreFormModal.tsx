'use client';

import { useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { resolveErrorTarget } from '@/lib/formErrors';
import {
  buildStoreCreateBody, buildStorePatchBody, initialStoreFormState, storeFormFromStore, validateStoreForm,
  type StoreFormState,
} from '@/lib/storeForm';
import { ApiRequestError, createStore, updateStore } from '@/services/api';
import type { SaleFeeRounding, SaleFeeType, Store } from '@/types/api';
import FormField from './FormField';
import styles from './forms.module.css';
import Modal from './Modal';

const BASE_FIELDS = [
  'name', 'currency', 'saleFeeType', 'saleFeeRate', 'saleFeeRounding', 'saleMinFeeCents', 'saleFixedFeeCents',
  'allowsWithdrawal', 'withdrawalFeeRate', 'withdrawalFixedFeeCents', 'isActive',
] as const;
const ROUNDINGS: SaleFeeRounding[] = ['CEIL', 'ROUND', 'FLOOR'];
const FEE_TYPES: SaleFeeType[] = ['DEDUCTED', 'ADDED'];

interface Props {
  // Sem `store` = nova loja.
  store?: Store;
  onClose: () => void;
  onSaved: (message: string) => void;
  onGone: () => void;
}

export default function StoreFormModal({ store, onClose, onSaved, onGone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const editing = store !== undefined;

  const [state, setState] = useState<StoreFormState>(() => (store ? storeFormFromStore(store, language) : initialStoreFormState()));
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = (partial: Partial<StoreFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  const currencyLocked = editing && store.inUse;
  const primaryLocked = editing && store.isPrimary;
  const withdrawalOff = !state.allowsWithdrawal;
  const currencyLabel = state.currency === 'USD' ? 'US$' : 'R$';

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'STORE_NOT_FOUND' && editing) {
      onGone();
      return;
    }
    const message = errorMessageFor(err, tLoose, language);
    const fields = editing ? BASE_FIELDS : [...BASE_FIELDS, 'isPrimary'];
    const { target, topLabelField } = resolveErrorTarget(err, fields);
    if (target) {
      setErrors({ [target]: message });
      setTopError(null);
    } else {
      const label = topLabelField ? tLoose(`fields.${topLabelField}`) : null;
      setErrors({});
      setTopError(label && label !== `fields.${topLabelField}` ? `${label}: ${message}` : message);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setTopError(null);
    const local = validateStoreForm(state, language);
    if (Object.keys(local).length > 0) {
      const translated: Partial<Record<string, string>> = {};
      for (const [field, key] of Object.entries(local)) translated[field] = tLoose(key);
      setErrors(translated);
      return;
    }
    setErrors({});
    if (store) {
      const body = buildStorePatchBody(state, store, language);
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      setSaving(true);
      updateStore(store.id, body)
        .then((saved) => onSaved(t('storeForm.updated', { name: saved.name })))
        .catch((err: unknown) => {
          setSaving(false);
          showApiError(err);
        });
      return;
    }
    setSaving(true);
    createStore(buildStoreCreateBody(state, language))
      .then((saved) => onSaved(t('storeForm.created', { name: saved.name })))
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  return (
    <Modal title={editing ? t('storeForm.editTitle', { name: store.name }) : t('storeForm.createTitle')} onClose={onClose} busy={saving} wide>
      <form className={styles.form} onSubmit={submit} noValidate>
        {topError && <div className={styles.topError} role="alert">{topError}</div>}
        <div className={styles.note} role="note">{t('storeForm.feeChangeNote')}</div>

        <div className={styles.grid}>
          <FormField label={t('storeForm.name')} error={errors.name}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                autoFocus
                maxLength={50}
                value={state.name}
                onChange={(e) => {
                  patch({ name: e.target.value });
                  clearError('name');
                }}
              />
            )}
          </FormField>
          <FormField
            label={t('storeForm.currency')}
            error={errors.currency}
            hint={currencyLocked ? t('storeForm.currencyLocked') : null}
          >
            {(c) => (
              <select
                {...c}
                className={styles.select}
                value={state.currency}
                disabled={currencyLocked}
                onChange={(e) => {
                  patch({ currency: e.target.value === 'BRL' ? 'BRL' : 'USD' });
                  clearError('currency');
                }}
              >
                <option value="USD">USD (US$)</option>
                <option value="BRL">BRL (R$)</option>
              </select>
            )}
          </FormField>
        </div>

        <fieldset className={styles.details} style={{ margin: 0 }}>
          <legend>{t('storeForm.saleFeeSection')}</legend>
          <div className={styles.grid}>
            <FormField label={t('storeForm.saleFeeType')} error={errors.saleFeeType}>
              {(c) => (
                <select
                  {...c}
                  className={styles.select}
                  value={state.saleFeeType}
                  onChange={(e) => {
                    patch({ saleFeeType: e.target.value === 'DEDUCTED' || e.target.value === 'ADDED' ? e.target.value : '' });
                    clearError('saleFeeType');
                  }}
                >
                  <option value="">{t('storeForm.notConfigured')}</option>
                  {FEE_TYPES.map((type) => <option key={type} value={type}>{tLoose(`storeForm.feeType.${type}`)}</option>)}
                </select>
              )}
            </FormField>
            <FormField label={t('storeForm.saleFeeRate')} error={errors.saleFeeRate} hint={t('storeForm.percentHint')}>
              {(c) => (
                <input
                  {...c}
                  className={styles.input}
                  inputMode="decimal"
                  value={state.saleFeeRateText}
                  onChange={(e) => {
                    patch({ saleFeeRateText: e.target.value });
                    clearError('saleFeeRate');
                    clearError('saleFeeType');
                  }}
                />
              )}
            </FormField>
            <FormField label={t('storeForm.saleFeeRounding')} error={errors.saleFeeRounding}>
              {(c) => (
                <select
                  {...c}
                  className={styles.select}
                  value={state.saleFeeRounding}
                  onChange={(e) => patch({ saleFeeRounding: ROUNDINGS.find((r) => r === e.target.value) ?? 'CEIL' })}
                >
                  {ROUNDINGS.map((r) => <option key={r} value={r}>{tLoose(`storeForm.rounding.${r}`)}</option>)}
                </select>
              )}
            </FormField>
            <FormField label={t('storeForm.saleMinFee', { currency: currencyLabel })} error={errors.saleMinFeeCents} hint={t('storeForm.emptyIsNone')}>
              {(c) => (
                <input
                  {...c}
                  className={styles.input}
                  inputMode="decimal"
                  value={state.saleMinFeeText}
                  onChange={(e) => {
                    patch({ saleMinFeeText: e.target.value });
                    clearError('saleMinFeeCents');
                  }}
                />
              )}
            </FormField>
            <FormField label={t('storeForm.saleFixedFee', { currency: currencyLabel })} error={errors.saleFixedFeeCents} hint={t('storeForm.emptyIsZero')}>
              {(c) => (
                <input
                  {...c}
                  className={styles.input}
                  inputMode="decimal"
                  value={state.saleFixedFeeText}
                  onChange={(e) => {
                    patch({ saleFixedFeeText: e.target.value });
                    clearError('saleFixedFeeCents');
                  }}
                />
              )}
            </FormField>
          </div>
        </fieldset>

        <fieldset className={styles.details} style={{ margin: 0 }}>
          <legend>{t('storeForm.withdrawalSection')}</legend>
          <div className={styles.grid}>
            <FormField label={t('storeForm.allowsWithdrawal')} error={errors.allowsWithdrawal} hint={withdrawalOff ? t('storeForm.withdrawalOffHint') : null} full>
              {(c) => (
                <input
                  {...c}
                  type="checkbox"
                  checked={state.allowsWithdrawal}
                  onChange={(e) => patch({ allowsWithdrawal: e.target.checked })}
                />
              )}
            </FormField>
            <FormField label={t('storeForm.withdrawalFeeRate')} error={errors.withdrawalFeeRate} hint={t('storeForm.percentHint')}>
              {(c) => (
                <input
                  {...c}
                  className={styles.input}
                  inputMode="decimal"
                  disabled={withdrawalOff}
                  value={state.withdrawalFeeRateText}
                  onChange={(e) => {
                    patch({ withdrawalFeeRateText: e.target.value });
                    clearError('withdrawalFeeRate');
                  }}
                />
              )}
            </FormField>
            <FormField label={t('storeForm.withdrawalFixedFee', { currency: currencyLabel })} error={errors.withdrawalFixedFeeCents} hint={t('storeForm.emptyIsZero')}>
              {(c) => (
                <input
                  {...c}
                  className={styles.input}
                  inputMode="decimal"
                  disabled={withdrawalOff}
                  value={state.withdrawalFixedFeeText}
                  onChange={(e) => {
                    patch({ withdrawalFixedFeeText: e.target.value });
                    clearError('withdrawalFixedFeeCents');
                  }}
                />
              )}
            </FormField>
          </div>
        </fieldset>

        <div className={styles.grid}>
          <FormField
            label={t('storeForm.isActive')}
            error={errors.isActive}
            hint={primaryLocked ? t('storeForm.primaryCannotDeactivate') : null}
          >
            {(c) => (
              <input
                {...c}
                type="checkbox"
                checked={state.isActive}
                disabled={primaryLocked}
                onChange={(e) => {
                  patch({ isActive: e.target.checked });
                  clearError('isActive');
                }}
              />
            )}
          </FormField>
          {!editing && (
            <FormField label={t('storeForm.isPrimary')} error={errors.isPrimary}>
              {(c) => (
                <input
                  {...c}
                  type="checkbox"
                  checked={state.isPrimary}
                  onChange={(e) => {
                    patch({ isPrimary: e.target.checked });
                    clearError('isPrimary');
                  }}
                />
              )}
            </FormField>
          )}
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
