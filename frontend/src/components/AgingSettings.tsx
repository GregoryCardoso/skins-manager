'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import {
  agingStateFromSettings, buildAgingPatch, hasAgingChanges, restoreDefaultPatch,
  type AgingErrors, type AgingField, type AgingFormState,
} from '@/lib/agingForm';
import { ApiRequestError, updatePreferences } from '@/services/api';
import { useInvalidate } from '@/lib/useInvalidate';
import type { Settings } from '@/types/api';
import styles from './settings.module.css';

interface Props {
  settings: Settings;
}

// Limites de giro (D159): "giro rápido até" e "agarrado acima de", cada um com "restaurar padrão".
export default function AgingSettings({ settings }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const fastId = useId();
  const slowId = useId();
  const [state, setState] = useState<AgingFormState>(() => agingStateFromSettings(settings));
  const [errors, setErrors] = useState<AgingErrors>({});
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  // Os campos acompanham o servidor depois de salvar ou restaurar.
  useEffect(() => {
    setState(agingStateFromSettings(settings));
  }, [settings]);

  const apiErrors = (err: unknown): AgingErrors => {
    const message = errorMessageFor(err, tLoose, locale);
    if (err instanceof ApiRequestError) {
      // A ordem entre os dois limites vale para os dois campos (D159).
      if (err.code === 'AGING_THRESHOLDS_ORDER') return { fastTurnoverDays: message, slowItemDays: message };
      if (err.field === 'fastTurnoverDays' || err.field === 'slowItemDays') return { [err.field]: message };
    }
    return { fastTurnoverDays: message };
  };

  const run = (patch: Parameters<typeof updatePreferences>[0], done: string) => {
    setBusy(true);
    setErrors({});
    setOk(null);
    updatePreferences(patch)
      .then(() => {
        // Os limites mudam as faixas de giro do inventário e das vendas, e as configurações (D259).
        invalidate('settings.aging');
        setOk(done);
      })
      .catch((err: unknown) => setErrors(apiErrors(err)))
      .finally(() => setBusy(false));
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = buildAgingPatch(state, settings);
    if (!result.ok) {
      setErrors(Object.fromEntries(Object.entries(result.errors).map(([k, key]) => [k, t(key as 'settings.aging.invalidNumber')])));
      setOk(null);
      return;
    }
    if (!hasAgingChanges(result.patch)) {
      setErrors({});
      setOk(t('settings.aging.noChanges'));
      return;
    }
    run(result.patch, t('settings.aging.saved'));
  };

  const field = (name: AgingField, id: string, label: string, text: string, custom: number | null, def: number) => (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>{label}</label>
      <div className={styles.row}>
        <input
          id={id}
          className={styles.input}
          value={text}
          inputMode="numeric"
          onChange={(e) => {
            const value = e.target.value;
            setState((s) => (name === 'fastTurnoverDays' ? { ...s, fastText: value } : { ...s, slowText: value }));
            setOk(null);
          }}
          aria-invalid={!!errors[name]}
          disabled={busy}
        />
        <span className={styles.sub}>{t('settings.aging.days')}</span>
        <button
          type="button"
          className={styles.button}
          disabled={busy || custom === null}
          onClick={() => run(restoreDefaultPatch(name), t('settings.aging.restored'))}
        >
          {t('settings.aging.restore')}
        </button>
      </div>
      <span className={styles.sub}>{t('settings.aging.defaultValue', { days: def })}</span>
      {errors[name] && <span className={styles.error} role="alert">{errors[name]}</span>}
    </div>
  );

  const fast = Number.parseInt(state.fastText, 10);
  const slow = Number.parseInt(state.slowText, 10);
  const showMiddle = Number.isInteger(fast) && Number.isInteger(slow) && fast < slow;

  return (
    <section className={styles.card} aria-labelledby="settings-aging-title">
      <h2 id="settings-aging-title" className={styles.cardTitle}>{t('settings.aging.title')}</h2>
      <p className={styles.muted}>{t('settings.aging.intro')}</p>
      {settings.agingThresholdsAdjusted && (
        <p className={styles.warning} role="status">
          {t('settings.aging.adjusted', { fast: settings.fastTurnoverDays })}
        </p>
      )}
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {field('fastTurnoverDays', fastId, t('settings.aging.fast'), state.fastText, settings.fastTurnoverDaysCustom, settings.fastTurnoverDaysDefault)}
        {field('slowItemDays', slowId, t('settings.aging.slow'), state.slowText, settings.slowItemDaysCustom, settings.slowItemDaysDefault)}
        <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>
          {busy ? t('common.saving') : t('settings.aging.save')}
        </button>
      </form>
      {showMiddle && <p className={styles.muted}>{t('settings.aging.middle', { from: fast + 1, to: slow })}</p>}
      {ok && <p className={styles.ok} role="status">{ok}</p>}
    </section>
  );
}
