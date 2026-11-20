// Constantes compartilhadas entre config e services (T14). Arquivo sem dependências.
const MIN_SLOW_ITEM_DAYS = 8;
// Teto de qualquer valor em centavos recebido pela API (R$/US$ 100 milhões).
const MAX_AMOUNT_CENTS = 1e10;
// Limites de texto (após trim).
const MAX_NAME_LENGTH = 200;
const MAX_ORIGIN_DETAIL_LENGTH = 200;
const MAX_NOTE_LENGTH = 500; // note de deposits/withdrawals (Etapa 7); sem validador nesta etapa

module.exports = Object.freeze({ MIN_SLOW_ITEM_DAYS, MAX_AMOUNT_CENTS, MAX_NAME_LENGTH, MAX_ORIGIN_DETAIL_LENGTH, MAX_NOTE_LENGTH });
