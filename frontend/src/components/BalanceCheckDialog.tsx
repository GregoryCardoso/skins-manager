'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { storeCounterpart } from '@/lib/baseMoney';
import { moneyErrorParams } from '@/lib/currencies';
import { resolveErrorTarget } from '@/lib/formErrors';
import { formatMoney } from '@/lib/format';
import { MAX_NOTE_LENGTH } from '@/lib/limits';
import { formatCentsInput } from '@/lib/numberInput';
import {
  buildCheckPreviewQuery, buildStoreBalanceBody, initialStoreBalanceState, validateStoreBalanceForm, type StoreBalanceFormState,
} from '@/lib/storeBalanceForm';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, createStoreBalanceCheck, getStoreBalanceCheckPreview } from '@/services/api';
import type { StoreBalanceCheckPreview, StoreBalanceSummary } from '@/types/api';
import CsfloatBalanceCheck from './CsfloatBalanceCheck';
import styles from './moneyForms.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import FormErrorSummary, { type FormErrorItem } from './ui/FormErrorSummary';
import Money from './ui/Money';
import NumberField from './ui/NumberField';
import TextField from './ui/TextField';

const FORM_FIELDS = ['balanceCents', 'recordedAt', 'note'] as const;
const PREVIEW_DEBOUNCE_MS = 300;
const TOTAL_STEPS = 2;

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: StoreBalanceCheckPreview }
  | { status: 'error'; message: string };

type Choice = 'adjust' | 'only';

interface Props {
  store: StoreBalanceSummary;
  // Saldo real já preenchido (9.7: "Usar este saldo", com o saldo do CSFloat).
  initialAmountCents?: number | null;
  // A loja da integração CSFloat com chave salva: o passo 1 ganha o bloco "Conferir com o CSFloat" (só leitura).
  csfloat?: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

// Conferência do saldo em dois passos (D242, D247; 12.7b, 2.8 sem mudança). Passo 1: o saldo que o usuário vê no site (e, na loja do
// CSFloat, o bloco que busca esse saldo). Passo 2: o app mostra calculado, real e diferença; com diferença, uma escolha única (ajustar
// ou só registrar) e um botão principal cujo rótulo segue a escolha. A prévia vem do backend (com debounce); nada é calculado aqui.
export default function BalanceCheckDialog({ store, onClose, onSaved, initialAmountCents = null, csfloat = false }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const formId = useId();

  const [state, setState] = useState<StoreBalanceFormState>(() => {
    const initial = initialStoreBalanceState();
    return initialAmountCents === null ? initial : { ...initial, amountText: formatCentsInput(initialAmountCents, locale, store.currency) };
  });
  const [step, setStep] = useState<1 | 2>(1);
  const [choice, setChoice] = useState<Choice>('adjust');
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const titleRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const patch = (partial: Partial<StoreBalanceFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  // Ao trocar de passo, o foco vai para o título do passo (o leitor de tela anuncia onde o usuário está).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    titleRef.current?.focus();
  }, [step]);

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
  }, [state.amountText, state.recordedAt, store.storeId, store.currency, locale, tLoose]);

  const showErrors = (next: Partial<Record<string, string>>) => {
    setErrors(next);
    setAttempt((n) => n + 1);
  };

  // Erros da API: a data (conferência antes da última, data no futuro) volta ao passo 1; a observação fica no passo 2.
  const showApiError = (err: unknown) => {
    const message = errorMessageFor(err, tLoose, locale);
    const code = err instanceof ApiRequestError ? err.code : null;
    if (code === 'BALANCE_CHECK_BEFORE_LAST' || code === 'RECORDED_AT_IN_FUTURE') {
      setStep(1);
      setTopError(null);
      showErrors({ recordedAt: message });
      return;
    }
    if (code === 'ADJUSTMENT_NOTE_REQUIRED') {
      setTopError(null);
      showErrors({ note: message });
      return;
    }
    const { target, topLabelField } = resolveErrorTarget(err, FORM_FIELDS);
    if (target) {
      setStep(target === 'note' ? 2 : 1);
      setTopError(null);
      showErrors({ [target]: message });
    } else {
      const label = topLabelField ? tLoose(`fields.${topLabelField}`) : null;
      setErrors({});
      setTopError(label && label !== `fields.${topLabelField}` ? `${label}: ${message}` : message);
    }
  };

  const translateLocal = (local: Record<string, string | undefined>) => {
    const translated: Partial<Record<string, string>> = {};
    for (const [field, key] of Object.entries(local)) translated[field] = key ? tLoose(key, moneyErrorParams(locale, store.currency)) : undefined;
    return translated;
  };

  const goToCompare = () => {
    setTopError(null);
    const local = validateStoreBalanceForm(state, locale, { adjust: false, currency: store.currency });
    if (Object.keys(local).length > 0) {
      showErrors(translateLocal(local));
      return;
    }
    setErrors({});
    setStep(2);
  };

  const difference = preview.status === 'ok' ? preview.data.differenceCents : null;
  const hasDifference = difference !== null && difference !== 0;
  const adjust = hasDifference && choice === 'adjust';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (step === 1) {
      goToCompare();
      return;
    }
    if (preview.status !== 'ok') return;
    setTopError(null);
    const local = validateStoreBalanceForm(state, locale, { adjust, currency: store.currency });
    if (Object.keys(local).length > 0) {
      const onlyDate = local.recordedAt !== undefined || local.balanceCents !== undefined;
      if (onlyDate) setStep(1);
      showErrors(translateLocal(local));
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
            : t('storeBalances.checkSaved', { store: store.storeName }),
        );
      })
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  const summaryFields = step === 1 ? (['balanceCents', 'recordedAt'] as const) : (['note'] as const);
  const summaryItems: FormErrorItem[] = summaryFields
    .filter((field) => errors[field])
    .map((field) => {
      const label = tLoose(`fields.${field}`);
      return { field, label: label === `fields.${field}` ? field : label, message: errors[field] as string };
    });

  const primaryLabel = saving
    ? t('common.saving')
    : adjust ? t('storeBalances.adjustAndSave') : t('storeBalances.saveCheck');

  const counterpart = preview.status === 'ok'
    ? storeCounterpart({
      currency: store.currency,
      usdCents: preview.data.differenceUsdCents,
      approxCents: preview.data.differenceApproxCents,
      approxCurrency: preview.data.approxCurrency,
    })
    : null;

  return (
    <Dialog
      title={t('storeBalances.form.title', { store: store.storeName })}
      size="md"
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          {step === 2 && <Button onClick={() => setStep(1)} disabled={saving}>{t('storeBalances.checkDialog.back')}</Button>}
          {step === 1 ? (
            <Button type="submit" form={formId} variant="primary">{t('storeBalances.checkDialog.continue')}</Button>
          ) : (
            <Button type="submit" form={formId} variant="primary" loading={saving} disabled={preview.status !== 'ok'}>{primaryLabel}</Button>
          )}
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.small}>{t('storeBalances.checkDialog.explain')}</p>
        <div>
          <p className={styles.stepCount}>{t('storeBalances.checkDialog.stepCount', { current: step, total: TOTAL_STEPS })}</p>
          <h3 ref={titleRef} tabIndex={-1} className={styles.stepTitle}>
            {t(step === 1 ? 'storeBalances.checkDialog.step1Title' : 'storeBalances.checkDialog.step2Title')}
          </h3>
        </div>

        <FormErrorSummary key={attempt} errors={summaryItems} />
        {topError && <Banner tone="danger">{topError}</Banner>}

        {step === 1 && (
          <div className={styles.stack}>
            <div className={styles.grid}>
              <NumberField
                kind="money"
                currency={store.currency}
                label={t('storeBalances.form.amount', { currency: store.currency })}
                name="balanceCents"
                value={state.amountText}
                error={errors.balanceCents}
                required
                autoFocus
                disabled={saving}
                onValueChange={(text) => {
                  patch({ amountText: text });
                  clearError('balanceCents');
                }}
              />
              <TextField
                label={t('storeBalances.form.date')}
                name="recordedAt"
                type="datetime-local"
                value={state.recordedAt}
                error={errors.recordedAt}
                required
                disabled={saving}
                onChange={(value) => {
                  patch({ recordedAt: value });
                  clearError('recordedAt');
                }}
              />
            </div>
            {csfloat && (
              <CsfloatBalanceCheck
                onUseBalance={(cents) => {
                  patch({ amountText: formatCentsInput(cents, locale, store.currency) });
                  clearError('balanceCents');
                }}
              />
            )}
          </div>
        )}

        {step === 2 && (
          <div className={styles.stack} aria-live="polite">
            {preview.status === 'loading' && <p className={styles.muted}>{t('storeBalances.checkPreviewLoading')}</p>}
            {preview.status === 'error' && <Banner tone="danger">{preview.message}</Banner>}
            {preview.status === 'idle' && <p className={styles.muted}>{t('storeBalances.checkPreviewLoading')}</p>}
            {preview.status === 'ok' && (
              <>
                <dl className={styles.compare}>
                  <div>
                    <dt>{t('storeBalances.checkDialog.computed')}</dt>
                    <dd><Money size="md" cents={preview.data.computedCents} currency={store.currency} /></dd>
                  </div>
                  <div>
                    <dt>{t('storeBalances.checkDialog.real')}</dt>
                    <dd><Money size="md" cents={preview.data.balanceCents} currency={store.currency} /></dd>
                  </div>
                  <div>
                    <dt>{t('storeBalances.difference')}</dt>
                    <dd>
                      <Money
                        size="md"
                        signed
                        cents={preview.data.differenceCents}
                        currency={store.currency}
                        approxCents={counterpart?.cents ?? null}
                        approxCurrency={counterpart?.currency ?? null}
                        estimated={preview.data.estimated}
                        estimatedBadge={false}
                      />
                    </dd>
                  </div>
                </dl>

                {!hasDifference && <p className={styles.muted}>{t('storeBalances.checkPreviewMatch')}</p>}

                {hasDifference && (
                  <>
                    <fieldset className={styles.options}>
                      <legend className={styles.optionsTitle}>{t('storeBalances.checkDialog.optionsTitle')}</legend>
                      <label className={styles.option}>
                        <input type="radio" name="choice" value="adjust" checked={choice === 'adjust'} disabled={saving} onChange={() => setChoice('adjust')} />
                        <span className={styles.optionText}>
                          <strong>{t('storeBalances.checkDialog.optionAdjust')}</strong>
                          <span className={styles.optionHint}>{t('storeBalances.checkDialog.optionAdjustHint')}</span>
                        </span>
                      </label>
                      <label className={styles.option}>
                        <input type="radio" name="choice" value="only" checked={choice === 'only'} disabled={saving} onChange={() => setChoice('only')} />
                        <span className={styles.optionText}>
                          <strong>{t('storeBalances.checkDialog.optionOnly')}</strong>
                          <span className={styles.optionHint}>{t('storeBalances.checkDialog.optionOnlyHint')}</span>
                        </span>
                      </label>
                    </fieldset>
                    {adjust && (
                      <TextField
                        label={t('storeBalances.adjustmentNote')}
                        name="note"
                        value={state.noteText}
                        error={errors.note}
                        hint={t('storeBalances.adjustmentNoteHint')}
                        maxLength={MAX_NOTE_LENGTH}
                        required
                        disabled={saving}
                        onChange={(value) => {
                          patch({ noteText: value });
                          clearError('note');
                        }}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}
