'use client';

import { useId } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { LANGUAGE_REGISTRY } from '@/i18n/languages';
import { THEME_CHOICES } from '@/lib/preferences';
import type { Language, ThemeChoice } from '@/types/api';
import CurrencySelect from './CurrencySelect';
import { usePreferences } from './PreferencesProvider';
import TranslationNotice from './TranslationNotice';
import styles from './settings.module.css';

// Tema, idioma e moeda de conversão (os mesmos controles do cabeçalho, com o mesmo estado). Trocar o idioma nunca muda a moeda.
export default function PreferencesSettings() {
  const t = useT();
  const { theme, language, setTheme, setLanguage } = usePreferences();
  const themeId = useId();
  const languageId = useId();
  const currencyId = useId();

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
            {LANGUAGE_REGISTRY.map((entry) => (
              <option key={entry.code} value={entry.code} lang={entry.code}>{entry.nativeName}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={currencyId} className={styles.label}>{t('currency.label')}</label>
          <CurrencySelect id={currencyId} className={styles.select} />
        </div>
      </div>
      <p className={styles.muted}>{t('currency.hint')}</p>
      <TranslationNotice language={language} />
    </section>
  );
}
