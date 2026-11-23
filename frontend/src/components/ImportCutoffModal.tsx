'use client';

import { useId, useState, type FormEvent } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { nowLocalInput } from '@/lib/dateInput';
import { suggestionToInputValue, validateCutoffInput } from '@/lib/importCutoff';
import forms from './forms.module.css';
import Modal from './Modal';

interface Props {
  // Sugestão do backend (ISO): só o valor inicial do campo; o usuário pode mudar (D296).
  suggestedCutoffAt: string | null;
  busy: boolean;
  // Mensagem de erro já traduzida (ex.: falha da importação com este corte).
  error: string | null;
  onConfirm: (cutoffIso: string) => void;
  onCancel: () => void;
}

// Primeira importação do CSFloat (9.2, D296): "Já lancei à mão tudo até qual data?".
export default function ImportCutoffModal({ suggestedCutoffAt, busy, error, onConfirm, onCancel }: Props) {
  const t = useT();
  const fieldId = useId();
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

  return (
    <Modal title={t('imports.cutoff.title')} onClose={onCancel} busy={busy}>
      <form className={forms.form} onSubmit={submit} noValidate>
        <p>{t('imports.cutoff.help')}</p>
        <p>{t('imports.cutoff.baseDepositHint')}</p>
        <div className={forms.field}>
          <label htmlFor={fieldId} className={forms.label}>{t('imports.cutoff.question')}</label>
          <input
            id={fieldId}
            type="datetime-local"
            className={forms.input}
            value={value}
            max={nowLocalInput()}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={fieldError !== null}
            disabled={busy}
            autoFocus
          />
          {fieldError !== null && <span className={forms.error} role="alert">{fieldError}</span>}
          {suggestedCutoffAt === null && <span className={forms.hint}>{t('imports.cutoff.noSuggestion')}</span>}
        </div>
        {error !== null && <div className={forms.topError} role="alert">{error}</div>}
        <div className={forms.actions}>
          <button type="button" className={forms.button} onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className={`${forms.button} ${forms.primary}`} disabled={busy}>
            {busy ? t('imports.running') : t('imports.cutoff.confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
