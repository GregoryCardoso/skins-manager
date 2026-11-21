'use client';

import { useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { resolveErrorTarget } from '@/lib/formErrors';
import { formatMoney } from '@/lib/format';
import {
  buildStoreBalanceBody, initialStoreBalanceState, validateStoreBalanceForm, type StoreBalanceFormState,
} from '@/lib/storeBalanceForm';
import { ApiRequestError, createStoreBalance } from '@/services/api';
import type { StoreBalanceSummary } from '@/types/api';
import FormField from './FormField';
import styles from './forms.module.css';
import Modal from './Modal';

const FORM_FIELDS = ['balanceCents', 'recordedAt'] as const;

interface Props {
  store: StoreBalanceSummary;
  onClose: () => void;
  onSaved: (message: string) => void;
}

// Registra o saldo DISPONÍVEL da loja (o que o site da loja mostra). O histórico é append-only (D200).
export default function StoreBalanceFormModal({ store, onClose, onSaved }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();

  const [state, setState] = useState<StoreBalanceFormState>(() => initialStoreBalanceState());
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = (partial: Partial<StoreBalanceFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  const showApiError = (err: unknown) => {
    const message = errorMessageFor(err, tLoose, language);
    const { target, topLabelField } = resolveErrorTarget(err, FORM_FIELDS);
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
    const local = validateStoreBalanceForm(state, language);
    if (Object.keys(local).length > 0) {
      const translated: Partial<Record<string, string>> = {};
      for (const [field, key] of Object.entries(local)) translated[field] = tLoose(key);
      setErrors(translated);
      return;
    }
    setErrors({});
    setSaving(true);
    createStoreBalance(buildStoreBalanceBody(state, store.storeId, language))
      .then((saved) => onSaved(t('storeBalances.created', {
        store: store.storeName, value: formatMoney(saved.balanceCents, store.currency, language),
      })))
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  const currencyLabel = store.currency === 'USD' ? 'US$' : 'R$';

  return (
    <Modal title={t('storeBalances.form.title', { store: store.storeName })} onClose={onClose} busy={saving}>
      <form className={styles.form} onSubmit={submit} noValidate>
        {topError && <div className={styles.topError} role="alert">{topError}</div>}
        <p className={styles.hint}>{t('storeBalances.form.intro')}</p>

        <div className={styles.grid}>
          <FormField label={t('storeBalances.form.amount', { currency: currencyLabel })} error={errors.balanceCents}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                inputMode="decimal"
                autoFocus
                value={state.amountText}
                onChange={(e) => {
                  patch({ amountText: e.target.value });
                  clearError('balanceCents');
                }}
              />
            )}
          </FormField>
          <FormField label={t('storeBalances.form.date')} error={errors.recordedAt}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                type="datetime-local"
                value={state.recordedAt}
                onChange={(e) => {
                  patch({ recordedAt: e.target.value });
                  clearError('recordedAt');
                }}
              />
            )}
          </FormField>
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
