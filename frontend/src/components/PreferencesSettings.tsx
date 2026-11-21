'use client';

import { useId } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { LANGUAGES, THEME_CHOICES } from '@/lib/preferences';
import type { Language, ThemeChoice } from '@/types/api';
import { usePreferences } from './PreferencesProvider';
import styles from './settings.module.css';

// Tema e idioma (os mesmos controles do cabeçalho, com o mesmo estado).
export default function PreferencesSettings() {
  const t = useT();
  const { theme, language, setTheme, setLanguage } = usePreferences();
  const themeId = useId();
  const languageId = useId();

  return (
    <section className={styles.card} aria-labelledby="settings-prefs-title">
      <h2 id="settings-prefs-title" className={styles.cardTitle}>{t('settings.preferences.title')}</h2>
      <div className={styles.form}>
        <div className={styles.field}>
          <label htmlFor={themeId} className={styles.label}>{t('settings.preferences.theme')}</label>
          <select
            id={themeId}
            className={styles.select}
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeChoice)}
          >
            {THEME_CHOICES.map((choice) => (
              <option key={choice} value={choice}>{t(`theme.${choice}`)}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={languageId} className={styles.label}>{t('settings.preferences.language')}</label>
          <select
            id={languageId}
            className={styles.select}
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>{t(`language.${code}`)}</option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
