'use client';

import { useLanguage, useT } from '@/i18n/I18nProvider';
import {
  MAX_STICKERS, STICKER_SLOTS, newStickerDraft,
  type ComponentCatalogChoice, type ComponentsState, type HangingKind, type StickerDraft,
} from '@/lib/itemComponents';
import type { CatalogItem } from '@/types/api';
import CatalogAutocomplete, { catalogDisplayName } from './CatalogAutocomplete';
import FormField from './FormField';
import styles from './forms.module.css';
import sectionStyles from './ItemComponentsSection.module.css';
import ItemImage from './ItemImage';

interface Props {
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
function Chosen({ choice, kind, onClear, disabled }: { choice: ComponentCatalogChoice; kind: 'STICKER' | 'PINGENTE'; onClear: () => void; disabled: boolean }) {
  const t = useT();
  const language = useLanguage();
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
export default function ItemComponentsSection({ state, onChange, error = null, disabled = false }: Props) {
  const t = useT();
  const { stickers, hanging } = state;

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
      <legend className={styles.label}>{t('itemForm.components.title')}</legend>
      <p className={styles.muted}>{t('itemForm.components.costNote')}</p>
      {error && <div className={styles.error} role="alert">{error}</div>}

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
        </div>
      )}
    </fieldset>
  );
}
