'use strict';

// Adapter do CSFloat (D287): só ele conhece URLs, headers e o formato do JSON. Devolve registros normalizados e nunca
// acessa o banco. `getAccount` (GET /me, 9.1), `pageTrades` (GET /me/trades) e `pageTransactions` (GET /me/transactions, 9.2).
const { CSFLOAT_PAGE_LIMIT } = require('../../../config/constants');
const { requestJson } = require('./csfloatHttp');
const { mapAccount, mapTradesPage, mapTransactionsPage } = require('./csfloatMapper');

const ID = 'CSFLOAT';

// `fetchFn`, `totalSignal` e os prazos são injetáveis (testes). A chave só é repassada ao csfloatHttp.
async function getAccount({ apiKey, fetchFn, totalSignal, totalDeadlineAt, callTimeoutMs, nowFn, sleepFn } = {}) {
  const { json } = await requestJson('/me', { apiKey, fetchFn, totalSignal, totalDeadlineAt, callTimeoutMs, nowFn, sleepFn });
  return mapAccount(json);
}

// Uma página de trades. Sem `role` e sem `state`: a direção vem da comparação com o Steam ID (D293). Devolve também o limite de uso.
async function pageTrades({
  apiKey, page = 0, limit = CSFLOAT_PAGE_LIMIT, fetchFn, totalSignal, totalDeadlineAt, callTimeoutMs, nowFn, sleepFn,
} = {}) {
  const { json, rateLimit } = await requestJson('/me/trades', {
    apiKey, query: { page, limit }, fetchFn, totalSignal, totalDeadlineAt, callTimeoutMs, nowFn, sleepFn,
  });
  return { ...mapTradesPage(json), rateLimit };
}

// Uma página do extrato, da mais nova para a mais antiga por padrão (`order = 'desc'`).
async function pageTransactions({
  apiKey, page = 0, limit = CSFLOAT_PAGE_LIMIT, order = 'desc', fetchFn, totalSignal, totalDeadlineAt, callTimeoutMs, nowFn, sleepFn,
} = {}) {
  const { json, rateLimit } = await requestJson('/me/transactions', {
    apiKey, query: { page, limit, order }, fetchFn, totalSignal, totalDeadlineAt, callTimeoutMs, nowFn, sleepFn,
  });
  return { ...mapTransactionsPage(json), rateLimit };
}

module.exports = {
  id: ID,
  capabilities: Object.freeze({ account: true, trades: true, transactions: true }),
  getAccount,
  pageTrades,
  pageTransactions,
};
