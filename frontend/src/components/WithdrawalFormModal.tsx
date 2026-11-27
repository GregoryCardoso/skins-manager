'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { moneyErrorParams, type CurrencyCode } from '@/lib/currencies';
import { resolveErrorTarget } from '@/lib/formErrors';
import {
  applyFeeSuggestion, buildWithdrawalCreateBody, buildWithdrawalPatchBody, editFee, feeSuggestionRequest,
  initialWithdrawalState, validateWithdrawalForm, withdrawalAmountText, withdrawalFormFromWithdrawal, withdrawalStoreOptions,
  type WithdrawalFormState,
} from '@/lib/withdrawalForm';
import { MAX_NOTE_LENGTH } from '@/lib/limits';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, createWithdrawal, getWithdrawalFeeSuggestion, updateWithdrawal } from '@/services/api';
import type { Store, Withdrawal } from '@/types/api';
import styles from './moneyForms.module.css';
import { usePreferences } from './PreferencesProvider';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import Disclosure from './ui/Disclosure';
import FormErrorSummary, { type FormErrorItem } from './ui/FormErrorSummary';
import NumberField from './ui/NumberField';
import Select from './ui/Select';
import TextField from './ui/TextField';

const FORM_FIELDS = ['storeId', 'amountStoreCents', 'feeCents', 'amountBrlCents', 'withdrawnAt', 'note'] as const;
// Campos em "Mais detalhes" (valor recebido e observação): o resumo de erros abre a seção para poder focá-los.
const DETAIL_FIELDS = ['amountBrlCents', 'note'] as const;
const SUGGESTION_DEBOUNCE_MS = 300;

interface Props {
  // Sem `withdrawal` = novo saque.
  withdrawal?: Withdrawal;
  stores: Store[];
  // Saque aberto pela linha de uma loja: a loja já vem escolhida (e pode ser trocada). Só vale se ela aceita saques.
  initialStoreId?: number | null;
  onClose: () => void;
  onSaved: (message: string) => void;
  onGone: () => void;
}

// Saque no design system (12.7b): Dialog `md`; loja, valor sacado, taxa paga (sugerida pelo backend) e data à vista; valor recebido
// (informativo) e observação em "Mais detalhes". As regras continuam em `lib/withdrawalForm`.
export default function WithdrawalFormModal({ withdrawal, stores, initialStoreId = null, onClose, onSaved, onGone }: Props) {
  const invalidate = useInvalidate();
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const formId = useId();
  const editing = withdrawal !== undefined;
  const { displayCurrency } = usePreferences();

  const storeOptions = withdrawalStoreOptions(stores, withdrawal?.storeId ?? null);

  const [state, setState] = useState<WithdrawalFormState>(() => {
    if (withdrawal) return withdrawalFormFromWithdrawal(withdrawal, locale);
    const initial = initialWithdrawalState();
    return initialStoreId !== null && storeOptions.some((store) => store.id === initialStoreId) ? { ...initial, storeId: initialStoreId } : initial;
  });
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(() => withdrawal !== undefined && (withdrawal.amountBrlCents !== null || (withdrawal.note ?? '') !== ''));
  // Aviso da sugestão (taxa da loja não configurada) e se o valor atual do campo veio da sugestão.
  const [feeWarning, setFeeWarning] = useState<string | null>(null);
  const [feeFromSuggestion, setFeeFromSuggestion] = useState(false);

  // Moedas dos campos (11.4): valor sacado e taxa na moeda da loja; o "recebido" informativo na moeda do registro (a de conversão, no novo).
  const selectedStore = stores.find((store) => store.id === state.storeId) ?? null;
  const currency = selectedStore?.currency ?? 'USD';
  const receivedCurrency = withdrawal && withdrawal.amountBrlCents !== null ? withdrawal.amountBrlCurrency ?? 'BRL' : displayCurrency;
  const currencies = { store: selectedStore?.currency, received: receivedCurrency };

  const patch = (partial: Partial<WithdrawalFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  // Sugestão de taxa (E8-Q12): debounce de 300 ms; só enquanto a taxa não foi tocada.
  const request = feeSuggestionRequest(state, locale, selectedStore?.currency);
  const requestKey = request ? `${request.storeId}:${request.amountStoreCents}` : null;
  const feeTouched = state.feeTouched;
  useEffect(() => {
    if (feeTouched) {
      setFeeFromSuggestion(false);
      setFeeWarning(null);
      return undefined;
    }
    if (requestKey === null) {
      setState((s) => applyFeeSuggestion(s, null, locale, selectedStore?.currency));
      setFeeFromSuggestion(false);
      setFeeWarning(null);
      return undefined;
    }
    const [storeId, amountStoreCents] = requestKey.split(':').map(Number);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getWithdrawalFeeSuggestion(storeId, amountStoreCents, controller.signal)
        .then((suggestion) => {
          setState((s) => applyFeeSuggestion(s, suggestion.suggestedFeeCents, locale, selectedStore?.currency));
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
  }, [requestKey, feeTouched, locale, selectedStore?.currency]);

  const showErrors = (next: Partial<Record<string, string>>) => {
    setErrors(next);
    setAttempt((n) => n + 1);
    if (DETAIL_FIELDS.some((field) => next[field])) setDetailsOpen(true);
  };

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'WITHDRAWAL_NOT_FOUND') {
      onGone();
      return;
    }
    const message = errorMessageFor(err, tLoose, locale);
    const { target, topLabelField } = resolveErrorTarget(err, FORM_FIELDS);
    if (target) {
      showErrors({ [target]: message });
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
    const local = validateWithdrawalForm(state, locale, currencies);
    if (Object.keys(local).length > 0) {
      const translated: Partial<Record<string, string>> = {};
      for (const [field, key] of Object.entries(local)) translated[field] = tLoose(key, moneyErrorParams(locale, field === 'amountBrlCents' ? receivedCurrency : currency));
      showErrors(translated);
      return;
    }
    setErrors({});
    if (withdrawal) {
      const body = buildWithdrawalPatchBody(state, withdrawal, locale, currencies);
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      setSaving(true);
      updateWithdrawal(withdrawal.id, body)
        .then(() => {
          invalidate('withdrawal.update');
          onSaved(t('withdrawals.updated'));
        })
        .catch((err: unknown) => {
          setSaving(false);
          showApiError(err);
        });
      return;
    }
    setSaving(true);
    createWithdrawal(buildWithdrawalCreateBody(state, locale, currencies))
      .then((saved) => {
        invalidate('withdrawal.create');
        onSaved(t('withdrawals.created', { value: withdrawalAmountText(saved, locale) }));
      })
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  const legacy = withdrawal?.legacyWithoutStore === true;

  let feeHint = t('withdrawals.form.feeHint');
  if (feeFromSuggestion && !state.feeTouched) feeHint = t('withdrawals.form.feeSuggested');
  else if (feeWarning === 'FEES_NOT_CONFIGURED' && !state.feeTouched) feeHint = t('withdrawals.form.feeNotConfigured');

  const summaryItems: FormErrorItem[] = FORM_FIELDS
    .filter((field) => errors[field])
    .map((field) => {
      const label = tLoose(`fields.${field}`);
      return { field, label: label === `fields.${field}` ? field : label, message: errors[field] as string };
    });

  return (
    <Dialog
      title={editing ? t('withdrawals.form.editTitle') : t('withdrawals.form.createTitle')}
      size="md"
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" loading={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        <FormErrorSummary key={attempt} errors={summaryItems} />
        {topError && <Banner tone="danger">{topError}</Banner>}
        {legacy && <Banner tone="info" announce={false}>{t('withdrawals.form.legacyHint')}</Banner>}

        <div className={styles.grid}>
          <div className={styles.full}>
            <Select
              label={t('withdrawals.form.store')}
              name="storeId"
              value={state.storeId === null ? '' : String(state.storeId)}
              error={errors.storeId}
              required
              autoFocus={state.storeId === null}
              disabled={saving}
              placeholder={t('withdrawals.form.chooseStore')}
              onChange={(value) => {
                patch({ storeId: value === '' ? null : Number(value) });
                clearError('storeId');
              }}
              options={storeOptions.map((store) => ({ value: String(store.id), label: store.isActive ? store.name : t('withdrawals.inactiveStore', { name: store.name }) }))}
            />
          </div>
          <NumberField
            kind="money"
            currency={currency}
            label={t('withdrawals.form.amount', { currency })}
            name="amountStoreCents"
            value={state.amountText}
            error={errors.amountStoreCents}
            required
            autoFocus={state.storeId !== null}
            disabled={saving}
            onValueChange={(text) => {
              patch({ amountText: text });
              clearError('amountStoreCents');
            }}
          />
          <NumberField
            kind="money"
            currency={currency}
            label={t('withdrawals.form.fee', { currency })}
            name="feeCents"
            value={state.feeText}
            error={errors.feeCents}
            hint={feeHint}
            disabled={saving}
            onValueChange={(text) => {
              setState((s) => editFee(s, text));
              clearError('feeCents');
            }}
          />
          <div className={styles.full}>
            <TextField
              label={t('withdrawals.form.date')}
              name="withdrawnAt"
              type="datetime-local"
              value={state.withdrawnAt}
              error={errors.withdrawnAt}
              required
              disabled={saving}
              onChange={(value) => {
                patch({ withdrawnAt: value });
                clearError('withdrawnAt');
              }}
            />
          </div>
        </div>

        <Disclosure label={t('common.moreDetails')} open={detailsOpen} onOpenChange={setDetailsOpen}>
          <div className={styles.stack}>
            <p className={styles.small}>{t('forms.moreDetailsInformative')}</p>
            <NumberField
              kind="money"
              currency={receivedCurrency as CurrencyCode}
              label={t('withdrawals.amountBrlOptional', { currency: receivedCurrency })}
              name="amountBrlCents"
              value={state.receivedText}
              error={errors.amountBrlCents}
              disabled={saving}
              onValueChange={(text) => {
                patch({ receivedText: text });
                clearError('amountBrlCents');
              }}
            />
            <TextField
              label={t('withdrawals.form.note')}
              name="note"
              value={state.note}
              error={errors.note}
              maxLength={MAX_NOTE_LENGTH}
              disabled={saving}
              onChange={(value) => {
                patch({ note: value });
                clearError('note');
              }}
            />
          </div>
        </Disclosure>
      </form>
    </Dialog>
  );
}
