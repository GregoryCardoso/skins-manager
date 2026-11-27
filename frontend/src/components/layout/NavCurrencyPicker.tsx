'use client';

import { useMemo } from 'react';
import Select from '@/components/ui/Select';
import { useLocale, useT } from '@/i18n/I18nProvider';
import { usePreferences } from '@/components/PreferencesProvider';
import { CURRENCY_GROUP_IDS, currencySelectOptions } from '@/lib/currencies';

// "Moeda de conversão" do menu (12.4): lista simples, igual à do idioma (pedido do usuário na 12.11; antes era um Combobox com busca),
// com USD/BRL/EUR no topo e as outras 39 por região. Escolher outra moeda NÃO grava: avisa quem usa (`onPick`), que abre o
// CurrencyChangeModal de sempre (só ele grava, ao confirmar).
export default function NavCurrencyPicker({ onPick }: { onPick: (currency: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const { displayCurrency } = usePreferences();
  const options = useMemo(() => currencySelectOptions(locale), [locale]);
  const groups = useMemo(() => CURRENCY_GROUP_IDS.map((id) => ({ id, label: t(`currency.groups.${id}` as 'currency.groups.america') })), [t]);
  return (
    <Select
      label={t('currency.label')}
      value={displayCurrency}
      options={options}
      groups={groups}
      onChange={(value) => {
        if (value !== displayCurrency) onPick(value);
      }}
    />
  );
}
