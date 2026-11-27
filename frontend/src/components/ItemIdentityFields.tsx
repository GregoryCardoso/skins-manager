'use client';

import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import {
  ALL_EXTERIORS, FREE_NAME_CATEGORIES, effectiveCategory, variantOptions, type FieldVisibility, type FormErrors, type ItemFormState,
} from '@/lib/itemForm';
import { catalogDisplayName } from '@/lib/itemName';
import { formatFloat } from '@/lib/format';
import type { CatalogItem, Category, Exterior, ItemView, Variant } from '@/types/api';
import ItemImage from './ItemImage';
import CatalogCombobox from './item/CatalogCombobox';
import itemStyles from './item/item.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import NumberField from './ui/NumberField';
import Select from './ui/Select';
import TextField from './ui/TextField';
import Badge from './ui/Badge';

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

const NO_EXTERIOR = '__none__';

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
        <div className={itemStyles.chosen}>
          <ItemImage category={state.catalog.category} url={state.catalog.imageUrl} size={48} />
          <div className={itemStyles.chosenText}>
            <strong className={itemStyles.chosenName}>{catalogDisplayName(state.catalog)}</strong>
            <span className={itemStyles.muted}>
              {categoryText(state.catalog.category)}{state.catalog.phase ? ` · ${state.catalog.phase}` : ''}
            </span>
          </div>
          <Button size="sm" onClick={() => setChangingItem(true)}>
            {t('itemForm.changeItem')}
          </Button>
        </div>
      )}

      {isLegacy && !changingItem && (
        <Banner tone="warning" announce={false}>
          <Badge tone="neutral">{t('inventory.legacy')}</Badge> <strong>{item?.name}</strong> · {categoryText(item?.category ?? '')}
          <div>{t('itemForm.legacyNote')}</div>
        </Banner>
      )}

      {showSearch && (
        <div className={itemStyles.search}>
          <CatalogCombobox
            label={isLegacy ? t('itemForm.legacyLink') : t('itemForm.catalogSearch')}
            name="catalogId"
            fixedCategory={isLegacy ? item?.category : undefined}
            error={errors.catalogId}
            autoFocus
            onSelect={onPickCatalog}
          />
          <div className={itemStyles.row}>
            {changingItem && (
              <Button size="sm" onClick={() => setChangingItem(false)}>
                {t('common.cancel')}
              </Button>
            )}
            {!isLegacy && !state.catalog && (
              <Button size="sm" variant="ghost" onClick={() => patch({ freeMode: true, category: state.category === '' ? 'OUTRO' : state.category })}>
                {t('itemForm.freeName')}
              </Button>
            )}
          </div>
        </div>
      )}

      {state.freeMode && !state.catalog && (
        <div className={itemStyles.grid}>
          <Select
            label={t('itemForm.category')}
            name="category"
            value={state.category}
            error={errors.category}
            onChange={(value) => patch({ category: value as Category })}
            options={FREE_NAME_CATEGORIES.map((cat) => ({ value: cat, label: categoryText(cat) }))}
          />
          <TextField
            label={t('itemForm.name')}
            name="name"
            value={state.name}
            error={errors.name}
            onChange={(value) => {
              patch({ name: value });
              clearError('name');
            }}
          />
          <div className={itemStyles.full}>
            <Button size="sm" variant="ghost" onClick={() => patch({ freeMode: false })}>
              {t('itemForm.backToCatalog')}
            </Button>
          </div>
        </div>
      )}

      {/* Atributos de arma */}
      {vis.weapon && (
        <div className={itemStyles.grid}>
          <Select
            label={t('itemForm.variant')}
            name="variant"
            value={state.variant === '' ? 'NORMAL' : state.variant}
            error={errors.variant}
            onChange={(value) => patch({ variant: value as Variant })}
            options={variantOptions(category, state.catalog, state.variant).map((v) => ({ value: v, label: tLoose(`enums.variant.${v}`) }))}
          />
          <NumberField
            kind="float"
            label={t('itemForm.floatValue')}
            name="floatValue"
            value={state.floatText}
            error={errors.floatValue}
            hint={floatHint}
            onValueChange={(text) => {
              patch({ floatText: text });
              clearError('floatValue');
            }}
          />
          {vis.exteriorInput ? (
            <Select
              label={t('itemForm.exterior')}
              name="exterior"
              value={state.exterior === '' ? NO_EXTERIOR : state.exterior}
              error={errors.exterior}
              onChange={(value) => patch({ exterior: value === NO_EXTERIOR ? '' : (value as Exterior) })}
              options={[
                { value: NO_EXTERIOR, label: t('common.none') },
                ...ALL_EXTERIORS.map((x) => ({ value: x, label: tLoose(`enums.exterior.${x}`) })),
              ]}
            />
          ) : (
            <TextField
              label={t('itemForm.exterior')}
              name="exterior"
              value=""
              disabled
              readOnly
              error={errors.exterior}
              hint={t('itemForm.exteriorDerived')}
              onChange={() => undefined}
            />
          )}
          <NumberField
            kind="integer"
            label={t('itemForm.paintSeed')}
            name="paintSeed"
            value={state.paintSeedText}
            error={errors.paintSeed}
            onValueChange={(text) => {
              patch({ paintSeedText: text });
              clearError('paintSeed');
            }}
          />
          <TextField
            label={t('itemForm.phase')}
            name="phase"
            value={vis.phaseLocked ? state.catalog?.phase ?? '' : state.phase}
            disabled={vis.phaseLocked}
            error={errors.phase}
            hint={vis.phaseLocked ? t('itemForm.phaseFromCatalog') : null}
            onChange={(value) => patch({ phase: value })}
          />
        </div>
      )}
    </>
  );
}
