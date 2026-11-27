'use client';

import { useMemo, useState } from 'react';
import { useLocale, useT } from '@/i18n/I18nProvider';
import { CURRENCY_GROUP_IDS, CURRENCY_PINNED, currencyComboboxOptions } from '@/lib/currencies';
import CurrencyChangeModal from './CurrencyChangeModal';
import { usePreferences } from './PreferencesProvider';
import Combobox from './ui/Combobox';

// Seletor da "Moeda de conversão" (D369 R3; Combobox com busca e grupos desde a 12.8): as 42 moedas com código, símbolo e nome no idioma
// atual, por região, com USD, BRL e EUR no topo. Escolher outra moeda não grava na hora: abre o modal de confirmação. Trocar o idioma
// nunca muda a moeda. Usado em Configurações (o menu lateral tem o NavCurrencyPicker, com o mesmo Combobox).
export default function CurrencySelect() {
  const t = useT();
  const locale = useLocale();
  const { displayCurrency } = usePreferences();
  const [pending, setPending] = useState<string | null>(null);
  const options = useMemo(() => currencyComboboxOptions(locale), [locale]);
  const groups = useMemo(() => CURRENCY_GROUP_IDS.map((id) => ({ id, label: t(`currency.groups.${id}` as 'currency.groups.america') })), [t]);

  return (
    <>
      <Combobox
        label={t('currency.label')}
        value={displayCurrency}
        options={options}
        groups={groups}
        pinned={[...CURRENCY_PINNED]}
        onChange={(value) => {
          if (value !== null && value !== displayCurrency) setPending(value);
        }}
      />
      {pending !== null && <CurrencyChangeModal key={pending} currency={pending} onClose={() => setPending(null)} />}
    </>
  );
}
