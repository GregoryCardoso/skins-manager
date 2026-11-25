'use client';

import { useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import {
  buildDepositCreateBody, buildDepositPatchBody, depositFormFromDeposit, depositStoreOptions, initialDepositState,
  legacyStoreIsNotUsd, validateDepositForm, type DepositFormState,
} from '@/lib/depositForm';
import { moneyInputMode } from '@/lib/currencies';
import { resolveErrorTarget } from '@/lib/formErrors';
import { formatMoney } from '@/lib/format';
import { MAX_NOTE_LENGTH } from '@/lib/limits';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, createDeposit, updateDeposit } from '@/services/api';
import type { Deposit, Store } from '@/types/api';
import Link from 'next/link';
import FormField from './FormField';
import styles from './forms.module.css';
import Modal from './Modal';
import { usePreferences } from './PreferencesProvider';

const FORM_FIELDS = ['storeId', 'amountStoreCents', 'feeCents', 'amountBrlCents', 'depositedAt', 'note'] as const;

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
  const locale = useLocale();
  const editing = deposit !== undefined;
  const invalidate = useInvalidate();
  const { displayCurrency } = usePreferences();
  // Moeda do valor pago informativo (11.4): a do registro, quando ele já tem valor; senão a moeda de conversão de agora.
  const paidCurrency = deposit && deposit.amountBrlCents !== null ? deposit.amountBrlCurrency ?? 'BRL' : displayCurrency;

  const [state, setState] = useState<DepositFormState>(() => (deposit ? depositFormFromDeposit(deposit, locale) : initialDepositState()));
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
    const message = errorMessageFor(err, tLoose, locale);
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
    const local = validateDepositForm(state, locale, paidCurrency);
    if (Object.keys(local).length > 0) {
      const translated: Partial<Record<string, string>> = {};
      for (const [field, key] of Object.entries(local)) translated[field] = tLoose(key);
      setErrors(translated);
      return;
    }
    setErrors({});
    if (deposit) {
      const body = buildDepositPatchBody(state, deposit, locale, paidCurrency);
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      setSaving(true);
      updateDeposit(deposit.id, body)
        .then(() => {
          invalidate('deposit.update');
          onSaved(t('deposits.updated'));
        })
        .catch((err: unknown) => {
          setSaving(false);
          showApiError(err);
        });
      return;
    }
    setSaving(true);
    createDeposit(buildDepositCreateBody(state, locale, paidCurrency))
      .then((saved) => {
        invalidate('deposit.create');
        onSaved(t('deposits.created', { value: saved.amountStoreCents === null ? '' : formatMoney(saved.amountStoreCents, 'USD', locale) }));
      })
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  // Só lojas em USD ativas (E8-Q16), mais a gravada no aporte se for USD (mesmo inativa). A Steam nunca aparece.
  const storeOptions = depositStoreOptions(stores, deposit ?? null);
  const legacy = deposit?.legacy === true;
  const noUsdStores = storeOptions.length === 0;

  return (
    <Modal title={editing ? t('deposits.form.editTitle') : t('deposits.form.createTitle')} onClose={onClose} busy={saving}>
      <form className={styles.form} onSubmit={submit} noValidate>
        {topError && <div className={styles.topError} role="alert">{topError}</div>}
        {legacy && <p className={styles.hint}>{t('deposits.legacyEditHint')}</p>}
        {noUsdStores && (
          <p className={styles.hint} role="status">
            {t('deposits.noUsdStores')} <Link href="/stores/">{t('withdrawals.goToStores')}</Link>
          </p>
        )}

        <FormField
          label={t('deposits.form.store')}
          error={errors.storeId}
          hint={deposit && legacyStoreIsNotUsd(deposit) ? t('deposits.legacyStoreNotUsd') : undefined}
        >
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
              <option value="">{t('deposits.form.chooseStore')}</option>
              {storeOptions.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.isActive ? store.name : t('deposits.inactiveStore', { name: store.name })}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <div className={styles.grid}>
          <FormField label={t('deposits.amountStore')} error={errors.amountStoreCents}>
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
          <FormField label={t('deposits.feeOptional')} error={errors.feeCents}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                inputMode="decimal"
                value={state.feeText}
                onChange={(e) => {
                  patch({ feeText: e.target.value });
                  clearError('feeCents');
                }}
              />
            )}
          </FormField>
          <FormField label={t('deposits.amountBrlOptional', { currency: paidCurrency })} error={errors.amountBrlCents}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                inputMode={moneyInputMode(paidCurrency)}
                value={state.paidText}
                onChange={(e) => {
                  patch({ paidText: e.target.value });
                  clearError('amountBrlCents');
                }}
              />
            )}
          </FormField>
          <p className={styles.hint}>{t('storeBalances.startHint')}</p>
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

        <FormField label={t('deposits.form.note')} error={errors.note}>
          {(c) => (
            <input
              {...c}
              className={styles.input}
              maxLength={MAX_NOTE_LENGTH}
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
