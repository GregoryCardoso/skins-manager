'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { resolveErrorTarget } from '@/lib/formErrors';
import {
  applyFeeSuggestion, buildWithdrawalCreateBody, buildWithdrawalPatchBody, editFee, feeSuggestionRequest,
  initialWithdrawalState, validateWithdrawalForm, withdrawalAmountText, withdrawalFormFromWithdrawal, withdrawalStoreOptions,
  type WithdrawalFormState,
} from '@/lib/withdrawalForm';
import { ApiRequestError, createWithdrawal, getWithdrawalFeeSuggestion, updateWithdrawal } from '@/services/api';
import type { Store, Withdrawal } from '@/types/api';
import FormField from './FormField';
import styles from './forms.module.css';
import Modal from './Modal';

const FORM_FIELDS = ['storeId', 'amountStoreCents', 'feeCents', 'amountBrlCents', 'withdrawnAt', 'note'] as const;
const SUGGESTION_DEBOUNCE_MS = 300;

interface Props {
  // Sem `withdrawal` = novo saque.
  withdrawal?: Withdrawal;
  stores: Store[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onGone: () => void;
}

export default function WithdrawalFormModal({ withdrawal, stores, onClose, onSaved, onGone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const editing = withdrawal !== undefined;

  const [state, setState] = useState<WithdrawalFormState>(() =>
    withdrawal ? withdrawalFormFromWithdrawal(withdrawal, language) : initialWithdrawalState());
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Aviso da sugestão (taxa da loja não configurada) e se o valor atual do campo veio da sugestão.
  const [feeWarning, setFeeWarning] = useState<string | null>(null);
  const [feeFromSuggestion, setFeeFromSuggestion] = useState(false);

  const patch = (partial: Partial<WithdrawalFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  // Sugestão de taxa (E8-Q12): debounce de 300 ms; só enquanto a taxa não foi tocada.
  const request = feeSuggestionRequest(state, language);
  const requestKey = request ? `${request.storeId}:${request.amountStoreCents}` : null;
  const feeTouched = state.feeTouched;
  useEffect(() => {
    if (feeTouched) {
      setFeeFromSuggestion(false);
      setFeeWarning(null);
      return undefined;
    }
    if (requestKey === null) {
      setState((s) => applyFeeSuggestion(s, null, language));
      setFeeFromSuggestion(false);
      setFeeWarning(null);
      return undefined;
    }
    const [storeId, amountStoreCents] = requestKey.split(':').map(Number);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getWithdrawalFeeSuggestion(storeId, amountStoreCents, controller.signal)
        .then((suggestion) => {
          setState((s) => applyFeeSuggestion(s, suggestion.suggestedFeeCents, language));
          setFeeFromSuggestion(suggestion.suggestedFeeCents !== null);
          setFeeWarning(suggestion.warningCode);
        })
        .catch(() => {
          // Sugestão é só uma ajuda: se falhar, o campo fica como está e o usuário digita a taxa.
        });
    }, SUGGESTION_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, feeTouched, language]);

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'WITHDRAWAL_NOT_FOUND') {
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
    const local = validateWithdrawalForm(state, language);
    if (Object.keys(local).length > 0) {
      const translated: Partial<Record<string, string>> = {};
      for (const [field, key] of Object.entries(local)) translated[field] = tLoose(key);
      setErrors(translated);
      return;
    }
    setErrors({});
    if (withdrawal) {
      const body = buildWithdrawalPatchBody(state, withdrawal, language);
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      setSaving(true);
      updateWithdrawal(withdrawal.id, body)
        .then(() => onSaved(t('withdrawals.updated')))
        .catch((err: unknown) => {
          setSaving(false);
          showApiError(err);
        });
      return;
    }
    setSaving(true);
    createWithdrawal(buildWithdrawalCreateBody(state, language))
      .then((saved) => onSaved(t('withdrawals.created', { value: withdrawalAmountText(saved, language) })))
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  const storeOptions = withdrawalStoreOptions(stores, withdrawal?.storeId ?? null);
  const selectedStore = stores.find((store) => store.id === state.storeId) ?? null;
  const currency = selectedStore?.currency ?? 'USD';
  const legacy = withdrawal?.legacyWithoutStore === true;

  let feeHint = t('withdrawals.form.feeHint');
  if (feeFromSuggestion && !state.feeTouched) feeHint = t('withdrawals.form.feeSuggested');
  else if (feeWarning === 'FEES_NOT_CONFIGURED' && !state.feeTouched) feeHint = t('withdrawals.form.feeNotConfigured');

  return (
    <Modal title={editing ? t('withdrawals.form.editTitle') : t('withdrawals.form.createTitle')} onClose={onClose} busy={saving}>
      <form className={styles.form} onSubmit={submit} noValidate>
        {topError && <div className={styles.topError} role="alert">{topError}</div>}
        {legacy && <p className={styles.hint}>{t('withdrawals.form.legacyHint')}</p>}

        <FormField label={t('withdrawals.form.store')} error={errors.storeId}>
          {(c) => (
            <select
              {...c}
              className={styles.select}
              autoFocus
              value={state.storeId === null ? '' : String(state.storeId)}
              onChange={(e) => {
                patch({ storeId: e.target.value === '' ? null : Number(e.target.value) });
                clearError('storeId');
              }}
            >
              <option value="">{t('withdrawals.form.chooseStore')}</option>
              {storeOptions.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.isActive ? store.name : t('withdrawals.inactiveStore', { name: store.name })}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <div className={styles.grid}>
          <FormField label={t('withdrawals.form.amount', { currency })} error={errors.amountStoreCents}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                inputMode="decimal"
                value={state.amountText}
                onChange={(e) => {
                  patch({ amountText: e.target.value });
                  clearError('amountStoreCents');
                }}
              />
            )}
          </FormField>
          <FormField label={t('withdrawals.form.fee', { currency })} error={errors.feeCents} hint={feeHint}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                inputMode="decimal"
                value={state.feeText}
                onChange={(e) => {
                  setState((s) => editFee(s, e.target.value));
                  clearError('feeCents');
                }}
              />
            )}
          </FormField>
          <FormField label={t('withdrawals.amountBrlOptional')} error={errors.amountBrlCents}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                inputMode="decimal"
                value={state.receivedText}
                onChange={(e) => {
                  patch({ receivedText: e.target.value });
                  clearError('amountBrlCents');
                }}
              />
            )}
          </FormField>
          <FormField label={t('withdrawals.form.date')} error={errors.withdrawnAt}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                type="datetime-local"
                value={state.withdrawnAt}
                onChange={(e) => {
                  patch({ withdrawnAt: e.target.value });
                  clearError('withdrawnAt');
                }}
              />
            )}
          </FormField>
        </div>

        <FormField label={t('withdrawals.form.note')} error={errors.note}>
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
