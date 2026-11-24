'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { dateToLocalInput, localInputToIso, nowLocalInput } from '@/lib/dateInput';
import { formatDate, formatMoney } from '@/lib/format';
import { buildComponentsBody, componentsAllowedFor, emptyComponentsState, type ComponentsState } from '@/lib/itemComponents';
import {
  applyCatalogChoice, buildCreateBody, effectiveCategory, fieldVisibility, initialCreateState, setTradeUnlockAt, visibleItemFields,
  type CatalogChoice, type FormErrors, type ItemFormState,
} from '@/lib/itemForm';
import { formatDecimalInput, parseDecimalInput, parseMoneyToCents } from '@/lib/numberInput';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, getCatalogStatus, getOpenOptions, openContainer } from '@/services/api';
import type { CatalogItem, ItemView, OpenContainerBody, OpenDecision, OpenGeneratedBody, Store } from '@/types/api';
import { Badge } from './badges';
import ConfirmDialog from './ConfirmDialog';
import FormField from './FormField';
import styles from './forms.module.css';
import ItemComponentsSection from './ItemComponentsSection';
import ItemIdentityFields from './ItemIdentityFields';
import ItemImage from './ItemImage';
import Modal from './Modal';
import modalStyles from './ApplyComponentModal.module.css';
import { usePreferences } from './PreferencesProvider';

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
function initialGeneratedState(stores: Store[], usdBrlRate: number | null, language: string): ItemFormState {
  return {
    ...initialCreateState({ stores, usdBrlRate, language }),
    acquisitionType: 'GANHEI',
    purchaseStoreId: null,
    fxText: '',
    acquiredAt: '',
    tradeUnlockAt: '',
    tradeUnlockAuto: false,
  };
}

export default function OpenContainerModal({ item, stores, onClose, onDone, onGone, onRegisterKey }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const invalidate = useInvalidate();
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
  const [state, setState] = useState<ItemFormState>(() => initialGeneratedState(stores, usdBrlRate, language));
  const [components, setComponents] = useState<ComponentsState>(() => emptyComponentsState());
  const [changingItem, setChangingItem] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
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

  const fxDefault = options?.defaultFxRate ?? usdBrlRate;
  const fxText = fxTyped ?? (fxDefault !== null ? formatDecimalInput(fxDefault, language) : '');
  const fxVisible = buying && steamStore?.currency === 'BRL';

  const containerCost = item.cost.effectiveUsdCents;
  const keyCost = isCase && options ? options.keys.find((k) => k.itemId === keyId)?.effectiveCostUsdCents ?? 0 : 0;
  const usd = (cents: number) => formatMoney(cents, 'USD', language);

  const summary = useMemo(() => {
    if (isTerminal) {
      if (decision === 'BUY') return t('openForm.summaryBuy', { value: usd(containerCost) });
      if (decision === 'DECLINE') return t('openForm.summaryDecline', { value: usd(containerCost) });
      return null;
    }
    return isCase ? t('openForm.summaryCase', { value: usd(containerCost + keyCost) }) : t('openForm.summaryNoKey', { value: usd(containerCost) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTerminal, isCase, decision, containerCost, keyCost, language]);

  const onPickCatalog = (picked: CatalogItem) => {
    setState((s) => applyCatalogChoice(s, picked as CatalogChoice));
    setChangingItem(false);
    clearError('catalogId');
  };

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'ITEM_NOT_FOUND') {
      onGone();
      return;
    }
    const message = errorMessageFor(err, tLoose, language);
    const raw = err instanceof ApiRequestError && err.field ? err.field : null;
    const field = raw && raw.startsWith('generated.') ? raw.slice('generated.'.length) : raw;
    const itemVisible = visibleItemFields(ITEM_FIELDS, vis, { showSearch, freeMode: state.freeMode, hasCatalog: !!state.catalog });
    const visible = [...OWN_FIELDS, ...(generates ? itemVisible : [])];
    if (err instanceof ApiRequestError && (err.code === 'CATALOG_ITEM_REQUIRED' || err.code === 'GENERATED_ITEM_REQUIRED')) {
      setErrors({ catalogId: message });
      setTopError(null);
    } else if (field && visible.includes(field)) {
      setErrors({ [field]: message });
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
      const cents = parseMoneyToCents(priceText, language);
      if (cents === null) next.paidPriceCents = t('itemForm.invalidMoney');
      else body.paidPriceCents = cents;
      if (fxVisible) {
        const rate = parseDecimalInput(fxText, language);
        if (fxText.trim() !== '' && rate === null) next.fxRateAtPurchase = t('itemForm.invalidNumber');
        else if (rate !== null) body.fxRateAtPurchase = rate;
      }
    }
    if (generates) {
      if (!state.catalog && !state.freeMode) next.catalogId = t('openForm.chooseItem');
      const built = buildCreateBody(state, { stores, usdBrlRate, language });
      if (!built.ok) {
        for (const [field, key] of Object.entries(built.errors)) next[field] = key ? tLoose(key) : undefined;
      } else {
        // A abertura define a aquisição do item obtido: loja, preço, cotação e data de compra não vão no corpo.
        const { acquisitionType: _a, purchaseStoreId: _s, purchasePriceCents: _p, fxRateAtPurchase: _f, acquiredAt: _d, ...generated } = built.body;
        const payload: OpenGeneratedBody = { ...generated };
        if (allowComponents) {
          const comp = buildComponentsBody(components, language);
          if (!comp.ok) next.components = tLoose(comp.errorKey, comp.params);
          else if (comp.body.length > 0) payload.components = comp.body;
        }
        body.generated = payload;
      }
    }
    if (Object.values(next).some(Boolean)) {
      setErrors(next);
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
            ? t('openForm.success', { name: item.name, generated: result.generatedItem.name })
            : t('openForm.successLost', { name: item.name }),
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

  return (
    <Modal title={t('openForm.title', { name: item.name })} onClose={onClose} busy={saving} wide>
      <form className={styles.form} onSubmit={submit} noValidate>
        {topError && <div className={styles.topError} role="alert">{topError}</div>}
        <div className={styles.chosen}>
          <ItemImage category={item.category} url={item.catalog?.imageUrl} size={48} />
          <div className={styles.chosenText}>
            <strong>{item.name}</strong>
            <span className={styles.muted}>{t('openForm.keyCost', { value: usd(containerCost) })}</span>
          </div>
        </div>
        <p className={styles.muted}>{t(introKey)}</p>

        {optionsQuery.isPending && <p className={styles.muted}>{t('common.loading')}</p>}
        {optionsQuery.error && <div className={styles.topError} role="alert">{errorMessageFor(optionsQuery.error, tLoose, language)}</div>}

        {options && isCase && (
          <fieldset className={styles.details} disabled={saving}>
            <legend className={styles.label}>{t('openForm.key')}</legend>
            {options.keys.length === 0 ? (
              <div className={styles.note} role="status">
                {t('openForm.noKey', { keyName: options.requiredKeyName ?? '' })}
                {options.otherKeysInStock > 0 && <div>{t('inventory.actions.openNeedsKeyOther', { keyName: options.requiredKeyName ?? '' })}</div>}
                {options.requiredKeyName && (
                  <div>
                    <button type="button" className={`${styles.button} ${styles.small}`} onClick={() => onRegisterKey(options.requiredKeyName ?? '')}>
                      {t('inventory.actions.registerKey')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <ul className={modalStyles.list}>
                {options.keys.map((key, index) => (
                  <li key={key.itemId} className={modalStyles.option}>
                    <label className={modalStyles.optionLabel}>
                      {options.keys.length > 1 && (
                        <input type="radio" name="key" checked={key.itemId === keyId} onChange={() => setChosenKey(key.itemId)} />
                      )}
                      <span className={modalStyles.optionText}>
                        <strong>{key.name}</strong>
                        <span className={styles.muted}>
                          {t('openForm.keyCost', { value: `${key.costEstimated ? '≈ ' : ''}${usd(key.effectiveCostUsdCents)}` })} · {formatDate(key.acquiredAt, language)}
                          {index === 0 && options.keys.length > 1 ? ` · ${t('openForm.keyOldest')}` : ''}
                        </span>
                      </span>
                      {key.tradeLocked && <Badge tone="info" icon="🔒">{t('applyForm.tradeLock')}</Badge>}
                      {key.offSale && <Badge>{t('applyForm.holding')}</Badge>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {errors.keyItemId && <span className={styles.error} role="alert">{errors.keyItemId}</span>}
          </fieldset>
        )}

        {options && isTerminal && (
          <fieldset className={styles.details} disabled={saving}>
            <legend className={styles.label}>{t('openForm.decision')}</legend>
            <div className={styles.radioRow}>
              <label>
                <input type="radio" name="decision" checked={decision === 'BUY'} onChange={() => setDecision('BUY')} />
                {t('openForm.buy')}
              </label>
              <label>
                <input type="radio" name="decision" checked={decision === 'DECLINE'} onChange={() => setDecision('DECLINE')} />
                {t('openForm.decline', { value: usd(containerCost) })}
              </label>
            </div>
            {errors.decision && <span className={styles.error} role="alert">{errors.decision}</span>}
            {decision === 'BUY' && !steamStore && (
              <div className={styles.note} role="status">
                {t('openForm.noSteamStore')}{' '}
                <Link href="/stores">{t('openForm.goToStores')}</Link>
              </div>
            )}
            {buying && steamStore && (
              <>
                <p className={styles.muted}>{t('openForm.steamStore', { store: steamStore.name, currency: steamStore.currency })}</p>
                <div className={styles.grid}>
                  <FormField label={t('openForm.price', { currency: steamStore.currency })} error={errors.paidPriceCents}>
                    {(c) => (
                      <input {...c} className={styles.input} inputMode="decimal" value={priceText} onChange={(e) => { setPriceText(e.target.value); clearError('paidPriceCents'); }} />
                    )}
                  </FormField>
                  {fxVisible && (
                    <FormField
                      label={t('openForm.fx')}
                      error={errors.fxRateAtPurchase}
                      hint={fxDefault !== null ? t('openForm.fxDefault', { rate: formatDecimalInput(fxDefault, language) }) : null}
                    >
                      {(c) => <input {...c} className={styles.input} inputMode="decimal" value={fxText} onChange={(e) => setFxTyped(e.target.value)} />}
                    </FormField>
                  )}
                </div>
              </>
            )}
          </fieldset>
        )}

        {options && generates && (
          <>
            <h3 className={styles.label}>{t('openForm.generatedTitle')}</h3>
            <p className={styles.muted}>{t('openForm.generatedHint')}</p>
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
              <ItemComponentsSection
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
            <FormField label={t('openForm.generatedTradeLock')} error={errors.tradeUnlockAt}>
              {(c) => (
                <input
                  {...c}
                  className={styles.input}
                  type="datetime-local"
                  value={state.tradeUnlockAt}
                  onChange={(e) => setState((s) => setTradeUnlockAt(s, e.target.value))}
                />
              )}
            </FormField>
          </>
        )}

        {options && (
          <FormField label={t('openForm.openedAt')} error={errors.openedAt}>
            {(c) => (
              <input
                {...c}
                type="datetime-local"
                className={styles.input}
                max={dateToLocalInput(new Date())}
                value={openedAtText}
                onChange={(e) => setTypedAt(e.target.value)}
              />
            )}
          </FormField>
        )}

        {summary && <div className={styles.note} role="status">{summary}</div>}

        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={!canSubmit}>
            {saving ? t('common.saving') : decision === 'DECLINE' ? t('openForm.submitDecline') : t('openForm.submit')}
          </button>
        </div>
      </form>
      {confirmDecline && (
        <ConfirmDialog
          title={t('openForm.confirmDeclineTitle')}
          message={t('openForm.confirmDeclineMessage', { value: usd(containerCost) })}
          confirmLabel={t('openForm.confirmDeclineConfirm')}
          danger
          busy={saving}
          onCancel={() => setConfirmDecline(false)}
          onConfirm={perform}
        />
      )}
    </Modal>
  );
}
