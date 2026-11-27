'use client';

import { useState, type FormEvent } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { localInputToIso } from '@/lib/dateInput';
import { suggestionToInputValue, validateCutoffInput } from '@/lib/importCutoff';
import CutoffTimeline from './imports/CutoffTimeline';
import styles from './imports/importModals.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import TextField from './ui/TextField';

interface Props {
  // Sugestão do backend (ISO): só o valor inicial do campo; o usuário pode mudar (D296).
  suggestedCutoffAt: string | null;
  busy: boolean;
  // Mensagem de erro já traduzida (ex.: falha da importação com este corte).
  error: string | null;
  onConfirm: (cutoffIso: string) => void;
  onCancel: () => void;
}

const FORM_ID = 'import-cutoff-form';

// Primeira importação do CSFloat (9.2, D296; 12.9): "Já lancei à mão tudo até qual data?", com a linha do tempo da data escolhida.
export default function ImportCutoffModal({ suggestedCutoffAt, busy, error, onConfirm, onCancel }: Props) {
  const t = useT();
  const [value, setValue] = useState(() => suggestionToInputValue(suggestedCutoffAt));
  const [fieldError, setFieldError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateCutoffInput(value, new Date());
    if (!result.ok) {
      setFieldError(
        result.reason === 'EMPTY' ? t('errors.IMPORT_CUTOFF_REQUIRED') : result.reason === 'FUTURE' ? t('errors.DATE_IN_FUTURE') : t('errors.INVALID_DATE'),
      );
      return;
    }
    setFieldError(null);
    onConfirm(result.iso);
  };

  const chosenIso = localInputToIso(value);

  return (
    <Dialog
      title={t('imports.cutoff.title')}
      onClose={onCancel}
      busy={busy}
      footer={(
        <>
          <Button onClick={onCancel} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={busy}>{busy ? t('imports.running') : t('imports.cutoff.confirm')}</Button>
        </>
      )}
    >
      <form id={FORM_ID} className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.help}>{t('imports.cutoff.help')}</p>
        <TextField
          label={t('imports.cutoff.question')}
          type="datetime-local"
          value={value}
          onChange={setValue}
          error={fieldError}
          hint={suggestedCutoffAt === null ? t('imports.cutoff.noSuggestion') : t('imports.cutoff.baseDepositHint')}
          disabled={busy}
          autoFocus
          full
        />
        <CutoffTimeline current={chosenIso} />
        {error !== null && <Banner tone="danger">{error}</Banner>}
      </form>
    </Dialog>
  );
}
