'use strict';

// Fixtures do GET /listings do CSFloat para os testes da 10.5 (não é arquivo de teste). Formato do exemplo real (H3 confirmada),
// com TODOS os dados pessoais e ids INVENTADOS. Nenhum teste faz chamada de rede real.
const { fakeResponse } = require('./csfloatFixtures');

// Marcadores únicos de dados que o mapper e o cache nunca podem guardar.
const LISTING_PII = Object.freeze({
  listingId: '999000111222333444',
  sellerSteamId: '76561190000000777',
  sellerName: 'vendedor-ficticio-qa',
  assetId: '44556677889',
  inspectLink: 'steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20FICTICIO-QA',
  gsSig: 'GSSIG-FICTICIO-QA',
});

// Um anúncio no formato real. `price` é o do anúncio (pode ser um leilão bem abaixo da referência).
function fakeListing({
  marketHashName, paintIndex = 1050, basePrice = 57, price = 58, type = 'buy_now', quantity = 1943, lastUpdated = '2026-11-24T18:57:01.089134Z',
  phase, reference, stickerOverpay = { total_price: 5 },
} = {}) {
  const item = {
    asset_id: LISTING_PII.assetId, def_index: 1, paint_index: paintIndex, paint_seed: 768, float_value: 0.25384074449539185, is_stattrak: false,
    is_souvenir: false, market_hash_name: marketHashName, tradable: 0, inspect_link: LISTING_PII.inspectLink, type: 'skin',
    serialized_inspect: 'SERIALIZED-FICTICIO-QA', gs_sig: LISTING_PII.gsSig,
    stickers: [{ stickerId: 6676, slot: 0, name: 'Sticker | FaZe Clan | Paris 2023', reference: { price: 1, quantity: 1729 } }],
  };
  if (phase) item.phase = phase;
  return {
    id: LISTING_PII.listingId,
    created_at: '2026-11-24T12:57:06.399856Z',
    type,
    price,
    state: 'listed',
    seller: { steam_id: LISTING_PII.sellerSteamId, username: LISTING_PII.sellerName },
    reference: reference === undefined
      ? { base_price: basePrice, float_factor: 1.07, predicted_price: 95354, quantity, last_updated: lastUpdated, sticker_overpay: stickerOverpay }
      : reference,
    item,
    is_watchlisted: false,
    watchers: 0,
  };
}

const LISTING_HEADERS = Object.freeze({ 'x-ratelimit-limit': '200', 'x-ratelimit-remaining': '199', 'x-ratelimit-reset': '1795557734' });

// fetchFn falso do /listings. `catalog`: { 'market_hash_name': base_price | { base, price, type, paintIndex, reference } }; nome ausente =
// lista vazia. `state`: { remaining (número ou null = sem headers), failAfter, failStatus, pending (conta chamadas simultâneas) }.
function routedListings(catalog, state = {}) {
  const calls = [];
  let active = 0;
  state.maxActive = 0;
  const fn = jest.fn(async (url, init) => {
    const parsed = new URL(url);
    const query = Object.fromEntries(parsed.searchParams.entries());
    calls.push({ path: parsed.pathname.replace(/^\/api\/v1/, ''), query, init });
    active += 1;
    state.maxActive = Math.max(state.maxActive, active);
    await Promise.resolve();
    active -= 1;
    if (state.failAfter !== undefined && calls.length > state.failAfter) {
      if (state.failStatus === 'network') throw new Error(`rede caiu em ${url}`);
      return fakeResponse(state.failStatus ?? 503, {});
    }
    const remaining = state.remaining === undefined ? 199 : state.remaining;
    const headers = remaining === null ? {} : { ...LISTING_HEADERS, 'x-ratelimit-remaining': String(Math.max(0, remaining - (calls.length - 1))) };
    const entry = catalog[query.market_hash_name];
    if (entry === undefined) return fakeResponse(200, { data: [], cursor: null }, headers);
    const spec = typeof entry === 'number' ? { base: entry } : entry;
    const listing = fakeListing({
      marketHashName: query.market_hash_name,
      paintIndex: query.paint_index !== undefined ? Number(query.paint_index) : spec.paintIndex ?? 1050,
      basePrice: spec.base, price: spec.price ?? spec.base + 1, type: spec.type ?? 'buy_now', reference: spec.reference,
    });
    return fakeResponse(200, { data: [listing], cursor: 'CURSOR-FICTICIO' }, headers);
  });
  fn.calls = calls;
  return fn;
}

module.exports = { LISTING_PII, LISTING_HEADERS, fakeListing, routedListings };
