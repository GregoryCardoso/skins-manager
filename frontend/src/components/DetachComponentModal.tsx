'use client';

import { useMemo, useState, type FormEvent } from 'react';
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
import FormField from './FormField';
import styles from './forms.module.css';
import ItemImage from './ItemImage';
import Modal from './Modal';

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
  const [saving, setSaving] = useState(false);

  const split = preview?.mode === 'SPLIT';
  const suggestion = preview?.suggestion ?? null;
  const needsShare = split && suggestion === null;
  // Texto mostrado no campo: o digitado ou, sem digitar, a sugestão.
  const shownShare = shareText ?? (suggestion ? formatCentsInput(suggestion.hangingShareBp, locale) : '');
  const usd = (cents: number | null) => (cents === null ? t('common.none') : formatMoney(cents, 'USD', locale));
  const hangingName = component ? (component.localizedName ?? component.name) : '';

  const showApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.code === 'ITEM_NOT_FOUND') {
      onGone();
      return;
    }
    const message = errorMessageFor(err, tLoose, locale);
    const field = err instanceof ApiRequestError && err.field ? err.field : null;
    if (field && (FIELDS as readonly string[]).includes(field)) {
      setErrors({ [field]: message });
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

  return (
    <Modal title={t('detachForm.title', { name: itemDisplayName(item) })} onClose={onClose} busy={saving}>
      <form className={styles.form} onSubmit={submit} noValidate>
        {topError && <div className={styles.topError} role="alert">{topError}</div>}
        {!component && <div className={styles.note} role="status">{t('detachForm.nothing')}</div>}
        {component && (
          <>
            <div className={styles.row}>
              <ItemImage category={component.kind === 'CHARM' ? 'PINGENTE' : 'STICKER'} url={component.imageUrl} size={40} />
              <strong>{hangingName}</strong>
              {component.pattern !== null && <span className={styles.muted}>{t('detachForm.pattern', { n: component.pattern })}</span>}
            </div>
            {previewQuery.isPending && <p className={styles.muted}>{t('common.loading')}</p>}
            {previewQuery.error && <div className={styles.topError} role="alert">{errorMessageFor(previewQuery.error, tLoose, locale)}</div>}

            {preview && preview.mode === 'RETURN' && (
              <div className={styles.note} role="status">
                <p>{t('detachForm.returnIntro', { name: preview.detached.name })}</p>
                {preview.result && (
                  <p>{t('detachForm.returnResult', { unit: usd(preview.result.detachedUsdCents), weapon: usd(preview.result.weaponUsdCents) })}</p>
                )}
              </div>
            )}

            {preview && split && (
              <>
                <p className={styles.muted}>{t('detachForm.splitIntro')}</p>
                <div className={styles.note} role="status">
                  <p>{t('detachForm.cost', { value: `${preview.weapon.estimated ? '≈ ' : ''}${usd(preview.weapon.effectiveUsdCents)}` })}</p>
                  {suggestion ? (
                    <>
                      <p>
                        {t('detachForm.valued', {
                          date: suggestion.pricedAt ? formatDate(suggestion.pricedAt, locale) : '',
                          weapon: usd(suggestion.basePriceCents),
                          hanging: usd(suggestion.hangingPriceCents),
                          total: usd(preview.valuedTotalUsdCents),
                          share: formatCentsInput(suggestion.hangingShareBp, locale),
                        })}
                      </p>
                      {suggestion.isStale && <p>{t('detachForm.stale')}</p>}
                    </>
                  ) : (
                    unavailable && <p>{unavailable}</p>
                  )}
                </div>
                <FormField
                  label={t('detachForm.share')}
                  error={errors.hangingShareBp}
                  hint={needsShare ? t('detachForm.shareRequiredHint') : t('detachForm.shareHint')}
                >
                  {(c) => (
                    <input
                      {...c}
                      className={styles.input}
                      inputMode="decimal"
                      value={shownShare}
                      onChange={(e) => setShareText(e.target.value)}
                      disabled={saving}
                    />
                  )}
                </FormField>
                {preview.result && (
                  <div className={styles.note} role="status">
                    {t('detachForm.result', { weapon: usd(preview.result.weaponUsdCents), unit: usd(preview.result.detachedUsdCents) })}
                  </div>
                )}
              </>
            )}

            <div className={styles.grid}>
              <FormField label={t('detachForm.detachedAt')} error={errors.detachedAt}>
                {(c) => (
                  <input
                    {...c}
                    type="datetime-local"
                    className={styles.input}
                    max={dateToLocalInput(new Date())}
                    value={detachedAtText}
                    onChange={(e) => setTypedAt(e.target.value)}
                    disabled={saving}
                  />
                )}
              </FormField>
              <FormField label={t('detachForm.tradeLock')} error={errors.tradeUnlockAt} hint={t('detachForm.tradeLockHint')}>
                {(c) => (
                  <input {...c} type="datetime-local" className={styles.input} value={tradeLockText} onChange={(e) => setTradeLockText(e.target.value)} disabled={saving} />
                )}
              </FormField>
            </div>
            <FormField label={t('detachForm.note')} error={errors.note}>
              {(c) => <input {...c} className={styles.input} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} disabled={saving} />}
            </FormField>
            <p className={styles.muted}>{t('detachForm.profitUnchanged')}</p>
          </>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onClose} disabled={saving}>{t('common.cancel')}</button>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={saving || !component || !preview || shareInvalid}>
            {saving ? t('common.saving') : t('detachForm.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
