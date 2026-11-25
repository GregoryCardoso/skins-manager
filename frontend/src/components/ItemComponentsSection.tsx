'use client';

import { useLanguage, useLocale, useT } from '@/i18n/I18nProvider';
import {
  MAX_PATCHES, MAX_STICKERS, PATCH_SLOTS, STICKER_SLOTS, newPatchDraft, newStickerDraft,
  type ComponentCatalogChoice, type ComponentsState, type HangingKind, type PatchDraft, type StickerDraft,
} from '@/lib/itemComponents';
import type { CatalogItem, Category } from '@/types/api';
import AppliedComponentsEditor from './AppliedComponentsEditor';
import CatalogAutocomplete, { catalogDisplayName } from './CatalogAutocomplete';
import FormField from './FormField';
import styles from './forms.module.css';
import sectionStyles from './ItemComponentsSection.module.css';
import ItemImage from './ItemImage';

interface Props {
  // Unidade em edição (para desfazer ou remover um componente aplicado); ausente no cadastro.
  itemId?: number;
  // Arma (stickers e pendurado) ou agente (patches).
  category: Category | '';
  onItemChanged?: (message: string) => void;
  // "Separar" o pendurado (M7): abre o modal de separação com o id do componente. `cameWithHangingId`: o pendurado que veio junto, separável.
  onDetach?: (componentId: number) => void;
  cameWithHangingId?: number | null;
  state: ComponentsState;
  onChange: (next: ComponentsState) => void;
  // Erro do campo `components` (local ou do backend).
  error?: string | null;
  disabled?: boolean;
}

const toChoice = (item: CatalogItem): ComponentCatalogChoice => ({
  id: item.id, name: item.name, namePtBr: item.namePtBr, imageUrl: item.imageUrl,
});

// Escolhido no catálogo: imagem, nome e botão para trocar.
function Chosen({ choice, kind, onClear, disabled }: { choice: ComponentCatalogChoice; kind: 'STICKER' | 'PINGENTE' | 'PATCH'; onClear: () => void; disabled: boolean }) {
  const t = useT();
  const language = useLanguage();
  const locale = useLocale();
  return (
    <div className={sectionStyles.chosen}>
      <ItemImage category={kind} url={choice.imageUrl} size={32} />
      <strong className={sectionStyles.chosenName}>{catalogDisplayName(choice, language)}</strong>
      <button type="button" className={`${styles.button} ${styles.small}`} onClick={onClear} disabled={disabled}>
        {t('itemForm.components.change')}
      </button>
    </div>
  );
}

// Seção "Stickers e chaveiro" do formulário de item (só SKIN, 10.1). Não muda o custo.
export default function ItemComponentsSection({ itemId, category, onItemChanged, onDetach, cameWithHangingId = null, state, onChange, error = null, disabled = false }: Props) {
  const t = useT();
  const { stickers, hanging, patches } = state;
  const isAgent = category === 'PERSONAGEM';

  const updatePatch = (key: string, partial: Partial<PatchDraft>) =>
    onChange({ ...state, patches: patches.map((p) => (p.key === key ? { ...p, ...partial } : p)) });

  const updateSticker = (key: string, partial: Partial<StickerDraft>) =>
    onChange({ ...state, stickers: stickers.map((s) => (s.key === key ? { ...s, ...partial } : s)) });
  const removeSticker = (key: string) => onChange({ ...state, stickers: stickers.filter((s) => s.key !== key) });
  const addSticker = () => onChange({ ...state, stickers: [...stickers, newStickerDraft()] });

  const setHangingKind = (value: string) => {
    if (value === '') {
      onChange({ ...state, hanging: null });
      return;
    }
    const kind = value as HangingKind;
    // Trocar o tipo troca a categoria do catálogo (chaveiro = pingente, slab = sticker): o item escolhido não vale mais.
    onChange({ ...state, hanging: { kind, catalog: hanging?.kind === kind ? hanging.catalog : null, patternText: hanging?.patternText ?? '' } });
  };

  return (
    <fieldset className={`${styles.details} ${sectionStyles.section}`} disabled={disabled}>
      <legend className={styles.label}>{t(isAgent ? 'itemForm.components.patchesTitle' : 'itemForm.components.title')}</legend>
      <p className={styles.muted}>{t('itemForm.components.costNote')}</p>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {isAgent && (
        <>
          <h4 className={sectionStyles.heading}>{t('itemForm.components.patches', { count: patches.length, max: MAX_PATCHES })}</h4>
          {patches.length === 0 && <p className={styles.muted}>{t('itemForm.components.noPatches')}</p>}
          {patches.map((draft, index) => (
            <div key={draft.key} className={sectionStyles.row}>
              <div className={sectionStyles.pick}>
                {draft.catalog ? (
                  <Chosen choice={draft.catalog} kind="PATCH" disabled={disabled} onClear={() => updatePatch(draft.key, { catalog: null })} />
                ) : (
                  <CatalogAutocomplete
                    label={t('itemForm.components.searchPatch', { n: index + 1 })}
                    fixedCategory="PATCH"
                    hideRefresh
                    onSelect={(item) => updatePatch(draft.key, { catalog: toChoice(item) })}
                  />
                )}
              </div>
              <FormField label={t('itemForm.components.patchSlot')}>
                {(c) => (
                  <select {...c} className={styles.select} value={draft.slot} onChange={(e) => updatePatch(draft.key, { slot: e.target.value })}>
                    <option value="">{t('common.none')}</option>
                    {PATCH_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                  </select>
                )}
              </FormField>
              <span />
              <button
                type="button"
                className={`${styles.button} ${styles.small} ${sectionStyles.remove}`}
                onClick={() => onChange({ ...state, patches: patches.filter((p) => p.key !== draft.key) })}
                aria-label={t('itemForm.components.removePatch', { n: index + 1 })}
              >
                {t('itemForm.components.remove')}
              </button>
            </div>
          ))}
          <div className={styles.row}>
            <button type="button" className={`${styles.button} ${styles.small}`} onClick={() => onChange({ ...state, patches: [...patches, newPatchDraft()] })} disabled={patches.length >= MAX_PATCHES}>
              {t('itemForm.components.addPatch')}
            </button>
          </div>
        </>
      )}
      {!isAgent && (
      <>
      <h4 className={sectionStyles.heading}>{t('itemForm.components.stickers', { count: stickers.length, max: MAX_STICKERS })}</h4>
      {stickers.length === 0 && <p className={styles.muted}>{t('itemForm.components.noStickers')}</p>}
      {stickers.map((draft, index) => (
        <div key={draft.key} className={sectionStyles.row}>
          <div className={sectionStyles.pick}>
            {draft.catalog ? (
              <Chosen choice={draft.catalog} kind="STICKER" disabled={disabled} onClear={() => updateSticker(draft.key, { catalog: null })} />
            ) : (
              <CatalogAutocomplete
                label={t('itemForm.components.searchSticker', { n: index + 1 })}
                fixedCategory="STICKER"
                hideRefresh
                onSelect={(item) => updateSticker(draft.key, { catalog: toChoice(item) })}
              />
            )}
          </div>
          <FormField label={t('itemForm.components.slot')}>
            {(c) => (
              <select {...c} className={styles.select} value={draft.slot} onChange={(e) => updateSticker(draft.key, { slot: e.target.value })}>
                <option value="">{t('common.none')}</option>
                {STICKER_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
              </select>
            )}
          </FormField>
          <FormField label={t('itemForm.components.wear')}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                inputMode="decimal"
                placeholder={t('itemForm.components.wearPlaceholder')}
                value={draft.wearText}
                onChange={(e) => updateSticker(draft.key, { wearText: e.target.value })}
              />
            )}
          </FormField>
          <button
            type="button"
            className={`${styles.button} ${styles.small} ${sectionStyles.remove}`}
            onClick={() => removeSticker(draft.key)}
            aria-label={t('itemForm.components.removeSticker', { n: index + 1 })}
          >
            {t('itemForm.components.remove')}
          </button>
        </div>
      ))}
      <div className={styles.row}>
        <button type="button" className={`${styles.button} ${styles.small}`} onClick={addSticker} disabled={stickers.length >= MAX_STICKERS}>
          {t('itemForm.components.addSticker')}
        </button>
        {stickers.length >= MAX_STICKERS && <span className={styles.muted}>{t('itemForm.components.limitReached', { max: MAX_STICKERS })}</span>}
      </div>

      <h4 className={sectionStyles.heading}>{t('itemForm.components.hanging')}</h4>
      <FormField label={t('itemForm.components.hangingKind')}>
        {(c) => (
          <select {...c} className={styles.select} value={hanging?.kind ?? ''} onChange={(e) => setHangingKind(e.target.value)}>
            <option value="">{t('itemForm.components.hangingNone')}</option>
            <option value="CHARM">{t('itemForm.components.kindCharm')}</option>
            <option value="STICKER_SLAB">{t('itemForm.components.kindSlab')}</option>
          </select>
        )}
      </FormField>
      {hanging && (
        <div className={sectionStyles.row}>
          <div className={sectionStyles.pick}>
            {hanging.catalog ? (
              <Chosen
                choice={hanging.catalog}
                kind={hanging.kind === 'CHARM' ? 'PINGENTE' : 'STICKER'}
                disabled={disabled}
                onClear={() => onChange({ ...state, hanging: { ...hanging, catalog: null } })}
              />
            ) : (
              <CatalogAutocomplete
                key={hanging.kind}
                label={t(hanging.kind === 'CHARM' ? 'itemForm.components.searchCharm' : 'itemForm.components.searchSlab')}
                fixedCategory={hanging.kind === 'CHARM' ? 'PINGENTE' : 'STICKER'}
                hideRefresh
                onSelect={(item) => onChange({ ...state, hanging: { ...hanging, catalog: toChoice(item) } })}
              />
            )}
          </div>
          <FormField label={t('itemForm.components.pattern')}>
            {(c) => (
              <input
                {...c}
                className={styles.input}
                inputMode="numeric"
                value={hanging.patternText}
                onChange={(e) => onChange({ ...state, hanging: { ...hanging, patternText: e.target.value } })}
              />
            )}
          </FormField>
          {onDetach && cameWithHangingId !== null && (
            <button type="button" className={`${styles.button} ${styles.small}`} onClick={() => onDetach(cameWithHangingId)} disabled={disabled}>
              {t('inventory.actions.detach')}
            </button>
          )}
        </div>
      )}
      </>
      )}
      {itemId !== undefined && onItemChanged && (
        <AppliedComponentsEditor itemId={itemId} state={state} onChange={onChange} onItemChanged={onItemChanged} onDetach={onDetach} disabled={disabled} />
      )}
    </fieldset>
  );
}
