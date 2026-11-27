'use client';

import { useT } from '@/i18n/I18nProvider';
import { LANGUAGE_REGISTRY } from '@/i18n/languages';
import { THEME_CHOICES } from '@/lib/preferences';
import type { Language, ThemeChoice } from '@/types/api';
import CurrencySelect from './CurrencySelect';
import { usePreferences } from './PreferencesProvider';
import styles from './PreferencesSettings.module.css';
import TranslationNotice from './TranslationNotice';
import Panel from './ui/Panel';
import SegmentedControl from './ui/SegmentedControl';
import Select from './ui/Select';

const LANGUAGE_OPTIONS = LANGUAGE_REGISTRY.map((entry) => ({ value: entry.code as string, label: entry.nativeName, lang: entry.code as string }));

// Tema, idioma e moeda de conversão (os mesmos controles do menu lateral, com o mesmo estado). Trocar o idioma nunca muda a moeda.
export default function PreferencesSettings() {
  const t = useT();
  const { theme, language, setTheme, setLanguage } = usePreferences();

  return (
    <Panel title={t('settings.preferences.title')}>
      <div className={styles.stack}>
        <div className={styles.theme}>
          <SegmentedControl
            label={t('settings.preferences.theme')}
            value={theme}
            onChange={(value) => setTheme(value as ThemeChoice)}
            options={THEME_CHOICES.map((choice) => ({ value: choice, label: t(`theme.${choice}`), icon: choice === 'DARK' ? ('moon' as const) : ('sun' as const) }))}
          />
        </div>
        <div className={styles.grid}>
          <Select
            label={t('settings.preferences.language')}
            value={language}
            onChange={(value) => setLanguage(value as Language)}
            options={LANGUAGE_OPTIONS}
          />
          <CurrencySelect />
        </div>
        <p className={styles.muted}>{t('currency.hint')}</p>
        <TranslationNotice language={language} />
      </div>
    </Panel>
  );
}
