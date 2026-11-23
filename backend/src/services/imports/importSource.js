'use strict';

// Contrato de uma fonte de importação (D287). Todo Adapter exporta:
//   id: 'CSFLOAT' (texto)
//   capabilities: { account, trades, transactions } (booleanos)
//   getAccount({ apiKey, fetchFn, ... })      -> ExternalAccount { steamId, username, balanceCents, pendingBalanceCents,
//                                                saleFeeRate, withdrawalFeeRate, statistics }       (se capabilities.account)
//   pageTrades({ apiKey, page, limit, ... })        -> { trades, count, rateLimit }               (se capabilities.trades; 9.2)
//   pageTransactions({ apiKey, page, limit, ... })  -> { transactions, count, rateLimit }         (se capabilities.transactions; 9.6)
// O Adapter nunca acessa o banco e devolve só campos da allowlist do mapper.
const CAPABILITY_METHODS = Object.freeze({ account: 'getAccount', trades: 'pageTrades', transactions: 'pageTransactions' });

// Devolve a lista de problemas do Adapter (vazia = cumpre o contrato).
function validateAdapter(adapter) {
  const problems = [];
  if (!adapter || typeof adapter !== 'object') return ['adapter ausente'];
  if (typeof adapter.id !== 'string' || adapter.id === '') problems.push('id');
  const capabilities = adapter.capabilities;
  if (!capabilities || typeof capabilities !== 'object') {
    problems.push('capabilities');
    return problems;
  }
  for (const [capability, method] of Object.entries(CAPABILITY_METHODS)) {
    if (typeof capabilities[capability] !== 'boolean') problems.push(`capabilities.${capability}`);
    else if (capabilities[capability] && typeof adapter[method] !== 'function') problems.push(method);
  }
  return problems;
}

module.exports = { CAPABILITY_METHODS, validateAdapter };
