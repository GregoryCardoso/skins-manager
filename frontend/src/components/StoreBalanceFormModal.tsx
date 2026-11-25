'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { currencySymbol, moneyErrorParams, moneyInputMode } from '@/lib/currencies';
import { resolveErrorTarget } from '@/lib/formErrors';
import { formatMoney } from '@/lib/format';
import { formatCentsInput } from '@/lib/numberInput';
import {
  buildCheckPreviewQuery, buildStoreBalanceBody, initialStoreBalanceState, validateStoreBalanceForm, type StoreBalanceFormState,
} from '@/lib/storeBalanceForm';
import { MAX_NOTE_LENGTH } from '@/lib/limits';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, createStoreBalanceCheck, getStoreBalanceCheckPreview } from '@/services/api';
import type { StoreBalanceCheckPreview, StoreBalanceSummary } from '@/types/api';
import FormField from './FormField';
import styles from './forms.module.css';
import Modal from './Modal';

const FORM_FIELDS = ['balanceCents', 'recordedAt', 'note'] as const;
const PREVIEW_DEBOUNCE_MS = 300;

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: StoreBalanceCheckPreview }
  | { status: 'error'; message: string };

interface Props {
  store: StoreBalanceSummary;
  // Saldo real já preenchido (9.7: "Registrar conferência com estes valores", com o saldo do CSFloat).
  initialAmountCents?: number | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

// Conferência do saldo (D242, D247): o usuário digita o saldo REAL do site; o backend calcula o saldo na data e a diferença
// (prévia com debounce, nada é calculado aqui). Dois caminhos: só registrar a conferência ou registrar também o ajuste.
export default function StoreBalanceFormModal({ store, onClose, onSaved, initialAmountCents = null }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();

  const [state, setState] = useState<StoreBalanceFormState>(() => {
    const initial = initialStoreBalanceState();
    return initialAmountCents === null ? initial : { ...initial, amountText: formatCentsInput(initialAmountCents, locale, store.currency) };
  });
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });

  const patch = (partial: Partial<StoreBalanceFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  // Prévia: espera 300 ms depois da última digitação e cancela a chamada anterior.
  useEffect(() => {
    const query = buildCheckPreviewQuery({ amountText: state.amountText, recordedAt: state.recordedAt, noteText: '' }, store.storeId, locale, store.currency);
    if (query === null) {
      setPreview({ status: 'idle' });
      return undefined;
    }
    const controller = new AbortController();
    setPreview({ status: 'loading' });
    const timer = setTimeout(() => {
      getStoreBalanceCheckPreview(query, controller.signal)
        .then((data) => setPreview({ status: 'ok', data }))
        .catch((err: unknown) => {
          if (controller.signal.aborted || (err instanceof ApiRequestError && err.code === 'ABORTED')) return;
          setPreview({ status: 'error', message: errorMessageFor(err, tLoose, locale) });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state.amountText, state.recordedAt, store.storeId, locale, tLoose]);

  const showApiError = (err: unknown) => {
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

  const submit = (adjust: boolean) => {
    if (saving) return;
    setTopError(null);
    const local = validateStoreBalanceForm(state, locale, { adjust, currency: store.currency });
    if (Object.keys(local).length > 0) {
      const translated: Partial<Record<string, string>> = {};
      for (const [field, key] of Object.entries(local)) translated[field] = tLoose(key, moneyErrorParams(locale, store.currency));
      setErrors(translated);
      return;
    }
    setErrors({});
    setSaving(true);
    createStoreBalanceCheck(buildStoreBalanceBody(state, store.storeId, locale, adjust, store.currency))
      .then((saved) => {
        invalidate('balanceCheck.create');
        onSaved(
          saved.adjustmentCents !== null
            ? t('storeBalances.checkAdjusted', { store: store.storeName, value: formatMoney(saved.adjustmentCents, store.currency, locale) })
            : t('storeBalances.checkSaved', { store: store.storeName })
        );
      })
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(false);
  };

  const currencyLabel = currencySymbol(store.currency, locale);
  const difference = preview.status === 'ok' ? preview.data.differenceCents : null;
  const hasDifference = difference !== null && difference !== 0;

  return (
    <Modal title={t('storeBalances.form.title', { store: store.storeName })} onClose={onClose} busy={saving}>
      <form className={styles.form} onSubmit={onFormSubmit} noValidate>
        {topError && <div className={styles.topError} role="alert">{topError}</div>}
        <p className={styles.hint}>{t('storeBalances.form.intro')}</p>

        <div className={styles.grid}>
          <FormField label={t('storeBalances.form.amount', { currency: currencyLabel })} error={errors.balanceCents}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                inputMode={moneyInputMode(store.currency)}
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

        <div aria-live="polite" className={styles.hint}>
          {preview.status === 'loading' && t('storeBalances.checkPreviewLoading')}
          {preview.status === 'error' && <span role="alert">{preview.message}</span>}
          {preview.status === 'ok' && (
            hasDifference
              ? t('storeBalances.checkPreview', {
                computed: formatMoney(preview.data.computedCents, store.currency, locale),
                difference: formatMoney(preview.data.differenceCents, store.currency, locale),
              })
              : `${t('storeBalances.computed')}: ${formatMoney(preview.data.computedCents, store.currency, locale)}. ${t('storeBalances.checkPreviewMatch')}`
          )}
        </div>

        {hasDifference && (
          <FormField label={t('storeBalances.adjustmentNote')} error={errors.note} hint={t('storeBalances.adjustmentNoteHint')}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                maxLength={MAX_NOTE_LENGTH}
                value={state.noteText}
                onChange={(e) => {
                  patch({ noteText: e.target.value });
                  clearError('note');
                }}
              />
            )}
          </FormField>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          {hasDifference ? (
            <>
              <button type="button" className={styles.button} onClick={() => submit(false)} disabled={saving}>
                {t('storeBalances.saveCheckOnly')}
              </button>
              <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => submit(true)} disabled={saving}>
                {saving ? t('common.saving') : t('storeBalances.adjustAndSave')}
              </button>
            </>
          ) : (
            <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={saving}>
              {saving ? t('common.saving') : t('storeBalances.saveCheck')}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
