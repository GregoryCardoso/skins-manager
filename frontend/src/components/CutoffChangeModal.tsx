'use client';

import { useQuery } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import { isoToLocalInput, localInputToIso } from '@/lib/dateInput';
import { formatDateTime, formatMoney } from '@/lib/format';
import { queryKeys } from '@/lib/queryKeys';
import { previewCutoffChange } from '@/services/api';
import forms from './forms.module.css';
import Modal from './Modal';

interface Props {
  currentCutoffAt: string;
  busy: boolean;
  error: string | null;
  onConfirm: (cutoffAt: string) => void;
  onCancel: () => void;
}

// Mudar a data de corte (9.5.1c, D325): a data nova, a pré-visualização local do efeito (sem rede) e a confirmação. Ao confirmar,
// o app roda uma importação manual com varredura completa; o corte só é gravado se a leitura der certo.
export default function CutoffChangeModal({ currentCutoffAt, busy, error, onConfirm, onCancel }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const language = useLanguage();
  const dateId = useId();
  const [text, setText] = useState(isoToLocalInput(currentCutoffAt));
  const iso = localInputToIso(text);
  const changed = iso !== null && Date.parse(iso) !== Date.parse(currentCutoffAt);
  const future = iso !== null && Date.parse(iso) > Date.now();

  const previewQuery = useQuery({
    queryKey: queryKeys.imports.cutoffPreview(iso),
    queryFn: ({ signal }) => previewCutoffChange(iso as string, signal),
    enabled: changed && !future,
    gcTime: 0,
  });
  const preview = changed && !future ? previewQuery.data ?? null : null;
  const usd = (cents: number) => formatMoney(cents, 'USD', language);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (iso && changed && !future) onConfirm(iso);
  };

  return (
    <Modal title={t('imports.cutoffChange.title')} onClose={onCancel} busy={busy} wide>
      <form className={forms.form} onSubmit={submit} noValidate>
        <p>{t('imports.cutoffChange.current', { date: formatDateTime(currentCutoffAt, language) })}</p>
        <label className={forms.field} htmlFor={dateId}>
          <span>{t('imports.cutoffChange.newDate')}</span>
          <input className={forms.input} id={dateId} type="datetime-local" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} autoFocus />
          {iso === null && <span className={forms.error}>{t('imports.launch.dateInvalid')}</span>}
          {future && <span className={forms.error}>{tLoose('errors.DATE_IN_FUTURE')}</span>}
        </label>
        <ul className={forms.hint}>
          <li>{t('imports.cutoffChange.backwardHelp')}</li>
          <li>{t('imports.cutoffChange.forwardHelp')}</li>
          <li>{t('imports.cutoffChange.undoHelp')}</li>
        </ul>

        {changed && !future && previewQuery.isFetching && <p className={forms.muted}>{t('common.loading')}</p>}
        {previewQuery.error !== null && changed && <div className={forms.topError} role="alert">{errorMessageFor(previewQuery.error, tLoose, language)}</div>}
        {preview?.backward && (
          <div className={forms.note} role="status" data-testid="cutoff-preview-backward">
            <p><strong>{t('imports.cutoffChange.previewTitle')}</strong></p>
            <p>{t('imports.cutoffChange.upToPurchases', { count: preview.backward.purchases.count, value: usd(preview.backward.purchases.amountCents) })}</p>
            <p>{t('imports.cutoffChange.upToSales', { count: preview.backward.sales.count, value: usd(preview.backward.sales.amountCents) })}</p>
            {preview.backward.mayHaveUnseen && <p>{t('imports.cutoffChange.mayHaveUnseen')}</p>}
            {(preview.backward.manualLaunches.purchases + preview.backward.manualLaunches.sales) > 0 && (
              <p>{t('imports.cutoffChange.manualLaunches', { purchases: preview.backward.manualLaunches.purchases, sales: preview.backward.manualLaunches.sales })}</p>
            )}
            {preview.backward.deposits.length > 0 && (
              <div className={forms.topError} role="alert">
                <p>{tPlural('imports.cutoffChange.depositsWarning', preview.backward.deposits.length)}</p>
                <ul>
                  {preview.backward.deposits.map((d) => (
                    <li key={d.id}>{formatDateTime(d.depositedAt, language)}{d.amountStoreCents !== null ? ` — ${usd(d.amountStoreCents)}` : ''}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {preview?.forward && (
          <div className={forms.note} role="status" data-testid="cutoff-preview-forward">
            <p><strong>{t('imports.cutoffChange.previewTitle')}</strong></p>
            <p>{t('imports.cutoffChange.importedKept', { count: preview.forward.importedKept })}</p>
            <p>{t('imports.cutoffChange.openToClose', { count: preview.forward.openToClose })}</p>
          </div>
        )}

        {error && <div className={forms.topError} role="alert">{error}</div>}
        <div className={forms.actions}>
          <button type="button" className={forms.button} onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className={`${forms.button} ${forms.primary}`} disabled={busy || !changed || future || iso === null}>
            {busy ? t('imports.running') : t('imports.cutoffChange.confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
