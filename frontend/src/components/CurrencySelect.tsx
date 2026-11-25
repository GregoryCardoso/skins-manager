'use client';

import { useMemo, useState } from 'react';
import { useLocale, useT } from '@/i18n/I18nProvider';
import { currencyOptions } from '@/lib/currencies';
import CurrencyChangeModal from './CurrencyChangeModal';
import { usePreferences } from './PreferencesProvider';

interface Props {
  className?: string;
  id?: string;
  // Rótulo acessível quando não há `<label>` ao lado (o cabeçalho).
  ariaLabel?: string;
  title?: string;
}

// Seletor da "Moeda de conversão" (D369 R3): as 17 moedas com código, símbolo e nome no idioma atual. Escolher outra moeda não grava
// na hora: abre o modal de confirmação. Trocar o idioma nunca muda a moeda. Usado no cabeçalho e em Configurações.
export default function CurrencySelect({ className, id, ariaLabel, title }: Props) {
  const t = useT();
  const locale = useLocale();
  const { displayCurrency } = usePreferences();
  const [pending, setPending] = useState<string | null>(null);
  const options = useMemo(() => currencyOptions(locale), [locale]);

  return (
    <>
      <select
        id={id}
        className={className}
        value={displayCurrency}
        onChange={(event) => {
          if (event.target.value !== displayCurrency) setPending(event.target.value);
        }}
        aria-label={ariaLabel}
        title={title ?? t('currency.label')}
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>{option.label}</option>
        ))}
      </select>
      {pending !== null && <CurrencyChangeModal key={pending} currency={pending} onClose={() => setPending(null)} />}
    </>
  );
}
