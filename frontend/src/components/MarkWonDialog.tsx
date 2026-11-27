'use client';

import { useState, type FormEvent } from 'react';
import { useT, useTPlural } from '@/i18n/I18nProvider';
import { localInputToIso } from '@/lib/dateInput';
import styles from './imports/importModals.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import SegmentedControl from './ui/SegmentedControl';
import TextField from './ui/TextField';

interface Props {
  count: number;
  busy: boolean;
  error: string | null;
  // `acquiredAt` nulo = a data da venda de cada uma (D328).
  onConfirm: (acquiredAt: string | null) => void;
  onCancel: () => void;
}

const FORM_ID = 'mark-won-form';

// "Foi drop (ganhei)" (9.5.1b, D328; 12.9), de uma ou de várias pendências: custo 0, sem trade lock, venda registrada na hora.
export default function MarkWonDialog({ count, busy, error, onConfirm, onCancel }: Props) {
  const t = useT();
  const tPlural = useTPlural();
  const [mode, setMode] = useState<'SALE' | 'OTHER'>('SALE');
  const [date, setDate] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'SALE') {
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
    <Dialog
      title={t('imports.won.title')}
      size="sm"
      onClose={onCancel}
      busy={busy}
      footer={(
        <>
          <Button onClick={onCancel} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={busy}>{busy ? t('common.saving') : t('imports.won.confirm')}</Button>
        </>
      )}
    >
      <form id={FORM_ID} className={styles.form} onSubmit={submit} noValidate>
        <p>{tPlural('imports.won.body', count)}</p>
        <SegmentedControl
          label={t('imports.won.title')}
          value={mode}
          onChange={setMode}
          disabled={busy}
          options={[
            { value: 'SALE', label: t('imports.won.saleDate') },
            { value: 'OTHER', label: t('imports.won.customDate') },
          ]}
        />
        {mode === 'OTHER' && (
          <TextField label={t('imports.won.acquiredAt')} type="datetime-local" value={date} onChange={setDate} error={dateError} disabled={busy} autoFocus full />
        )}
        <p className={styles.help}>{t('imports.won.turnoverHint', { days: tPlural('common.dayCount', 0) })}</p>
        {error && <Banner tone="danger">{error}</Banner>}
      </form>
    </Dialog>
  );
}
