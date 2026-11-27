'use client';

import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { usePreferences } from '@/components/PreferencesProvider';
import IconButton from '@/components/ui/IconButton';
import SegmentedControl from '@/components/ui/SegmentedControl';
import Select from '@/components/ui/Select';
import { useT } from '@/i18n/I18nProvider';
import { LANGUAGE_REGISTRY } from '@/i18n/languages';
import { nextTheme } from '@/lib/preferences';
import type { Language, ThemeChoice } from '@/types/api';
import NavCurrencyPicker from './NavCurrencyPicker';
import styles from './NavPreferences.module.css';

export interface NavPreferencesProps {
  // Forma recolhida: dois botões de ícone (tema direto e um Popover com idioma e moeda).
  compact: boolean;
  // A moeda escolhida (ainda não gravada): quem usa abre o CurrencyChangeModal.
  onPickCurrency: (currency: string) => void;
}

const LANGUAGE_OPTIONS = LANGUAGE_REGISTRY.map((entry) => ({ value: entry.code as string, label: entry.nativeName, lang: entry.code as string }));

// Atalhos de tema, idioma e moeda de conversão no rodapé do menu (12.4). Reaproveita o usePreferences(): nada é regra daqui.
export default function NavPreferences({ compact, onPickCurrency }: NavPreferencesProps) {
  const t = useT();
  const { theme, language, setTheme, setLanguage } = usePreferences();
  const [popoverOpen, setPopoverOpen] = useState(false);

  const themeOptions: { value: ThemeChoice; label: string; icon: 'sun' | 'moon' }[] = [
    { value: 'LIGHT', label: t('theme.LIGHT'), icon: 'sun' },
    { value: 'DARK', label: t('theme.DARK'), icon: 'moon' },
  ];

  if (!compact) {
    return (
      <div className={styles.prefs}>
        <SegmentedControl label={t('theme.label')} value={theme} onChange={setTheme} options={themeOptions} size="sm" />
        <Select label={t('language.label')} value={language} onChange={(value) => setLanguage(value as Language)} options={LANGUAGE_OPTIONS} />
        <NavCurrencyPicker onPick={onPickCurrency} />
      </div>
    );
  }

  const next = nextTheme(theme);
  return (
    <div className={styles.compact} role="group" aria-label={t('header.controls')}>
      <IconButton
        icon={next === 'DARK' ? 'moon' : 'sun'}
        label={t('theme.switchTo', { current: t(`theme.${theme}`), next: t(`theme.${next}`) })}
        onClick={() => setTheme(next)}
      />
      <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
        <Popover.Trigger asChild>
          <IconButton icon="languages" label={t('header.controls')} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className={styles.popover} side="right" align="end" sideOffset={8} collisionPadding={8}>
            <Select label={t('language.label')} value={language} onChange={(value) => setLanguage(value as Language)} options={LANGUAGE_OPTIONS} />
            <NavCurrencyPicker
              onPick={(currency) => {
                setPopoverOpen(false);
                onPickCurrency(currency);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
