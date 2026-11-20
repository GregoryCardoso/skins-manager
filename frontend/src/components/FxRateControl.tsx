'use client';

import { useId, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDecimalInput, parseDecimalInput } from '@/lib/numberInput';
import { formatRate } from '@/lib/format';
import styles from './FxRateControl.module.css';
import { usePreferences } from './PreferencesProvider';

// Cotação USD→BRL no cabeçalho com edição rápida (D107). A conversão em si é sempre do backend.
export default function FxRateControl() {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const { usdBrlRate, saveFxRate } = usePreferences();
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setText(usdBrlRate !== null ? formatDecimalInput(usdBrlRate, language) : '');
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const rate = parseDecimalInput(text, language);
    if (rate === null) {
      setError(t('fx.invalidInput'));
      return;
    }
    setSaving(true);
    setError(null);
    saveFxRate(rate)
      .then(() => setEditing(false))
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose)))
      .finally(() => setSaving(false));
  };

  if (!editing) {
    return (
      <div className={styles.root}>
        <span className={styles.value} title={t('fx.label')}>
          {usdBrlRate !== null
            ? t('fx.value', { rate: formatRate(usdBrlRate, language) })
            : t('fx.notSet')}
        </span>
        <button type="button" className={styles.button} onClick={startEdit}>{t('fx.edit')}</button>
      </div>
    );
  }

  return (
    <form className={styles.root} onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && cancel()}>
      <label htmlFor={inputId} className={styles.label}>{t('fx.label')}</label>
      <input
        id={inputId}
        className={styles.input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        inputMode="decimal"
        autoFocus
        aria-invalid={error !== null}
        disabled={saving}
      />
      <button type="submit" className={styles.button} disabled={saving}>{saving ? t('fx.saving') : t('fx.save')}</button>
      <button type="button" className={styles.button} onClick={cancel} disabled={saving}>{t('fx.cancel')}</button>
      {error && <span className={styles.error} role="alert">{error}</span>}
    </form>
  );
}
