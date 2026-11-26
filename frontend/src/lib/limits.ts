// Limites espelhados do backend (`backend/src/config/constants.js`). O backend continua sendo a fonte da regra.

// Tamanho máximo da observação de aportes, saques e conferências (MAX_NOTE_LENGTH do backend).
export const MAX_NOTE_LENGTH = 500;

// Teto de qualquer valor em centavos, por moeda (MAX_AMOUNT_CENTS_BY_CURRENCY do backend; mesmo valor em dólar para todas as moedas,
// 11.11 complemento). Tabela literal e fixa; o teste S4 (currencies1111.test.ts) confere a paridade com o backend. O backend valida; aqui só
// serve para textos (ex.: "o máximo é ...") e para o futuro limite dos campos.
export const MAX_AMOUNT_CENTS_BY_CURRENCY: Readonly<Record<string, number>> = Object.freeze({
  USD: 1e10, AED: 1e10, ARS: 2e12, AUD: 1e10, BRL: 1e10, CAD: 1e10, CHF: 1e10, CLP: 2e12, CNY: 1e10, COP: 5e12, CRC: 1e12, CZK: 5e10, DKK: 1e10,
  EUR: 1e10, GBP: 1e10, HKD: 1e10, HUF: 5e11, IDR: 2e13, ILS: 1e10, INR: 2e11, JPY: 2e11, KRW: 2e12, KZT: 1e12, MXN: 5e10, MYR: 1e10, NOK: 2e10,
  NZD: 1e10, PEN: 1e10, PHP: 1e11, PLN: 1e10, QAR: 1e10, RUB: 1e11, SAR: 1e10, SEK: 2e10, SGD: 1e10, THB: 5e10, TRY: 5e10, TWD: 5e10, UAH: 5e10,
  UYU: 5e10, VND: 5e13, ZAR: 5e10,
});

// Teto da moeda; moeda desconhecida usa o maior (como o backend).
export const maxAmountCents = (currency: string): number =>
  Object.prototype.hasOwnProperty.call(MAX_AMOUNT_CENTS_BY_CURRENCY, currency)
    ? MAX_AMOUNT_CENTS_BY_CURRENCY[currency]
    : Math.max(...Object.values(MAX_AMOUNT_CENTS_BY_CURRENCY));
