'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { resolveErrorTarget, revealFor } from '@/lib/formErrors';
import {
  buildComponentsBody, componentsAllowedFor, componentsBodyFromItem, componentsStateFromItem, emptyComponentsState, sameComponents,
  type ComponentsState,
} from '@/lib/itemComponents';
import {
  applyCatalogChoice, applyPurchaseStore, buildCreateBody,
  buildPatchBody, defaultRateFor, effectiveCategory, fieldVisibility, findStore, initialCreateState, isDirty, isGeneratedUnit, stateFromItem,
  visibleItemFields,
  type CatalogChoice, type FormContext, type FormErrors, type ItemFormState,
} from '@/lib/itemForm';
import { moneyErrorParams } from '@/lib/currencies';
import { ratesRecord } from '@/lib/fxRates';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, createItem, getCatalogStatus, updateItem } from '@/services/api';
import type { CatalogItem, Currency, ItemPatchBody, ItemView, Store } from '@/types/api';
import AcquisitionFields, { AcquisitionDetails } from './item/AcquisitionFields';
import ComponentsPanel from './item/ComponentsPanel';
import itemStyles from './item/item.module.css';
import ItemIdentityFields from './ItemIdentityFields';
import { usePreferences } from './PreferencesProvider';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import FormErrorSummary, { type FormErrorItem } from './ui/FormErrorSummary';
import TextField from './ui/TextField';

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
  // "Separar" o pendurado pelo painel de componentes (M7): o host abre o modal de separação com o id do componente.
  onDetach?: (item: ItemView, componentId: number) => void;
  // "Aplicar do estoque" pelo painel de componentes: o host abre o modal de aplicação.
  onApply?: (item: ItemView) => void;
  // Entrada "Componentes" do menu da linha: a edição abre rolada e com o foco no painel.
  focusComponents?: boolean;
  // Item excluído em outra aba (ITEM_NOT_FOUND na edição).
  onGone: () => void;
}

// Cadastro e edição do item (12.6a): Dialog `lg` com as seções Item, Aquisição, Componentes e "Mais detalhes", validação na digitação
// (NumberField) e `FormErrorSummary` ao enviar. Nenhuma regra nova: o backend continua sendo a fonte e `lib/itemForm` monta o corpo.
export default function ItemFormModal({ item, preset, stores, onClose, onSaved, onDetach, onApply, focusComponents = false, onGone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const formId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const { usdBrlRate, fxRates } = usePreferences();
  const editing = item !== undefined;
  const rates = ratesRecord(fxRates);
  const ctx: FormContext = { stores, usdBrlRate, rates, language: locale };

  const [state, setState] = useState<ItemFormState>(() => {
    if (item) return stateFromItem(item, locale);
    const base = initialCreateState(ctx);
    return preset ? { ...base, freeMode: true, category: 'OUTRO', name: preset.name } : base;
  });
  // Componentes aplicados (10.1): só SKIN (e agente com patches); ficam fora do ItemFormState e entram no corpo no envio.
  const [components, setComponents] = useState<ComponentsState>(() => (item ? componentsStateFromItem(item, locale) : emptyComponentsState()));
  const [errors, setErrors] = useState<FormErrors>({});
  const [attempt, setAttempt] = useState(0);
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changingItem, setChangingItem] = useState(false);
  const [currencyChangedTo, setCurrencyChangedTo] = useState<Currency | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const patch = (partial: Partial<ItemFormState>) => setState((s) => ({ ...s, ...partial }));
  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  const category = effectiveCategory(state);
  const vis = fieldVisibility(state, stores);
  const store = findStore(stores, state.purchaseStoreId);
  const isLegacy = editing && item.isLegacy && !state.catalog;
  const generated = isGeneratedUnit(item);
  const showSearch = !state.catalog && !state.freeMode ? true : changingItem;
  // Agente: o painel de patches só aparece quando o catálogo tem patches (ou o agente já tem algum; 10.3, D362).
  const catalogStatus = useQuery({ queryKey: queryKeys.catalog.status, queryFn: ({ signal }) => getCatalogStatus(signal) });
  const patchesAvailable = (catalogStatus.data?.countsBySource.PATCHES ?? 0) > 0 || (editing && item.components.some((c) => c.kind === 'PATCH'));
  const allowComponents = componentsAllowedFor(category, patchesAvailable);
  // Trocar para uma categoria sem componentes remove os gravados que vieram junto (aviso no formulário; o backend recusa o resto).
  const willRemoveComponents = !allowComponents && editing && item.components.some((c) => c.origin !== 'APPLIED_FROM_STOCK');

  const priceCurrency: Currency = store?.currency ?? 'USD';
  const defaultFx = defaultRateFor(ctx, priceCurrency);
  const dirty = editing && isDirty(state, item, allowComponents ? components : null, ctx);

  // Mostra os erros e abre o "Mais detalhes" se algum campo com erro estiver lá dentro (o resumo precisa focá-lo).
  const showErrors = (next: FormErrors) => {
    setErrors(next);
    const hidden = Object.entries(next).some(([field, message]) => message && revealFor(field, vis) === 'details');
    if (hidden) setDetailsOpen(true);
  };

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
    setAttempt((n) => n + 1);
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

    if (!editing && !state.catalog && !state.freeMode) {
      setAttempt((n) => n + 1);
      showErrors({ catalogId: t('itemForm.chooseItem') });
      return;
    }
    const built = editing ? buildPatchBody(state, item, ctx) : buildCreateBody(state, ctx);
    if (!built.ok) {
      const translated: FormErrors = {};
      for (const [field, key] of Object.entries(built.errors)) translated[field] = key ? tLoose(key, moneyErrorParams(locale, priceCurrency)) : undefined;
      setAttempt((n) => n + 1);
      showErrors(translated);
      return;
    }
    const body: ItemPatchBody = { ...built.body };
    if (allowComponents) {
      const comp = buildComponentsBody(components, locale);
      if (!comp.ok) {
        setAttempt((n) => n + 1);
        showErrors({ components: tLoose(comp.errorKey, comp.params) });
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

  const summaryItems: FormErrorItem[] = ITEM_FORM_FIELDS
    .filter((field) => errors[field])
    .map((field) => {
      const label = tLoose(`fields.${field}`);
      return { field, label: label === `fields.${field}` ? field : label, message: errors[field] as string };
    });

  return (
    <Dialog
      title={editing ? t('itemForm.titleEdit') : t('itemForm.titleCreate')}
      size="lg"
      busy={saving}
      onClose={onClose}
      onOpenAutoFocus={focusComponents && allowComponents
        ? (event) => {
          event.preventDefault();
          panelRef.current?.focus();
          panelRef.current?.scrollIntoView?.({ block: 'start' });
        }
        : undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" loading={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id={formId} className={itemStyles.form} onSubmit={submit} noValidate>
        <FormErrorSummary key={attempt} errors={summaryItems} />
        {topError && <Banner tone="danger">{topError}</Banner>}
        {editing && item.status === 'VENDIDO' && <Banner tone="info" announce={false}>{t('itemForm.soldNote')}</Banner>}

        <section className={itemStyles.section} aria-labelledby={`${formId}-item`}>
          <h3 id={`${formId}-item`} className={itemStyles.sectionTitle}>{t('itemForm.sections.item')}</h3>
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
          <TextField
            label={t('itemForm.inspectLink')}
            name="inspectLink"
            value={state.inspectLink}
            error={errors.inspectLink}
            hint={t('itemForm.inspectLinkHint')}
            disabled={saving}
            onChange={(value) => {
              patch({ inspectLink: value });
              clearError('inspectLink');
            }}
          />
        </section>

        <section className={itemStyles.section} aria-labelledby={`${formId}-acq`}>
          <h3 id={`${formId}-acq`} className={itemStyles.sectionTitle}>{t('itemForm.sections.acquisition')}</h3>
          <AcquisitionFields
            state={state}
            setState={setState}
            patch={patch}
            errors={errors}
            clearError={clearError}
            vis={vis}
            stores={stores}
            item={item}
            priceCurrency={priceCurrency}
            defaultFx={defaultFx}
            currencyChangedTo={currencyChangedTo}
            onStoreChange={onStoreChange}
            generated={generated}
            disabled={saving}
          />
        </section>

        {/* Componentes (stickers, chaveiro e patches): não mudam o custo */}
        {allowComponents && (
          <ComponentsPanel
            panelRef={panelRef}
            item={item}
            category={category}
            state={components}
            onChange={(next) => {
              setComponents(next);
              clearError('components');
            }}
            error={errors.components}
            disabled={saving}
            dirty={dirty}
            onItemChanged={onSaved}
            onApply={onApply}
            onDetach={onDetach}
          />
        )}
        {willRemoveComponents && <Banner tone="warning" announce={false}>{t('itemForm.components.willRemove')}</Banner>}

        <AcquisitionDetails
          state={state}
          patch={patch}
          errors={errors}
          vis={vis}
          stores={stores}
          item={item}
          onStoreChange={onStoreChange}
          generated={generated}
          disabled={saving}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      </form>
    </Dialog>
  );
}
