'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { nowLocalInput } from '@/lib/dateInput';
import { resolveErrorTarget } from '@/lib/formErrors';
import { formatApprox, formatMoney } from '@/lib/format';
import { formatCentsInput, parseMoneyToCents } from '@/lib/numberInput';
import {
  applySaleStore, buildSellBody, feesConfigured, initialSellState, needsFx, netTextFromQuote, priceLabelKey,
  recalculate, referenceFor, type SellContext, type SellFormState,
} from '@/lib/sellForm';
import { ApiRequestError, getSaleQuote, sellItem } from '@/services/api';
import type { ItemView, Store } from '@/types/api';
import { Badge } from './badges';
import FormField from './FormField';
import ItemHistoryBox from './ItemHistoryBox';
import styles from './forms.module.css';
import Modal from './Modal';
import { usePreferences } from './PreferencesProvider';

const SELL_FORM_FIELDS = ['saleStoreId', 'salePriceCents', 'soldAt', 'fxRateAtSale', 'netReceivedCents'] as const;
const QUOTE_DEBOUNCE_MS = 300;

interface Props {
  item: ItemView;
  stores: Store[];
  onClose: () => void;
  onSold: (message: string) => void;
  onGone: () => void;
}

export default function SellItemModal({ item, stores, onClose, onSold, onGone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const { usdBrlRate } = usePreferences();
  const ctx: SellContext = useMemo(() => ({ stores, usdBrlRate, language }), [stores, usdBrlRate, language]);

  const [state, setState] = useState<SellFormState>(() => initialSellState(ctx, nowLocalInput()));
  const [quoteNet, setQuoteNet] = useState<number | null>(null);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const store = stores.find((s) => s.id === state.storeId);
  const configured = feesConfigured(store);
  const patch = (partial: Partial<SellFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  // Prévia do líquido pelo backend (D122): debounce de 300 ms e cancelamento a cada digitação.
  const storeId = state.storeId;
  const priceText = state.priceText;
  useEffect(() => {
    const cents = priceText.trim() === '' ? null : parseMoneyToCents(priceText, language);
    if (storeId === null || !configured || cents === null || cents <= 0) {
      setQuoteNet(null);
      setState((s) => (s.netTouched || !configured ? s : { ...s, netText: '' }));
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getSaleQuote(storeId, cents, controller.signal)
        .then((quote) => {
          setQuoteNet(quote.netReceivedCents);
          setState((s) => (s.netTouched ? s : { ...s, netText: netTextFromQuote(quote.netReceivedCents, language) }));
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || (err instanceof ApiRequestError && err.code === 'ABORTED')) return;
          // Prévia com erro (ex.: NET_RECEIVED_NEGATIVE): campo vazio, sem bloquear a digitação manual.
          setQuoteNet(null);
          setState((s) => (s.netTouched ? s : { ...s, netText: '' }));
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [storeId, priceText, configured, language]);

  const reference = referenceFor(item, store);

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'ITEM_NOT_FOUND') {
      onGone();
      return;
    }
    const message = errorMessageFor(err, tLoose, language);
    const { target, topLabelField } = resolveErrorTarget(err, SELL_FORM_FIELDS);
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
    const built = buildSellBody(state, ctx, quoteNet);
    if (!built.ok) {
      const translated: Partial<Record<string, string>> = {};
      for (const [field, key] of Object.entries(built.errors)) translated[field] = key ? tLoose(key) : undefined;
      setErrors(translated);
      return;
    }
    setErrors({});
    setSaving(true);
    sellItem(item.id, built.body)
      .then((result) => {
        const currency = store?.currency ?? 'USD';
        const net = formatMoney(result.sale.netReceivedCents, currency, language);
        const profit = result.sale.saleProfitUsdCents === null
          ? t('common.none')
          : formatMoney(result.sale.saleProfitUsdCents, 'USD', language);
        const note = result.sale.netReceivedManual ? ` ${t('sellForm.manualNetNote')}` : '';
        onSold(`${t('sellForm.success', { net, profit })}${note}`);
      })
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  const currency = store?.currency ?? 'USD';
  const storeOptionLabel = (s: Store) => {
    const parts = [s.name];
    if (!s.isActive) parts.push(t('itemForm.storeInactive'));
    if (!s.saleFeesConfigured) parts.push(t('sellForm.feesNotConfiguredBadge'));
    return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(', ')})` : parts[0];
  };

  return (
    <Modal title={`${t('sellForm.title')}: ${item.name}`} onClose={onClose} busy={saving}>
      <form className={styles.form} onSubmit={submit} noValidate>
        {topError && <div className={styles.topError} role="alert">{topError}</div>}

        <FormField label={t('sellForm.store')} error={errors.saleStoreId}>
          {(c) => (
            <select
              {...c}
              className={styles.select}
              value={state.storeId ?? ''}
              onChange={(e) => {
                setState((s) => applySaleStore(s, e.target.value === '' ? null : Number(e.target.value), ctx));
                setQuoteNet(null);
                clearError('saleStoreId');
              }}
            >
              {state.storeId === null && <option value="">{t('common.select')}</option>}
              {stores.map((s) => <option key={s.id} value={s.id}>{storeOptionLabel(s)}</option>)}
            </select>
          )}
        </FormField>
        {store && !configured && <div><Badge tone="warning">{t('sellForm.feesNotConfiguredBadge')}</Badge></div>}

        <FormField label={t(priceLabelKey(store), { currency })} error={errors.salePriceCents}>
          {(c) => (
            <input
              {...c}
              className={styles.input}
              inputMode="decimal"
              autoFocus
              value={state.priceText}
              onChange={(e) => {
                patch({ priceText: e.target.value });
                clearError('salePriceCents');
              }}
            />
          )}
        </FormField>

        <div className={styles.ref}>
          {reference.kind === 'price' && (
            <>
              <span>
                {t('sellForm.minPriceRef', {
                  value: formatMoney(reference.entry.minPriceCents ?? 0, reference.entry.currency, language),
                })}
                {reference.entry.approx && (
                  <span className={styles.muted}> {t('common.approx', { value: formatApprox(reference.entry.approx, language) })}</span>
                )}
              </span>
              <button
                type="button"
                className={`${styles.button} ${styles.small}`}
                onClick={() => patch({
                  priceText: formatCentsInput(reference.entry.minPriceCents ?? 0, language),
                  netTouched: false,
                })}
              >
                {t('sellForm.useMinPrice')}
              </button>
            </>
          )}
          {reference.kind === 'warning' && (
            <span className={styles.warn}>
              {reference.warningCode ? tLoose(`warnings.${reference.warningCode}`) : reference.warning ?? t('common.none')}
            </span>
          )}
          {reference.kind === 'inactive' && <span className={styles.muted}>{t('sellForm.noRefInactive')}</span>}
          {reference.kind === 'price' && needsFx(store) && <span className={styles.muted}>{t('sellForm.refUsesSavedRate')}</span>}
        </div>

        <ItemHistoryBox stats={item.stats} compact />

        <FormField
          label={t('sellForm.netReceived', { currency })}
          error={errors.netReceivedCents}
          hint={configured ? (state.netTouched ? null : t('sellForm.netReceivedCalculated')) : t('sellForm.netReceivedHint')}
        >
          {(c) => (
            <div className={styles.row}>
              <input
                {...c}
                className={styles.input}
                inputMode="decimal"
                value={state.netText}
                onChange={(e) => {
                  patch({ netText: e.target.value, netTouched: true });
                  clearError('netReceivedCents');
                }}
              />
              {configured && state.netTouched && (
                <button
                  type="button"
                  className={`${styles.button} ${styles.small}`}
                  onClick={() => setState((s) => recalculate(s, quoteNet, language))}
                >
                  {t('sellForm.recalculate')}
                </button>
              )}
            </div>
          )}
        </FormField>

        <div className={styles.grid}>
          <FormField label={t('sellForm.soldAt')} error={errors.soldAt}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                type="datetime-local"
                value={state.soldAt}
                onChange={(e) => {
                  patch({ soldAt: e.target.value });
                  clearError('soldAt');
                }}
              />
            )}
          </FormField>
          {needsFx(store) && (
            <FormField label={t('sellForm.fxRateAtSale')} error={errors.fxRateAtSale}>
              {(c) => (
                <input
                  {...c}
                  className={styles.input}
                  inputMode="decimal"
                  value={state.fxText}
                  onChange={(e) => patch({ fxText: e.target.value })}
                />
              )}
            </FormField>
          )}
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={saving}>
            {saving ? t('common.saving') : t('sellForm.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
