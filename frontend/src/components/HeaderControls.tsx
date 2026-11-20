'use client';

import { errorMessageFor } from '@/i18n/errorMessage';
import { useT, useTLoose } from '@/i18n/I18nProvider';
import { LANGUAGES, nextTheme } from '@/lib/preferences';
import type { Language, Theme } from '@/types/api';
import styles from './HeaderControls.module.css';
import { usePreferences } from './PreferencesProvider';

const THEME_ICONS: Record<Theme, string> = { SYSTEM: '◐', LIGHT: '☀', DARK: '☾' };

export default function HeaderControls() {
  const { theme, language, saveError, setTheme, setLanguage } = usePreferences();
  const t = useT();
  const tLoose = useTLoose();

  const current = t(`theme.${theme}`);
  const next = t(`theme.${nextTheme(theme)}`);
  const hint = t('theme.switchTo', { current, next });

  return (
    <div className={styles.controls} role="group" aria-label={t('header.controls')}>
      {saveError !== null && (
        <span className={styles.warning} role="status">
          {t('header.preferenceNotSaved', { reason: errorMessageFor(saveError, tLoose) })}
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
        {LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {t(`language.${code}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
