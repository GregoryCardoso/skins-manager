'use strict';

// Adapter do CSFloat (D287): só ele conhece URLs, headers e o formato do JSON. Devolve registros normalizados e nunca
// acessa o banco. Na 9.1 só existe `getAccount` (GET /me); `pageTrades` e `pageTransactions` entram na 9.2.
const { requestJson } = require('./csfloatHttp');
const { mapAccount } = require('./csfloatMapper');

const ID = 'CSFLOAT';

// `fetchFn`, `totalSignal` e os prazos são injetáveis (testes). A chave só é repassada ao csfloatHttp.
async function getAccount({ apiKey, fetchFn, totalSignal, totalDeadlineAt, callTimeoutMs, nowFn, sleepFn } = {}) {
  const { json } = await requestJson('/me', { apiKey, fetchFn, totalSignal, totalDeadlineAt, callTimeoutMs, nowFn, sleepFn });
  return mapAccount(json);
}

module.exports = {
  id: ID,
  capabilities: Object.freeze({ account: true, trades: false, transactions: false }),
  getAccount,
};
