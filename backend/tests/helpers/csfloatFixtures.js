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
  sentToDifferentUser = null, listingType = 'buy_now', item = {}, reference,
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
      ...(reference === undefined ? {} : { reference }),
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
        serialized_inspect: 'SERIALIZED-FICTICIO-QA',
        gs_sig: 'GS-SIG-FICTICIO-QA',
        cs2_screenshot_id: 'SCREENSHOT-FICTICIO-QA',
        cs2_screenshot_at: '2026-11-20T14:00:00.000Z',
        ...item,
      },
    },
  };
}

// --- Componentes (10.2, D361): estrutura do exemplo REAL do usuário (anonimizado), com dados INVENTADOS onde há risco ------------
// `icon_url` de domínio fictício e os campos que o app nunca lê (`stickerId`, `reference`, `offset_*`, `rotation`, `contract.reference`)
// ficam de propósito, para provar que são descartados. Os nomes de stickers e chaveiro são públicos (itens do jogo).
const FAKE_ICON_HOST = 'https://icones-ficticios.example.invalid/economy/image/';
const COMPONENT_REFERENCE = { price: 18, quantity: 177, updated_at: '2026-11-23T00:33:53.830644Z' };
const fakeSticker = (stickerId, slot, name, extra = {}) => ({
  stickerId, slot, icon_url: `${FAKE_ICON_HOST}STICKER-${stickerId}`, name, reference: { ...COMPONENT_REFERENCE }, ...extra,
});
const fakeKeychain = (stickerId, slot, name, pattern, extra = {}) => ({
  stickerId, slot, offset_x: 4.1337357, offset_y: 0.4869821, offset_z: 1.8659537, pattern, icon_url: `${FAKE_ICON_HOST}CHARM-${stickerId}`, name,
  reference: { price: 67, quantity: 897, updated_at: '2026-11-23T00:33:46.286292Z' }, ...extra,
});
const contractReference = (extra = {}) => ({
  base_price: 57, float_factor: 1, predicted_price: 57, keychain_price: 75, quantity: 1943, last_updated: '2026-11-24T11:25:09.703625Z',
  sticker_overpay: { total_price: 45 }, ...extra,
});
const exteriorOf = (name) => name.slice(name.lastIndexOf('(') + 1, -1);
// Cada preset é { item, reference } para `fakeTrade({ item: preset.item, reference: preset.reference })`.
const preset = (marketHashName, extra) => ({
  item: {
    market_hash_name: marketHashName, item_name: marketHashName.split(' | ')[1].replace(/ \(.*$/, ''), wear_name: exteriorOf(marketHashName),
    type: 'skin', float_value: 0.2534, paint_seed: 661, ...extra,
  },
  reference: contractReference(),
});
const DEAGLE_4_STICKERS = preset('Desert Eagle | Trigger Discipline (Field-Tested)', {
  stickers: [
    fakeSticker(4718, 0, 'Sticker | BIG (Holo) | 2020 RMR'),
    fakeSticker(4707, 1, 'Sticker | Heroic (Foil) | 2020 RMR'),
    fakeSticker(4710, 2, 'Sticker | Ninjas in Pyjamas (Holo) | 2020 RMR'),
    fakeSticker(6566, 3, 'Sticker | FL1T (Champion) | Rio 2022'),
  ],
});
const GLOCK_WEAR_OFFSET = preset('Glock-18 | Moonrise (Field-Tested)', {
  stickers: [
    fakeSticker(9480, 3, 'Sticker | Clavis', { offset_x: -0.029786095, offset_y: -0.10788977 }),
    fakeSticker(4785, 2, 'Sticker | Boom | 2020 RMR', { wear: 0.72, offset_x: -0.14575681, offset_y: -0.0005184412 }),
  ],
});
const M4A4_SAME_STICKER_TWICE = preset('M4A4 | Tooth Fairy (Field-Tested)', {
  stickers: [fakeSticker(5000, 4, 'Sticker | Fly High', { rotation: 12.5 }), fakeSticker(5000, 3, 'Sticker | Fly High', { rotation: -3.2 })],
});
const M4A1S_DUP_SLOT_WEAR1 = preset('M4A1-S | Mud-Spec (Field-Tested)', {
  stickers: [
    fakeSticker(5100, 4, 'Sticker | Scavenger', { wear: 1 }),
    fakeSticker(5101, 4, 'Sticker | Flickshot'),
    fakeSticker(5102, 0, 'Sticker | Battlefield Portal'),
  ],
});
const GLOCK_ST_CHARM = preset('StatTrak™ Glock-18 | Off World (Battle-Scarred)', {
  is_stattrak: true,
  stickers: [
    fakeSticker(6000, 0, 'Sticker | Separate Pixels'),
    fakeSticker(6001, 1, 'Sticker | Operation Riptide'),
    fakeSticker(6002, 2, 'Sticker | Stone Scales'),
    fakeSticker(6003, 3, 'Sticker | Choose Wisely'),
  ],
  keychains: [fakeKeychain(14, 0, "Charm | Lil' Teacup", 84492)],
  sticker_index: 3, keychain_index: 14, keychain_pattern: 84492,
});
// HIPÓTESE (sem exemplo real): o Sticker Slab provavelmente vem em `keychains[]` com o nome "Sticker Slab | ...".
const SLAB_HYPOTHETICAL = preset('AK-47 | Redline (Field-Tested)', {
  keychains: [fakeKeychain(900, 0, 'Sticker Slab | Fly High', 321)],
});
const KNIFE_WITH_STICKER = preset('★ Karambit | Fade (Factory New)', {
  float_value: 0.01,
  stickers: [fakeSticker(7000, 0, 'Sticker | Fly High')],
});
// Variações inválidas (cada uma num item AK-47 | Redline).
const AK = 'AK-47 | Redline (Field-Tested)';
const INVALID_VARIANTS = Object.freeze({
  wearText: preset(AK, { stickers: [fakeSticker(1, 0, 'Sticker | Fly High', { wear: 'muito' })] }),
  slotNine: preset(AK, { stickers: [fakeSticker(1, 9, 'Sticker | Fly High')] }),
  emptyName: preset(AK, { stickers: [fakeSticker(1, 0, '')] }),
  sevenStickers: preset(AK, { stickers: Array.from({ length: 7 }, (_, i) => fakeSticker(100 + i, i % 5, 'Sticker | Fly High')) }),
  twoKeychains: preset(AK, { keychains: [fakeKeychain(1, 0, "Charm | Lil' Teacup", 1), fakeKeychain(2, 0, "Charm | Lil' Teacup", 2)] }),
  arraysAsObjects: preset(AK, { stickers: { 0: fakeSticker(1, 0, 'Sticker | Fly High') }, keychains: 'nada' }),
});

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
  FAKE_ICON_HOST, fakeSticker, fakeKeychain, contractReference, DEAGLE_4_STICKERS, GLOCK_WEAR_OFFSET, M4A4_SAME_STICKER_TWICE, M4A1S_DUP_SLOT_WEAR1,
  GLOCK_ST_CHARM, SLAB_HYPOTHETICAL, KNIFE_WITH_STICKER, INVALID_VARIANTS,
  KEY, OTHER_KEY, PII, OTHER, TRADE_PII, meBody, fakeResponse, fakeFetch, okMe, fakeTrade, fakeTransaction, purchaseTx, routedFetch,
};

