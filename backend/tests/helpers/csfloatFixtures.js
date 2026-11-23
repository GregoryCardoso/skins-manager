'use strict';

// Fixtures do CSFloat para os testes da 9.1 (não é arquivo de teste). TODOS os dados são INVENTADOS: nenhum Steam ID,
// nome, e-mail, telefone, token ou avatar é real. Nenhum teste faz chamada de rede real.

// Chave falsa marcada: se aparecer em resposta, mensagem, log ou backup, o teste falha. Termina em "a1b2" (máscara).
const KEY = 'SENTINEL-KEY-zq7r5k3m9x-a1b2';
const OTHER_KEY = 'SENTINEL-OTHER-w4n8v2c6p1-c3d4';

// Marcadores únicos de dados pessoais falsos (buscados em respostas, logs, banco e arquivos).
const PII = Object.freeze({
  steamId: '76561190000000001',
  steamId2: '76561190000000002',
  username: 'usuario_ficticio_qa',
  username2: 'outro_ficticio_qa',
  email: 'ficticio.qa@example.invalid',
  phone: '+00-555-0100-QA',
  tradeToken: 'TRADE-TOKEN-FICTICIO-QA',
  payment: 'PAYMENT-ACCT-FICTICIO-QA',
  stripe: 'STRIPE-FICTICIO-QA',
  avatar: 'https://avatars.example.invalid/ficticio-qa.jpg',
});

// Formato real do GET /me (valores inventados): `user.steam_id` em texto, taxas em texto/número, saldos em centavos.
function meBody(overrides = {}) {
  const user = {
    steam_id: PII.steamId,
    username: PII.username,
    avatar: PII.avatar,
    email: PII.email,
    phone_number: PII.phone,
    trade_token: PII.tradeToken,
    payment_accounts: [{ type: 'IBAN', value: PII.payment }],
    stripe_connect: { account_id: PII.stripe, verified: true },
    balance: 12345,
    pending_balance: 678,
    fee: '0.02',
    withdraw_fee: '0.025',
    statistics: {
      total_sales: 10,
      total_purchases: 5,
      total_trades: 61,
      total_verified_trades: 55,
      total_failed_trades: 4,
      total_avoided_trades: 2,
    },
    ...(overrides.user || {}),
  };
  const { user: _ignored, ...rest } = overrides;
  return { user, ...rest };
}

// Resposta falsa no formato mínimo que o csfloatHttp usa (status, headers.get em minúsculas, text/json).
function fakeResponse(status, body, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const text = typeof body === 'string' ? body : JSON.stringify(body === undefined ? {} : body);
  return {
    status,
    headers: { get: (name) => (Object.prototype.hasOwnProperty.call(lower, String(name).toLowerCase()) ? lower[String(name).toLowerCase()] : null) },
    text: async () => text,
  };
}

// fetchFn falso: devolve as respostas em sequência (a última se repete); funções são chamadas com (url, init).
function fakeFetch(...steps) {
  const calls = [];
  const fn = jest.fn(async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    return typeof step === 'function' ? step(url, init) : step;
  });
  fn.calls = calls;
  return fn;
}

const okMe = (overrides) => fakeResponse(200, meBody(overrides));

// --- Trades e extrato (9.2): formato real, dados INVENTADOS --------------------------------------------------------------

// A outra ponta dos trades (nunca o dono da conta). Marcadores únicos para a busca por vazamento.
const OTHER = Object.freeze({
  steamId: '76561190000000099',
  username: 'comprador-teste-qa',
  avatar: 'https://example.invalid/outra-pessoa.png',
  tradeUrl: 'https://steamcommunity.com/tradeoffer/new/?partner=999&token=OUTRO-TOKEN-QA',
  tradeToken: 'OUTRO-TOKEN-QA',
  contractToken: 'CONTRACT-TOKEN-QA',
});
const TRADE_PII = [OTHER.steamId, OTHER.username, OTHER.avatar, OTHER.tradeUrl, OTHER.tradeToken, OTHER.contractToken, 'SESSION-FICTICIO-QA', 'TRANSFER-FICTICIO-QA', 'CONNECT-FICTICIO-QA'];

// Trade no formato do GET /me/trades. `direction`: 'BUY' (a conta é a compradora) ou 'SELL'.
function fakeTrade({
  id = '1001', contractId = null, direction = 'BUY', state = 'pending', offerState = 3, createdAt = '2026-11-20T14:00:00.000Z',
  soldAt, acceptedAt, protectionEndsAt = '2026-11-27T14:00:00.000Z', verifySaleAt = null, price = 1250, steamId = PII.steamId,
  sentToDifferentUser = null, listingType = 'buy_now', item = {},
} = {}) {
  const accepted = acceptedAt === undefined ? (offerState === 3 ? createdAt : null) : acceptedAt;
  return {
    id,
    contract_id: contractId || `9${id}`,
    buyer_id: direction === 'BUY' ? steamId : OTHER.steamId,
    seller_id: direction === 'BUY' ? OTHER.steamId : steamId,
    state,
    created_at: createdAt,
    accepted_at: accepted,
    trade_protection_ends_at: protectionEndsAt,
    verify_sale_at: verifySaleAt,
    sent_to_different_user_id: sentToDifferentUser,
    steam_offer: offerState === null ? null : { state: offerState, id: 'OFFER-FICTICIO-QA' },
    buyer: { steam_id: direction === 'BUY' ? steamId : OTHER.steamId, username: OTHER.username, avatar: OTHER.avatar },
    seller: { steam_id: direction === 'BUY' ? OTHER.steamId : steamId, username: OTHER.username, avatar: OTHER.avatar },
    trade_url: OTHER.tradeUrl,
    trade_token: OTHER.tradeToken,
    contract: {
      id: contractId || `9${id}`,
      price,
      type: listingType,
      sold_at: soldAt === undefined ? createdAt : soldAt,
      token: OTHER.contractToken,
      item: {
        market_hash_name: 'AK-47 | Redline (Field-Tested)',
        item_name: 'Redline',
        wear_name: 'Field-Tested',
        type: 'skin',
        is_commodity: false,
        def_index: 7,
        paint_index: 282,
        float_value: 0.2534,
        paint_seed: 661,
        phase: null,
        is_stattrak: false,
        is_souvenir: false,
        inspect_link: `steam://rungame/730/${OTHER.steamId}/+csgo_econ_action_preview%20S${OTHER.steamId}A1D1`,
        asset_id: '123456789',
        stickers: [{ name: 'Sticker FICTICIO', slot: 0 }],
        ...item,
      },
    },
  };
}

// Transação no formato do GET /me/transactions.
function fakeTransaction({
  id = 'tx-1', type = 'contract_purchased', balanceOffset = 0, pendingOffset = 0, createdAt = '2026-11-20T14:00:01.000Z', details = {},
} = {}) {
  return {
    id,
    type,
    created_at: createdAt,
    balance_offset: balanceOffset,
    pending_offset: pendingOffset,
    session_id: 'SESSION-FICTICIO-QA',
    connect_account_id: 'CONNECT-FICTICIO-QA',
    details: { transfer_id: 'TRANSFER-FICTICIO-QA', payment_method: 'card', ...details },
  };
}

// Compra de contrato no extrato (`contract_purchased`): saída de saldo igual ao preço, salvo `balanceOffset`.
const purchaseTx = (contractId, price, extra = {}) =>
  fakeTransaction({ id: `tx-${contractId}`, type: 'contract_purchased', balanceOffset: -price, details: { contract_id: contractId }, ...extra });

// fetchFn falso roteado por caminho. `state`: { me, trades: [...], transactions: [...], pageSize, headers, failAt } (mutável entre chamadas).
// Registra `calls` ({ path, page }). `failAt`: { path, status } faz o caminho falhar a partir da página indicada.
function routedFetch(state) {
  const calls = [];
  const fn = jest.fn(async (url) => {
    const parsed = new URL(url);
    const pathName = parsed.pathname.replace(/^\/api\/v1/, '');
    const page = Number(parsed.searchParams.get('page') || 0);
    const limit = Number(parsed.searchParams.get('limit') || 50);
    calls.push({ path: pathName, page, limit, order: parsed.searchParams.get('order') });
    const headers = state.headers || {};
    const fail = state.failAt && state.failAt.path === pathName && page >= (state.failAt.page || 0) ? state.failAt : null;
    if (fail) return fakeResponse(fail.status, fail.body === undefined ? { code: 1 } : fail.body, headers);
    if (pathName === '/me') return fakeResponse(200, state.me || meBody(), headers);
    if (pathName === '/me/trades') {
      const all = state.trades || [];
      return fakeResponse(200, { trades: all.slice(page * limit, (page + 1) * limit), count: all.length }, headers);
    }
    if (pathName === '/me/transactions') {
      const all = state.transactions || [];
      return fakeResponse(200, { transactions: all.slice(page * limit, (page + 1) * limit), count: all.length }, headers);
    }
    return fakeResponse(404, {});
  });
  fn.calls = calls;
  return fn;
}

module.exports = {
  KEY, OTHER_KEY, PII, OTHER, TRADE_PII, meBody, fakeResponse, fakeFetch, okMe, fakeTrade, fakeTransaction, purchaseTx, routedFetch,
};

