'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { dateToLocalInput, isoToLocalInput, localInputToIso, nowLocalInput } from '@/lib/dateInput';
import { formatDate, formatMoney } from '@/lib/format';
import { MAX_PATTERN, MAX_STICKERS, PATCH_SLOTS, STICKER_SLOTS, parseWearText } from '@/lib/itemComponents';
import { parseIntegerInput } from '@/lib/numberInput';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, applyComponent, getApplyCandidates, getItem, resolveImportEntry } from '@/services/api';
import type { ApplyCandidate, ApplyCandidates, ComponentKind, ImportResolveBody } from '@/types/api';
import { Badge } from './badges';
import FormField from './FormField';
import styles from './forms.module.css';
import ItemImage from './ItemImage';
import Modal from './Modal';
import modalStyles from './ApplyComponentModal.module.css';

// `stock`: o botão "Aplicar do estoque" de uma arma/agente em estoque. `retro`: a ação "Aplicar e registrar" da importação (E-P2-Q47),
// numa arma já vendida, com a unidade sugerida pelo aviso e a data limitada à da venda.
export type ApplyMode =
  | { type: 'stock' }
  | { type: 'retro'; entryId: number; sourceItemId: number };

interface Props {
  target: { id: number; name: string };
  mode: ApplyMode;
  onClose: () => void;
  onDone: (message: string) => void;
  onGone: () => void;
}

const FIELDS = ['sourceItemId', 'slot', 'wear', 'pattern', 'appliedAt'] as const;
const KIND_ORDER: ComponentKind[] = ['STICKER', 'CHARM', 'STICKER_SLAB', 'PATCH'];
const REMAINING_KEY: Record<ComponentKind, 'stickers' | 'hanging' | 'patches'> = {
  STICKER: 'stickers', CHARM: 'hanging', STICKER_SLAB: 'hanging', PATCH: 'patches',
};

// Tipo de componente de uma unidade do estoque (pela categoria do catálogo); o backend confere de novo.
function kindOfCategory(category: string, name: string): ComponentKind | null {
  if (category === 'STICKER') return 'STICKER';
  if (category === 'PINGENTE') return 'CHARM';
  if (category === 'PATCH') return 'PATCH';
  if (category === 'OUTRO' && name.startsWith('Sticker Slab | ')) return 'STICKER_SLAB';
  return null;
}

export default function ApplyComponentModal({ target, mode, onClose, onDone, onGone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const retro = mode.type === 'retro';

  const candidatesQuery = useQuery({
    queryKey: queryKeys.items.candidates(target.id),
    queryFn: ({ signal }) => getApplyCandidates(target.id, signal),
    enabled: !retro,
  });
  // Aplicação retroativa: a data da venda da arma limita a data da aplicação.
  const retroTargetQuery = useQuery({
    queryKey: queryKeys.items.retroTarget(target.id),
    queryFn: ({ signal }) => getItem(target.id, signal),
    enabled: retro,
  });
  const soldAt = retro ? retroTargetQuery.data?.soldAt ?? null : null;
  const retroSourceQuery = useQuery({
    queryKey: queryKeys.items.retroSource(mode.type === 'retro' ? mode.sourceItemId : 0),
    queryFn: ({ signal }) => getItem(mode.type === 'retro' ? mode.sourceItemId : 0, signal),
    enabled: retro,
  });

  // Uma lista só: as candidatas do backend ou, na aplicação retroativa, só a unidade do aviso.
  const data: ApplyCandidates | null = useMemo(() => {
    if (!retro) return candidatesQuery.data ?? null;
    const source = retroSourceQuery.data;
    if (!source) return null;
    const kind = kindOfCategory(source.category, source.name);
    if (!kind) return { allowedKinds: [], remaining: { stickers: 0, hanging: 0, patches: 0 }, candidates: [] };
    const candidate: ApplyCandidate = {
      itemId: source.id, kind, catalogId: source.catalogId ?? '', name: source.name, namePtBr: source.catalog?.namePtBr ?? null,
      imageUrl: source.catalog?.imageUrl ?? null, acquiredAt: source.acquiredAt, effectiveCostUsdCents: source.cost.effectiveUsdCents,
      costEstimated: source.cost.estimated, tradeLocked: source.tradeLock.isLocked, offSale: source.saleState === 'OFF_SALE',
    };
    return { allowedKinds: [kind], remaining: { stickers: MAX_STICKERS, hanging: 1, patches: 3 }, candidates: [candidate] };
  }, [retro, candidatesQuery.data, retroSourceQuery.data]);

  const available = useMemo(() => (data ? KIND_ORDER.filter((kind) => data.allowedKinds.includes(kind) && data.candidates.some((c) => c.kind === kind)) : []), [data]);
  const [chosenKind, setChosenKind] = useState<ComponentKind | null>(null);
  const kind = chosenKind && available.includes(chosenKind) ? chosenKind : available[0] ?? null;
  const options = useMemo(() => (data && kind ? data.candidates.filter((c) => c.kind === kind) : []), [data, kind]);
  const [chosenId, setChosenId] = useState<number | null>(null);
  const sourceId = chosenId !== null && options.some((c) => c.itemId === chosenId) ? chosenId : options[0]?.itemId ?? null;

  const maxLocal = retro ? isoToLocalInput(soldAt) : nowLocalInput();
  const [slot, setSlot] = useState('');
  const [wearText, setWearText] = useState('');
  const [patternText, setPatternText] = useState('');
  const [typedAt, setAppliedAtText] = useState<string | null>(null);
  const appliedAtText = typedAt ?? (retro ? isoToLocalInput(soldAt) : nowLocalInput());
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const full = data && kind ? data.remaining[REMAINING_KEY[kind]] <= 0 : false;
  const limitKey = kind === 'STICKER' ? 'STICKER' : kind === 'PATCH' ? 'PATCH' : 'HANGING';
  const chosen = options.find((c) => c.itemId === sourceId) ?? null;
  const displayName = (c: ApplyCandidate) => (language === 'pt-BR' ? c.namePtBr ?? c.name : c.name);

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'ITEM_NOT_FOUND') {
      onGone();
      return;
    }
    const message = errorMessageFor(err, tLoose, locale);
    const field = err instanceof ApiRequestError && err.field ? err.field : null;
    const mapped = field === 'components' ? 'wear' : field;
    if (mapped && (FIELDS as readonly string[]).includes(mapped)) {
      setErrors({ [mapped]: message });
      setTopError(null);
    } else {
      setErrors({});
      setTopError(message);
    }
    // A unidade pode ter saído do estoque em outra aba: recarrega as candidatas.
    if (err instanceof ApiRequestError && (err.code === 'ITEM_NOT_IN_STOCK' || err.code === 'ITEM_CONSUMED')) invalidate('item.applyComponent');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving || sourceId === null || kind === null || !chosen) return;
    setTopError(null);
    const next: Partial<Record<string, string>> = {};
    const appliedAt = localInputToIso(appliedAtText);
    if (appliedAt === null) next.appliedAt = t('errors.INVALID_DATE');
    const body: { slot?: number | null; wear?: number | null; pattern?: number | null } = {};
    if (slot !== '') body.slot = Number(slot);
    if (kind === 'STICKER' && wearText.trim() !== '') {
      const wear = parseWearText(wearText, locale);
      if (wear === null) next.wear = t('itemForm.components.invalidWear', { n: 1 });
      else body.wear = wear;
    }
    if ((kind === 'CHARM' || kind === 'STICKER_SLAB') && patternText.trim() !== '') {
      const pattern = parseIntegerInput(patternText);
      if (pattern === null || pattern > MAX_PATTERN) next.pattern = t('itemForm.components.invalidPattern');
      else body.pattern = pattern;
    }
    if (Object.keys(next).length > 0 || appliedAt === null) {
      setErrors(next);
      return;
    }
    setErrors({});
    setSaving(true);
    const done = () => {
      invalidate('item.applyComponent');
      onDone(t('applyForm.success', { name: displayName(chosen), target: target.name }));
    };
    const request = mode.type === 'retro'
      ? resolveImportEntry(mode.entryId, { action: 'APPLY_FROM_STOCK', sourceItemId: sourceId, appliedAt, ...body } satisfies ImportResolveBody).then(() => invalidate('import.resolve'))
      : applyComponent(target.id, { sourceItemId: sourceId, appliedAt, ...body });
    request
      .then(done)
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  const loading = retro ? retroSourceQuery.isPending || retroTargetQuery.isPending : candidatesQuery.isPending;
  const loadError = retro ? retroSourceQuery.error ?? retroTargetQuery.error : candidatesQuery.error;
  const slots = kind === 'PATCH' ? PATCH_SLOTS : STICKER_SLOTS;
  const costText = (c: ApplyCandidate) => `${c.costEstimated ? '≈ ' : ''}${formatMoney(c.effectiveCostUsdCents, 'USD', locale)}`;

  return (
    <Modal title={t('applyForm.title', { name: target.name })} onClose={onClose} busy={saving}>
      <form className={styles.form} onSubmit={submit} noValidate>
        {topError && <div className={styles.topError} role="alert">{topError}</div>}
        <p className={styles.muted}>{retro ? t('applyForm.retroIntro') : t('applyForm.intro')}</p>

        {loading && <p className={styles.muted}>{t('common.loading')}</p>}
        {loadError && <div className={styles.topError} role="alert">{errorMessageFor(loadError, tLoose, locale)}</div>}
        {!loading && !loadError && available.length === 0 && (
          <div className={styles.note} role="status">{retro ? t('applyForm.unitGone') : t('applyForm.noCandidates')}</div>
        )}

        {kind && (
          <>
            {!retro && available.length > 1 && (
              <FormField label={t('applyForm.kind')}>
                {(c) => (
                  <select {...c} className={styles.select} value={kind} onChange={(e) => { setChosenKind(e.target.value as ComponentKind); setChosenId(null); }}>
                    {available.map((k) => <option key={k} value={k}>{t(`applyForm.kinds.${k}`)}</option>)}
                  </select>
                )}
              </FormField>
            )}
            {full && <div className={styles.note} role="status">{t(`applyForm.limit.${limitKey}`)}</div>}

            <fieldset className={styles.details} disabled={saving}>
              <legend className={styles.label}>{t('applyForm.pick')}</legend>
              <ul className={modalStyles.list}>
                {options.map((c) => (
                  <li key={c.itemId} className={modalStyles.option}>
                    <label className={modalStyles.optionLabel}>
                      {options.length > 1 && (
                        <input type="radio" name="source" checked={c.itemId === sourceId} onChange={() => setChosenId(c.itemId)} />
                      )}
                      <ItemImage category={c.kind === 'CHARM' ? 'PINGENTE' : c.kind === 'PATCH' ? 'PATCH' : 'STICKER'} url={c.imageUrl} size={36} />
                      <span className={modalStyles.optionText}>
                        <strong>{displayName(c)}</strong>
                        <span className={styles.muted}>
                          {t('applyForm.cost', { value: costText(c) })} · {formatDate(c.acquiredAt, locale)}
                        </span>
                      </span>
                      {c.tradeLocked && <Badge tone="info" icon="🔒">{t('applyForm.tradeLock')}</Badge>}
                      {c.offSale && <Badge>{t('applyForm.holding')}</Badge>}
                    </label>
                  </li>
                ))}
              </ul>
              {errors.sourceItemId && <span className={styles.error} role="alert">{errors.sourceItemId}</span>}
            </fieldset>

            <div className={styles.grid}>
              {kind !== 'CHARM' && kind !== 'STICKER_SLAB' && (
                <FormField label={kind === 'PATCH' ? t('itemForm.components.patchSlot') : t('applyForm.slot')} error={errors.slot}>
                  {(c) => (
                    <select {...c} className={styles.select} value={slot} onChange={(e) => setSlot(e.target.value)}>
                      <option value="">{t('common.none')}</option>
                      {slots.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  )}
                </FormField>
              )}
              {kind === 'STICKER' && (
                <FormField label={t('applyForm.wear')} error={errors.wear}>
                  {(c) => (
                    <input {...c} className={styles.input} inputMode="decimal" placeholder={t('itemForm.components.wearPlaceholder')} value={wearText} onChange={(e) => setWearText(e.target.value)} />
                  )}
                </FormField>
              )}
              {(kind === 'CHARM' || kind === 'STICKER_SLAB') && (
                <FormField label={t('applyForm.pattern')} error={errors.pattern}>
                  {(c) => <input {...c} className={styles.input} inputMode="numeric" value={patternText} onChange={(e) => setPatternText(e.target.value)} />}
                </FormField>
              )}
              <FormField label={t('applyForm.appliedAt')} error={errors.appliedAt} hint={retro && soldAt ? t('applyForm.retroLimit', { date: formatDate(soldAt, locale) }) : null}>
                {(c) => (
                  <input
                    {...c}
                    type="datetime-local"
                    className={styles.input}
                    max={maxLocal || dateToLocalInput(new Date())}
                    value={appliedAtText}
                    onChange={(e) => setAppliedAtText(e.target.value)}
                  />
                )}
              </FormField>
            </div>
          </>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={saving || sourceId === null || full || !kind}>
            {saving ? t('common.saving') : retro ? t('applyForm.submitRetro') : t('applyForm.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
