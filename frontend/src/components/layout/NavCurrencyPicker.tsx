'use client';

import { useMemo } from 'react';
import Combobox from '@/components/ui/Combobox';
import { useLocale, useT } from '@/i18n/I18nProvider';
import { usePreferences } from '@/components/PreferencesProvider';
import { CURRENCY_GROUP_IDS, CURRENCY_PINNED, currencyComboboxOptions } from '@/lib/currencies';

// "Moeda de conversão" do menu (12.4): o Combobox da 12.3 com as 42 moedas por região e USD/BRL/EUR no topo. Escolher outra moeda NÃO
// grava: avisa quem usa (`onPick`), que abre o CurrencyChangeModal de sempre (só ele grava, ao confirmar).
export default function NavCurrencyPicker({ onPick }: { onPick: (currency: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const { displayCurrency } = usePreferences();
  const options = useMemo(() => currencyComboboxOptions(locale), [locale]);
  const groups = useMemo(() => CURRENCY_GROUP_IDS.map((id) => ({ id, label: t(`currency.groups.${id}` as 'currency.groups.america') })), [t]);
  return (
    <Combobox
      label={t('currency.label')}
      value={displayCurrency}
      options={options}
      groups={groups}
      pinned={[...CURRENCY_PINNED]}
      onChange={(value) => {
        if (value !== null && value !== displayCurrency) onPick(value);
      }}
    />
  );
}
