'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { dateToLocalInput, isoToLocalInput, localInputToIso, nowLocalInput } from '@/lib/dateInput';
import { formatDate, formatMoney } from '@/lib/format';
import { MAX_PATTERN, MAX_STICKERS, PATCH_SLOTS, STICKER_SLOTS, parseWearText } from '@/lib/itemComponents';
import { parseIntegerInput } from '@/lib/numberInput';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, applyComponent, getApplyCandidates, getItem, resolveImportEntry } from '@/services/api';
import type { ApplyCandidate, ApplyCandidates, ComponentKind, ImportResolveBody } from '@/types/api';
import itemStyles from './item/item.module.css';
import ItemImage from './ItemImage';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import FormErrorSummary, { type FormErrorItem } from './ui/FormErrorSummary';
import { HoldingBadge, TradeLockBadge } from './ui/Badge';
import NumberField from './ui/NumberField';
import Select from './ui/Select';
import Spinner from './ui/Spinner';
import TextField from './ui/TextField';

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
const NO_SLOT = '__none__';
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
      itemId: source.id, kind, catalogId: source.catalogId ?? '', name: source.name, localizedName: source.catalog?.localizedName ?? null,
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
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const formId = useId();

  const full = data && kind ? data.remaining[REMAINING_KEY[kind]] <= 0 : false;
  const limitKey = kind === 'STICKER' ? 'STICKER' : kind === 'PATCH' ? 'PATCH' : 'HANGING';
  const chosen = options.find((c) => c.itemId === sourceId) ?? null;
  const displayName = (c: ApplyCandidate) => (c.localizedName ?? c.name);

  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

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
      setAttempt((n) => n + 1);
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
      setAttempt((n) => n + 1);
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
  const candidateImageCategory = (c: ApplyCandidate) => (c.kind === 'CHARM' ? 'PINGENTE' : c.kind === 'PATCH' ? 'PATCH' : 'STICKER');
  const candidateLabel = (c: ApplyCandidate) => {
    const parts = [displayName(c), t('applyForm.cost', { value: costText(c) }), formatDate(c.acquiredAt, locale)];
    if (c.tradeLocked) parts.push(t('applyForm.tradeLock'));
    if (c.offSale) parts.push(t('applyForm.holding'));
    return parts.join(' · ');
  };
  const fieldLabel = (field: string): string => {
    switch (field) {
      case 'sourceItemId': return t('applyForm.pick');
      case 'slot': return kind === 'PATCH' ? t('itemForm.components.patchSlot') : t('applyForm.slot');
      case 'wear': return t('applyForm.wear');
      case 'pattern': return t('applyForm.pattern');
      default: return t('applyForm.appliedAt');
    }
  };
  const summaryItems: FormErrorItem[] = FIELDS
    .filter((field) => errors[field])
    .map((field) => ({ field, label: fieldLabel(field), message: errors[field] as string }));

  return (
    <Dialog
      title={t('applyForm.title', { name: target.name })}
      size="md"
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" loading={saving} disabled={sourceId === null || full || !kind}>
            {saving ? t('common.saving') : retro ? t('applyForm.submitRetro') : t('applyForm.submit')}
          </Button>
        </>
      }
    >
      <form id={formId} className={itemStyles.form} onSubmit={submit} noValidate>
        <FormErrorSummary key={attempt} errors={summaryItems} />
        {topError && <Banner tone="danger">{topError}</Banner>}
        <p className={itemStyles.muted}>{retro ? t('applyForm.retroIntro') : t('applyForm.intro')}</p>

        {loading && <Spinner size="sm" />}
        {loadError && (
          <Banner tone="danger" onRetry={() => { void (retro ? retroSourceQuery.refetch() : candidatesQuery.refetch()); }}>
            {errorMessageFor(loadError, tLoose, locale)}
          </Banner>
        )}
        {!loading && !loadError && available.length === 0 && (
          <Banner tone="info" announce={false}>{retro ? t('applyForm.unitGone') : t('applyForm.noCandidates')}</Banner>
        )}

        {kind && (
          <>
            {!retro && available.length > 1 && (
              <Select
                label={t('applyForm.kind')}
                name="kind"
                value={kind}
                disabled={saving}
                onChange={(value) => {
                  setChosenKind(value as ComponentKind);
                  setChosenId(null);
                }}
                options={available.map((k) => ({ value: k, label: t(`applyForm.kinds.${k}`) }))}
              />
            )}
            {full && <Banner tone="warning" announce={false}>{t(`applyForm.limit.${limitKey}`)}</Banner>}

            {options.length > 1 && (
              <Select
                label={t('applyForm.pick')}
                name="sourceItemId"
                value={String(sourceId ?? '')}
                error={errors.sourceItemId}
                disabled={saving}
                onChange={(value) => setChosenId(Number(value))}
                options={options.map((c) => ({ value: String(c.itemId), label: candidateLabel(c) }))}
              />
            )}
            {chosen && (
              <div className={itemStyles.chosen}>
                <ItemImage category={candidateImageCategory(chosen)} url={chosen.imageUrl} size={36} />
                <div className={itemStyles.chosenText}>
                  <strong className={itemStyles.chosenName}>{displayName(chosen)}</strong>
                  <span className={itemStyles.muted}>{t('applyForm.cost', { value: costText(chosen) })} · {formatDate(chosen.acquiredAt, locale)}</span>
                </div>
                {chosen.tradeLocked && <TradeLockBadge />}
                {chosen.offSale && <HoldingBadge />}
              </div>
            )}
            {options.length <= 1 && errors.sourceItemId && <span className={itemStyles.fieldError} role="alert" data-field="sourceItemId" tabIndex={-1}>{errors.sourceItemId}</span>}

            <div className={itemStyles.grid}>
              {kind !== 'CHARM' && kind !== 'STICKER_SLAB' && (
                <Select
                  label={kind === 'PATCH' ? t('itemForm.components.patchSlot') : t('applyForm.slot')}
                  name="slot"
                  value={slot === '' ? NO_SLOT : slot}
                  error={errors.slot}
                  disabled={saving}
                  onChange={(value) => setSlot(value === NO_SLOT ? '' : value)}
                  options={[{ value: NO_SLOT, label: t('common.none') }, ...slots.map((value) => ({ value: String(value), label: String(value) }))]}
                />
              )}
              {kind === 'STICKER' && (
                <NumberField
                  kind="decimal"
                  label={t('applyForm.wear')}
                  name="wear"
                  placeholder={t('itemForm.components.wearPlaceholder')}
                  suggestAmbiguous={false}
                  value={wearText}
                  error={errors.wear}
                  disabled={saving}
                  onValueChange={(text) => {
                    setWearText(text);
                    clearError('wear');
                  }}
                />
              )}
              {(kind === 'CHARM' || kind === 'STICKER_SLAB') && (
                <NumberField
                  kind="integer"
                  label={t('applyForm.pattern')}
                  name="pattern"
                  value={patternText}
                  error={errors.pattern}
                  disabled={saving}
                  onValueChange={(text) => {
                    setPatternText(text);
                    clearError('pattern');
                  }}
                />
              )}
              <TextField
                label={t('applyForm.appliedAt')}
                name="appliedAt"
                type="datetime-local"
                max={maxLocal || dateToLocalInput(new Date())}
                value={appliedAtText}
                error={errors.appliedAt}
                hint={retro && soldAt ? t('applyForm.retroLimit', { date: formatDate(soldAt, locale) }) : null}
                disabled={saving}
                onChange={(value) => {
                  setAppliedAtText(value);
                  clearError('appliedAt');
                }}
              />
            </div>
          </>
        )}
      </form>
    </Dialog>
  );
}
