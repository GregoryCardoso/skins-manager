'use client';

import { useId, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLanguage, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatDate, formatRate } from '@/lib/format';
import { formatDecimalInput, parseDecimalInput } from '@/lib/numberInput';
import { usePreferences } from './PreferencesProvider';
import styles from './settings.module.css';

// Cotação USD→BRL na tela de configurações (D147, D152): edição manual e "atualizar cotação" pela PTAX de venda.
export default function FxRateSettings() {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const { usdBrlRate, fxSource, ptaxQuotedAt, saveFxRate, refreshFxFromPtax } = usePreferences();
  const inputId = useId();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const busy = saving || refreshing;
  const shownText = touched ? text : usdBrlRate !== null ? formatDecimalInput(usdBrlRate, language) : '';

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    const rate = parseDecimalInput(shownText, language);
    if (rate === null) {
      setError(t('fx.invalidInput'));
      setOk(null);
      return;
    }
    setSaving(true);
    setError(null);
    setOk(null);
    saveFxRate(rate)
      .then(() => {
        setTouched(false);
        setOk(t('settings.fx.saved'));
      })
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, language)))
      .finally(() => setSaving(false));
  };

  const onRefresh = () => {
    setRefreshing(true);
    setError(null);
    setOk(null);
    refreshFxFromPtax()
      .then((result) => {
        setTouched(false);
        setOk(
          t('settings.fx.refreshed', {
            date: formatDate(result.ptax.quotedAt, language),
            rate: formatRate(result.ptax.rate, language),
          }),
        );
      })
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, language)))
      .finally(() => setRefreshing(false));
  };

  return (
    <section className={styles.card} aria-labelledby="settings-fx-title">
      <h2 id="settings-fx-title" className={styles.cardTitle}>{t('settings.fx.title')}</h2>

      <div className={styles.row}>
        <span className={styles.big}>
          {usdBrlRate !== null ? t('settings.fx.value', { rate: formatRate(usdBrlRate, language) }) : t('settings.fx.notSet')}
        </span>
        {fxSource && (
          <span className={styles.tag}>
            {t('settings.fx.sourceLabel')}: {t(`settings.fx.source.${fxSource}`)}
            {fxSource === 'PTAX' && ptaxQuotedAt ? ` · ${t('settings.fx.ptaxDate', { date: formatDate(ptaxQuotedAt, language) })}` : ''}
          </span>
        )}
      </div>

      <form className={styles.form} onSubmit={onSave}>
        <div className={styles.field}>
          <label htmlFor={inputId} className={styles.label}>{t('settings.fx.manualLabel')}</label>
          <input
            id={inputId}
            className={styles.input}
            value={shownText}
            onChange={(e) => {
              setText(e.target.value);
              setTouched(true);
            }}
            inputMode="decimal"
            aria-invalid={error !== null}
            disabled={busy}
          />
        </div>
        <button type="submit" className={styles.button} disabled={busy}>
          {saving ? t('fx.saving') : t('settings.fx.save')}
        </button>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onRefresh} disabled={busy}>
          {refreshing ? t('settings.fx.refreshing') : t('settings.fx.refreshPtax')}
        </button>
      </form>

      <p className={styles.muted}>{t('settings.fx.note')}</p>
      {ok && <p className={styles.ok} role="status">{ok}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
