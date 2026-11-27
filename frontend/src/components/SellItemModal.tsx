'use client';

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { nowLocalInput } from '@/lib/dateInput';
import { resolveErrorTarget, revealFor } from '@/lib/formErrors';
import { formatDate, formatMoney } from '@/lib/format';
import { moneyErrorParams } from '@/lib/currencies';
import { ratesRecord } from '@/lib/fxRates';
import { formatCentsInput, parseMoneyToCents } from '@/lib/numberInput';
import {
  applySaleStore, buildSellBody, detailsCollapsedByDefault, feesConfigured, fieldsInDetails, initialSellState, isUnitSellable, needsFx,
  netTextFromQuote, priceLabelKey, recalculate, referenceFor, sellableUnitsOf, type SellContext, type SellFormState,
} from '@/lib/sellForm';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, getSaleQuote, sellItem } from '@/services/api';
import { launchStoreOptions } from '@/lib/storeOptions';
import { itemDisplayName } from '@/lib/itemName';
import type { ItemView, Store } from '@/types/api';
import ItemHistoryBox from './ItemHistoryBox';
import itemStyles from './item/item.module.css';
import { usePreferences } from './PreferencesProvider';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import Disclosure from './ui/Disclosure';
import FormErrorSummary, { type FormErrorItem } from './ui/FormErrorSummary';
import HelpTip from './ui/HelpTip';
import Money from './ui/Money';
import NumberField from './ui/NumberField';
import Select from './ui/Select';
import TextField from './ui/TextField';

const SELL_FORM_FIELDS = ['saleStoreId', 'salePriceCents', 'soldAt', 'fxRateAtSale', 'netReceivedCents'] as const;
const QUOTE_DEBOUNCE_MS = 300;

interface Props {
  item: ItemView;
  // Venda pela linha do grupo (12.6b): as unidades do grupo, para escolher qual vender. Sem ele (ou com uma só em estoque) não há seletor.
  units?: ItemView[];
  stores: Store[];
  onClose: () => void;
  onSold: (message: string) => void;
  onGone: () => void;
}

// Venda no design system (12.6b): Dialog `md`, "Você recebe" calculado pelo backend (sale-quote) e o líquido editável com a cotação em
// "Mais detalhes" (recolhido quando a loja tem as taxas configuradas). Nenhuma regra nova: `lib/sellForm` monta o corpo.
export default function SellItemModal({ item: initialItem, units, stores, onClose, onSold, onGone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const formId = useId();
  const { usdBrlRate, fxRates } = usePreferences();
  const rates = useMemo(() => ratesRecord(fxRates), [fxRates]);
  const ctx: SellContext = useMemo(() => ({ stores, usdBrlRate, rates, language: locale }), [stores, usdBrlRate, rates, locale]);

  const choices = useMemo(() => sellableUnitsOf(units), [units]);
  const [unitId, setUnitId] = useState(initialItem.id);
  const item = choices.find((unit) => unit.id === unitId) ?? initialItem;

  const [state, setState] = useState<SellFormState>(() => initialSellState(ctx, nowLocalInput()));
  const [quoteNet, setQuoteNet] = useState<number | null>(null);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const store = stores.find((s) => s.id === state.storeId);
  const configured = feesConfigured(store);
  const inDetails = fieldsInDetails(store);
  const [detailsOpen, setDetailsOpen] = useState(() => !detailsCollapsedByDefault(stores.find((s) => s.isPrimary) ?? stores[0]));
  const patch = (partial: Partial<SellFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  // Prévia do líquido pelo backend (D122): debounce de 300 ms e cancelamento a cada digitação.
  const storeId = state.storeId;
  const storeCurrency = store?.currency;
  const priceText = state.priceText;
  useEffect(() => {
    const cents = priceText.trim() === '' ? null : parseMoneyToCents(priceText, locale, storeCurrency);
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
          setState((s) => (s.netTouched ? s : { ...s, netText: netTextFromQuote(quote.netReceivedCents, locale, storeCurrency) }));
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
  }, [storeId, priceText, configured, locale, storeCurrency]);

  const reference = referenceFor(item, store);
  const currency = store?.currency ?? 'USD';

  // Mostra os erros e abre o "Mais detalhes" se algum campo com erro estiver lá dentro (o resumo precisa focá-lo).
  const showErrors = (next: Partial<Record<string, string>>) => {
    setErrors(next);
    setAttempt((n) => n + 1);
    const hidden = Object.entries(next).some(([field, message]) => message && revealFor(field, { detailsFields: inDetails }) === 'details');
    if (hidden) setDetailsOpen(true);
  };

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'ITEM_NOT_FOUND') {
      onGone();
      return;
    }
    const message = errorMessageFor(err, tLoose, locale);
    const visible = SELL_FORM_FIELDS.filter((field) => field !== 'fxRateAtSale' || needsFx(store));
    const { target, topLabelField } = resolveErrorTarget(err, visible);
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
    const built = buildSellBody(state, ctx, quoteNet);
    if (!built.ok) {
      const translated: Partial<Record<string, string>> = {};
      for (const [field, key] of Object.entries(built.errors)) translated[field] = key ? tLoose(key, moneyErrorParams(locale, storeCurrency)) : undefined;
      showErrors(translated);
      return;
    }
    setErrors({});
    setSaving(true);
    sellItem(item.id, built.body)
      .then((result) => {
        const net = formatMoney(result.sale.netReceivedCents, currency, locale);
        const profit = result.sale.saleProfitUsdCents === null
          ? t('common.none')
          : formatMoney(result.sale.saleProfitUsdCents, 'USD', locale);
        const note = result.sale.netReceivedManual ? ` ${t('sellForm.manualNetNote')}` : '';
        invalidate('item.sell');
        onSold(`${t('sellForm.success', { net, profit })}${note}`);
      })
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  const storeOptionLabel = (s: Store) => {
    const parts: string[] = [];
    if (!s.isActive) parts.push(t('itemForm.storeInactive'));
    if (!s.saleFeesConfigured) parts.push(t('sellForm.feesNotConfiguredBadge'));
    return parts.length > 0 ? `${s.name} (${parts.join(', ')})` : s.name;
  };

  // Rótulo da unidade: float, pattern e data de aquisição (o que distingue as unidades de um grupo); trade lock desabilita a opção.
  const unitLabel = (unit: ItemView) => {
    const parts: string[] = [];
    if (unit.floatValue !== null) parts.push(`${t('itemForm.floatValue')} ${unit.floatValue}`);
    if (unit.paintSeed !== null) parts.push(`${t('itemForm.paintSeed')} ${unit.paintSeed}`);
    parts.push(formatDate(unit.acquiredAt, locale));
    if (unit.saleState === 'OFF_SALE') parts.push(t('applyForm.holding'));
    if (unit.tradeLock.isLocked && unit.tradeLock.tradeUnlockAt) parts.push(t('sellForm.lockedUntil', { date: formatDate(unit.tradeLock.tradeUnlockAt, locale) }));
    return parts.join(' · ');
  };

  const typedNet = state.netText.trim() === '' ? null : parseMoneyToCents(state.netText, locale, storeCurrency);
  const youReceive = state.netTouched ? typedNet : quoteNet;

  const summaryItems: FormErrorItem[] = SELL_FORM_FIELDS
    .filter((field) => errors[field])
    .map((field) => {
      const label = tLoose(`fields.${field}`);
      return { field, label: label === `fields.${field}` ? field : label, message: errors[field] as string };
    });

  const netField = (
    <NumberField
      kind="money"
      currency={currency}
      label={t('sellForm.netReceived', { currency })}
      name="netReceivedCents"
      value={state.netText}
      error={errors.netReceivedCents}
      required={!configured}
      disabled={saving}
      suggestAmbiguous={false}
      hint={configured ? (state.netTouched ? null : t('sellForm.netReceivedCalculated')) : t('sellForm.netReceivedHint')}
      trailing={configured && state.netTouched
        ? <Button size="sm" variant="ghost" disabled={saving} onClick={() => setState((s) => recalculate(s, quoteNet, locale, store?.currency))}>{t('sellForm.recalculate')}</Button>
        : undefined}
      onValueChange={(text) => {
        patch({ netText: text, netTouched: true });
        clearError('netReceivedCents');
      }}
    />
  );

  const fxField = needsFx(store) && (
    <NumberField
      kind="decimal"
      label={t('sellForm.fxRateAtSale', { currency })}
      name="fxRateAtSale"
      value={state.fxText}
      error={errors.fxRateAtSale}
      disabled={saving}
      onValueChange={(text) => {
        patch({ fxText: text });
        clearError('fxRateAtSale');
      }}
    />
  );

  return (
    <Dialog
      title={`${t('sellForm.title')}: ${itemDisplayName(item)}`}
      size="md"
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" loading={saving}>
            {saving ? t('common.saving') : t('sellForm.submit')}
          </Button>
        </>
      }
    >
      <form id={formId} className={itemStyles.form} onSubmit={submit} noValidate>
        <FormErrorSummary key={attempt} errors={summaryItems} />
        {topError && <Banner tone="danger">{topError}</Banner>}

        <div className={itemStyles.grid}>
          {choices.length > 1 && (
            <div className={itemStyles.full}>
              <Select
                label={t('sellForm.unit')}
                name="unit"
                value={String(item.id)}
                disabled={saving}
                onChange={(value) => setUnitId(Number(value))}
                options={choices.map((unit) => ({ value: String(unit.id), label: unitLabel(unit), disabled: !isUnitSellable(unit) && unit.id !== item.id }))}
              />
            </div>
          )}
          <Select
            label={t('sellForm.store')}
            name="saleStoreId"
            value={state.storeId === null ? '' : String(state.storeId)}
            error={errors.saleStoreId}
            required
            disabled={saving}
            onChange={(value) => {
              const id = value === '' ? null : Number(value);
              setState((s) => applySaleStore(s, id, ctx));
              setQuoteNet(null);
              setDetailsOpen(!detailsCollapsedByDefault(stores.find((s) => s.id === id)));
              clearError('saleStoreId');
            }}
            options={launchStoreOptions(stores, [item.saleStoreId, state.storeId]).map((s) => ({ value: String(s.id), label: storeOptionLabel(s) }))}
          />
          <NumberField
            kind="money"
            currency={currency}
            label={t(priceLabelKey(store), { currency })}
            name="salePriceCents"
            value={state.priceText}
            error={errors.salePriceCents}
            required
            autoFocus
            disabled={saving}
            onValueChange={(text) => {
              patch({ priceText: text });
              clearError('salePriceCents');
            }}
          />
        </div>

        <div className={itemStyles.reference}>
          {reference.kind === 'price' && (
            <>
              <span className={itemStyles.lockedLabel}>{t('sellForm.minPriceLabel')}</span>
              <HelpTip topic={t('sellForm.minPriceLabel')}>{t('inventory.help.minPrice')}</HelpTip>
              <Money
                size="sm"
                layout="inline"
                cents={reference.entry.minPriceCents}
                currency={reference.entry.currency}
                approxCents={reference.entry.approx?.cents ?? null}
                approxCurrency={reference.entry.approx?.currency ?? null}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => patch({
                  priceText: formatCentsInput(reference.entry.minPriceCents ?? 0, locale, reference.entry.currency),
                  netTouched: false,
                })}
              >
                {t('sellForm.useMinPrice')}
              </Button>
            </>
          )}
          {reference.kind === 'warning' && (
            <span className={itemStyles.muted}>
              {reference.warningCode ? tLoose(`warnings.${reference.warningCode}`) : reference.warning ?? t('common.none')}
            </span>
          )}
          {reference.kind === 'inactive' && <span className={itemStyles.muted}>{t('sellForm.noRefInactive')}</span>}
          {reference.kind === 'price' && needsFx(store) && <span className={itemStyles.muted}>{t('sellForm.refUsesSavedRate')}</span>}
        </div>

        {store && !configured && (
          <Banner tone="warning" announce={false} action={{ label: t('inventory.warnings.goToStores'), href: '/stores' }}>
            {t('sellForm.feesMissing')}
          </Banner>
        )}

        {configured ? (
          <div className={itemStyles.youReceive}>
            <span className={itemStyles.lockedLabel}>{t('sellForm.youReceive')}</span>
            {youReceive === null ? <span className={itemStyles.muted}>{t('common.none')}</span> : <Money size="md" layout="inline" cents={youReceive} currency={currency} />}
          </div>
        ) : (
          netField
        )}

        <TextField
          label={t('sellForm.soldAt')}
          name="soldAt"
          type="datetime-local"
          value={state.soldAt}
          error={errors.soldAt}
          required
          disabled={saving}
          onChange={(value) => {
            patch({ soldAt: value });
            clearError('soldAt');
          }}
        />

        {inDetails.length > 0 && (
          <Disclosure label={t('common.moreDetails')} open={detailsOpen} onOpenChange={setDetailsOpen}>
            <div className={itemStyles.grid}>
              {configured && netField}
              {fxField}
            </div>
          </Disclosure>
        )}

        <ItemHistoryBox stats={item.stats} compact />
      </form>
    </Dialog>
  );
}
