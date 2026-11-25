'use client';

import { useId, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { formatRate } from '@/lib/format';
import { describeFxRate } from '@/lib/fxDisplay';
import { formatDecimalInput, parseDecimalInput } from '@/lib/numberInput';
import { usePreferences } from './PreferencesProvider';
import styles from './settings.module.css';

// Cotação USD→BRL na tela de configurações (D152, D162): edição manual, fonte do botão (salva na hora) e "atualizar cotação".
export default function FxRateSettings() {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const {
    usdBrlRate, fxSource, rateQuotedAt, fxRateUpdatedAt, fxRefreshSource, saveFxRate, saveFxRefreshSource, refreshFxRate,
  } = usePreferences();
  const sourceId = useId();
  const inputId = useId();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [savingSource, setSavingSource] = useState(false);

  const busy = saving || refreshing || savingSource;
  const shownText = touched ? text : usdBrlRate !== null ? formatDecimalInput(usdBrlRate, locale) : '';

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    const rate = parseDecimalInput(shownText, locale);
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
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setSaving(false));
  };

  const onRefresh = () => {
    setRefreshing(true);
    setError(null);
    setOk(null);
    refreshFxRate()
      .then((result) => {
        setTouched(false);
        if (!result.quote) return; // o botão manual sempre traz a cotação; só a atualização ao abrir é pulada
        setOk(
          t('settings.fx.refreshed', {
            source: tLoose(`fx.sourceName.${result.quote.source}`),
            rate: formatRate(result.quote.rate, locale),
          }),
        );
      })
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setRefreshing(false));
  };

  const onChangeSource = (value: string) => {
    if (value !== 'AWESOMEAPI' && value !== 'PTAX') return;
    setSavingSource(true);
    setError(null);
    setOk(null);
    saveFxRefreshSource(value)
      .then(() => setOk(t('settings.fx.refreshSourceSaved')))
      .catch((err: unknown) => setError(errorMessageFor(err, tLoose, locale)))
      .finally(() => setSavingSource(false));
  };

  return (
    <section className={styles.card} aria-labelledby="settings-fx-title">
      <h2 id="settings-fx-title" className={styles.cardTitle}>{t('settings.fx.title')}</h2>

      <div className={styles.row}>
        <span className={styles.big}>
          {usdBrlRate !== null ? t('settings.fx.value', { rate: formatRate(usdBrlRate, locale) }) : t('settings.fx.notSet')}
        </span>
      </div>
      {usdBrlRate !== null && (
        <p className={styles.muted} data-testid="fx-description">
          {describeFxRate(
            { rate: usdBrlRate, source: fxSource, quotedAt: rateQuotedAt, updatedAt: fxRateUpdatedAt },
            locale,
            tLoose,
          )}
        </p>
      )}

      <div className={styles.field}>
        <label htmlFor={sourceId} className={styles.label}>{t('settings.fx.refreshSourceLabel')}</label>
        <select
          id={sourceId}
          className={styles.input}
          value={fxRefreshSource}
          onChange={(e) => onChangeSource(e.target.value)}
          disabled={busy}
        >
          <option value="AWESOMEAPI">{t('settings.fx.refreshSource.AWESOMEAPI')}</option>
          <option value="PTAX">{t('settings.fx.refreshSource.PTAX')}</option>
        </select>
        {/* D338: com uma fonte automática, a cotação é atualizada sozinha ao abrir o app; a digitada à mão, não. */}
        <p className={styles.muted} data-testid="fx-auto-refresh-hint">
          {fxSource === 'MANUAL' ? t('settings.fx.autoRefreshPausedManual') : t('settings.fx.autoRefreshHint')}
        </p>
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
          {refreshing ? t('settings.fx.refreshing') : t('settings.fx.refresh')}
        </button>
      </form>

      <p className={styles.muted}>{t('settings.fx.note')}</p>
      {ok && <p className={styles.ok} role="status">{ok}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
