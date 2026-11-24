'use client';

import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { resolveErrorTarget } from '@/lib/formErrors';
import { formatFloat } from '@/lib/format';
import {
  buildComponentsBody, componentsAllowedFor, componentsBodyFromItem, componentsStateFromItem, emptyComponentsState, sameComponents,
  type ComponentsState,
} from '@/lib/itemComponents';
import {
  ALL_EXTERIORS, FREE_NAME_CATEGORIES, addSevenDays, applyCatalogChoice, applyPurchaseStore, buildCreateBody,
  setAcquiredAt, setAcquisitionType, setTradeUnlockAt,
  buildPatchBody, effectiveCategory, fieldVisibility, findStore, initialCreateState, stateFromItem, variantOptions,
  visibleItemFields,
  type CatalogChoice, type FormContext, type FormErrors, type ItemFormState,
} from '@/lib/itemForm';
import { formatDecimalInput } from '@/lib/numberInput';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, createItem, getCatalogStatus, updateItem } from '@/services/api';
import type { AcquisitionType, CatalogItem, Category, Currency, Exterior, ItemPatchBody, ItemView, Store, Variant } from '@/types/api';
import CatalogAutocomplete, { catalogDisplayName } from './CatalogAutocomplete';
import FormField from './FormField';
import styles from './forms.module.css';
import ItemComponentsSection from './ItemComponentsSection';
import ItemImage from './ItemImage';
import Modal from './Modal';
import { Badge } from './badges';
import { usePreferences } from './PreferencesProvider';

export const ITEM_FORM_FIELDS = [
  'catalogId', 'name', 'category', 'variant', 'floatValue', 'exterior', 'paintSeed', 'phase', 'acquisitionType',
  'purchaseStoreId', 'purchasePriceCents', 'fxRateAtPurchase', 'acquiredAt', 'tradeUnlockAt', 'inspectLink',
  'assetId', 'originDetail', 'components',
] as const;

interface Props {
  // Sem `item` = cadastro; com `item` = edição.
  item?: ItemView;
  stores: Store[];
  onClose: () => void;
  onSaved: (message: string) => void;
  // Item excluído em outra aba (ITEM_NOT_FOUND na edição).
  onGone: () => void;
}

const storeLabel = (store: Store, inactive: string) => (store.isActive ? store.name : `${store.name} (${inactive})`);

export default function ItemFormModal({ item, stores, onClose, onSaved, onGone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const invalidate = useInvalidate();
  const { usdBrlRate } = usePreferences();
  const editing = item !== undefined;
  const ctx: FormContext = { stores, usdBrlRate, language };

  const [state, setState] = useState<ItemFormState>(() => (item ? stateFromItem(item, language) : initialCreateState(ctx)));
  // Componentes aplicados (10.1): só SKIN; ficam fora do ItemFormState e entram no corpo no envio.
  const [components, setComponents] = useState<ComponentsState>(() => (item ? componentsStateFromItem(item, language) : emptyComponentsState()));
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
    const message = errorMessageFor(err, tLoose, language);
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
      const comp = buildComponentsBody(components, language);
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

  const categoryText = (c: Category | '') => (c === '' ? '' : tLoose(`enums.category.${c}`));
  const floatHint = state.catalog && state.catalog.minFloat !== null && state.catalog.maxFloat !== null
    ? t('itemForm.floatRange', { min: formatFloat(state.catalog.minFloat, language), max: formatFloat(state.catalog.maxFloat, language) })
    : null;
  const priceCurrency = store?.currency ?? 'USD';

  return (
    <Modal title={editing ? t('itemForm.titleEdit') : t('itemForm.titleCreate')} onClose={onClose} busy={saving} wide>
      <form className={styles.form} onSubmit={submit} noValidate>
        {topError && <div className={styles.topError} role="alert">{topError}</div>}
        {editing && item.status === 'VENDIDO' && <div className={styles.note}>{t('itemForm.soldNote')}</div>}

        {/* Identidade */}
        {state.catalog && !changingItem && (
          <div className={styles.chosen}>
            <ItemImage category={state.catalog.category} url={state.catalog.imageUrl} size={48} />
            <div className={styles.chosenText}>
              <strong>{catalogDisplayName(state.catalog, language)}</strong>
              <span className={styles.muted}>
                {categoryText(state.catalog.category)}{state.catalog.phase ? ` · ${state.catalog.phase}` : ''}
              </span>
            </div>
            <button type="button" className={`${styles.button} ${styles.small}`} onClick={() => setChangingItem(true)}>
              {t('itemForm.changeItem')}
            </button>
          </div>
        )}

        {isLegacy && !changingItem && (
          <div className={styles.note}>
            <Badge tone="warning">{t('inventory.legacy')}</Badge> <strong>{item.name}</strong> · {categoryText(item.category)}
            <div>{t('itemForm.legacyNote')}</div>
          </div>
        )}

        {showSearch && (
          <div>
            <CatalogAutocomplete
              label={isLegacy ? t('itemForm.legacyLink') : t('itemForm.catalogSearch')}
              fixedCategory={isLegacy ? item.category : undefined}
              error={errors.catalogId}
              autoFocus
              onSelect={onPickCatalog}
            />
            <div className={styles.row}>
              {changingItem && (
                <button type="button" className={`${styles.button} ${styles.small}`} onClick={() => setChangingItem(false)}>
                  {t('common.cancel')}
                </button>
              )}
              {!isLegacy && !state.catalog && (
                <button
                  type="button"
                  className={`${styles.button} ${styles.small}`}
                  onClick={() => patch({ freeMode: true, category: state.category === '' ? 'OUTRO' : state.category })}
                >
                  {t('itemForm.freeName')}
                </button>
              )}
            </div>
          </div>
        )}

        {state.freeMode && !state.catalog && (
          <div className={styles.grid}>
            <FormField label={t('itemForm.category')} error={errors.category}>
              {(c) => (
                <select
                  {...c}
                  className={styles.select}
                  value={state.category}
                  onChange={(e) => patch({ category: e.target.value as Category })}
                >
                  {FREE_NAME_CATEGORIES.map((cat) => <option key={cat} value={cat}>{categoryText(cat)}</option>)}
                </select>
              )}
            </FormField>
            <FormField label={t('itemForm.name')} error={errors.name}>
              {(c) => (
                <input {...c} className={styles.input} value={state.name} onChange={(e) => patch({ name: e.target.value })} />
              )}
            </FormField>
            <div className={styles.full}>
              <button type="button" className={`${styles.button} ${styles.small}`} onClick={() => patch({ freeMode: false })}>
                {t('itemForm.backToCatalog')}
              </button>
            </div>
          </div>
        )}

        {/* Atributos de arma */}
        {vis.weapon && (
          <div className={styles.grid}>
            <FormField label={t('itemForm.variant')} error={errors.variant}>
              {(c) => (
                <select
                  {...c}
                  className={styles.select}
                  value={state.variant}
                  onChange={(e) => patch({ variant: e.target.value as Variant })}
                >
                  {variantOptions(category, state.catalog, state.variant).map((v) => (
                    <option key={v} value={v}>{tLoose(`enums.variant.${v}`)}</option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label={t('itemForm.floatValue')} error={errors.floatValue} hint={floatHint}>
              {(c) => (
                <input
                  {...c}
                  className={styles.input}
                  inputMode="decimal"
                  value={state.floatText}
                  onChange={(e) => {
                    patch({ floatText: e.target.value });
                    clearError('floatValue');
                  }}
                />
              )}
            </FormField>
            {vis.exteriorInput ? (
              <FormField label={t('itemForm.exterior')} error={errors.exterior}>
                {(c) => (
                  <select
                    {...c}
                    className={styles.select}
                    value={state.exterior}
                    onChange={(e) => patch({ exterior: e.target.value as Exterior | '' })}
                  >
                    <option value="">{t('common.none')}</option>
                    {ALL_EXTERIORS.map((x) => <option key={x} value={x}>{tLoose(`enums.exterior.${x}`)}</option>)}
                  </select>
                )}
              </FormField>
            ) : (
              <FormField label={t('itemForm.exterior')} error={errors.exterior} hint={t('itemForm.exteriorDerived')}>
                {(c) => <input {...c} className={styles.input} value="" disabled readOnly />}
              </FormField>
            )}
            <FormField label={t('itemForm.paintSeed')} error={errors.paintSeed}>
              {(c) => (
                <input
                  {...c}
                  className={styles.input}
                  inputMode="numeric"
                  value={state.paintSeedText}
                  onChange={(e) => patch({ paintSeedText: e.target.value })}
                />
              )}
            </FormField>
            <FormField label={t('itemForm.phase')} error={errors.phase} hint={vis.phaseLocked ? t('itemForm.phaseFromCatalog') : null}>
              {(c) => (
                <input
                  {...c}
                  className={styles.input}
                  value={vis.phaseLocked ? state.catalog?.phase ?? '' : state.phase}
                  disabled={vis.phaseLocked}
                  onChange={(e) => patch({ phase: e.target.value })}
                />
              )}
            </FormField>
          </div>
        )}

        {/* Componentes aplicados (stickers e chaveiro): só SKIN, não mudam o custo */}
        {allowComponents && (
          <ItemComponentsSection
            itemId={editing ? item.id : undefined}
            category={category}
            onItemChanged={onSaved}
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
                {stores.map((s) => <option key={s.id} value={s.id}>{storeLabel(s, t('itemForm.storeInactive'))}</option>)}
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
                  inputMode="decimal"
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
              label={t('itemForm.fxRateAtPurchase')}
              error={errors.fxRateAtPurchase}
              hint={usdBrlRate !== null ? t('itemForm.fxRateDefault', { rate: formatDecimalInput(usdBrlRate, language) }) : null}
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
