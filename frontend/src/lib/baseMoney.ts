// Textos de valor na moeda base com "≈ <moeda de conversão>" (8.5, D225, D231; moeda escolhida na 11.3). O frontend NÃO soma nem
// converte (D74): todos os centavos, inclusive o "≈", chegam prontos do backend; aqui só se formata o que veio, na moeda que veio.
import { formatMoney } from '@/lib/format';

// Qualquer das 42 moedas (`lib/currencies.ts`).
export type MoneyCurrency = string;

export interface MoneyInput {
  // Valor principal; nulo = indisponível (sem cotação).
  cents: number | null;
  currency?: MoneyCurrency;
  // Valor aproximado na moeda de conversão; nulo/ausente = não exibir. Sem a moeda (`approxCurrency`), também não exibe: nunca se
  // supõe uma moeda.
  approxCents?: number | null;
  approxCurrency?: MoneyCurrency | null;
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
  const approx = input.approxCents === null || input.approxCents === undefined || !input.approxCurrency
    ? null
    : formatMoney(input.approxCents, input.approxCurrency, language);
  return { main, mainEstimated: main !== null && input.estimated === true, approx };
}

export interface Counterpart {
  currency: MoneyCurrency;
  cents: number;
}

// "≈" discreto ao lado de um valor na moeda da loja (D369 4.2), já calculado no backend:
// - loja em US$: o "≈" é o valor na moeda de conversão (nenhum com US$ como moeda de conversão);
// - loja em outra moeda: se a moeda de conversão é uma terceira, o "≈" é nela; se é a própria moeda da loja (ou US$), o "≈" é em US$.
export function storeCounterpart(input: {
  currency: MoneyCurrency;
  usdCents: number | null;
  approxCents: number | null;
  approxCurrency: MoneyCurrency | null | undefined;
}): Counterpart | null {
  const { currency, usdCents, approxCents, approxCurrency } = input;
  if (currency === 'USD') {
    return approxCents === null || !approxCurrency ? null : { currency: approxCurrency, cents: approxCents };
  }
  if (approxCurrency && approxCurrency !== 'USD' && approxCurrency !== currency && approxCents !== null) {
    return { currency: approxCurrency, cents: approxCents };
  }
  return usdCents === null ? null : { currency: 'USD', cents: usdCents };
}
