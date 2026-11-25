'use client';

import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { resolveErrorTarget } from '@/lib/formErrors';
import {
  buildComponentsBody, componentsAllowedFor, componentsBodyFromItem, componentsStateFromItem, emptyComponentsState, sameComponents,
  type ComponentsState,
} from '@/lib/itemComponents';
import {
  addSevenDays, applyCatalogChoice, applyPurchaseStore, buildCreateBody,
  setAcquiredAt, setAcquisitionType, setTradeUnlockAt,
  buildPatchBody, defaultRateFor, effectiveCategory, fieldVisibility, findStore, initialCreateState, stateFromItem,
  visibleItemFields,
  type CatalogChoice, type FormContext, type FormErrors, type ItemFormState,
} from '@/lib/itemForm';
import { moneyInputMode } from '@/lib/currencies';
import { ratesRecord } from '@/lib/fxRates';
import { formatDecimalInput } from '@/lib/numberInput';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, createItem, getCatalogStatus, updateItem } from '@/services/api';
import { launchStoreOptions } from '@/lib/storeOptions';
import type { AcquisitionType, CatalogItem, Currency, ItemPatchBody, ItemView, Store } from '@/types/api';
import FormField from './FormField';
import styles from './forms.module.css';
import ItemComponentsSection from './ItemComponentsSection';
import ItemIdentityFields from './ItemIdentityFields';
import Modal from './Modal';
import { usePreferences } from './PreferencesProvider';

export const ITEM_FORM_FIELDS = [
  'catalogId', 'name', 'category', 'variant', 'floatValue', 'exterior', 'paintSeed', 'phase', 'acquisitionType',
  'purchaseStoreId', 'purchasePriceCents', 'fxRateAtPurchase', 'acquiredAt', 'tradeUnlockAt', 'inspectLink',
  'assetId', 'originDetail', 'components',
] as const;

interface Props {
  // Sem `item` = cadastro; com `item` = edição.
  item?: ItemView;
  // Cadastro de uma chave pelo atalho da caixa sem chave (10.4): nome livre em OUTRO já preenchido.
  preset?: { name: string };
  stores: Store[];
  onClose: () => void;
  onSaved: (message: string) => void;
  // "Separar" o pendurado pela seção de componentes (M7): o host abre o modal de separação com o id do componente.
  onDetach?: (item: ItemView, componentId: number) => void;
  // Item excluído em outra aba (ITEM_NOT_FOUND na edição).
  onGone: () => void;
}

const storeLabel = (store: Store, inactive: string) => (store.isActive ? store.name : `${store.name} (${inactive})`);

export default function ItemFormModal({ item, preset, stores, onClose, onSaved, onDetach, onGone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const { usdBrlRate, fxRates } = usePreferences();
  const editing = item !== undefined;
  const rates = ratesRecord(fxRates);
  const ctx: FormContext = { stores, usdBrlRate, rates, language: locale };

  const [state, setState] = useState<ItemFormState>(() => {
    if (item) return stateFromItem(item, locale);
    const base = initialCreateState(ctx);
    return preset ? { ...base, freeMode: true, category: 'OUTRO', name: preset.name } : base;
  });
  // Componentes aplicados (10.1): só SKIN; ficam fora do ItemFormState e entram no corpo no envio.
  const [components, setComponents] = useState<ComponentsState>(() => (item ? componentsStateFromItem(item, locale) : emptyComponentsState()));
  const [errors, setErrors] = useState<FormErrors>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changingItem, setChangingItem] = useState(false);
  const [currencyChangedTo, setCurrencyChangedTo] = useState<Currency | null>(null);

  const patch = (partial: Partial<ItemFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  const category = effectiveCategory(state);
  const vis = fieldVisibility(state, stores);
  const store = findStore(stores, state.purchaseStoreId);
  const isLegacy = editing && item.isLegacy && !state.catalog;
  const showSearch = !state.catalog && !state.freeMode ? true : changingItem;
  // Agente: a seção de patches só aparece quando o catálogo tem patches (ou o agente já tem algum; 10.3, D362).
  const catalogStatus = useQuery({ queryKey: queryKeys.catalog.status, queryFn: ({ signal }) => getCatalogStatus(signal) });
  const patchesAvailable = (catalogStatus.data?.countsBySource.PATCHES ?? 0) > 0 || (editing && item.components.some((c) => c.kind === 'PATCH'));
  const allowComponents = componentsAllowedFor(category, patchesAvailable);
  // Trocar para uma categoria sem componentes remove os gravados que vieram junto (aviso no formulário; o backend recusa o resto).
  const willRemoveComponents = !allowComponents && editing && item.components.some((c) => c.origin !== 'APPLIED_FROM_STOCK');

  const onPickCatalog = (picked: CatalogItem) => {
    setState((s) => applyCatalogChoice(s, picked as CatalogChoice));
    setChangingItem(false);
    clearError('catalogId');
  };

  const onStoreChange = (value: string) => {
    const id = value === '' ? null : Number(value);
    const previous = findStore(stores, state.purchaseStoreId);
    const next = findStore(stores, id);
    setCurrencyChangedTo(previous && next && previous.currency !== next.currency ? next.currency : null);
    setState((s) => applyPurchaseStore(s, id, ctx));
    clearError('purchaseStoreId');
  };

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'ITEM_NOT_FOUND' && editing) {
      onGone();
      return;
    }
    const message = errorMessageFor(err, tLoose, locale);
    let visible = visibleItemFields(ITEM_FORM_FIELDS, vis, { showSearch, freeMode: state.freeMode, hasCatalog: !!state.catalog });
    if (!allowComponents) visible = visible.filter((field) => field !== 'components');
    if (err instanceof ApiRequestError && (err.code === 'CATALOG_ITEM_REQUIRED' || err.code === 'CATALOG_ITEM_NOT_FOUND')) {
      // Abre a busca do catálogo para o erro ter onde aparecer.
      patch({ freeMode: false });
      setChangingItem(true);
      if (!visible.includes('catalogId')) visible = [...visible, 'catalogId'];
    }
    const { target, topLabelField } = resolveErrorTarget(err, visible);
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

    if (!editing && !state.catalog && !state.freeMode) {
      setErrors({ catalogId: t('itemForm.chooseItem') });
      return;
    }
    const built = editing ? buildPatchBody(state, item, ctx) : buildCreateBody(state, ctx);
    if (!built.ok) {
      const translated: FormErrors = {};
      for (const [field, key] of Object.entries(built.errors)) translated[field] = key ? tLoose(key) : undefined;
      setErrors(translated);
      return;
    }
    const body: ItemPatchBody = { ...built.body };
    if (allowComponents) {
      const comp = buildComponentsBody(components, locale);
      if (!comp.ok) {
        setErrors({ components: tLoose(comp.errorKey, comp.params) });
        return;
      }
      // Presente = substitui a lista; no cadastro só vai se houver algo; na edição só se mudou.
      if (editing ? !sameComponents(comp.body, componentsBodyFromItem(item)) : comp.body.length > 0) body.components = comp.body;
    } else if (willRemoveComponents) {
      body.components = [];
    }
    setErrors({});
    if (editing && Object.keys(body).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    const request = editing ? updateItem(item.id, body) : createItem(body as Parameters<typeof createItem>[0]);
    request
      .then(() => {
        invalidate(editing ? 'item.update' : 'item.create');
        onSaved(editing ? t('itemForm.saved') : t('itemForm.created'));
      })
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  const priceCurrency = store?.currency ?? 'USD';
  const defaultFx = defaultRateFor(ctx, priceCurrency);

  return (
    <Modal title={editing ? t('itemForm.titleEdit') : t('itemForm.titleCreate')} onClose={onClose} busy={saving} wide>
      <form className={styles.form} onSubmit={submit} noValidate>
        {topError && <div className={styles.topError} role="alert">{topError}</div>}
        {editing && item.status === 'VENDIDO' && <div className={styles.note}>{t('itemForm.soldNote')}</div>}

        <ItemIdentityFields
          state={state}
          patch={patch}
          errors={errors}
          clearError={clearError}
          vis={vis}
          showSearch={showSearch}
          changingItem={changingItem}
          setChangingItem={setChangingItem}
          isLegacy={isLegacy}
          item={item}
          onPickCatalog={onPickCatalog}
        />

        {/* Componentes aplicados (stickers e chaveiro): só SKIN, não mudam o custo */}
        {allowComponents && (
          <ItemComponentsSection
            itemId={editing ? item.id : undefined}
            category={category}
            onItemChanged={onSaved}
            onDetach={editing && item && onDetach ? (componentId) => onDetach(item, componentId) : undefined}
            cameWithHangingId={editing && item ? item.components.find((c) => c.detachable && c.origin === 'CAME_WITH')?.id ?? null : null}
            state={components}
            onChange={(next) => {
              setComponents(next);
              clearError('components');
            }}
            error={errors.components}
            disabled={saving}
          />
        )}
        {willRemoveComponents && <div className={styles.note} role="status">{t('itemForm.components.willRemove')}</div>}

        {/* Aquisição */}
        <fieldset className={styles.details} disabled={saving}>
          <legend className={styles.label}>{t('itemForm.acquisitionType')}</legend>
          <div className={styles.radioRow}>
            {(['COMPRA', 'GANHEI'] as AcquisitionType[]).map((type) => (
              <label key={type}>
                <input
                  type="radio"
                  name="acquisitionType"
                  checked={state.acquisitionType === type}
                  onChange={() => setState((s) => setAcquisitionType(s, type))}
                />
                {tLoose(`enums.acquisitionType.${type}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.grid}>
          <FormField
            label={vis.informativeStore ? t('itemForm.purchaseStoreInformative') : t('itemForm.purchaseStore')}
            error={errors.purchaseStoreId}
          >
            {(c) => (
              <select
                {...c}
                className={styles.select}
                value={state.purchaseStoreId ?? ''}
                onChange={(e) => onStoreChange(e.target.value)}
              >
                {(vis.informativeStore || state.purchaseStoreId === null) && <option value="">{t('common.select')}</option>}
                {launchStoreOptions(stores, [item?.purchaseStoreId, state.purchaseStoreId]).map((s) => <option key={s.id} value={s.id}>{storeLabel(s, t('itemForm.storeInactive'))}</option>)}
              </select>
            )}
          </FormField>

          {vis.price ? (
            <FormField
              label={t('itemForm.purchasePrice', { currency: priceCurrency })}
              error={errors.purchasePriceCents}
              hint={currencyChangedTo && state.priceText === '' ? t('itemForm.priceReenter', { currency: currencyChangedTo }) : null}
            >
              {(c) => (
                <input
                  {...c}
                  className={styles.input}
                  inputMode={moneyInputMode(priceCurrency)}
                  value={state.priceText}
                  onChange={(e) => {
                    patch({ priceText: e.target.value });
                    clearError('purchasePriceCents');
                  }}
                />
              )}
            </FormField>
          ) : (
            <div className={styles.field}>
              <span className={styles.label}>{t('itemForm.purchasePrice', { currency: 'USD' })}</span>
              <span className={styles.muted}>{t('itemForm.ganheiCost')}</span>
            </div>
          )}

          {vis.fx && (
            <FormField
              label={t('itemForm.fxRateAtPurchase', { currency: priceCurrency })}
              error={errors.fxRateAtPurchase}
              hint={defaultFx !== null ? t('itemForm.fxRateDefault', { rate: formatDecimalInput(defaultFx, locale) }) : null}
            >
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

          <FormField label={t('itemForm.acquiredAt')} error={errors.acquiredAt}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                type="datetime-local"
                value={state.acquiredAt}
                onChange={(e) => setState((s) => setAcquiredAt(s, e.target.value))}
              />
            )}
          </FormField>

          <FormField label={t('itemForm.tradeUnlockAt')} error={errors.tradeUnlockAt}>
            {(c) => (
              <div className={styles.row}>
                <input
                  {...c}
                  className={styles.input}
                  type="datetime-local"
                  value={state.tradeUnlockAt}
                  onChange={(e) => setState((s) => setTradeUnlockAt(s, e.target.value))}
                />
                <button
                  type="button"
                  className={`${styles.button} ${styles.small}`}
                  onClick={() => setState((s) => addSevenDays(s))}
                >
                  {t('itemForm.plus7Days')}
                </button>
              </div>
            )}
          </FormField>

          <FormField label={t('itemForm.inspectLink')} error={errors.inspectLink} hint={t('itemForm.inspectLinkHint')} full>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                value={state.inspectLink}
                onChange={(e) => {
                  patch({ inspectLink: e.target.value });
                  clearError('inspectLink');
                }}
              />
            )}
          </FormField>
        </div>

        <details className={styles.details}>
          <summary>{t('common.moreDetails')}</summary>
          <div className={styles.grid}>
            <FormField label={`${t('itemForm.originDetail')} ${t('common.optional')}`} error={errors.originDetail}>
              {(c) => (
                <input {...c} className={styles.input} value={state.originDetail} onChange={(e) => patch({ originDetail: e.target.value })} />
              )}
            </FormField>
            <FormField label={`${t('itemForm.assetId')} ${t('common.optional')}`} error={errors.assetId}>
              {(c) => (
                <input {...c} className={styles.input} value={state.assetId} onChange={(e) => patch({ assetId: e.target.value })} />
              )}
            </FormField>
          </div>
        </details>

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
