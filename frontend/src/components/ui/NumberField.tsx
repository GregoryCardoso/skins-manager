'use client';

import { useState } from 'react';
import { useLanguage, useLocale, useT, useTLoose } from '@/i18n/I18nProvider';
import { ambiguousReadings } from '@/lib/ambiguousNumber';
import { hasNoDecimals, invalidMoneyKey, moneyErrorParams, moneyInputMode, type CurrencyCode } from '@/lib/currencies';
import { isAmbiguousDecimal, parseDecimalInput, parseFloatInput, parseIntegerInput, parseMoneyToCents } from '@/lib/numberInput';
import Button from './Button';
import styles from './NumberField.module.css';
import TextField, { type TextFieldProps } from './TextField';

export type NumberKind = 'money' | 'decimal' | 'float' | 'integer';

export interface NumberFieldProps extends Omit<TextFieldProps, 'type' | 'onChange' | 'inputMode' | 'align' | 'value'> {
  kind: NumberKind;
  // Obrigatória em `money`: decide as casas decimais e o exemplo.
  currency?: CurrencyCode;
  // Texto digitado (controlado).
  value: string;
  // `parsed`: centavos (money), número (decimal e float), inteiro (integer) ou null (vazio ou inválido).
  onValueChange: (text: string, parsed: number | null) => void;
  // Dica "Exemplo: 1.25". Padrão: ligada em money (nas moedas sem casas decimais a dica é sempre a de números inteiros).
  showFormatHint?: boolean;
  // Oferece "Usar 1,25" / "Usar 1250" quando o texto é ambíguo. Padrão: ligado em money e decimal.
  suggestAmbiguous?: boolean;
}

// Número digitado no formato do idioma atual. Só usa as funções de lib/numberInput.ts e lib/currencies.ts (nenhuma regra nova).
export default function NumberField({ kind, currency, value, onValueChange, error, hint, showFormatHint, suggestAmbiguous = true, onBlur, ...rest }: NumberFieldProps) {
  const t = useT();
  const tLoose = useTLoose();
  const language = useLanguage();
  const locale = useLocale();
  // O erro local só aparece depois do primeiro blur com texto; a partir daí acompanha cada tecla.
  const [touched, setTouched] = useState(false);

  const parse = (text: string): number | null => {
    if (text.trim() === '') return null;
    switch (kind) {
      case 'money':
        return parseMoneyToCents(text, language, currency);
      case 'decimal':
        return parseDecimalInput(text, language);
      case 'float':
        return parseFloatInput(text, language);
      default:
        return parseIntegerInput(text);
    }
  };

  const whole = kind === 'money' && currency !== undefined && hasNoDecimals(currency);
  const parsed = parse(value);
  const hasText = value.trim() !== '';
  const offerAmbiguous = suggestAmbiguous && (kind === 'money' || kind === 'decimal') && hasText && parsed === null && isAmbiguousDecimal(value, language);
  const params = moneyErrorParams(locale, currency);

  let localError: string | null = null;
  if (touched && hasText && parsed === null) {
    if (offerAmbiguous) localError = tLoose('fx.ambiguousInput', params);
    else if (kind === 'money') localError = tLoose(invalidMoneyKey(currency), params);
    else localError = t('itemForm.invalidNumber');
  }

  const showFormat = (showFormatHint ?? kind === 'money') && !whole;
  const fieldHint = (
    <>
      {hint}
      {whole && <span className={styles.line}>{t('ui.field.wholeNumberHint', params)}</span>}
      {showFormat && <span className={styles.line}>{t('ui.field.formatHint', { example: params.example })}</span>}
    </>
  );
  const hasHint = !!hint || whole || showFormat;

  const readings = offerAmbiguous && touched ? ambiguousReadings(value, language, whole) : [];

  return (
    <div className={`${styles.stack} ${rest.full ? styles.full : ''}`}>
      <TextField
        {...rest}
        value={value}
        align="end"
        inputMode={kind === 'integer' ? 'numeric' : kind === 'money' ? moneyInputMode(currency) : 'decimal'}
        hint={hasHint ? fieldHint : undefined}
        error={error ?? localError}
        onChange={(text) => onValueChange(text, parse(text))}
        onBlur={() => {
          if (value.trim() !== '') setTouched(true);
          onBlur?.();
        }}
      />
      {readings.length > 0 && (
        <div className={styles.suggestions}>
          {readings.map((text) => (
            <Button key={text} size="sm" onClick={() => onValueChange(text, parse(text))}>
              {t('ui.field.useValue', { value: text })}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
