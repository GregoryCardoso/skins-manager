'use client';

import { useState } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { PATCH_SLOTS, STICKER_SLOTS, type AppliedDraft, type ComponentsState } from '@/lib/itemComponents';
import { useInvalidate } from '@/lib/useInvalidate';
import { scrapeOffComponent, undoOperation } from '@/services/api';
import type { ItemComponent } from '@/types/api';
import { Badge } from './badges';
import ConfirmDialog from './ConfirmDialog';
import FormField from './FormField';
import styles from './forms.module.css';
import sectionStyles from './ItemComponentsSection.module.css';
import ItemImage from './ItemImage';

interface Props {
  itemId: number;
  state: ComponentsState;
  onChange: (next: ComponentsState) => void;
  // Depois de desfazer ou remover, o item mudou: o formulário fecha com a mensagem (as edições não salvas se perdem).
  onItemChanged: (message: string) => void;
  // "Separar" o pendurado aplicado (M7), com o id do componente.
  onDetach?: (componentId: number) => void;
  disabled?: boolean;
}

type Pending = { kind: 'undo' | 'scrape'; component: ItemComponent };

// Componentes aplicados do estoque (10.3, D362): só leitura, menos posição, desgaste e pattern. "Desfazer aplicação" corrige um
// lançamento errado (a unidade volta ao estoque); "Remover para sempre" tira sticker ou patch da arma e o custo continua no item.
export default function AppliedComponentsEditor({ itemId, state, onChange, onItemChanged, onDetach, disabled = false }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (state.applied.length === 0) return null;

  const update = (id: number, partial: Partial<AppliedDraft>) =>
    onChange({ ...state, applied: state.applied.map((a) => (a.component.id === id ? { ...a, ...partial } : a)) });

  const confirm = () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const { kind, component } = pending;
    const call = kind === 'undo'
      ? undoOperation(component.operationId ?? 0).then(() => invalidate('operation.undo'))
      : scrapeOffComponent(itemId, component.id).then(() => invalidate('item.scrapeOff'));
    call
      .then(() => {
        setPending(null);
        onItemChanged(t(kind === 'undo' ? 'operations.undoDone' : 'operations.scrapeDone'));
      })
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setBusy(false));
  };

  return (
    <fieldset className={`${styles.details} ${sectionStyles.section}`} disabled={disabled}>
      <legend className={styles.label}>{t('itemForm.components.appliedTitle')}</legend>
      <p className={styles.muted}>{t('itemForm.components.appliedNote')}</p>
      {state.applied.map((draft) => {
        const { component } = draft;
        const name = component.localizedName ?? component.name;
        const isSticker = component.kind === 'STICKER';
        const isHanging = component.kind === 'CHARM' || component.kind === 'STICKER_SLAB';
        const slots = component.kind === 'PATCH' ? PATCH_SLOTS : STICKER_SLOTS;
        return (
          <div key={component.id} className={sectionStyles.row}>
            <div className={sectionStyles.chosen}>
              <ItemImage category={component.kind === 'CHARM' ? 'PINGENTE' : component.kind === 'PATCH' ? 'PATCH' : 'STICKER'} url={component.imageUrl} size={32} />
              <strong className={sectionStyles.chosenName}>{name}</strong>
              <Badge tone="info">{t('operations.appliedBadge')}</Badge>
            </div>
            {!isHanging ? (
              <FormField label={t('itemForm.components.slot')}>
                {(c) => (
                  <select {...c} className={styles.select} value={draft.slot} onChange={(e) => update(component.id, { slot: e.target.value })}>
                    <option value="">{t('common.none')}</option>
                    {slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                  </select>
                )}
              </FormField>
            ) : <span />}
            {isSticker && (
              <FormField label={t('itemForm.components.wear')}>
                {(c) => (
                  <input {...c} className={styles.input} inputMode="decimal" value={draft.wearText} onChange={(e) => update(component.id, { wearText: e.target.value })} />
                )}
              </FormField>
            )}
            {isHanging && (
              <FormField label={t('itemForm.components.pattern')}>
                {(c) => (
                  <input {...c} className={styles.input} inputMode="numeric" value={draft.patternText} onChange={(e) => update(component.id, { patternText: e.target.value })} />
                )}
              </FormField>
            )}
            <div className={sectionStyles.buttons}>
              <button
                type="button"
                className={`${styles.button} ${styles.small}`}
                disabled={!component.undoable}
                title={component.undoable ? undefined : t('errors.OPERATION_UNDO_BLOCKED')}
                onClick={() => { setError(null); setPending({ kind: 'undo', component }); }}
              >
                {t('operations.undo')}
              </button>
              {onDetach && component.detachable && (
                <button type="button" className={`${styles.button} ${styles.small}`} onClick={() => onDetach(component.id)}>
                  {t('inventory.actions.detach')}
                </button>
              )}
              {component.scrapeable && (
                <button type="button" className={`${styles.button} ${styles.small} ${styles.danger}`} onClick={() => { setError(null); setPending({ kind: 'scrape', component }); }}>
                  {t('operations.scrape')}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {pending && (
        <ConfirmDialog
          title={t(pending.kind === 'undo' ? 'operations.undoTitle' : 'operations.scrapeTitle')}
          message={t(pending.kind === 'undo' ? 'operations.undoMessage' : 'operations.scrapeMessage')}
          confirmLabel={t(pending.kind === 'undo' ? 'operations.undoConfirm' : 'operations.scrapeConfirm')}
          danger={pending.kind === 'scrape'}
          busy={busy}
          error={error}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </fieldset>
  );
}
