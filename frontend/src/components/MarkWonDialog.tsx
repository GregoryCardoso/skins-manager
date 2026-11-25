'use client';

import { useId, useState, type FormEvent } from 'react';
import { useT, useTPlural } from '@/i18n/I18nProvider';
import { localInputToIso } from '@/lib/dateInput';
import forms from './forms.module.css';
import Modal from './Modal';

interface Props {
  count: number;
  busy: boolean;
  error: string | null;
  // `acquiredAt` nulo = a data da venda de cada uma (D328).
  onConfirm: (acquiredAt: string | null) => void;
  onCancel: () => void;
}

// "Foi drop (ganhei)" (9.5.1b, D328), de uma ou de várias pendências: custo 0, sem trade lock, venda registrada na hora.
export default function MarkWonDialog({ count, busy, error, onConfirm, onCancel }: Props) {
  const t = useT();
  const tPlural = useTPlural();
  const dateId = useId();
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!custom) {
      onConfirm(null);
      return;
    }
    const iso = localInputToIso(date);
    if (iso === null) {
      setDateError(t('imports.launch.dateRequired'));
      return;
    }
    setDateError(null);
    onConfirm(iso);
  };

  return (
    <Modal title={t('imports.won.title')} onClose={onCancel} busy={busy}>
      <form className={forms.form} onSubmit={submit} noValidate>
        <p>{tPlural('imports.won.body', count)}</p>
        <label className={forms.radioRow}>
          <input type="radio" name="won-date" checked={!custom} onChange={() => setCustom(false)} disabled={busy} />
          {t('imports.won.saleDate')}
        </label>
        <label className={forms.radioRow}>
          <input type="radio" name="won-date" checked={custom} onChange={() => setCustom(true)} disabled={busy} />
          {t('imports.won.customDate')}
        </label>
        {custom && (
          <label className={forms.field} htmlFor={dateId}>
            <span>{t('imports.won.acquiredAt')}</span>
            <input className={forms.input} id={dateId} type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
            {dateError && <span className={forms.error}>{dateError}</span>}
          </label>
        )}
        <p className={forms.hint}>{t('imports.won.turnoverHint', { days: tPlural('common.dayCount', 0) })}</p>
        {error && <div className={forms.topError} role="alert">{error}</div>}
        <div className={forms.actions}>
          <button type="button" className={forms.button} onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className={`${forms.button} ${forms.primary}`} disabled={busy}>
            {busy ? t('common.saving') : t('imports.won.confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
