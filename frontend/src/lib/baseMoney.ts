// Textos de valor na moeda base com "≈ R$" (8.5, D225, D231). O frontend NÃO soma nem converte (D74): todos os centavos,
// inclusive o "≈ R$"/"≈ US$", chegam prontos do backend; aqui só se formata o que veio.
import { formatMoney } from '@/lib/format';

export type MoneyCurrency = 'USD' | 'BRL';

export interface MoneyInput {
  // Valor principal; nulo = indisponível (sem cotação).
  cents: number | null;
  currency?: MoneyCurrency;
  // Valor aproximado na outra moeda; nulo/ausente = não exibir.
  approxCents?: number | null;
  approxCurrency?: MoneyCurrency;
  // true quando o valor principal contém conversão R$ -> US$ (ganha o prefixo "≈").
  estimated?: boolean;
}

export interface MoneyTexts {
  // null quando o valor principal está indisponível.
  main: string | null;
  // O "≈" antes do valor principal só aparece quando houve conversão e o valor existe.
  mainEstimated: boolean;
  approx: string | null;
}

export function moneyTexts(input: MoneyInput, language: string): MoneyTexts {
  const main = input.cents === null ? null : formatMoney(input.cents, input.currency ?? 'USD', language);
  const approx = input.approxCents === null || input.approxCents === undefined
    ? null
    : formatMoney(input.approxCents, input.approxCurrency ?? 'BRL', language);
  return { main, mainEstimated: main !== null && input.estimated === true, approx };
}
