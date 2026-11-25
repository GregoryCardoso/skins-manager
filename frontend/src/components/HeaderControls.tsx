'use client';

import { errorMessageFor } from '@/i18n/errorMessage';
import { useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { LANGUAGE_REGISTRY } from '@/i18n/languages';
import { nextTheme } from '@/lib/preferences';
import type { Language, ThemeChoice } from '@/types/api';
import styles from './HeaderControls.module.css';
import { usePreferences } from './PreferencesProvider';

// Dois estados (D112): sol = Claro, lua = Escuro.
const THEME_ICONS: Record<ThemeChoice, string> = { LIGHT: '☀', DARK: '☾' };

export default function HeaderControls() {
  const { theme, language, saveError, setTheme, setLanguage } = usePreferences();
  const t = useT();
  const tLoose = useTLoose();
  const locale = useLocale();

  const current = t(`theme.${theme}`);
  const next = t(`theme.${nextTheme(theme)}`);
  const hint = t('theme.switchTo', { current, next });

  return (
    <div className={styles.controls} role="group" aria-label={t('header.controls')}>
      {saveError !== null && (
        <span className={styles.warning} role="status">
          {t('header.preferenceNotSaved', { reason: errorMessageFor(saveError, tLoose, locale) })}
        </span>
      )}
      <button
        type="button"
        className={styles.button}
        onClick={() => setTheme(nextTheme(theme))}
        title={hint}
        aria-label={hint}
      >
        <span aria-hidden="true">{THEME_ICONS[theme]}</span> {current}
      </button>
      <select
        className={styles.select}
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
        aria-label={t('language.label')}
        title={t('language.label')}
      >
        {LANGUAGE_REGISTRY.map((entry) => (
          <option key={entry.code} value={entry.code} lang={entry.code}>
            {entry.nativeName}
          </option>
        ))}
      </select>
    </div>
  );
}
