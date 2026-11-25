'use strict';

// 10.5 (D364): partes puras do valor de mercado: nome de mercado, mapper do /listings (com o exemplo real anonimizado), valor da unidade
// e totais. Sem banco e sem rede.
const { buildPriceTarget, paintIndexOf } = require('../../src/services/valuation/marketHashName');
const { mapListingReference } = require('../../src/services/imports/adapters/csfloatMapper');
const csfloatAdapter = require('../../src/services/imports/adapters/csfloatAdapter');
const { valueUnit, summarize, componentShares, isStaleRow } = require('../../src/services/valuation/valuationService');
const { fakeListing, LISTING_PII, routedListings } = require('../helpers/listingFixtures');
const { KEY } = require('../helpers/csfloatFixtures');

const NOW = new Date('2026-11-24T12:00:00.000Z');

describe('buildPriceTarget (nome de mercado e chave)', () => {
  const skin = (extra = {}) => ({ category: 'SKIN', name: 'AK-47 | Redline', variant: 'NORMAL', exterior: 'FT', phase: null, ...extra });

  test.each([
    ['normal', skin(), 'AK-47 | Redline (Field-Tested)'],
    ['StatTrak', skin({ variant: 'STATTRAK', exterior: 'FN' }), 'StatTrak™ AK-47 | Redline (Factory New)'],
    ['Souvenir', skin({ variant: 'SOUVENIR', exterior: 'BS', name: 'Desert Eagle | Urban DDPAT' }), 'Souvenir Desert Eagle | Urban DDPAT (Battle-Scarred)'],
    ['faca', { category: 'FACA', name: '★ Karambit | Fade', variant: 'NORMAL', exterior: 'MW' }, '★ Karambit | Fade (Minimal Wear)'],
    ['faca sem ★ no nome', { category: 'FACA', name: 'Karambit | Fade', variant: 'NORMAL', exterior: 'WW' }, '★ Karambit | Fade (Well-Worn)'],
    ['faca StatTrak', { category: 'FACA', name: '★ Karambit | Fade', variant: 'STATTRAK', exterior: 'FN' }, '★ StatTrak™ Karambit | Fade (Factory New)'],
    ['luva', { category: 'LUVA', name: '★ Sport Gloves | Pandora\'s Box', variant: 'NORMAL', exterior: 'FT' }, '★ Sport Gloves | Pandora\'s Box (Field-Tested)'],
    ['faca vanilla (sem exterior)', { category: 'FACA', name: '★ Karambit', variant: 'NORMAL', exterior: null }, '★ Karambit'],
    ['faca vanilla StatTrak', { category: 'FACA', name: '★ Karambit', variant: 'STATTRAK', exterior: null }, '★ StatTrak™ Karambit'],
  ])('%s', (_label, subject, expected) => {
    const target = buildPriceTarget(subject);
    expect(target.marketHashName).toBe(expected);
    expect(target.paintIndex).toBeNull();
    expect(target.priceKey).toBe(`${expected}|`);
  });

  test('Doppler e Gamma Doppler: a mesma "Phase 2" vira índices diferentes', () => {
    const doppler = buildPriceTarget({ category: 'FACA', name: '★ Karambit | Doppler', variant: 'NORMAL', exterior: 'FN', phase: 'Phase 2' });
    const gamma = buildPriceTarget({ category: 'FACA', name: '★ Karambit | Gamma Doppler', variant: 'NORMAL', exterior: 'FN', phase: 'Phase 2' });
    expect(doppler).toMatchObject({ marketHashName: '★ Karambit | Doppler (Factory New)', paintIndex: 419, priceKey: '★ Karambit | Doppler (Factory New)|419' });
    expect(gamma).toMatchObject({ marketHashName: '★ Karambit | Gamma Doppler (Factory New)', paintIndex: 570 });
    expect(paintIndexOf({ category: 'FACA', name: '★ Karambit | Doppler', phase: 'Ruby' })).toBe(415);
    expect(paintIndexOf({ category: 'FACA', name: '★ Karambit | Gamma Doppler', phase: 'Emerald' })).toBe(568);
  });

  test('a fase também vem do catálogo quando o item não a tem', () => {
    const catalogById = new Map([['c1', { id: 'c1', phase: 'Phase 1' }]]);
    const target = buildPriceTarget({ category: 'FACA', name: '★ Karambit | Doppler', variant: 'NORMAL', exterior: 'FN', phase: null, catalogId: 'c1' }, { catalogById });
    expect(target.paintIndex).toBe(418);
  });

  test('fase sem índice conhecido, ou Doppler sem fase -> PHASE_UNMAPPED', () => {
    expect(buildPriceTarget(skin({ name: 'Glock-18 | Gamma Doppler', exterior: 'FN', phase: 'Phase 1' }))).toEqual({ notPriceable: 'PHASE_UNMAPPED' });
    expect(buildPriceTarget({ category: 'FACA', name: '★ Karambit | Doppler', variant: 'NORMAL', exterior: 'FN', phase: 'Fase Nova' })).toEqual({ notPriceable: 'PHASE_UNMAPPED' });
    expect(buildPriceTarget({ category: 'FACA', name: '★ Karambit | Doppler', variant: 'NORMAL', exterior: 'FN', phase: null })).toEqual({ notPriceable: 'PHASE_REQUIRED' });
    // B1 (D365): arma Doppler/Gamma Doppler sem fase também pede a fase; vanilla e skin comum seguem avaliáveis.
    expect(buildPriceTarget(skin({ name: 'Glock-18 | Gamma Doppler', exterior: 'FN', phase: null }))).toEqual({ notPriceable: 'PHASE_REQUIRED' });
    expect(buildPriceTarget(skin({ name: 'Glock-18 | Gamma Doppler', exterior: null, phase: null }))).toEqual({ notPriceable: 'NO_EXTERIOR' });
    expect(buildPriceTarget(skin({ name: 'AK-47 | Redline', exterior: 'FT', phase: null })).notPriceable).toBeUndefined();
  });

  test('arma sem exterior -> NO_EXTERIOR; nome vazio -> NOT_PRICEABLE', () => {
    expect(buildPriceTarget(skin({ exterior: null }))).toEqual({ notPriceable: 'NO_EXTERIOR' });
    expect(buildPriceTarget({ category: 'OUTRO', name: '   ' })).toEqual({ notPriceable: 'NOT_PRICEABLE' });
    expect(buildPriceTarget(null)).toEqual({ notPriceable: 'NOT_PRICEABLE' });
  });

  test('categorias sem exterior e componentes usam o nome como está (sem o pattern do chaveiro)', () => {
    expect(buildPriceTarget({ category: 'CAIXA', name: 'Revolver Case' }).priceKey).toBe('Revolver Case|');
    expect(buildPriceTarget({ category: 'PERSONAGEM', name: 'Bloody Darryl The Strapped | The Professionals' }).marketHashName).toBe('Bloody Darryl The Strapped | The Professionals');
    expect(buildPriceTarget({ category: 'OUTRO', name: 'Revolver Case Key' }).marketHashName).toBe('Revolver Case Key');
    expect(buildPriceTarget({ category: 'OUTRO', name: 'Patch | Crazy Banana' }).marketHashName).toBe('Patch | Crazy Banana');
    expect(buildPriceTarget({ kind: 'STICKER', name: 'Sticker | Titan | Katowice 2014' }).marketHashName).toBe('Sticker | Titan | Katowice 2014');
    expect(buildPriceTarget({ kind: 'CHARM', name: "Charm | Lil' Ava", pattern: 123 }).priceKey).toBe("Charm | Lil' Ava|");
    expect(buildPriceTarget({ kind: 'STICKER_SLAB', name: 'Sticker Slab | Titan | Katowice 2014' }).marketHashName).toBe('Sticker Slab | Titan | Katowice 2014');
    expect(buildPriceTarget({ kind: 'PATCH', name: 'Patch | The Boss' }).marketHashName).toBe('Patch | The Boss');
  });

  test('o float não entra na chave', () => {
    expect(buildPriceTarget(skin({ floatValue: 0.11 })).priceKey).toBe(buildPriceTarget(skin({ floatValue: 0.37 })).priceKey);
  });
});

describe('mapListingReference (exemplo real anonimizado)', () => {
  const DEAGLE = 'Desert Eagle | Trigger Discipline (Field-Tested)';
  const KARAMBIT = '★ Karambit | Doppler (Factory New)';

  test('Desert Eagle: lê base_price, quantidade e data; o price do anúncio (58) não é usado; paint_index 1050 aceito sem filtro', () => {
    const json = { data: [fakeListing({ marketHashName: DEAGLE, paintIndex: 1050, basePrice: 57, price: 58 })], cursor: 'x' };
    expect(mapListingReference(json, { marketHashName: DEAGLE, paintIndex: null })).toEqual({
      status: 'OK', basePriceCents: 57, referenceQuantity: 1943, sourceUpdatedAt: '2026-11-24T18:57:01.089Z',
    });
  });

  test('leilão com price 32352 e base_price 89000: grava a referência, nunca o price do anúncio', () => {
    const json = { data: [fakeListing({ marketHashName: KARAMBIT, paintIndex: 418, basePrice: 89000, price: 32352, type: 'auction', stickerOverpay: {} })] };
    const mapped = mapListingReference(json, { marketHashName: KARAMBIT, paintIndex: 418 });
    expect(mapped.status).toBe('OK');
    expect(mapped.basePriceCents).toBe(89000);
    expect(JSON.stringify(mapped)).not.toContain('32352');
  });

  test('aceita o corpo como array', () => {
    const mapped = mapListingReference([fakeListing({ marketHashName: DEAGLE, basePrice: 57 })], { marketHashName: DEAGLE });
    expect(mapped).toMatchObject({ status: 'OK', basePriceCents: 57 });
  });

  test('lista vazia, reference ausente, base_price inválido ou negativo -> NOT_FOUND', () => {
    const notFound = { status: 'NOT_FOUND', basePriceCents: null, referenceQuantity: null, sourceUpdatedAt: null };
    expect(mapListingReference({ data: [] }, { marketHashName: DEAGLE })).toEqual(notFound);
    expect(mapListingReference({ data: [fakeListing({ marketHashName: DEAGLE, reference: null })] }, { marketHashName: DEAGLE })).toEqual(notFound);
    expect(mapListingReference({ data: [fakeListing({ marketHashName: DEAGLE, reference: { base_price: 'abc' } })] }, { marketHashName: DEAGLE })).toEqual(notFound);
    expect(mapListingReference({ data: [fakeListing({ marketHashName: DEAGLE, reference: { base_price: -5 } })] }, { marketHashName: DEAGLE })).toEqual(notFound);
    expect(mapListingReference({ data: [fakeListing({ marketHashName: DEAGLE, reference: { base_price: '57', quantity: 'x', last_updated: 'ontem' } })] }, { marketHashName: DEAGLE }))
      .toEqual({ status: 'OK', basePriceCents: 57, referenceQuantity: null, sourceUpdatedAt: null });
  });

  test.each([
    ['pedido 418 e anúncio 419', { marketHashName: KARAMBIT, paintIndex: 419 }, { marketHashName: KARAMBIT, paintIndex: 418 }],
    ['nome diferente do pedido', { marketHashName: 'Outro Item (Field-Tested)', paintIndex: 1050 }, { marketHashName: DEAGLE, paintIndex: null }],
  ])('%s -> NOT_FOUND (anúncio de outro item, M2; nunca devolve o preço dele)', (_label, listing, request) => {
    expect(mapListingReference({ data: [fakeListing({ ...listing, basePrice: 100 })] }, request))
      .toEqual({ status: 'NOT_FOUND', basePriceCents: null, referenceQuantity: null, sourceUpdatedAt: null });
  });

  test.each([['objeto qualquer', { foo: 1 }], ['texto', 'x'], ['nulo', null], ['data não é lista', { data: {} }], ['anúncio não é objeto', { data: [1] }], ['sem item', { data: [{ reference: { base_price: 5 } }] }]])(
    '%s -> IMPORT_SOURCE_FORMAT_CHANGED', (_label, json) => {
      expect(() => mapListingReference(json, { marketHashName: DEAGLE })).toThrow(expect.objectContaining({ code: 'IMPORT_SOURCE_FORMAT_CHANGED' }));
    }
  );

  test('privacidade: a saída não tem vendedor, ids, inspect_link, preço do anúncio, float nem predicted_price', () => {
    const json = { data: [fakeListing({ marketHashName: DEAGLE, basePrice: 57, price: 58 })], cursor: 'CURSOR-FICTICIO' };
    const mapped = mapListingReference(json, { marketHashName: DEAGLE });
    expect(Object.keys(mapped).sort()).toEqual(['basePriceCents', 'referenceQuantity', 'sourceUpdatedAt', 'status']);
    const text = JSON.stringify(mapped);
    for (const marker of Object.values(LISTING_PII)) expect(text).not.toContain(marker);
    for (const word of ['seller', 'asset_id', 'inspect', 'predicted', 'float', 'CURSOR', 'sticker_overpay', 'FaZe']) expect(text).not.toContain(word);
  });
});

describe('csfloatAdapter.getReferencePrice', () => {
  test('a requisição leva só market_hash_name, paint_index (quando há), sort_by=lowest_price e limit=1, sem type', async () => {
    const fetchFn = routedListings({ '★ Karambit | Doppler (Factory New)': 89000, 'AK-47 | Redline (Field-Tested)': 1200 });
    await csfloatAdapter.getReferencePrice({ apiKey: KEY, marketHashName: '★ Karambit | Doppler (Factory New)', paintIndex: 418, fetchFn });
    await csfloatAdapter.getReferencePrice({ apiKey: KEY, marketHashName: 'AK-47 | Redline (Field-Tested)', fetchFn });
    expect(fetchFn.calls[0]).toMatchObject({ path: '/listings', query: { market_hash_name: '★ Karambit | Doppler (Factory New)', paint_index: '418', sort_by: 'lowest_price', limit: '1' } });
    expect(Object.keys(fetchFn.calls[0].query).sort()).toEqual(['limit', 'market_hash_name', 'paint_index', 'sort_by']);
    expect(Object.keys(fetchFn.calls[1].query).sort()).toEqual(['limit', 'market_hash_name', 'sort_by']);
    expect(fetchFn.calls[0].init.method).toBe('GET');
    expect(csfloatAdapter.capabilities.valuation).toBe(true);
  });

  test('devolve o limite de uso lido dos headers', async () => {
    const fetchFn = routedListings({ 'AK-47 | Redline (Field-Tested)': 1200 });
    const res = await csfloatAdapter.getReferencePrice({ apiKey: KEY, marketHashName: 'AK-47 | Redline (Field-Tested)', fetchFn });
    expect(res.rateLimit).toMatchObject({ limit: 200, remaining: 199 });
    expect(res.rateLimit.resetAt).toBe(new Date(1795557734 * 1000).toISOString());
  });
});

describe('valueUnit e totais', () => {
  const csfloatStore = { id: 1, name: 'CSFloat', currency: 'USD', saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeeRounding: 'CEIL', saleMinFeeCents: null, saleFixedFeeCents: 0 };
  const costIndex = (usd, estimated = false) => ({ effectiveOf: () => ({ effectiveUsdCents: usd, estimated }) });
  const row = (basePriceCents, pricedAt = '2026-11-24T10:00:00.000Z', status = 'OK') => ({ status, basePriceCents, pricedAt, fetchedAt: pricedAt });
  const ak = (extra = {}) => ({ id: 1, status: 'EM_ESTOQUE', category: 'SKIN', name: 'AK-47 | Redline', variant: 'NORMAL', exterior: 'FT', phase: null, ...extra });
  const prices = (map) => (key) => map[key] ?? null;
  const AK_KEY = 'AK-47 | Redline (Field-Tested)|';

  test('valor, lucro bruto e líquido da taxa da loja da integração (2%)', () => {
    const v = valueUnit({ item: ak(), priceOf: prices({ [AK_KEY]: row(1000) }), costIndex: costIndex(600), saleStore: csfloatStore, now: NOW });
    expect(v).toMatchObject({
      status: 'OK', marketValueUsdCents: 1000, costUsdCents: 600, unrealizedUsdCents: 400, unrealizedNetUsdCents: 1000 - 20 - 600, netUnavailableReason: null,
      isStale: false, isComplete: true, missing: [], basis: 'NAME', isEstimated: true, costEstimated: false,
    });
    expect(v.parts).toEqual({ baseCents: 1000, hangingCents: null, stickersInfoCents: 0, patchesInfoCents: 0 });
  });

  test('GANHEI (custo 0) e compra em BRL (custo estimado)', () => {
    expect(valueUnit({ item: ak(), priceOf: prices({ [AK_KEY]: row(500) }), costIndex: costIndex(0), saleStore: csfloatStore, now: NOW }).unrealizedUsdCents).toBe(500);
    const brl = valueUnit({ item: ak(), priceOf: prices({ [AK_KEY]: row(500) }), costIndex: costIndex(300, true), saleStore: csfloatStore, now: NOW });
    expect(brl.costEstimated).toBe(true);
  });

  test('chaveiro soma; sticker e patch ficam só como informação; chaveiro sem preço deixa o valor incompleto', () => {
    const components = [
      { kind: 'STICKER', name: 'Sticker | A' }, { kind: 'STICKER', name: 'Sticker | B' }, { kind: 'PATCH', name: 'Patch | P' }, { kind: 'CHARM', name: 'Charm | C' },
    ];
    const map = { [AK_KEY]: row(1000), 'Sticker | A|': row(30), 'Sticker | B|': row(70), 'Patch | P|': row(15), 'Charm | C|': row(250) };
    const full = valueUnit({ item: ak(), components, priceOf: prices(map), costIndex: costIndex(100), saleStore: csfloatStore, now: NOW });
    expect(full.marketValueUsdCents).toBe(1250);
    expect(full.parts).toEqual({ baseCents: 1000, hangingCents: 250, stickersInfoCents: 100, patchesInfoCents: 15 });
    expect(full.isComplete).toBe(true);
    const { 'Charm | C|': _charm, ...withoutCharm } = map;
    const partial = valueUnit({ item: ak(), components, priceOf: prices(withoutCharm), costIndex: costIndex(100), saleStore: csfloatStore, now: NOW });
    expect(partial).toMatchObject({ marketValueUsdCents: 1000, isComplete: false, missing: ['HANGING'] });
    const slab = valueUnit({ item: ak(), components: [{ kind: 'STICKER_SLAB', name: 'Sticker Slab | A' }], priceOf: prices({ [AK_KEY]: row(1000), 'Sticker Slab | A|': row(40) }), costIndex: costIndex(0), now: NOW });
    expect(slab.marketValueUsdCents).toBe(1040);
  });

  test('sem preço do item igual: sem valor, mesmo com o chaveiro avaliado', () => {
    const v = valueUnit({ item: ak(), components: [{ kind: 'CHARM', name: 'Charm | C' }], priceOf: prices({ 'Charm | C|': row(250) }), costIndex: costIndex(100), now: NOW });
    expect(v).toMatchObject({ status: 'NO_PRICE', marketValueUsdCents: null, unrealizedUsdCents: null, costUsdCents: 100 });
  });

  test('B2: NO_PRICE traz o motivo (NOT_FETCHED sem linha; NOT_FOUND sem preço anterior); com preço anterior segue OK desatualizado', () => {
    const base = { item: ak(), costIndex: costIndex(100), now: NOW };
    expect(valueUnit({ ...base, priceOf: prices({}) })).toMatchObject({ status: 'NO_PRICE', reason: 'NOT_FETCHED' });
    const notFound = { status: 'NOT_FOUND', basePriceCents: null, pricedAt: null, fetchedAt: '2026-11-24T10:00:00.000Z' };
    expect(valueUnit({ ...base, priceOf: prices({ [AK_KEY]: notFound }) })).toMatchObject({ status: 'NO_PRICE', reason: 'NOT_FOUND' });
    expect(valueUnit({ ...base, priceOf: prices({ [AK_KEY]: row(1000, '2026-11-24T10:00:00.000Z', 'NOT_FOUND') }) })).toMatchObject({ status: 'OK', isStale: true, reason: null });
  });

  test('B3: netUnits conta as unidades com valor e líquido; sem loja da integração = 0 e líquido 0', () => {
    const priceOf = prices({ [AK_KEY]: row(1000) });
    const withStore = valueUnit({ item: ak(), priceOf, costIndex: costIndex(100), saleStore: csfloatStore, now: NOW });
    const noStore = valueUnit({ item: ak({ id: 2 }), priceOf, costIndex: costIndex(100), saleStore: null, now: NOW });
    expect(summarize([withStore, noStore])).toMatchObject({ pricedUnits: 2, netUnits: 1 });
    expect(summarize([noStore])).toMatchObject({ pricedUnits: 1, netUnits: 0, unrealizedNetUsdCents: 0 });
  });

  test('item não avaliável traz o motivo; vendida e consumida = null', () => {
    expect(valueUnit({ item: ak({ exterior: null }), priceOf: prices({}), costIndex: costIndex(1), now: NOW })).toMatchObject({ status: 'NOT_PRICEABLE', reason: 'NO_EXTERIOR' });
    expect(valueUnit({ item: ak({ status: 'VENDIDO' }), priceOf: prices({}), costIndex: costIndex(1), now: NOW })).toBeNull();
    expect(valueUnit({ item: ak({ status: 'CONSUMIDO' }), priceOf: prices({}), costIndex: costIndex(1), now: NOW })).toBeNull();
  });

  test.each([
    ['sem loja da integração', null, 'NO_INTEGRATION_STORE'],
    ['loja sem taxas', { ...csfloatStore, saleFeeType: null, saleFeeRate: null }, 'FEES_NOT_CONFIGURED'],
  ])('%s: líquido nulo com o motivo', (_label, store, reason) => {
    const v = valueUnit({ item: ak(), priceOf: prices({ [AK_KEY]: row(1000) }), costIndex: costIndex(100), saleStore: store, now: NOW });
    expect(v).toMatchObject({ unrealizedNetUsdCents: null, netUnavailableReason: reason, unrealizedUsdCents: 900 });
  });

  test('valor 0 e líquido negativo: líquido não calculável', () => {
    const zero = valueUnit({ item: ak(), priceOf: prices({ [AK_KEY]: row(0) }), costIndex: costIndex(100), saleStore: csfloatStore, now: NOW });
    expect(zero).toMatchObject({ status: 'OK', marketValueUsdCents: 0, unrealizedNetUsdCents: null, netUnavailableReason: 'NET_NOT_COMPUTABLE' });
    const fixed = { ...csfloatStore, saleFixedFeeCents: 50 };
    const tiny = valueUnit({ item: ak(), priceOf: prices({ [AK_KEY]: row(10) }), costIndex: costIndex(1), saleStore: fixed, now: NOW });
    expect(tiny.netUnavailableReason).toBe('NET_NOT_COMPUTABLE');
  });

  test('desatualizado: preço há mais de 24 h, ou última tentativa NOT_FOUND com preço antigo', () => {
    expect(isStaleRow(row(1, '2026-11-23T12:00:01.000Z'), NOW)).toBe(false);
    expect(isStaleRow(row(1, '2026-11-23T11:59:59.000Z'), NOW)).toBe(true);
    expect(isStaleRow(row(1, '2026-11-24T11:00:00.000Z', 'NOT_FOUND'), NOW)).toBe(true);
    expect(isStaleRow({ status: 'NOT_FOUND', basePriceCents: null, pricedAt: null }, NOW)).toBe(false);
    const v = valueUnit({ item: ak(), priceOf: prices({ [AK_KEY]: row(1000, '2026-11-20T00:00:00.000Z') }), costIndex: costIndex(1), now: NOW });
    expect(v.isStale).toBe(true);
  });

  test('summarize soma só as unidades com valor e conta as demais; componentShares dá as proporções', () => {
    const a = valueUnit({ item: ak({ id: 1 }), priceOf: prices({ [AK_KEY]: row(1000) }), costIndex: costIndex(600), saleStore: csfloatStore, now: NOW });
    const b = valueUnit({ item: ak({ id: 2 }), priceOf: prices({}), costIndex: costIndex(300), now: NOW });
    const c = valueUnit({ item: ak({ id: 3, exterior: null }), priceOf: prices({}), costIndex: costIndex(300), now: NOW });
    const d = valueUnit({ item: ak({ id: 4, status: 'VENDIDO' }), priceOf: prices({}), costIndex: costIndex(300), now: NOW });
    expect(summarize([a, b, c, d])).toMatchObject({
      marketValueUsdCents: 1000, costUsdCents: 600, unrealizedUsdCents: 400, unrealizedNetUsdCents: 380, pricedUnits: 1, unpricedUnits: 1, notPriceableUnits: 1, unitCount: 3,
    });
    const withCharm = valueUnit({ item: ak(), components: [{ kind: 'CHARM', name: 'Charm | C' }], priceOf: prices({ [AK_KEY]: row(750), 'Charm | C|': row(250) }), costIndex: costIndex(0), now: NOW });
    expect(componentShares(withCharm)).toEqual({ base: 0.75, hanging: 0.25 });
    expect(componentShares(b)).toBeNull();
  });
});
