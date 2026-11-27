'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { dateToLocalInput, localInputToIso, nowLocalInput } from '@/lib/dateInput';
import { formatDate, formatMoney } from '@/lib/format';
import { buildComponentsBody, componentsAllowedFor, emptyComponentsState, type ComponentsState } from '@/lib/itemComponents';
import {
  applyCatalogChoice, buildCreateBody, effectiveCategory, fieldVisibility, initialCreateState, setTradeUnlockAt, visibleItemFields,
  type CatalogChoice, type FormErrors, type ItemFormState,
} from '@/lib/itemForm';
import { invalidMoneyKey, moneyErrorParams } from '@/lib/currencies';
import { formatDecimalInput, isAmbiguousDecimal, parseDecimalInput, parseMoneyToCents } from '@/lib/numberInput';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, getCatalogStatus, getOpenOptions, openContainer } from '@/services/api';
import { itemDisplayName, localizedOrName } from '@/lib/itemName';
import type { CatalogItem, ItemView, OpenContainerBody, OpenDecision, OpenGeneratedBody, Store } from '@/types/api';
import ComponentsPanel from './item/ComponentsPanel';
import itemStyles from './item/item.module.css';
import ItemIdentityFields from './ItemIdentityFields';
import ItemImage from './ItemImage';
import { usePreferences } from './PreferencesProvider';
import Banner from './ui/Banner';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';
import Dialog from './ui/Dialog';
import FormErrorSummary, { type FormErrorItem } from './ui/FormErrorSummary';
import NumberField from './ui/NumberField';
import SegmentedControl from './ui/SegmentedControl';
import Select from './ui/Select';
import Spinner from './ui/Spinner';
import TextField from './ui/TextField';

interface Props {
  // O recipiente em estoque (caixa, cápsula, pacote ou terminal) que será aberto.
  item: ItemView;
  stores: Store[];
  onClose: () => void;
  onDone: (message: string) => void;
  onGone: () => void;
  // Atalho "Cadastrar chave": fecha este modal e abre o cadastro em OUTRO com o nome sugerido.
  onRegisterKey: (keyName: string) => void;
}

// Campos da API que o modal sabe mostrar (o erro de outro campo vai para o topo).
const OWN_FIELDS = ['keyItemId', 'decision', 'paidPriceCents', 'fxRateAtPurchase', 'openedAt'];
const ITEM_FIELDS = ['catalogId', 'name', 'category', 'variant', 'floatValue', 'exterior', 'paintSeed', 'phase', 'tradeUnlockAt', 'components'];

// Estado inicial do item obtido: sem aquisição própria (a abertura define loja, preço, cotação e data) e sem trade lock sugerido.
function initialGeneratedState(stores: Store[], usdBrlRate: number | null, locale: string): ItemFormState {
  return {
    ...initialCreateState({ stores, usdBrlRate, language: locale }),
    acquisitionType: 'GANHEI',
    purchaseStoreId: null,
    fxText: '',
    acquiredAt: '',
    tradeUnlockAt: '',
    tradeUnlockAuto: false,
  };
}

// Abrir caixa, cápsula, pacote ou terminal (10.4, D363) no design system (12.6b): mesmo fluxo e mesmo contrato da API. A chave é um Select,
// a decisão do terminal um SegmentedControl e a falta de chave ou de loja Steam um Banner com a ação.
export default function OpenContainerModal({ item, stores, onClose, onDone, onGone, onRegisterKey }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const formId = useId();
  const { usdBrlRate } = usePreferences();

  const optionsQuery = useQuery({
    queryKey: queryKeys.items.openOptions(item.id),
    queryFn: ({ signal }) => getOpenOptions(item.id, signal),
  });
  const options = optionsQuery.data ?? null;
  const kind = options?.kind ?? item.openable?.kind ?? null;
  const isCase = kind === 'CASE';
  const isTerminal = kind === 'TERMINAL';

  const [chosenKey, setChosenKey] = useState<number | null>(null);
  const keyId = options && chosenKey !== null && options.keys.some((k) => k.itemId === chosenKey) ? chosenKey : options?.keys[0]?.itemId ?? null;
  const [decision, setDecision] = useState<OpenDecision | null>(null);
  const [priceText, setPriceText] = useState('');
  const [fxTyped, setFxTyped] = useState<string | null>(null);
  const [typedAt, setTypedAt] = useState<string | null>(null);
  const openedAtText = typedAt ?? nowLocalInput();
  const [state, setState] = useState<ItemFormState>(() => initialGeneratedState(stores, usdBrlRate, locale));
  const [components, setComponents] = useState<ComponentsState>(() => emptyComponentsState());
  const [changingItem, setChangingItem] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [attempt, setAttempt] = useState(0);
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);

  const patch = (partial: Partial<ItemFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  const buying = isTerminal && decision === 'BUY';
  const generates = !isTerminal || buying;
  const steamStore = options?.steamStore ?? null;
  const category = effectiveCategory(state);
  const vis = fieldVisibility(state, stores);
  const showSearch = !state.catalog && !state.freeMode ? true : changingItem;
  const catalogStatus = useQuery({ queryKey: queryKeys.catalog.status, queryFn: ({ signal }) => getCatalogStatus(signal) });
  const allowComponents = componentsAllowedFor(category, (catalogStatus.data?.countsBySource.PATCHES ?? 0) > 0);

  // Cotação padrão: a da moeda da loja Steam (calculada pelo backend, 11.4); nula se a Steam é em USD ou falta a cotação.
  const fxDefault = options?.defaultFxRate ?? null;
  const fxText = fxTyped ?? (fxDefault !== null ? formatDecimalInput(fxDefault, locale) : '');
  const fxVisible = buying && steamStore !== null && steamStore.currency !== 'USD';

  const containerCost = item.cost.effectiveUsdCents;
  const keyCost = isCase && options ? options.keys.find((k) => k.itemId === keyId)?.effectiveCostUsdCents ?? 0 : 0;
  const usd = (cents: number) => formatMoney(cents, 'USD', locale);

  const summary = useMemo(() => {
    if (isTerminal) {
      if (decision === 'BUY') return t('openForm.summaryBuy', { value: usd(containerCost) });
      if (decision === 'DECLINE') return t('openForm.summaryDecline', { value: usd(containerCost) });
      return null;
    }
    return isCase ? t('openForm.summaryCase', { value: usd(containerCost + keyCost) }) : t('openForm.summaryNoKey', { value: usd(containerCost) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTerminal, isCase, decision, containerCost, keyCost, locale]);

  const onPickCatalog = (picked: CatalogItem) => {
    setState((s) => applyCatalogChoice(s, picked as CatalogChoice));
    setChangingItem(false);
    clearError('catalogId');
  };

  const showErrors = (next: FormErrors) => {
    setErrors(next);
    setAttempt((n) => n + 1);
  };

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'ITEM_NOT_FOUND') {
      onGone();
      return;
    }
    const message = errorMessageFor(err, tLoose, locale);
    const raw = err instanceof ApiRequestError && err.field ? err.field : null;
    const field = raw && raw.startsWith('generated.') ? raw.slice('generated.'.length) : raw;
    const itemVisible = visibleItemFields(ITEM_FIELDS, vis, { showSearch, freeMode: state.freeMode, hasCatalog: !!state.catalog });
    const visible = [...OWN_FIELDS, ...(generates ? itemVisible : [])];
    if (err instanceof ApiRequestError && (err.code === 'CATALOG_ITEM_REQUIRED' || err.code === 'GENERATED_ITEM_REQUIRED')) {
      showErrors({ catalogId: message });
      setTopError(null);
    } else if (field && visible.includes(field)) {
      showErrors({ [field]: message });
      setTopError(null);
    } else {
      setErrors({});
      setTopError(message);
    }
    // O recipiente ou a chave podem ter saído do estoque em outra aba: recarrega a prévia e as listas.
    if (err instanceof ApiRequestError && ['ITEM_NOT_IN_STOCK', 'ITEM_CONSUMED', 'ITEM_NOT_OPENABLE'].includes(err.code)) invalidate('item.open');
  };

  const perform = () => {
    if (!options || kind === null) return;
    const next: FormErrors = {};
    const openedAt = localInputToIso(openedAtText);
    if (openedAt === null) next.openedAt = t('errors.INVALID_DATE');
    const body: OpenContainerBody = { openedAt: openedAt ?? undefined };

    if (isCase) {
      if (keyId === null) {
        setTopError(t('openForm.noKey', { keyName: options.requiredKeyName ?? '' }));
        return;
      }
      body.keyItemId = keyId;
    }
    if (isTerminal) body.decision = decision;
    if (buying) {
      const cents = parseMoneyToCents(priceText, locale, steamStore?.currency);
      if (cents === null) next.paidPriceCents = tLoose(invalidMoneyKey(steamStore?.currency), moneyErrorParams(locale, steamStore?.currency));
      else body.paidPriceCents = cents;
      if (fxVisible) {
        const rate = parseDecimalInput(fxText, locale);
        if (fxText.trim() !== '' && rate === null) next.fxRateAtPurchase = isAmbiguousDecimal(fxText, locale) ? tLoose('fx.ambiguousInput', moneyErrorParams(locale, undefined)) : t('itemForm.invalidNumber');
        else if (rate !== null) body.fxRateAtPurchase = rate;
      }
    }
    if (generates) {
      if (!state.catalog && !state.freeMode) next.catalogId = t('openForm.chooseItem');
      const built = buildCreateBody(state, { stores, usdBrlRate, language: locale });
      if (!built.ok) {
        for (const [field, key] of Object.entries(built.errors)) next[field] = key ? tLoose(key) : undefined;
      } else {
        // A abertura define a aquisição do item obtido: loja, preço, cotação e data de compra não vão no corpo.
        const { acquisitionType: _a, purchaseStoreId: _s, purchasePriceCents: _p, fxRateAtPurchase: _f, acquiredAt: _d, ...generated } = built.body;
        const payload: OpenGeneratedBody = { ...generated };
        if (allowComponents) {
          const comp = buildComponentsBody(components, locale);
          if (!comp.ok) next.components = tLoose(comp.errorKey, comp.params);
          else if (comp.body.length > 0) payload.components = comp.body;
        }
        body.generated = payload;
      }
    }
    if (Object.values(next).some(Boolean)) {
      showErrors(next);
      setConfirmDecline(false);
      return;
    }
    setErrors({});
    setTopError(null);
    setSaving(true);
    openContainer(item.id, body)
      .then((result) => {
        invalidate('item.open');
        onDone(
          result.generatedItem
            ? t('openForm.success', { name: itemDisplayName(item), generated: itemDisplayName(result.generatedItem) })
            : t('openForm.successLost', { name: itemDisplayName(item) }),
        );
      })
      .catch((err: unknown) => {
        setSaving(false);
        setConfirmDecline(false);
        showApiError(err);
      });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (isTerminal && decision === 'DECLINE') {
      setConfirmDecline(true);
      return;
    }
    perform();
  };

  const introKey = isCase ? 'openForm.introCase' : isTerminal ? 'openForm.introTerminal' : 'openForm.introNoKey';
  const canSubmit = !saving && options !== null && (!isCase || keyId !== null) && (!isTerminal || (decision !== null && (decision === 'DECLINE' || steamStore !== null)));

  const fieldLabel = (field: string): string => {
    switch (field) {
      case 'keyItemId': return t('openForm.key');
      case 'decision': return t('openForm.decision');
      case 'paidPriceCents': return t('openForm.price', { currency: steamStore?.currency ?? 'USD' });
      case 'fxRateAtPurchase': return t('openForm.fx', { currency: steamStore?.currency ?? '' });
      case 'openedAt': return t('openForm.openedAt');
      case 'tradeUnlockAt': return t('openForm.generatedTradeLock');
      default: {
        const label = tLoose(`fields.${field}`);
        return label === `fields.${field}` ? field : label;
      }
    }
  };
  const summaryItems: FormErrorItem[] = Object.entries(errors)
    .filter(([, message]) => Boolean(message))
    .map(([field, message]) => ({ field, label: fieldLabel(field), message: message as string }));

  const keyLabel = (key: NonNullable<typeof options>['keys'][number], index: number) => {
    const parts = [
      localizedOrName(key.name, key.localizedName),
      t('openForm.keyCost', { value: `${key.costEstimated ? '≈ ' : ''}${usd(key.effectiveCostUsdCents)}` }),
      formatDate(key.acquiredAt, locale),
    ];
    if (index === 0 && (options?.keys.length ?? 0) > 1) parts.push(t('openForm.keyOldest'));
    if (key.tradeLocked) parts.push(t('applyForm.tradeLock'));
    if (key.offSale) parts.push(t('applyForm.holding'));
    return parts.join(' · ');
  };

  return (
    <Dialog
      title={t('openForm.title', { name: itemDisplayName(item) })}
      size={options && generates ? 'lg' : 'md'}
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" loading={saving} disabled={!canSubmit}>
            {saving ? t('common.saving') : decision === 'DECLINE' ? t('openForm.submitDecline') : t('openForm.submit')}
          </Button>
        </>
      }
    >
      <form id={formId} className={itemStyles.form} onSubmit={submit} noValidate>
        <FormErrorSummary key={attempt} errors={summaryItems} />
        {topError && <Banner tone="danger">{topError}</Banner>}
        <div className={itemStyles.chosen}>
          <ItemImage category={item.category} url={item.catalog?.imageUrl} size={48} />
          <div className={itemStyles.chosenText}>
            <strong className={itemStyles.chosenName}>{itemDisplayName(item)}</strong>
            <span className={itemStyles.muted}>{t('openForm.keyCost', { value: usd(containerCost) })}</span>
          </div>
        </div>
        <p className={itemStyles.muted}>{t(introKey)}</p>

        {optionsQuery.isPending && <Spinner size="sm" />}
        {optionsQuery.error && (
          <Banner tone="danger" onRetry={() => { void optionsQuery.refetch(); }}>{errorMessageFor(optionsQuery.error, tLoose, locale)}</Banner>
        )}

        {options && isCase && (
          options.keys.length === 0 ? (
            <Banner
              tone="warning"
              announce={false}
              action={options.requiredKeyName ? { label: t('inventory.actions.registerKey'), onClick: () => onRegisterKey(options.requiredKeyName ?? '') } : undefined}
            >
              <p>{t('openForm.noKey', { keyName: options.requiredKeyName ?? '' })}</p>
              {options.otherKeysInStock > 0 && <p>{t('inventory.actions.openNeedsKeyOther', { keyName: options.requiredKeyName ?? '' })}</p>}
            </Banner>
          ) : options.keys.length === 1 ? (
            <div className={itemStyles.lockedValue}>
              <span className={itemStyles.lockedLabel}>{t('openForm.key')}</span>
              <span>{keyLabel(options.keys[0], 0)}</span>
            </div>
          ) : (
            <Select
              label={t('openForm.key')}
              name="keyItemId"
              value={String(keyId ?? '')}
              error={errors.keyItemId}
              disabled={saving}
              onChange={(value) => setChosenKey(Number(value))}
              options={options.keys.map((key, index) => ({ value: String(key.itemId), label: keyLabel(key, index) }))}
            />
          )
        )}

        {options && isTerminal && (
          <div className={itemStyles.section}>
            <span className={itemStyles.lockedLabel} id={`${formId}-decision`}>{t('openForm.decision')}</span>
            <SegmentedControl<OpenDecision>
              label={t('openForm.decision')}
              value={(decision ?? '') as OpenDecision}
              disabled={saving}
              onChange={(next) => {
                setDecision(next);
                clearError('decision');
              }}
              options={[
                { value: 'BUY', label: t('openForm.buy') },
                { value: 'DECLINE', label: t('openForm.decline', { value: usd(containerCost) }) },
              ]}
            />
            {errors.decision && <span className={itemStyles.fieldError} role="alert" data-field="decision" tabIndex={-1}>{errors.decision}</span>}
            {decision === 'BUY' && !steamStore && (
              <Banner tone="warning" announce={false} action={{ label: t('openForm.goToStores'), href: '/stores' }}>
                {t('openForm.noSteamStore')}
              </Banner>
            )}
            {buying && steamStore && (
              <>
                <p className={itemStyles.muted}>{t('openForm.steamStore', { store: steamStore.name, currency: steamStore.currency })}</p>
                <div className={itemStyles.grid}>
                  <NumberField
                    kind="money"
                    currency={steamStore.currency}
                    label={t('openForm.price', { currency: steamStore.currency })}
                    name="paidPriceCents"
                    value={priceText}
                    error={errors.paidPriceCents}
                    required
                    disabled={saving}
                    onValueChange={(text) => {
                      setPriceText(text);
                      clearError('paidPriceCents');
                    }}
                  />
                  {fxVisible && (
                    <NumberField
                      kind="decimal"
                      label={t('openForm.fx', { currency: steamStore.currency })}
                      name="fxRateAtPurchase"
                      value={fxText}
                      error={errors.fxRateAtPurchase}
                      disabled={saving}
                      hint={fxDefault !== null ? t('openForm.fxDefault', { rate: formatDecimalInput(fxDefault, locale) }) : null}
                      onValueChange={(text) => {
                        setFxTyped(text);
                        clearError('fxRateAtPurchase');
                      }}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {options && generates && (
          <section className={itemStyles.section} aria-labelledby={`${formId}-generated`}>
            <h3 id={`${formId}-generated`} className={itemStyles.sectionTitle}>{t('openForm.generatedTitle')}</h3>
            <p className={itemStyles.muted}>{t('openForm.generatedHint')}</p>
            <ItemIdentityFields
              state={state}
              patch={patch}
              errors={errors}
              clearError={clearError}
              vis={vis}
              showSearch={showSearch}
              changingItem={changingItem}
              setChangingItem={setChangingItem}
              isLegacy={false}
              onPickCatalog={onPickCatalog}
            />
            {allowComponents && (
              <ComponentsPanel
                category={category}
                state={components}
                onChange={(next) => {
                  setComponents(next);
                  clearError('components');
                }}
                error={errors.components}
                disabled={saving}
              />
            )}
            <TextField
              label={t('openForm.generatedTradeLock')}
              name="tradeUnlockAt"
              type="datetime-local"
              value={state.tradeUnlockAt}
              error={errors.tradeUnlockAt}
              disabled={saving}
              onChange={(value) => setState((s) => setTradeUnlockAt(s, value))}
            />
          </section>
        )}

        {options && (
          <TextField
            label={t('openForm.openedAt')}
            name="openedAt"
            type="datetime-local"
            max={dateToLocalInput(new Date())}
            value={openedAtText}
            error={errors.openedAt}
            disabled={saving}
            onChange={(value) => {
              setTypedAt(value);
              clearError('openedAt');
            }}
          />
        )}

        {summary && <Banner tone="info" announce={false}>{summary}</Banner>}
      </form>
      {confirmDecline && (
        <ConfirmDialog
          title={t('openForm.confirmDeclineTitle')}
          message={t('openForm.confirmDeclineMessage', { value: usd(containerCost) })}
          confirmLabel={t('openForm.confirmDeclineConfirm')}
          tone="danger"
          busy={saving}
          onCancel={() => setConfirmDecline(false)}
          onConfirm={perform}
        />
      )}
    </Dialog>
  );
}
