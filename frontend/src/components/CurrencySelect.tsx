'use client';

import { useMemo, useState } from 'react';
import { useLocale, useT } from '@/i18n/I18nProvider';
import { CURRENCY_GROUP_IDS, currencySelectOptions } from '@/lib/currencies';
import CurrencyChangeModal from './CurrencyChangeModal';
import { usePreferences } from './PreferencesProvider';
import Select from './ui/Select';

// Seletor da "Moeda de conversão" (D369 R3): as 42 moedas com código, símbolo e nome no idioma atual, numa lista simples igual à do
// idioma (pedido do usuário na 12.11; de 12.8 até lá era um Combobox com busca), com USD, BRL e EUR no topo e as outras por região.
// Escolher outra moeda não grava na hora: abre o modal de confirmação. Trocar o idioma nunca muda a moeda. Usado em Configurações
// (o menu lateral tem o NavCurrencyPicker, com a mesma lista).
export default function CurrencySelect() {
  const t = useT();
  const locale = useLocale();
  const { displayCurrency } = usePreferences();
  const [pending, setPending] = useState<string | null>(null);
  const options = useMemo(() => currencySelectOptions(locale), [locale]);
  const groups = useMemo(() => CURRENCY_GROUP_IDS.map((id) => ({ id, label: t(`currency.groups.${id}` as 'currency.groups.america') })), [t]);

  return (
    <>
      <Select
        label={t('currency.label')}
        value={displayCurrency}
        options={options}
        groups={groups}
        onChange={(value) => {
          if (value !== displayCurrency) setPending(value);
        }}
      />
      {pending !== null && <CurrencyChangeModal key={pending} currency={pending} onClose={() => setPending(null)} />}
    </>
  );
}
