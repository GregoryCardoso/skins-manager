'use client';

import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import {
  ALL_EXTERIORS, FREE_NAME_CATEGORIES, effectiveCategory, variantOptions, type FieldVisibility, type FormErrors, type ItemFormState,
} from '@/lib/itemForm';
import { formatFloat } from '@/lib/format';
import type { CatalogItem, Category, Exterior, ItemView, Variant } from '@/types/api';
import CatalogAutocomplete, { catalogDisplayName } from './CatalogAutocomplete';
import FormField from './FormField';
import styles from './forms.module.css';
import ItemImage from './ItemImage';
import { Badge } from './badges';

interface Props {
  state: ItemFormState;
  patch: (partial: Partial<ItemFormState>) => void;
  errors: FormErrors;
  clearError: (field: string) => void;
  vis: FieldVisibility;
  showSearch: boolean;
  changingItem: boolean;
  setChangingItem: (value: boolean) => void;
  // Item antigo sem vínculo com o catálogo (só na edição); `item` traz o nome e a categoria para o aviso.
  isLegacy: boolean;
  item?: ItemView;
  onPickCatalog: (picked: CatalogItem) => void;
}

// Identidade do item (busca no catálogo, nome livre) e atributos de arma. Compartilhado pelo cadastro/edição (ItemFormModal) e pelo item
// obtido na abertura de uma caixa (OpenContainerModal, 10.4), para a regra visual de identidade e atributos ficar num lugar só.
export default function ItemIdentityFields({ state, patch, errors, clearError, vis, showSearch, changingItem, setChangingItem, isLegacy, item, onPickCatalog }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const category = effectiveCategory(state);
  const categoryText = (c: Category | '') => (c === '' ? '' : tLoose(`enums.category.${c}`));
  const floatHint = state.catalog && state.catalog.minFloat !== null && state.catalog.maxFloat !== null
    ? t('itemForm.floatRange', { min: formatFloat(state.catalog.minFloat, locale), max: formatFloat(state.catalog.maxFloat, locale) })
    : null;

  return (
    <>
    {/* Identidade */}
    {state.catalog && !changingItem && (
      <div className={styles.chosen}>
        <ItemImage category={state.catalog.category} url={state.catalog.imageUrl} size={48} />
        <div className={styles.chosenText}>
          <strong>{catalogDisplayName(state.catalog)}</strong>
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
        <Badge tone="warning">{t('inventory.legacy')}</Badge> <strong>{item?.name}</strong> · {categoryText(item?.category ?? '')}
        <div>{t('itemForm.legacyNote')}</div>
      </div>
    )}

    {showSearch && (
      <div>
        <CatalogAutocomplete
          label={isLegacy ? t('itemForm.legacyLink') : t('itemForm.catalogSearch')}
          fixedCategory={isLegacy ? item?.category : undefined}
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
    </>
  );
}
