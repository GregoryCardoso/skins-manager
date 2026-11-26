import { formatDecimalInput } from './numberInput';

// As duas leituras de um número ambíguo (ver `isAmbiguousDecimal`): "1,250" em inglês pode ser 1,25 (decimal) ou 1250 (milhar).
// Devolve os textos já no formato do idioma, prontos para reescrever o campo: [decimal, inteiro] ou, nas moedas sem casas
// decimais, só [inteiro]. Texto que não é ambíguo (ou que não tem a forma "1 a 3 dígitos + separador + 3 dígitos") devolve [].
export function ambiguousReadings(text: string, language: string, wholeOnly: boolean): string[] {
  const match = /^([1-9]\d{0,2})[.,](\d{3})$/.exec(text.trim().replace(/\s+/g, ''));
  if (!match) return [];
  const thousands = formatDecimalInput(Number(`${match[1]}${match[2]}`), language);
  if (wholeOnly) return [thousands];
  return [formatDecimalInput(Number(`${match[1]}.${match[2]}`), language), thousands];
}
