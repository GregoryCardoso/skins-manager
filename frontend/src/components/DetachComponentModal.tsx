'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { dateToLocalInput, localInputToIso, nowLocalInput } from '@/lib/dateInput';
import { formatDate, formatMoney } from '@/lib/format';
import { formatCentsInput, normalizeNumberText } from '@/lib/numberInput';
import { queryKeys } from '@/lib/queryKeys';
import { useInvalidate } from '@/lib/useInvalidate';
import { ApiRequestError, detachComponent, getDetachPreview } from '@/services/api';
import { itemDisplayName, itemEnglishTitle } from '@/lib/itemName';
import type { DetachBody, ItemView } from '@/types/api';
import itemStyles from './item/item.module.css';
import ItemImage from './ItemImage';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import FormErrorSummary, { type FormErrorItem } from './ui/FormErrorSummary';
import NumberField from './ui/NumberField';
import Spinner from './ui/Spinner';
import TextField from './ui/TextField';

interface Props {
  item: ItemView;
  // Pendurado a separar (M7: vindo da seção de componentes). Ausente: o primeiro separável da arma.
  componentId?: number;
  onClose: () => void;
  onDone: (message: string) => void;
  onGone: () => void;
}

const FIELDS = ['detachedAt', 'hangingShareBp', 'tradeUnlockAt', 'note'] as const;

// Porcentagem digitada ("33,33" / "33.33") -> pontos-base (0 a 10000). Inválido -> null.
function parseShareText(text: string, locale: string): number | null {
  const normalized = normalizeNumberText(text, locale);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return bp <= 10000 ? bp : null;
}

// "Separar" o chaveiro ou o Sticker Slab da arma (10.7, D366). Dois modos, definidos pelo backend: devolver a unidade do estoque que
// foi aplicada (RETURN) ou criar uma unidade nova dividindo o custo da arma pelos valores avaliados (SPLIT). Todos os números vêm da
// prévia do backend; aqui não se calcula nada. Não muda o lucro real nem o saldo das lojas.
export default function DetachComponentModal({ item, componentId, onClose, onDone, onGone }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const component = item.components.find((c) => c.detachable && (componentId === undefined || c.id === componentId)) ?? null;

  const [shareText, setShareText] = useState<string | null>(null);
  const shareBp = shareText === null || shareText.trim() === '' ? null : parseShareText(shareText, locale);
  const shareInvalid = shareText !== null && shareText.trim() !== '' && shareBp === null;

  const previewQuery = useQuery({
    queryKey: queryKeys.items.detachPreview(item.id, component?.id ?? 0, shareBp),
    queryFn: ({ signal }) => getDetachPreview(item.id, component?.id ?? 0, shareBp, signal),
    enabled: component !== null && !shareInvalid,
    placeholderData: (previous) => previous,
  });
  const preview = previewQuery.data ?? null;

  const [typedAt, setTypedAt] = useState<string | null>(null);
  const detachedAtText = typedAt ?? nowLocalInput();
  const [tradeLockText, setTradeLockText] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const formId = useId();

  const split = preview?.mode === 'SPLIT';
  const suggestion = preview?.suggestion ?? null;
  const needsShare = split && suggestion === null;
  // Texto mostrado no campo: o digitado ou, sem digitar, a sugestão.
  const shownShare = shareText ?? (suggestion ? formatCentsInput(suggestion.hangingShareBp, locale) : '');
  const usd = (cents: number | null) => (cents === null ? t('common.none') : formatMoney(cents, 'USD', locale));
  const hangingName = component ? (component.localizedName ?? component.name) : '';

  const clearError = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'ITEM_NOT_FOUND') {
      onGone();
      return;
    }
    const message = errorMessageFor(err, tLoose, locale);
    const field = err instanceof ApiRequestError && err.field ? err.field : null;
    if (field && (FIELDS as readonly string[]).includes(field)) {
      setErrors({ [field]: message });
      setAttempt((n) => n + 1);
      setTopError(null);
    } else {
      setErrors({});
      setTopError(message);
    }
    // O estoque pode ter mudado em outra aba: recarrega as telas.
    if (err instanceof ApiRequestError && ['ITEM_NOT_IN_STOCK', 'ITEM_CONSUMED', 'COMPONENT_NOT_FOUND', 'COMPONENT_NOT_DETACHABLE'].includes(err.code)) {
      invalidate('item.detachComponent');
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving || !component || !preview) return;
    setTopError(null);
    const next: Partial<Record<string, string>> = {};
    const detachedAt = localInputToIso(detachedAtText);
    if (detachedAt === null) next.detachedAt = t('errors.INVALID_DATE');
    let tradeUnlockAt: string | null = null;
    if (tradeLockText.trim() !== '') {
      tradeUnlockAt = localInputToIso(tradeLockText);
      if (tradeUnlockAt === null) next.tradeUnlockAt = t('errors.INVALID_DATE');
    }
    if (split) {
      if (shareInvalid) next.hangingShareBp = t('detachForm.shareInvalid');
      else if (needsShare && shareBp === null) next.hangingShareBp = t('detachForm.shareRequired');
    }
    if (Object.keys(next).length > 0 || detachedAt === null) {
      setErrors(next);
      setAttempt((n) => n + 1);
      return;
    }
    setErrors({});
    const body: DetachBody = { detachedAt };
    if (tradeUnlockAt) body.tradeUnlockAt = tradeUnlockAt;
    if (note.trim() !== '') body.note = note.trim();
    if (split && shareBp !== null) body.hangingShareBp = shareBp;
    setSaving(true);
    detachComponent(item.id, component.id, body)
      .then(() => {
        invalidate('item.detachComponent');
        onDone(t(preview.mode === 'RETURN' ? 'detachForm.successReturn' : 'detachForm.successSplit', { name: hangingName, weapon: itemDisplayName(item) }));
      })
      .catch((err: unknown) => {
        setSaving(false);
        showApiError(err);
      });
  };

  const unavailable = useMemo(
    () => (preview?.suggestionUnavailableReason ? t(`detachForm.unavailable.${preview.suggestionUnavailableReason}`) : null),
    [preview, t],
  );

  const fieldLabel = (field: string): string => {
    switch (field) {
      case 'hangingShareBp': return t('detachForm.share');
      case 'tradeUnlockAt': return t('detachForm.tradeLock');
      case 'note': return t('detachForm.note');
      default: return t('detachForm.detachedAt');
    }
  };
  const summaryItems: FormErrorItem[] = FIELDS
    .filter((field) => errors[field])
    .map((field) => ({ field, label: fieldLabel(field), message: errors[field] as string }));

  return (
    <Dialog
      title={t('detachForm.title', { name: itemDisplayName(item) })}
      size="md"
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" loading={saving} disabled={!component || !preview || shareInvalid}>
            {saving ? t('common.saving') : t('detachForm.submit')}
          </Button>
        </>
      }
    >
      <form id={formId} className={itemStyles.form} onSubmit={submit} noValidate>
        <FormErrorSummary key={attempt} errors={summaryItems} />
        {topError && <Banner tone="danger">{topError}</Banner>}
        {!component && <Banner tone="info" announce={false}>{t('detachForm.nothing')}</Banner>}
        {component && (
          <>
            <div className={itemStyles.chosen}>
              <ItemImage category={component.kind === 'CHARM' ? 'PINGENTE' : 'STICKER'} url={component.imageUrl} size={40} />
              <div className={itemStyles.chosenText}>
                <strong className={itemStyles.chosenName}>{hangingName}</strong>
                {component.pattern !== null && <span className={itemStyles.muted}>{t('detachForm.pattern', { n: component.pattern })}</span>}
              </div>
            </div>
            {previewQuery.isPending && <Spinner size="sm" />}
            {previewQuery.error && (
              <Banner tone="danger" onRetry={() => { void previewQuery.refetch(); }}>{errorMessageFor(previewQuery.error, tLoose, locale)}</Banner>
            )}

            {preview && preview.mode === 'RETURN' && (
              <Banner tone="info" announce={false}>
                <span className={itemStyles.noteBlock}>
                  <span>{t('detachForm.returnIntro', { name: preview.detached.name })}</span>
                  {preview.result && (
                    <span>{t('detachForm.returnResult', { unit: usd(preview.result.detachedUsdCents), weapon: usd(preview.result.weaponUsdCents) })}</span>
                  )}
                </span>
              </Banner>
            )}

            {preview && split && (
              <>
                <p className={itemStyles.muted}>{t('detachForm.splitIntro')}</p>
                <Banner tone="info" announce={false}>
                  <span className={itemStyles.noteBlock}>
                    <span>{t('detachForm.cost', { value: `${preview.weapon.estimated ? '≈ ' : ''}${usd(preview.weapon.effectiveUsdCents)}` })}</span>
                    {suggestion ? (
                      <>
                        <span>
                          {t('detachForm.valued', {
                            date: suggestion.pricedAt ? formatDate(suggestion.pricedAt, locale) : '',
                            weapon: usd(suggestion.basePriceCents),
                            hanging: usd(suggestion.hangingPriceCents),
                            total: usd(preview.valuedTotalUsdCents),
                            share: formatCentsInput(suggestion.hangingShareBp, locale),
                          })}
                        </span>
                        {suggestion.isStale && <span>{t('detachForm.stale')}</span>}
                      </>
                    ) : (
                      unavailable && <span>{unavailable}</span>
                    )}
                  </span>
                </Banner>
                <NumberField
                  kind="decimal"
                  label={t('detachForm.share')}
                  name="hangingShareBp"
                  suggestAmbiguous={false}
                  value={shownShare}
                  error={errors.hangingShareBp}
                  required={needsShare}
                  hint={needsShare ? t('detachForm.shareRequiredHint') : t('detachForm.shareHint')}
                  disabled={saving}
                  onValueChange={(text) => {
                    setShareText(text);
                    clearError('hangingShareBp');
                  }}
                />
                {preview.result && (
                  <Banner tone="success" announce={false}>
                    {t('detachForm.result', { weapon: usd(preview.result.weaponUsdCents), unit: usd(preview.result.detachedUsdCents) })}
                  </Banner>
                )}
              </>
            )}

            <div className={itemStyles.grid}>
              <TextField
                label={t('detachForm.detachedAt')}
                name="detachedAt"
                type="datetime-local"
                max={dateToLocalInput(new Date())}
                value={detachedAtText}
                error={errors.detachedAt}
                disabled={saving}
                onChange={(value) => {
                  setTypedAt(value);
                  clearError('detachedAt');
                }}
              />
              <TextField
                label={t('detachForm.tradeLock')}
                name="tradeUnlockAt"
                type="datetime-local"
                value={tradeLockText}
                error={errors.tradeUnlockAt}
                hint={t('detachForm.tradeLockHint')}
                disabled={saving}
                onChange={(value) => {
                  setTradeLockText(value);
                  clearError('tradeUnlockAt');
                }}
              />
            </div>
            <TextField
              label={t('detachForm.note')}
              name="note"
              optional
              value={note}
              maxLength={500}
              error={errors.note}
              disabled={saving}
              onChange={setNote}
            />
            <p className={itemStyles.muted}>{t('detachForm.profitUnchanged')}</p>
          </>
        )}
      </form>
    </Dialog>
  );
}
