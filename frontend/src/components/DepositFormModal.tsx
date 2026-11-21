'use client';

import { useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import {
  buildDepositCreateBody, buildDepositPatchBody, depositFormFromDeposit, initialDepositState, validateDepositForm,
  type DepositFormState,
} from '@/lib/depositForm';
import { resolveErrorTarget } from '@/lib/formErrors';
import { formatMoney } from '@/lib/format';
import { ApiRequestError, createDeposit, updateDeposit } from '@/services/api';
import type { Deposit, Store } from '@/types/api';
import FormField from './FormField';
import styles from './forms.module.css';
import Modal from './Modal';

const FORM_FIELDS = ['amountBrlCents', 'depositedAt', 'storeId', 'note'] as const;

interface Props {
  // Sem `deposit` = novo aporte.
  deposit?: Deposit;
  stores: Store[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onGone: () => void;
}

export default function DepositFormModal({ deposit, stores, onClose, onSaved, onGone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const editing = deposit !== undefined;

  const [state, setState] = useState<DepositFormState>(() => (deposit ? depositFormFromDeposit(deposit, language) : initialDepositState()));
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = (partial: Partial<DepositFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'DEPOSIT_NOT_FOUND') {
      onGone();
      return;
    }
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
    const local = validateDepositForm(state, language);
    if (Object.keys(local).length > 0) {
      const translated: Partial<Record<string, string>> = {};
      for (const [field, key] of Object.entries(local)) translated[field] = tLoose(key);
      setErrors(translated);
      return;
    }
    setErrors({});
    if (deposit) {
      const body = buildDepositPatchBody(state, deposit, language);
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      setSaving(true);
      updateDeposit(deposit.id, body)
        .then(() => onSaved(t('deposits.updated')))
        .catch((err: unknown) => {
          setSaving(false);
          showApiError(err);
        });
      return;
    }
    setSaving(true);
    createDeposit(buildDepositCreateBody(state, language))
      .then((saved) => onSaved(t('deposits.created', { value: formatMoney(saved.amountBrlCents, 'BRL', language) })))
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  // Loja inativa só aparece se já for a do aporte (vale para aportes antigos).
  const storeOptions = stores.filter((store) => store.isActive || store.id === state.storeId);

  return (
    <Modal title={editing ? t('deposits.form.editTitle') : t('deposits.form.createTitle')} onClose={onClose} busy={saving}>
      <form className={styles.form} onSubmit={submit} noValidate>
        {topError && <div className={styles.topError} role="alert">{topError}</div>}

        <div className={styles.grid}>
          <FormField label={t('deposits.form.amount')} error={errors.amountBrlCents}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                inputMode="decimal"
                autoFocus
                value={state.amountText}
                onChange={(e) => {
                  patch({ amountText: e.target.value });
                  clearError('amountBrlCents');
                }}
              />
            )}
          </FormField>
          <FormField label={t('deposits.form.date')} error={errors.depositedAt}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                type="datetime-local"
                value={state.depositedAt}
                onChange={(e) => {
                  patch({ depositedAt: e.target.value });
                  clearError('depositedAt');
                }}
              />
            )}
          </FormField>
        </div>

        <FormField label={t('deposits.form.store')} error={errors.storeId} hint={t('deposits.form.storeHint')}>
          {(c) => (
            <select
              {...c}
              className={styles.select}
              value={state.storeId === null ? '' : String(state.storeId)}
              onChange={(e) => {
                patch({ storeId: e.target.value === '' ? null : Number(e.target.value) });
                clearError('storeId');
              }}
            >
              <option value="">{t('deposits.form.noStore')}</option>
              {storeOptions.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.isActive ? store.name : t('deposits.inactiveStore', { name: store.name })}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField label={t('deposits.form.note')} error={errors.note}>
          {(c) => (
            <input
              {...c}
              className={styles.input}
              maxLength={500}
              value={state.note}
              onChange={(e) => {
                patch({ note: e.target.value });
                clearError('note');
              }}
            />
          )}
        </FormField>

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
