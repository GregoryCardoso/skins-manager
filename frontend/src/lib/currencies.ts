// Moedas do app (D369, Adendo 1, 11.3): a lista única das 17 moedas (a mesma do backend, `CURRENCIES`), as que não têm casas decimais e o
// texto de cada uma no seletor (código, símbolo e nome no idioma atual). A moeda base é sempre USD; a moeda de conversão é escolha do usuário.
export const CURRENCIES = [
  'USD', 'BRL', 'EUR', 'RUB', 'TRY', 'CNY', 'PLN', 'UAH', 'JPY', 'KRW', 'GBP', 'KZT', 'CAD', 'AUD', 'MXN', 'ARS', 'CLP',
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number];

// Sem casas decimais (o `Intl` já as trata assim; a lista fixa o comportamento, como no backend).
export const ZERO_DECIMAL_CURRENCIES: readonly string[] = ['JPY', 'KRW', 'CLP'];

// Moeda base: nunca tem cotação nem "≈".
export const BASE_CURRENCY: CurrencyCode = 'USD';

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

export const hasNoDecimals = (currency: string): boolean => ZERO_DECIMAL_CURRENCIES.includes(currency);

// Nome da moeda no idioma ("euro", "Brazilian Real"); sem `Intl.DisplayNames` ou sem dado, devolve o código.
export function currencyName(code: string, locale: string): string {
  try {
    if (typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') return code;
    const name = new Intl.DisplayNames([locale], { type: 'currency' }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

// Símbolo curto da moeda no idioma ("€", "R$", "$"); sem símbolo próprio, devolve o código.
export function currencySymbol(code: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

// "EUR € — euro". Quando o símbolo é o próprio código, não se repete: "CHF — franc suíço".
export function currencyLabel(code: string, locale: string): string {
  const symbol = currencySymbol(code, locale);
  const head = symbol === code ? code : `${code} ${symbol}`;
  const name = currencyName(code, locale);
  return name === code ? head : `${head} — ${name}`;
}

export interface CurrencyOption {
  code: CurrencyCode;
  label: string;
}

// Itens do seletor, na ordem fixa da lista (USD primeiro).
export function currencyOptions(locale: string): CurrencyOption[] {
  return CURRENCIES.map((code) => ({ code, label: currencyLabel(code, locale) }));
}

// Teclado do campo de valor: só números inteiros nas moedas sem casas decimais (JPY, KRW e CLP); decimal nas demais.
export const moneyInputMode = (currency: string | undefined): 'numeric' | 'decimal' => (currency !== undefined && hasNoDecimals(currency) ? 'numeric' : 'decimal');

// Chaves de erro de valor digitado (D369, revisão de textos 11.6, seção 14): moeda sem casas decimais (JPY, KRW e CLP) tem texto próprio.
export function invalidMoneyKey(currency: string | undefined): 'itemForm.invalidMoney' | 'itemForm.invalidMoneyWhole' {
  return currency !== undefined && hasNoDecimals(currency) ? 'itemForm.invalidMoneyWhole' : 'itemForm.invalidMoney';
}

// Parâmetros dos textos de erro de valor: o exemplo vem do idioma (1,25 em pt-BR, 1.25 em en; 1500 nas moedas sem casas decimais).
export function moneyErrorParams(locale: string, currency: string | undefined): { example: string; currency: string } {
  const whole = currency !== undefined && hasNoDecimals(currency);
  let example: string;
  try {
    example = whole
      ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: false }).format(1500)
      : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(1.25);
  } catch {
    example = whole ? '1500' : '1.25';
  }
  return { example, currency: currency ?? '' };
}
