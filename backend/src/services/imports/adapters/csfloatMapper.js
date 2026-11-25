'use strict';

// Normalização pura das respostas do CSFloat (D287, D309). Por ALLOWLIST: só os campos listados são lidos; todo o resto do
// JSON (e-mail, telefone, trade_token, payment_accounts, stripe_connect, avatar, dados da outra parte...) é descartado aqui e
// nunca sai do mapper. `mapAccount` (GET /me, 9.1) e `mapTradesPage`/`mapTransactionsPage` (9.2).
const { formatChanged } = require('./csfloatHttp');
const { parseDate } = require('../../dateUtils');

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

// --- Trades e extrato (9.2, D318 seção 3) ----------------------------------------------------------------------------

const SOURCE_RECORD_INVALID = 'SOURCE_RECORD_INVALID';

// ISO 8601 com fuso -> ISO em UTC; qualquer outra coisa -> null.
function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  try {
    return parseDate(value.trim()).toISOString();
  } catch (err) {
    return null;
  }
}

// Número finito em [0, 1] ou null (float da skin).
function parseOptionalFloat(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

// Texto aparado com 1 a `max` caracteres ou null.
function parseText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text !== '' && text.length <= max ? text : null;
}

// Id em texto de dígitos; número só se for inteiro seguro (convertido em texto). Número inseguro perderia precisão -> null.
function parseIdText(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  return parseDigitsId(value);
}

// Id de transação: dígitos ou um token curto (letras, números, `_` e `-`), até 40 caracteres.
function parseTransactionId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : null;
}

// Inteiro com sinal (número ou texto de inteiro). Ausente -> 0; qualquer outra coisa -> NaN (inválido).
function parseSignedCents(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : NaN;
  if (typeof value === 'string' && /^-?\d{1,15}$/.test(value)) return Number(value);
  return NaN;
}

const invalidRecord = (externalId) => ({ ok: false, externalId: externalId ?? null, reason: SOURCE_RECORD_INVALID });

// Componentes do item (D361): só de `stickers[]` e `keychains[]`, por allowlist (nome, slot, desgaste e pattern). Nunca lê `stickerId`,
// `icon_url`, `offset_*`, `rotation`, `reference`, `sticker_index`, `keychain_index` nem `keychain_pattern`. Arrays ausentes ou
// inválidos viram []; um componente ruim nunca invalida o trade.
const MAX_RAW_COMPONENTS = 10;
const MAX_COMPONENT_SLOT = 5;
const MAX_COMPONENT_PATTERN = 999999;

// Sticker novo não traz `wear` (= 0). Número em [0, 1] vale; qualquer outra coisa -> null.
function parseComponentWear(value) {
  if (value === undefined || value === null) return 0;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function mapRawComponent(raw, from) {
  if (!isPlainObject(raw)) return null;
  const slot = Number.isSafeInteger(raw.slot) && raw.slot >= 0 && raw.slot <= MAX_COMPONENT_SLOT ? raw.slot : null;
  const pattern = Number.isSafeInteger(raw.pattern) && raw.pattern >= 0 && raw.pattern <= MAX_COMPONENT_PATTERN ? raw.pattern : null;
  return {
    from,
    name: parseText(raw.name, 200),
    slot,
    wear: from === 'STICKER' ? parseComponentWear(raw.wear) : null,
    pattern: from === 'KEYCHAIN' ? pattern : null,
  };
}

function mapRawComponents(item) {
  const out = [];
  for (const [key, from] of [['stickers', 'STICKER'], ['keychains', 'KEYCHAIN']]) {
    const list = Array.isArray(item[key]) ? item[key].slice(0, MAX_RAW_COMPONENTS) : [];
    for (const raw of list) {
      const mapped = mapRawComponent(raw, from);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}

// Um trade de GET /me/trades -> { ok: true, trade } ou { ok: false, externalId, reason }. Só os campos da allowlist.
// `buyerId`/`sellerId` saem só para o service calcular a direção e nunca são gravados.
function mapTrade(raw) {
  if (!isPlainObject(raw)) return invalidRecord(null);
  const externalId = parseIdText(raw.id);
  const contractId = parseIdText(raw.contract_id);
  const buyerId = parseIdText(raw.buyer_id);
  const sellerId = parseIdText(raw.seller_id);
  const createdAt = parseIsoDate(raw.created_at);
  const contract = isPlainObject(raw.contract) ? raw.contract : null;
  const item = contract && isPlainObject(contract.item) ? contract.item : null;
  const priceCents = contract ? parseCentsString(contract.price) : null;
  const marketHashName = item ? parseText(item.market_hash_name, 200) : null;
  if (!externalId || !contractId || !buyerId || !sellerId || !createdAt || priceCents === null || !marketHashName) {
    return invalidRecord(externalId);
  }
  const offer = isPlainObject(raw.steam_offer) ? raw.steam_offer : null;
  const different = raw.sent_to_different_user_id;
  const seed = Number.isInteger(item.paint_seed) && item.paint_seed >= 0 && item.paint_seed <= 1000 ? item.paint_seed : null;
  return {
    ok: true,
    trade: {
      externalId,
      contractId,
      buyerId,
      sellerId,
      rawState: parseText(raw.state, 60),
      offerState: offer ? parseNonNegativeInt(offer.state) : null,
      createdAt,
      soldAt: parseIsoDate(contract.sold_at),
      acceptedAt: parseIsoDate(raw.accepted_at),
      protectionEndsAt: parseIsoDate(raw.trade_protection_ends_at),
      verifySaleAt: parseIsoDate(raw.verify_sale_at),
      sentToDifferentUser: (typeof different === 'string' && different !== '') || (typeof different === 'number' && different !== 0),
      priceCents,
      listingType: parseText(contract.type, 30),
      item: {
        marketHashName,
        itemName: parseText(item.item_name, 200),
        wearName: parseText(item.wear_name, 60),
        type: parseText(item.type, 30),
        isCommodity: item.is_commodity === true,
        defIndex: parseNonNegativeInt(item.def_index),
        paintIndex: parseNonNegativeInt(item.paint_index),
        floatValue: parseOptionalFloat(item.float_value),
        paintSeed: seed,
        phase: parseText(item.phase, 40),
        isStattrak: item.is_stattrak === true,
        isSouvenir: item.is_souvenir === true,
        components: mapRawComponents(item),
      },
    },
  };
}

// GET /me/trades -> { trades: [ { ok, trade } | { ok: false, ... } ], count }. Formato fora do esperado -> FORMAT_CHANGED.
function mapTradesPage(json) {
  if (!isPlainObject(json) || !Array.isArray(json.trades) || !Number.isInteger(json.count) || json.count < 0) throw formatChanged();
  const seen = new Set();
  const trades = json.trades.map((raw) => {
    const result = mapTrade(raw);
    if (result.ok) {
      if (seen.has(result.trade.externalId)) throw formatChanged(); // id repetido na mesma página
      seen.add(result.trade.externalId);
    }
    return result;
  });
  return { trades, count: json.count };
}

// Uma transação do extrato -> { ok: true, transaction } ou { ok: false, ... }. Fora da allowlist: session_id, transfer_id,
// payment_*, exchange_rate, bid_id, listing_id etc. nunca são lidos.
function mapTransaction(raw) {
  if (!isPlainObject(raw)) return invalidRecord(null);
  const externalId = parseTransactionId(raw.id);
  const createdAt = parseIsoDate(raw.created_at);
  const type = parseText(raw.type, 60);
  const balance = parseSignedCents(raw.balance_offset);
  const pending = parseSignedCents(raw.pending_offset);
  if (!externalId || !createdAt || !type || Number.isNaN(balance) || Number.isNaN(pending)) return invalidRecord(externalId);
  const details = isPlainObject(raw.details) ? raw.details : {};
  const feeAmount = parseCentsString(details.fee_amount);
  const fee = parseCentsString(details.fee);
  const floatFee = parseCentsString(details.float_fee);
  const processorFee = parseCentsString(details.processor_fee);
  let feeCents = null;
  if (feeAmount !== null) feeCents = feeAmount;
  else if (fee !== null) feeCents = fee;
  else if (floatFee !== null || processorFee !== null) feeCents = (floatFee ?? 0) + (processorFee ?? 0);
  return {
    ok: true,
    transaction: {
      externalId,
      createdAt,
      type,
      balanceOffsetCents: balance,
      pendingOffsetCents: pending,
      contractId: parseIdText(details.contract_id),
      tradeId: parseIdText(details.trade_id),
      feeCents,
      detailsType: parseText(details.type, 30),
    },
  };
}

// GET /me/transactions -> { transactions: [ { ok, transaction } | { ok: false, ... } ], count }.
function mapTransactionsPage(json) {
  if (!isPlainObject(json) || !Array.isArray(json.transactions) || !Number.isInteger(json.count) || json.count < 0) throw formatChanged();
  return { transactions: json.transactions.map(mapTransaction), count: json.count };
}

// --- Preço de referência (10.5, D364) ---------------------------------------------------------------------------------------

// GET /listings?...&limit=1 -> { status: 'OK'|'NOT_FOUND', basePriceCents, referenceQuantity, sourceUpdatedAt }. Allowlist: do primeiro
// anúncio só `reference.base_price`, `reference.quantity`, `reference.last_updated`, `item.market_hash_name` e `item.paint_index`.
// Nunca `price` (o mais barato pode ser um leilão abaixo da referência), `type`, `state`, `phase`, `sticker_overpay`, `cursor`, `id`,
// `seller`, `asset_id`, `inspect_link`, `float_value`, `predicted_price` nem `float_factor` (D309).
// Salvaguarda: o nome (e o `paint_index`, só quando foi pedido um) do anúncio precisam bater com o pedido; senão a fonte ignorou o filtro
// e o anúncio é de OUTRO item: problema só desta chave (NOT_FOUND, nunca grava o preço do outro item) e a rodada segue. Formato
// estrutural inválido (sem `item`, nome ou `paint_index` de tipo errado) continua sendo FORMAT_CHANGED.
function mapListingReference(json, { marketHashName, paintIndex = null } = {}) {
  const list = Array.isArray(json) ? json : isPlainObject(json) && Array.isArray(json.data) ? json.data : null;
  if (list === null) throw formatChanged();
  if (list.length === 0) return { status: 'NOT_FOUND', basePriceCents: null, referenceQuantity: null, sourceUpdatedAt: null };
  const listing = list[0];
  if (!isPlainObject(listing)) throw formatChanged();
  const item = isPlainObject(listing.item) ? listing.item : null;
  if (!item || typeof item.market_hash_name !== 'string') throw formatChanged();
  const notFound = { status: 'NOT_FOUND', basePriceCents: null, referenceQuantity: null, sourceUpdatedAt: null };
  if (item.market_hash_name !== marketHashName) return notFound;
  if (paintIndex !== null && paintIndex !== undefined) {
    if (!Number.isInteger(item.paint_index)) throw formatChanged();
    if (item.paint_index !== paintIndex) return notFound;
  }
  const reference = isPlainObject(listing.reference) ? listing.reference : null;
  const basePriceCents = reference ? parseCentsString(reference.base_price) : null;
  if (basePriceCents === null) return { status: 'NOT_FOUND', basePriceCents: null, referenceQuantity: null, sourceUpdatedAt: null };
  return {
    status: 'OK',
    basePriceCents,
    referenceQuantity: parseNonNegativeInt(reference.quantity),
    sourceUpdatedAt: parseIsoDate(reference.last_updated),
  };
}

module.exports = {
  mapListingReference,
  mapAccount,
  mapTrade,
  mapTradesPage,
  mapTransaction,
  mapTransactionsPage,
  parseIsoDate,
  parseOptionalFloat,
  parseCentsString,
  parseRate,
  parseNonNegativeInt,
  parseDigitsId,
  SOURCE_RECORD_INVALID,
};
