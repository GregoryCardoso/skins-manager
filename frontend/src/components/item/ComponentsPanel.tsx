'use client';

import { useState, type Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate } from '@/lib/format';
import { catalogDisplayName } from '@/lib/itemName';
import {
  MAX_PATCHES, MAX_STICKERS, PATCH_SLOTS, STICKER_SLOTS, newPatchDraft, newStickerDraft,
  type AppliedDraft, type ComponentCatalogChoice, type ComponentsState, type HangingKind, type PatchDraft, type StickerDraft,
} from '@/lib/itemComponents';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { listItemOperations, scrapeOffComponent, undoOperation } from '@/services/api';
import type { CatalogItem, Category, ItemComponent, ItemView } from '@/types/api';
import ItemImage from '../ItemImage';
import ItemOperationsList from '../ItemOperationsList';
import Badge from '../ui/Badge';
import Banner from '../ui/Banner';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import NumberField from '../ui/NumberField';
import Select from '../ui/Select';
import CatalogCombobox from './CatalogCombobox';
import styles from './item.module.css';

interface Props {
  // Unidade em edição; ausente no cadastro (só o editor dos que vieram junto).
  item?: ItemView;
  // Arma (stickers e pendurado) ou agente (patches).
  category: Category | '';
  state: ComponentsState;
  onChange: (next: ComponentsState) => void;
  // Erro do campo `components` (local ou do backend).
  error?: string | null;
  disabled?: boolean;
  // Há alteração não salva no formulário: as ações que gravam na hora ficam desabilitadas, com o motivo visível.
  dirty?: boolean;
  // Depois de desfazer ou remover, o item mudou: o formulário fecha com a mensagem.
  onItemChanged?: (message: string) => void;
  onApply?: (item: ItemView) => void;
  onDetach?: (item: ItemView, componentId: number) => void;
  // Para a entrada "Componentes" do menu: o formulário leva o foco e a rolagem até aqui.
  panelRef?: Ref<HTMLElement>;
}

const NO_SLOT = '__none__';

const toChoice = (item: CatalogItem): ComponentCatalogChoice => ({
  id: item.id, name: item.name, localizedName: item.localizedName, imageUrl: item.imageUrl,
});

// Escolhido no catálogo: imagem, nome e botão para trocar.
function Chosen({ choice, kind, onClear, disabled }: { choice: ComponentCatalogChoice; kind: 'STICKER' | 'PINGENTE' | 'PATCH'; onClear: () => void; disabled: boolean }) {
  const t = useT();
  return (
    <div className={styles.chosen}>
      <ItemImage category={kind} url={choice.imageUrl} size={32} />
      <strong className={`${styles.chosenText} ${styles.chosenName}`}>{catalogDisplayName(choice)}</strong>
      <Button size="sm" disabled={disabled} onClick={onClear}>
        {t('itemForm.components.change')}
      </Button>
    </div>
  );
}

function SlotSelect({ label, slots, value, onChange, disabled }: { label: string; slots: readonly number[]; value: string; onChange: (value: string) => void; disabled: boolean }) {
  const t = useT();
  return (
    <Select
      label={label}
      value={value === '' ? NO_SLOT : value}
      disabled={disabled}
      onChange={(next) => onChange(next === NO_SLOT ? '' : next)}
      options={[{ value: NO_SLOT, label: t('common.none') }, ...slots.map((slot) => ({ value: String(slot), label: String(slot) }))]}
    />
  );
}

type Pending = { kind: 'undo' | 'scrape'; component: ItemComponent };

// Painel único "Componentes" do formulário do item (12.6a). Reúne: o editor do que veio junto com a unidade (até 5 stickers + 1 pendurado
// na arma, até 3 patches no agente), a lista do que foi aplicado do estoque (origem e data) e as operações. As ações que gravam na hora
// (aplicar do estoque, separar, desfazer, remover) ficam desabilitadas com alteração pendente, para nenhuma edição se perder ao trocar
// de diálogo. Não muda o custo (o que muda o custo é a operação).
export default function ComponentsPanel({ item, category, state, onChange, error = null, disabled = false, dirty = false, onItemChanged, onApply, onDetach, panelRef }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const { stickers, hanging, patches, applied } = state;
  const isAgent = category === 'PERSONAGEM';
  const editing = item !== undefined;
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Mesma consulta da lista de operações (um pedido só): dá a data de cada aplicação.
  const operations = useQuery({
    queryKey: queryKeys.items.operations(item?.id ?? 0),
    queryFn: ({ signal }) => listItemOperations(item?.id ?? 0, signal),
    enabled: editing,
  });
  const dateOf = (component: ItemComponent): string | null => {
    const operation = operations.data?.find((o) => o.id === component.operationId);
    return operation ? formatDate(operation.occurredAt, locale) : null;
  };

  const reason = dirty ? t('itemForm.components.saveFirst') : null;
  const cameWithHangingId = item?.components.find((c) => c.detachable && c.origin === 'CAME_WITH')?.id ?? null;

  const updateSticker = (key: string, partial: Partial<StickerDraft>) =>
    onChange({ ...state, stickers: stickers.map((s) => (s.key === key ? { ...s, ...partial } : s)) });
  const updatePatch = (key: string, partial: Partial<PatchDraft>) =>
    onChange({ ...state, patches: patches.map((p) => (p.key === key ? { ...p, ...partial } : p)) });
  const updateApplied = (id: number, partial: Partial<AppliedDraft>) =>
    onChange({ ...state, applied: applied.map((a) => (a.component.id === id ? { ...a, ...partial } : a)) });

  const setHangingKind = (value: string) => {
    if (value === '') {
      onChange({ ...state, hanging: null });
      return;
    }
    const kind = value as HangingKind;
    // Trocar o tipo troca a categoria do catálogo (chaveiro = pingente, slab = sticker): o item escolhido não vale mais.
    onChange({ ...state, hanging: { kind, catalog: hanging?.kind === kind ? hanging.catalog : null, patternText: hanging?.patternText ?? '' } });
  };

  const confirm = () => {
    if (!pending) return;
    setBusy(true);
    setConfirmError(null);
    const { kind, component } = pending;
    const call = kind === 'undo'
      ? undoOperation(component.operationId ?? 0).then(() => invalidate('operation.undo'))
      : scrapeOffComponent(item?.id ?? 0, component.id).then(() => invalidate('item.scrapeOff'));
    call
      .then(() => {
        setPending(null);
        onItemChanged?.(t(kind === 'undo' ? 'operations.undoDone' : 'operations.scrapeDone'));
      })
      .catch((err: unknown) => setConfirmError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setBusy(false));
  };

  const removeButton = (label: string, onClick: () => void) => (
    <Button size="sm" variant="ghost" aria-label={label} disabled={disabled} onClick={onClick}>
      {t('itemForm.components.remove')}
    </Button>
  );

  return (
    <section ref={panelRef} tabIndex={-1} data-field="components" className={`${styles.section} ${styles.panel}`} aria-labelledby="components-panel-title">
      <h3 id="components-panel-title" className={styles.sectionTitle}>{t('itemForm.sections.components')}</h3>
      <p className={styles.muted}>{t('itemForm.components.costNote')}</p>
      {editing && <p className={styles.muted}>{t('itemForm.components.panelHint')}</p>}
      {error && <Banner tone="danger" announce={false}>{error}</Banner>}

      <h4 className={styles.heading}>{t('itemForm.components.originCameWith')}</h4>

      {isAgent ? (
        <>
          <h5 className={styles.origin}>{t('itemForm.components.patches', { count: patches.length, max: MAX_PATCHES })}</h5>
          {patches.length === 0 && <p className={styles.muted}>{t('itemForm.components.noPatches')}</p>}
          {patches.map((draft, index) => (
            <div key={draft.key} className={styles.componentRow}>
              <div>
                {draft.catalog ? (
                  <Chosen choice={draft.catalog} kind="PATCH" disabled={disabled} onClear={() => updatePatch(draft.key, { catalog: null })} />
                ) : (
                  <CatalogCombobox
                    label={t('itemForm.components.searchPatch', { n: index + 1 })}
                    fixedCategory="PATCH"
                    hideRefresh
                    onSelect={(picked) => updatePatch(draft.key, { catalog: toChoice(picked) })}
                  />
                )}
              </div>
              <SlotSelect label={t('itemForm.components.patchSlot')} slots={PATCH_SLOTS} value={draft.slot} disabled={disabled} onChange={(slot) => updatePatch(draft.key, { slot })} />
              <span />
              {removeButton(t('itemForm.components.removePatch', { n: index + 1 }), () => onChange({ ...state, patches: patches.filter((p) => p.key !== draft.key) }))}
            </div>
          ))}
          <div className={styles.row}>
            <Button size="sm" disabled={disabled || patches.length >= MAX_PATCHES} onClick={() => onChange({ ...state, patches: [...patches, newPatchDraft()] })}>
              {t('itemForm.components.addPatch')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <h5 className={styles.origin}>{t('itemForm.components.stickers', { count: stickers.length, max: MAX_STICKERS })}</h5>
          {stickers.length === 0 && <p className={styles.muted}>{t('itemForm.components.noStickers')}</p>}
          {stickers.map((draft, index) => (
            <div key={draft.key} className={styles.componentRow}>
              <div>
                {draft.catalog ? (
                  <Chosen choice={draft.catalog} kind="STICKER" disabled={disabled} onClear={() => updateSticker(draft.key, { catalog: null })} />
                ) : (
                  <CatalogCombobox
                    label={t('itemForm.components.searchSticker', { n: index + 1 })}
                    fixedCategory="STICKER"
                    hideRefresh
                    onSelect={(picked) => updateSticker(draft.key, { catalog: toChoice(picked) })}
                  />
                )}
              </div>
              <SlotSelect label={t('itemForm.components.slot')} slots={STICKER_SLOTS} value={draft.slot} disabled={disabled} onChange={(slot) => updateSticker(draft.key, { slot })} />
              <NumberField
                kind="decimal"
                label={t('itemForm.components.wear')}
                placeholder={t('itemForm.components.wearPlaceholder')}
                suggestAmbiguous={false}
                value={draft.wearText}
                disabled={disabled}
                onValueChange={(text) => updateSticker(draft.key, { wearText: text })}
              />
              {removeButton(t('itemForm.components.removeSticker', { n: index + 1 }), () => onChange({ ...state, stickers: stickers.filter((s) => s.key !== draft.key) }))}
            </div>
          ))}
          <div className={styles.row}>
            <Button size="sm" disabled={disabled || stickers.length >= MAX_STICKERS} onClick={() => onChange({ ...state, stickers: [...stickers, newStickerDraft()] })}>
              {t('itemForm.components.addSticker')}
            </Button>
            {stickers.length >= MAX_STICKERS && <span className={styles.muted}>{t('itemForm.components.limitReached', { max: MAX_STICKERS })}</span>}
          </div>

          <h5 className={styles.origin}>{t('itemForm.components.hanging')}</h5>
          <div className={styles.grid}>
            <Select
              label={t('itemForm.components.hangingKind')}
              value={hanging?.kind ?? NO_SLOT}
              disabled={disabled}
              onChange={(value) => setHangingKind(value === NO_SLOT ? '' : value)}
              options={[
                { value: NO_SLOT, label: t('itemForm.components.hangingNone') },
                { value: 'CHARM', label: t('itemForm.components.kindCharm') },
                { value: 'STICKER_SLAB', label: t('itemForm.components.kindSlab') },
              ]}
            />
          </div>
          {hanging && (
            <div className={styles.componentRow}>
              <div>
                {hanging.catalog ? (
                  <Chosen
                    choice={hanging.catalog}
                    kind={hanging.kind === 'CHARM' ? 'PINGENTE' : 'STICKER'}
                    disabled={disabled}
                    onClear={() => onChange({ ...state, hanging: { ...hanging, catalog: null } })}
                  />
                ) : (
                  <CatalogCombobox
                    key={hanging.kind}
                    label={t(hanging.kind === 'CHARM' ? 'itemForm.components.searchCharm' : 'itemForm.components.searchSlab')}
                    fixedCategory={hanging.kind === 'CHARM' ? 'PINGENTE' : 'STICKER'}
                    hideRefresh
                    onSelect={(picked) => onChange({ ...state, hanging: { ...hanging, catalog: toChoice(picked) } })}
                  />
                )}
              </div>
              <NumberField
                kind="integer"
                label={t('itemForm.components.pattern')}
                value={hanging.patternText}
                disabled={disabled}
                onValueChange={(text) => onChange({ ...state, hanging: { ...hanging, patternText: text } })}
              />
              <span />
              {item && onDetach && cameWithHangingId !== null && (
                <Button size="sm" disabled={disabled || dirty} onClick={() => onDetach(item, cameWithHangingId)}>
                  {t('inventory.actions.detach')}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {editing && applied.length > 0 && (
        <>
          <h4 className={styles.heading}>{t('itemForm.components.appliedTitle')}</h4>
          <p className={styles.muted}>{t('itemForm.components.appliedNote')}</p>
          {applied.map((draft) => {
            const { component } = draft;
            const name = component.localizedName ?? component.name;
            const isSticker = component.kind === 'STICKER';
            const isHanging = component.kind === 'CHARM' || component.kind === 'STICKER_SLAB';
            const date = dateOf(component);
            return (
              <div key={component.id} className={styles.componentRow}>
                <div className={styles.chosen}>
                  <ItemImage category={component.kind === 'CHARM' ? 'PINGENTE' : component.kind === 'PATCH' ? 'PATCH' : 'STICKER'} url={component.imageUrl} size={32} />
                  <div className={styles.chosenText}>
                    <strong className={styles.chosenName}>{name}</strong>
                    <Badge tone="info">{date ? t('itemForm.components.originApplied', { date }) : t('operations.appliedBadge')}</Badge>
                  </div>
                </div>
                {!isHanging ? (
                  <SlotSelect
                    label={t('itemForm.components.slot')}
                    slots={component.kind === 'PATCH' ? PATCH_SLOTS : STICKER_SLOTS}
                    value={draft.slot}
                    disabled={disabled}
                    onChange={(slot) => updateApplied(component.id, { slot })}
                  />
                ) : <span />}
                {isSticker && (
                  <NumberField
                    kind="decimal"
                    label={t('itemForm.components.wear')}
                    suggestAmbiguous={false}
                    value={draft.wearText}
                    disabled={disabled}
                    onValueChange={(text) => updateApplied(component.id, { wearText: text })}
                  />
                )}
                {isHanging && (
                  <NumberField
                    kind="integer"
                    label={t('itemForm.components.pattern')}
                    value={draft.patternText}
                    disabled={disabled}
                    onValueChange={(text) => updateApplied(component.id, { patternText: text })}
                  />
                )}
                {!isSticker && !isHanging && <span />}
                <div className={styles.rowButtons}>
                  <Button
                    size="sm"
                    disabled={disabled || dirty || !component.undoable}
                    onClick={() => { setConfirmError(null); setPending({ kind: 'undo', component }); }}
                  >
                    {t('operations.undo')}
                  </Button>
                  {onDetach && item && component.detachable && (
                    <Button size="sm" disabled={disabled || dirty} onClick={() => onDetach(item, component.id)}>
                      {t('inventory.actions.detach')}
                    </Button>
                  )}
                  {component.scrapeable && (
                    <Button size="sm" variant="danger" disabled={disabled || dirty} onClick={() => { setConfirmError(null); setPending({ kind: 'scrape', component }); }}>
                      {t('operations.scrape')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      {item && onApply && item.canReceiveComponents && (
        <div className={styles.actions}>
          <Button disabled={disabled || dirty} onClick={() => onApply(item)}>
            {t('inventory.actions.apply')}
          </Button>
        </div>
      )}
      {reason && <p className={styles.disabledReason} role="status">{reason}</p>}

      {item && <ItemOperationsList item={item} disabledReason={reason} />}

      {pending && (
        <ConfirmDialog
          title={t(pending.kind === 'undo' ? 'operations.undoTitle' : 'operations.scrapeTitle')}
          message={t(pending.kind === 'undo' ? 'operations.undoMessage' : 'operations.scrapeMessage')}
          confirmLabel={t(pending.kind === 'undo' ? 'operations.undoConfirm' : 'operations.scrapeConfirm')}
          tone={pending.kind === 'scrape' ? 'danger' : 'primary'}
          busy={busy}
          error={confirmError}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </section>
  );
}
