'use strict';

// Normalização pura das respostas do CSFloat (D287, D309). Por ALLOWLIST: só os campos listados são lidos; todo o resto do
// JSON (e-mail, telefone, trade_token, payment_accounts, stripe_connect, avatar...) é descartado aqui e nunca sai do mapper.
// Na 9.1 só existe `mapAccount` (GET /me); `parseCentsString` e `parseRate` ficam prontos para a 9.2.
const { formatChanged } = require('./csfloatHttp');

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Inteiro >= 0 e seguro (número) ou null.
function parseNonNegativeInt(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// Valores em centavos que o CSFloat manda em texto ("20") ou número: só dígitos, até 12; qualquer outra coisa -> null.
function parseCentsString(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 && value <= 999999999999 ? value : null;
  if (typeof value !== 'string' || !/^\d{1,12}$/.test(value)) return null;
  return Number(value);
}

// Taxa decimal (0.02) em [0, 1): número finito ou texto decimal; senão null.
function parseRate(value) {
  let rate = value;
  if (typeof rate === 'string') rate = /^\d+(\.\d+)?$/.test(rate.trim()) ? Number(rate.trim()) : NaN;
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate < 1 ? rate : null;
}

// Id numérico (Steam ID de 17 dígitos): só texto de dígitos. Número é recusado (perderia precisão acima de 2^53).
function parseDigitsId(value) {
  return typeof value === 'string' && /^\d{1,32}$/.test(value) ? value : null;
}

// GET /me -> ExternalAccount. Sem `user` ou sem `steam_id` válido -> IMPORT_SOURCE_FORMAT_CHANGED.
// Os demais campos são tolerantes (inválido vira null): na 9.1 só `steamId`, `username` e as taxas são usados.
function mapAccount(json) {
  const user = isPlainObject(json) ? json.user : null;
  if (!isPlainObject(user)) throw formatChanged();
  const steamId = parseDigitsId(user.steam_id);
  if (steamId === null) throw formatChanged();
  const stats = isPlainObject(user.statistics) ? user.statistics : {};
  const username = typeof user.username === 'string' && user.username.trim() !== '' ? user.username.trim().slice(0, 100) : null;
  return {
    steamId,
    username,
    balanceCents: parseNonNegativeInt(user.balance),
    pendingBalanceCents: parseNonNegativeInt(user.pending_balance),
    saleFeeRate: parseRate(user.fee),
    withdrawalFeeRate: parseRate(user.withdraw_fee),
    statistics: {
      totalSales: parseNonNegativeInt(stats.total_sales),
      totalPurchases: parseNonNegativeInt(stats.total_purchases),
      totalTrades: parseNonNegativeInt(stats.total_trades),
      totalVerifiedTrades: parseNonNegativeInt(stats.total_verified_trades),
      totalFailedTrades: parseNonNegativeInt(stats.total_failed_trades),
      totalAvoidedTrades: parseNonNegativeInt(stats.total_avoided_trades),
    },
  };
}

module.exports = { mapAccount, parseCentsString, parseRate, parseNonNegativeInt, parseDigitsId };
