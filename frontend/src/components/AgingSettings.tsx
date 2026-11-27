'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose, useTPlural } from '@/i18n/I18nProvider';
import {
  agingStateFromSettings, buildAgingPatch, hasAgingChanges, restoreDefaultPatch,
  type AgingErrors, type AgingField, type AgingFormState,
} from '@/lib/agingForm';
import { parseIntegerInput } from '@/lib/numberInput';
import { ApiRequestError, updatePreferences } from '@/services/api';
import { useInvalidate } from '@/lib/useInvalidate';
import type { Settings } from '@/types/api';
import styles from './AgingSettings.module.css';
import Banner from './ui/Banner';
import Button from './ui/Button';
import NumberField from './ui/NumberField';
import Panel from './ui/Panel';
import { useToast } from './ui/Toast';
import TurnoverRule, { TurnoverLegend } from './ui/TurnoverRule';

interface Props {
  settings: Settings;
}

// Os limites que a régua desenha: os digitados, quando respeitam 1 <= rápido < encalhado <= 365; senão, os salvos. É só geometria:
// quem valida de verdade é o backend (a régua nunca grava nada).
export function scaleLimits(
  state: AgingFormState,
  saved: Pick<Settings, 'fastTurnoverDays' | 'slowItemDays'>,
): { limits: { fastTurnoverDays: number; slowItemDays: number }; typedValid: boolean } {
  const fast = parseIntegerInput(state.fastText);
  const slow = parseIntegerInput(state.slowText);
  const valid = fast !== null && slow !== null && fast >= 1 && fast < slow && slow <= 365;
  return {
    limits: valid ? { fastTurnoverDays: fast, slowItemDays: slow } : { fastTurnoverDays: saved.fastTurnoverDays, slowItemDays: saved.slowItemDays },
    typedValid: valid,
  };
}

// Limites de giro (D159): "giro rápido até" e "agarrado acima de", cada um com "restaurar padrão", e a barra das três faixas, que muda
// enquanto se digita (12.8).
export default function AgingSettings({ settings }: Props) {
  const t = useT();
  const tLoose = useTLoose();
  const tPlural = useTPlural();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [state, setState] = useState<AgingFormState>(() => agingStateFromSettings(settings));
  const [errors, setErrors] = useState<AgingErrors>({});
  const [busy, setBusy] = useState(false);

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
    updatePreferences(patch)
      .then(() => {
        // Os limites mudam as faixas de giro do inventário e das vendas, e as configurações (D259).
        invalidate('settings.aging');
        toast.show({ tone: 'success', message: done });
      })
      .catch((err: unknown) => setErrors(apiErrors(err)))
      .finally(() => setBusy(false));
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = buildAgingPatch(state, settings);
    if (!result.ok) {
      setErrors(Object.fromEntries(Object.entries(result.errors).map(([k, key]) => [k, t(key as 'settings.aging.invalidNumber')])));
      return;
    }
    if (!hasAgingChanges(result.patch)) {
      setErrors({});
      toast.show({ tone: 'info', message: t('settings.aging.noChanges') });
      return;
    }
    run(result.patch, t('settings.aging.saved'));
  };

  const field = (name: AgingField, label: string, text: string, custom: number | null, def: number) => (
    <div className={styles.field}>
      <NumberField
        kind="integer"
        label={label}
        name={name}
        value={text}
        disabled={busy}
        error={errors[name]}
        hint={t('settings.aging.defaultValue', { days: tPlural('common.dayCount', def) })}
        trailing={<span className={styles.unit}>{t('settings.aging.days')}</span>}
        onValueChange={(value) => setState((s) => (name === 'fastTurnoverDays' ? { ...s, fastText: value } : { ...s, slowText: value }))}
      />
      <Button size="sm" variant="ghost" disabled={busy || custom === null} onClick={() => run(restoreDefaultPatch(name), t('settings.aging.restored'))}>
        {t('settings.aging.restore')}
      </Button>
    </div>
  );

  const { limits, typedValid } = scaleLimits(state, settings);
  const hasTyped = state.fastText.trim() !== '' || state.slowText.trim() !== '';

  return (
    <Panel title={t('settings.aging.title')} hint={t('settings.aging.intro')}>
      <div className={styles.stack}>
        {settings.agingThresholdsAdjusted && (
          <Banner tone="warning">{t('settings.aging.adjusted', { fast: tPlural('common.dayCount', settings.fastTurnoverDays) })}</Banner>
        )}
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <div className={styles.fields}>
            {field('fastTurnoverDays', t('settings.aging.fast'), state.fastText, settings.fastTurnoverDaysCustom, settings.fastTurnoverDaysDefault)}
            {field('slowItemDays', t('settings.aging.slow'), state.slowText, settings.slowItemDaysCustom, settings.slowItemDaysDefault)}
          </div>
          <div>
            <Button type="submit" variant="primary" loading={busy}>
              {busy ? t('common.saving') : t('settings.aging.save')}
            </Button>
          </div>
        </form>
        <div className={styles.scale} data-testid="aging-scale">
          <h3 className={styles.scaleTitle}>{t('settings.aging.scaleTitle')}</h3>
          <TurnoverRule kind="scale" limits={limits} />
          <TurnoverLegend limits={limits} />
          {hasTyped && !typedValid && <p className={styles.hint} role="status">{t('settings.aging.scaleInvalid')}</p>}
          {typedValid && limits.slowItemDays - limits.fastTurnoverDays > 0 && (
            <p className={styles.hint}>{t('settings.aging.middle', { from: limits.fastTurnoverDays + 1, to: tPlural('common.dayCount', limits.slowItemDays) })}</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
