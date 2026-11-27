// Moedas do app (D369, Adendo 1, 11.3): a lista única das 42 moedas (a mesma do backend, `CURRENCIES`, na mesma ordem: USD primeiro e as outras 41 em ordem alfabética pelo código), as que não têm casas decimais e o
// texto de cada uma no seletor (código, símbolo e nome no idioma atual). A moeda base é sempre USD; a moeda de conversão é escolha do usuário.
export const CURRENCIES = [
  'USD',
  'AED', 'ARS', 'AUD', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'JPY', 'KRW', 'KZT', 'MXN', 'MYR', 'NOK', 'NZD', 'PEN', 'PHP', 'PLN', 'QAR', 'RUB', 'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'TWD', 'UAH', 'UYU', 'VND', 'ZAR',
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number];

// Sem casas decimais, a mesma lista do backend. A lista fixa o comportamento do app: o `Intl` de versões diferentes do ICU trata TWD, CRC
// (e, em ICU antigo, IDR, VND, COP e HUF) com 2 casas, e `formatMoney` força 0 casas nelas.
export const ZERO_DECIMAL_CURRENCIES: readonly string[] = ['CLP', 'COP', 'CRC', 'HUF', 'IDR', 'JPY', 'KRW', 'TWD', 'VND'];

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

// Teclado do campo de valor: só números inteiros nas moedas sem casas decimais (moedas sem casas decimais); decimal nas demais.
export const moneyInputMode = (currency: string | undefined): 'numeric' | 'decimal' => (currency !== undefined && hasNoDecimals(currency) ? 'numeric' : 'decimal');

// Chaves de erro de valor digitado (D369, revisão de textos 11.6, seção 14): moeda sem casas decimais (`hasNoDecimals`) tem texto próprio.
export function invalidMoneyKey(currency: string | undefined): 'itemForm.invalidMoney' | 'itemForm.invalidMoneyWhole' {
  return currency !== undefined && hasNoDecimals(currency) ? 'itemForm.invalidMoneyWhole' : 'itemForm.invalidMoney';
}

// Parâmetros dos textos de erro de valor: o exemplo vem do idioma (1,25 em pt-BR, 1.25 em en; 1500 nas moedas sem casas decimais).
export function moneyErrorParams(locale: string, currency: string | undefined, forceWhole = false): { example: string; currency: string } {
  const whole = forceWhole || (currency !== undefined && hasNoDecimals(currency));
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

// Organização da lista de moedas no Combobox (D370, 12.3a): grupos por região e "mais usadas" no topo. É só a ordem de exibição;
// nenhuma regra muda. Toda moeda de CURRENCIES está em exatamente um grupo (o teste confere).
export const CURRENCY_GROUPS: Readonly<Record<'america' | 'europe' | 'asia' | 'other', readonly CurrencyCode[]>> = {
  america: ['ARS', 'BRL', 'CAD', 'CLP', 'COP', 'CRC', 'MXN', 'PEN', 'USD', 'UYU'],
  europe: ['CHF', 'CZK', 'DKK', 'EUR', 'GBP', 'HUF', 'NOK', 'PLN', 'RUB', 'SEK', 'TRY', 'UAH'],
  asia: ['CNY', 'HKD', 'IDR', 'INR', 'JPY', 'KRW', 'KZT', 'MYR', 'PHP', 'SGD', 'THB', 'TWD', 'VND'],
  other: ['AED', 'AUD', 'ILS', 'NZD', 'QAR', 'SAR', 'ZAR'],
};

export type CurrencyGroupId = keyof typeof CURRENCY_GROUPS;

// Ordem dos grupos; o rótulo vem de `currency.groups.<id>`.
export const CURRENCY_GROUP_IDS: readonly CurrencyGroupId[] = ['america', 'europe', 'asia', 'other'];

// Fixadas no topo do Combobox ("Mais usadas").
export const CURRENCY_PINNED: readonly CurrencyCode[] = ['USD', 'BRL', 'EUR'];

export interface CurrencyComboboxOption {
  value: CurrencyCode;
  label: string;
  keywords: string[];
  group: CurrencyGroupId;
}

// Lista simples (Select nativo) da moeda de conversão, igual à do idioma (pedido do usuário, 12.11): USD, BRL e EUR soltos no topo e as
// outras por região (`group`), sem repetir.
export function currencySelectOptions(locale: string): { value: string; label: string; group?: string }[] {
  const pinned = CURRENCY_PINNED.map((code) => ({ value: code as string, label: currencyLabel(code, locale) }));
  const rest = currencyComboboxOptions(locale)
    .filter((option) => !(CURRENCY_PINNED as readonly string[]).includes(option.value))
    .map(({ value, label, group }) => ({ value, label, group }));
  return [...pinned, ...rest];
}

// Opções do Combobox de moedas: rótulo no idioma, busca também pelo código e pelo nome em inglês, grupo por região (dentro do grupo,
// ordem pelo código, como na 11.11).
export function currencyComboboxOptions(locale: string): CurrencyComboboxOption[] {
  const out: CurrencyComboboxOption[] = [];
  for (const group of CURRENCY_GROUP_IDS) {
    for (const code of [...CURRENCY_GROUPS[group]].sort()) {
      out.push({ value: code, label: currencyLabel(code, locale), keywords: [code, currencyName(code, 'en')], group });
    }
  }
  return out;
}
