'use client';

import { useId, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import {
  buildDepositCreateBody, buildDepositPatchBody, depositFormFromDeposit, depositStoreOptions, initialDepositState,
  legacyStoreIsNotUsd, validateDepositForm, type DepositFormState,
} from '@/lib/depositForm';
import { moneyErrorParams, type CurrencyCode } from '@/lib/currencies';
import { resolveErrorTarget } from '@/lib/formErrors';
import { formatMoney } from '@/lib/format';
import { MAX_NOTE_LENGTH } from '@/lib/limits';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, createDeposit, updateDeposit } from '@/services/api';
import type { Deposit, Store } from '@/types/api';
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

const FORM_FIELDS = ['storeId', 'amountStoreCents', 'feeCents', 'amountBrlCents', 'depositedAt', 'note'] as const;
// Campos que ficam em "Mais detalhes" (valor pago e observação): o resumo de erros abre a seção para poder focá-los.
const DETAIL_FIELDS = ['amountBrlCents', 'note'] as const;

interface Props {
  // Sem `deposit` = novo aporte.
  deposit?: Deposit;
  stores: Store[];
  // Aporte aberto pela linha de uma loja: a loja já vem escolhida (e pode ser trocada). Só vale se ela aceita aportes.
  initialStoreId?: number | null;
  onClose: () => void;
  onSaved: (message: string) => void;
  onGone: () => void;
}

// Aporte no design system (12.7b): Dialog `md`; loja, valor creditado, taxa e data à vista; valor pago (informativo) e observação em
// "Mais detalhes". As regras (lojas em US$, taxa no total colocado) continuam em `lib/depositForm`.
export default function DepositFormModal({ deposit, stores, initialStoreId = null, onClose, onSaved, onGone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const editing = deposit !== undefined;
  const invalidate = useInvalidate();
  const formId = useId();
  const { displayCurrency } = usePreferences();
  // Moeda do valor pago informativo (11.4): a do registro, quando ele já tem valor; senão a moeda de conversão de agora.
  const paidCurrency = deposit && deposit.amountBrlCents !== null ? deposit.amountBrlCurrency ?? 'BRL' : displayCurrency;

  // Só lojas em USD ativas (E8-Q16), mais a gravada no aporte se for USD (mesmo inativa). A Steam nunca aparece.
  const storeOptions = depositStoreOptions(stores, deposit ?? null);

  const [state, setState] = useState<DepositFormState>(() => {
    if (deposit) return depositFormFromDeposit(deposit, locale);
    const initial = initialDepositState();
    return initialStoreId !== null && storeOptions.some((store) => store.id === initialStoreId) ? { ...initial, storeId: initialStoreId } : initial;
  });
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(() => deposit !== undefined && (deposit.amountBrlCents !== null || (deposit.note ?? '') !== ''));

  const patch = (partial: Partial<DepositFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  // Mostra os erros e abre "Mais detalhes" se algum campo com erro estiver lá dentro (o resumo precisa focá-lo).
  const showErrors = (next: Partial<Record<string, string>>) => {
    setErrors(next);
    setAttempt((n) => n + 1);
    if (DETAIL_FIELDS.some((field) => next[field])) setDetailsOpen(true);
  };

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'DEPOSIT_NOT_FOUND') {
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
    const local = validateDepositForm(state, locale, paidCurrency);
    if (Object.keys(local).length > 0) {
      const translated: Partial<Record<string, string>> = {};
      for (const [field, key] of Object.entries(local)) translated[field] = tLoose(key, moneyErrorParams(locale, field === 'amountBrlCents' ? paidCurrency : 'USD'));
      showErrors(translated);
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

  const legacy = deposit?.legacy === true;
  const noUsdStores = storeOptions.length === 0;

  const summaryItems: FormErrorItem[] = FORM_FIELDS
    .filter((field) => errors[field])
    .map((field) => {
      const label = tLoose(`fields.${field}`);
      return { field, label: label === `fields.${field}` ? field : label, message: errors[field] as string };
    });

  return (
    <Dialog
      title={editing ? t('deposits.form.editTitle') : t('deposits.form.createTitle')}
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
        {legacy && <Banner tone="info" announce={false}>{t('deposits.legacyEditHint')}</Banner>}
        {noUsdStores && (
          <Banner tone="warning" announce={false} action={{ label: t('withdrawals.goToStores'), href: '/stores/' }}>
            {t('deposits.noUsdStores')}
          </Banner>
        )}

        <p className={styles.small}>{t('storeBalances.startHint')}</p>

        <div className={styles.grid}>
          <div className={styles.full}>
            <Select
              label={t('deposits.form.store')}
              name="storeId"
              value={state.storeId === null ? '' : String(state.storeId)}
              error={errors.storeId}
              hint={deposit && legacyStoreIsNotUsd(deposit) ? t('deposits.legacyStoreNotUsd') : undefined}
              required
              autoFocus={state.storeId === null}
              disabled={saving}
              placeholder={t('deposits.form.chooseStore')}
              onChange={(value) => {
                patch({ storeId: value === '' ? null : Number(value) });
                clearError('storeId');
              }}
              options={storeOptions.map((store) => ({ value: String(store.id), label: store.isActive ? store.name : t('deposits.inactiveStore', { name: store.name }) }))}
            />
          </div>
          <NumberField
            kind="money"
            currency="USD"
            label={t('deposits.amountStore')}
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
            currency="USD"
            label={t('deposits.feeOptional')}
            name="feeCents"
            value={state.feeText}
            error={errors.feeCents}
            disabled={saving}
            onValueChange={(text) => {
              patch({ feeText: text });
              clearError('feeCents');
            }}
          />
          <div className={styles.full}>
            <TextField
              label={t('deposits.form.date')}
              name="depositedAt"
              type="datetime-local"
              value={state.depositedAt}
              error={errors.depositedAt}
              required
              disabled={saving}
              onChange={(value) => {
                patch({ depositedAt: value });
                clearError('depositedAt');
              }}
            />
          </div>
        </div>

        <Disclosure label={t('common.moreDetails')} open={detailsOpen} onOpenChange={setDetailsOpen}>
          <div className={styles.stack}>
            <p className={styles.small}>{t('forms.moreDetailsInformative')}</p>
            <NumberField
              kind="money"
              currency={paidCurrency as CurrencyCode}
              label={t('deposits.amountBrlOptional', { currency: paidCurrency })}
              name="amountBrlCents"
              value={state.paidText}
              error={errors.amountBrlCents}
              disabled={saving}
              onValueChange={(text) => {
                patch({ paidText: text });
                clearError('amountBrlCents');
              }}
            />
            <TextField
              label={t('deposits.form.note')}
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
