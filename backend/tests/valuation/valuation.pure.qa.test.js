'use strict';

// 10.5 (D364, Adendo 1): complementos de QA das partes puras: nome de mercado, mapper/adapter (privacidade, chave só no header),
// ordenação das chaves a buscar e valor da unidade. Sem rede; dados INVENTADOS.
const { buildPriceTarget, paintIndexOf } = require('../../src/services/valuation/marketHashName');
const { DOPPLER_PHASES } = require('../../src/services/imports/adapters/csfloatStates');
const { mapListingReference } = require('../../src/services/imports/adapters/csfloatMapper');
const csfloatAdapter = require('../../src/services/imports/adapters/csfloatAdapter');
const { valueUnit, summarize, isStaleRow } = require('../../src/services/valuation/valuationService');
const { collectTargets, pickStale } = require('../../src/services/valuation/marketValueService');
const { fakeListing, routedListings } = require('../helpers/listingFixtures');
const { KEY } = require('../helpers/csfloatFixtures');

const NOW = new Date('2026-11-24T12:00:00.000Z');
const HOUR = 3600000;

describe('marketHashName: complementos', () => {
  test('toda fase da tabela vira o mesmo índice na ida e na volta (Doppler e Gamma Doppler)', () => {
    for (const [index, phase] of Object.entries(DOPPLER_PHASES)) {
      const finish = Number(index) >= 568 ? 'Gamma Doppler' : 'Doppler';
      const target = buildPriceTarget({ category: 'FACA', name: `★ Butterfly Knife | ${finish}`, variant: 'NORMAL', exterior: 'FN', phase });
      expect(target.paintIndex).toBe(Number(index));
    }
  });

  test('a fase em minúsculas e com espaços sobrantes ainda acha o índice', () => {
    expect(paintIndexOf({ category: 'FACA', name: '★ Karambit | Doppler', phase: '  phase 3 ' })).toBe(420);
  });

  test('faca vanilla com exterior preenchido continua sem exterior no nome', () => {
    expect(buildPriceTarget({ category: 'FACA', name: '★ Karambit', variant: 'NORMAL', exterior: 'FN' }).marketHashName).toBe('★ Karambit');
  });

  test('★ não é duplicado quando o nome já o traz, nem acrescentado em SKIN', () => {
    expect(buildPriceTarget({ category: 'LUVA', name: '★ Sport Gloves | Vice', variant: 'NORMAL', exterior: 'BS' }).marketHashName).toBe('★ Sport Gloves | Vice (Battle-Scarred)');
    expect(buildPriceTarget({ category: 'SKIN', name: 'AK-47 | Redline', variant: 'NORMAL', exterior: 'FT' }).marketHashName).not.toContain('★');
  });

  test('exterior inválido -> NO_EXTERIOR; nome com espaços nas pontas é aparado', () => {
    expect(buildPriceTarget({ category: 'SKIN', name: 'AK-47 | Redline', variant: 'NORMAL', exterior: 'XX' })).toEqual({ notPriceable: 'NO_EXTERIOR' });
    expect(buildPriceTarget({ category: 'SKIN', name: '  AK-47 | Redline  ', variant: 'NORMAL', exterior: 'MW' }).marketHashName).toBe('AK-47 | Redline (Minimal Wear)');
  });

  test('variante/exterior/fase em categorias sem exterior são ignorados (caixa, agente, cápsula)', () => {
    expect(buildPriceTarget({ category: 'CAIXA', name: 'Revolver Case', variant: 'STATTRAK', exterior: 'FN' }).marketHashName).toBe('Revolver Case');
    expect(buildPriceTarget({ category: 'PERSONAGEM', name: 'Agent X', exterior: 'FN' }).priceKey).toBe('Agent X|');
  });

  test('componente sem nome gravado usa o nome do catálogo; sem nenhum -> NOT_PRICEABLE', () => {
    const catalogById = new Map([['s1', { id: 's1', name: 'Sticker | Do Catalogo' }]]);
    expect(buildPriceTarget({ kind: 'STICKER', catalogId: 's1' }, { catalogById }).marketHashName).toBe('Sticker | Do Catalogo');
    expect(buildPriceTarget({ kind: 'STICKER', catalogId: 'zz' }, { catalogById })).toEqual({ notPriceable: 'NOT_PRICEABLE' });
  });

  test('Doppler em arma (não faca) com fase: PHASE_UNMAPPED (desvio declarado); sem fase pede a fase (B1, D365)', () => {
    expect(buildPriceTarget({ category: 'SKIN', name: 'Glock-18 | Gamma Doppler', variant: 'NORMAL', exterior: 'FN', phase: 'Phase 2' })).toEqual({ notPriceable: 'PHASE_UNMAPPED' });
    const noPhase = buildPriceTarget({ category: 'SKIN', name: 'Glock-18 | Gamma Doppler', variant: 'NORMAL', exterior: 'FN', phase: null });
    expect(noPhase).toEqual({ notPriceable: 'PHASE_REQUIRED' });
  });
});

describe('mapListingReference: complementos', () => {
  const NAME = 'AK-47 | Redline (Field-Tested)';

  test('base_price 0 é um preço válido (OK com 0), não NOT_FOUND', () => {
    expect(mapListingReference({ data: [fakeListing({ marketHashName: NAME, reference: { base_price: 0 } })] }, { marketHashName: NAME }))
      .toMatchObject({ status: 'OK', basePriceCents: 0 });
  });

  test('base_price decimal, em texto com sinal ou notação científica -> NOT_FOUND (nunca arredonda)', () => {
    for (const bad of [57.5, '57.5', '-1', '1e3', ' 57', '', null, {}, [], true]) {
      expect(mapListingReference({ data: [fakeListing({ marketHashName: NAME, reference: { base_price: bad } })] }, { marketHashName: NAME }).status).toBe('NOT_FOUND');
    }
  });

  test('só o primeiro anúncio vale; os demais (inclusive de outro nome) são ignorados', () => {
    const json = { data: [fakeListing({ marketHashName: NAME, basePrice: 10 }), fakeListing({ marketHashName: 'Outro', basePrice: 999 })] };
    expect(mapListingReference(json, { marketHashName: NAME }).basePriceCents).toBe(10);
  });

  test('o nome tem de ser idêntico (maiúsculas e espaços contam)', () => {
    expect(() => mapListingReference({ data: [fakeListing({ marketHashName: NAME.toLowerCase() })] }, { marketHashName: NAME })).toThrow(expect.objectContaining({ code: 'IMPORT_SOURCE_FORMAT_CHANGED' }));
    expect(() => mapListingReference({ data: [fakeListing({ marketHashName: `${NAME} ` })] }, { marketHashName: NAME })).toThrow(expect.objectContaining({ code: 'IMPORT_SOURCE_FORMAT_CHANGED' }));
  });

  test('paint_index pedido e anúncio sem paint_index -> FORMAT_CHANGED; pedido nulo ignora o do anúncio', () => {
    const listing = fakeListing({ marketHashName: NAME });
    delete listing.item.paint_index;
    expect(() => mapListingReference({ data: [listing] }, { marketHashName: NAME, paintIndex: 418 })).toThrow(expect.objectContaining({ code: 'IMPORT_SOURCE_FORMAT_CHANGED' }));
    expect(mapListingReference({ data: [listing] }, { marketHashName: NAME, paintIndex: null }).status).toBe('OK');
  });

  test('o erro de formato não carrega o conteúdo do anúncio (nome, vendedor, ids)', () => {
    let error;
    try {
      mapListingReference({ data: [fakeListing({ marketHashName: 'Item de Outro Vendedor' })] }, { marketHashName: NAME });
    } catch (err) {
      error = err;
    }
    const text = JSON.stringify({ message: error.message, code: error.code, params: error.params });
    for (const word of ['Outro Vendedor', 'vendedor-ficticio-qa', '76561190000000777', '999000111222333444']) expect(text).not.toContain(word);
  });

  test('reference com campos extras (float_factor, predicted_price) nunca vaza para a saída', () => {
    const mapped = mapListingReference({ data: [fakeListing({ marketHashName: NAME, basePrice: 10 })] }, { marketHashName: NAME });
    expect(JSON.stringify(mapped)).not.toMatch(/95354|1\.07|float_factor|predicted/);
  });
});

describe('csfloatAdapter.getReferencePrice: chave e requisição', () => {
  test('a chave vai só no header Authorization, nunca na URL; só GET e sem corpo', async () => {
    const fetchFn = routedListings({ 'AK-47 | Redline (Field-Tested)': 10 });
    await csfloatAdapter.getReferencePrice({ apiKey: KEY, marketHashName: 'AK-47 | Redline (Field-Tested)', fetchFn });
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).not.toContain(KEY);
    expect(init.headers.Authorization).toBe(KEY);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  test('nome com acentos, ™ e ★ viaja codificado e volta idêntico', async () => {
    const name = '★ StatTrak™ Karambit | Doppler (Factory New)';
    const fetchFn = routedListings({ [name]: 5 });
    const res = await csfloatAdapter.getReferencePrice({ apiKey: KEY, marketHashName: name, paintIndex: 419, fetchFn });
    expect(fetchFn.calls[0].query.market_hash_name).toBe(name);
    expect(res.status).toBe('OK');
  });

  test('sem headers de limite, rateLimit vem nulo/sem remaining (a rodada usa o teto de segurança)', async () => {
    const fetchFn = routedListings({ A: 1 }, { remaining: null });
    const res = await csfloatAdapter.getReferencePrice({ apiKey: KEY, marketHashName: 'A', fetchFn });
    expect(res.rateLimit === null || res.rateLimit === undefined || res.rateLimit.remaining === null || res.rateLimit.remaining === undefined).toBe(true);
  });
});

describe('collectTargets e pickStale', () => {
  const stock = (id, extra = {}) => ({ id, status: 'EM_ESTOQUE', category: 'SKIN', name: 'AK-47 | Redline', variant: 'NORMAL', exterior: 'FT', phase: null, ...extra });
  const AK = 'AK-47 | Redline (Field-Tested)|';

  test('prioridade 1 itens, 2 pendurados, 3 stickers/patches; chave repetida conta uma vez; vendido/consumido fora', () => {
    const items = [stock(1), stock(2), stock(3, { exterior: 'MW' }), stock(4, { status: 'VENDIDO', exterior: 'WW' }), stock(5, { status: 'CONSUMIDO', exterior: 'BS' })];
    const componentsByItemId = new Map([
      [1, [{ kind: 'STICKER', name: 'Sticker | A' }, { kind: 'PATCH', name: 'Patch | P' }, { kind: 'CHARM', name: 'Charm | C' }]],
      [2, [{ kind: 'STICKER', name: 'Sticker | A' }, { kind: 'STICKER_SLAB', name: 'Sticker Slab | S' }]],
      [4, [{ kind: 'STICKER', name: 'Sticker | DoVendido' }]],
    ]);
    const { targets } = collectTargets({ items, componentsByItemId });
    const byKey = Object.fromEntries(targets.map((t) => [t.priceKey, t.level]));
    expect(byKey).toEqual({
      [AK]: 1, 'AK-47 | Redline (Minimal Wear)|': 1, 'Sticker | A|': 3, 'Patch | P|': 3, 'Charm | C|': 2, 'Sticker Slab | S|': 2,
    });
    expect(targets).toHaveLength(6);
  });

  test('uma chave que é item e componente ao mesmo tempo fica no nível mais alto (1)', () => {
    const items = [stock(1), stock(2, { category: 'STICKER', name: 'Sticker | A', exterior: null })];
    const { targets } = collectTargets({ items, componentsByItemId: new Map([[1, [{ kind: 'STICKER', name: 'Sticker | A' }]]]) });
    expect(targets.find((t) => t.priceKey === 'Sticker | A|').level).toBe(1);
  });

  test('unidades não avaliáveis são contadas e não geram chave; componente sem nome é ignorado', () => {
    const { targets, notPriceableUnits } = collectTargets({
      items: [stock(1, { exterior: null }), stock(2)],
      componentsByItemId: new Map([[2, [{ kind: 'STICKER', name: '' }]]]),
    });
    expect(notPriceableUnits).toBe(1);
    expect(targets.map((t) => t.priceKey)).toEqual([AK]);
  });

  test('pickStale: em dia fica de fora (24 h exatas ainda em dia, 24 h + 1 ms desatualizado); nunca buscadas primeiro, depois a mais antiga, por nível', () => {
    const t = (key, level) => ({ priceKey: key, level });
    const ago = (ms) => ({ fetchedAt: new Date(NOW.getTime() - ms).toISOString() });
    const rows = new Map([
      ['fresh', ago(24 * HOUR)], ['old1', ago(48 * HOUR)], ['old2', ago(30 * HOUR)], ['edge', ago(24 * HOUR + 1)], ['lvl1old', ago(100 * HOUR)],
    ]);
    const queue = pickStale([t('fresh', 1), t('old2', 2), t('never2', 2), t('old1', 2), t('lvl1old', 1), t('edge', 3), t('never3', 3)], rows, NOW);
    expect(queue.map((x) => x.priceKey)).toEqual(['lvl1old', 'never2', 'old1', 'old2', 'never3', 'edge']);
  });
});

describe('valueUnit: complementos', () => {
  const store = { id: 1, name: 'CSFloat', currency: 'USD', saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeeRounding: 'CEIL', saleMinFeeCents: null, saleFixedFeeCents: 0 };
  const costIndex = (usd) => ({ effectiveOf: () => ({ effectiveUsdCents: usd, estimated: false }) });
  const row = (basePriceCents, pricedAt = '2026-11-24T10:00:00.000Z', status = 'OK') => ({ status, basePriceCents, pricedAt, fetchedAt: pricedAt });
  const ak = (extra = {}) => ({ id: 1, status: 'EM_ESTOQUE', category: 'SKIN', name: 'AK-47 | Redline', variant: 'NORMAL', exterior: 'FT', phase: null, ...extra });
  const AK = 'AK-47 | Redline (Field-Tested)|';
  const prices = (map) => (key) => map[key] ?? null;

  test('lucro não realizado negativo (valor abaixo do custo) é preservado com sinal', () => {
    const v = valueUnit({ item: ak(), priceOf: prices({ [AK]: row(500) }), costIndex: costIndex(800), saleStore: store, now: NOW });
    expect(v.unrealizedUsdCents).toBe(-300);
    expect(v.unrealizedNetUsdCents).toBe(500 - 10 - 800);
  });

  test('taxa de 2% arredonda para cima no líquido (CEIL): valor 1001 -> taxa 21', () => {
    const v = valueUnit({ item: ak(), priceOf: prices({ [AK]: row(1001) }), costIndex: costIndex(0), saleStore: store, now: NOW });
    expect(v.unrealizedNetUsdCents).toBe(1001 - 21);
  });

  test('item em trade lock e GANHEI/GERADO contam igual (só o status EM_ESTOQUE importa)', () => {
    const locked = valueUnit({ item: ak({ tradeUnlockAt: '2026-12-01T00:00:00.000Z', acquisitionType: 'GERADO' }), priceOf: prices({ [AK]: row(1000) }), costIndex: costIndex(0), now: NOW });
    expect(locked).toMatchObject({ status: 'OK', marketValueUsdCents: 1000 });
  });

  test('custo desconhecido (null) deixa o lucro nulo mas mantém o valor', () => {
    const v = valueUnit({ item: ak(), priceOf: prices({ [AK]: row(1000) }), costIndex: costIndex(null), saleStore: store, now: NOW });
    expect(v).toMatchObject({ marketValueUsdCents: 1000, costUsdCents: null, unrealizedUsdCents: null, unrealizedNetUsdCents: null });
  });

  test('chaveiro desatualizado marca a unidade como desatualizada e pricedAt é o mais antigo', () => {
    const v = valueUnit({
      item: ak(), components: [{ kind: 'CHARM', name: 'Charm | C' }], costIndex: costIndex(0), now: NOW,
      priceOf: prices({ [AK]: row(1000, '2026-11-24T10:00:00.000Z'), 'Charm | C|': row(100, '2026-11-20T10:00:00.000Z') }),
    });
    expect(v).toMatchObject({ isStale: true, pricedAt: '2026-11-20T10:00:00.000Z' });
  });

  test('sticker ou patch NÃO avaliado não deixa a unidade incompleta (só o pendurado conta); sticker sem preço não soma nada', () => {
    const v = valueUnit({ item: ak(), components: [{ kind: 'STICKER', name: 'Sticker | Sem Preco' }, { kind: 'PATCH', name: 'Patch | Sem' }], priceOf: prices({ [AK]: row(1000) }), costIndex: costIndex(0), now: NOW });
    expect(v).toMatchObject({ isComplete: true, marketValueUsdCents: 1000, parts: { stickersInfoCents: 0, patchesInfoCents: 0 } });
  });

  test('dois pendurados (dado inconsistente) somam; um componente não avaliável (sem nome) conta como sem preço', () => {
    const two = valueUnit({
      item: ak(), components: [{ kind: 'CHARM', name: 'Charm | A' }, { kind: 'STICKER_SLAB', name: 'Sticker Slab | B' }], costIndex: costIndex(0), now: NOW,
      priceOf: prices({ [AK]: row(1000), 'Charm | A|': row(10), 'Sticker Slab | B|': row(20) }),
    });
    expect(two.marketValueUsdCents).toBe(1030);
    const unnamed = valueUnit({ item: ak(), components: [{ kind: 'CHARM', name: '' }], priceOf: prices({ [AK]: row(1000) }), costIndex: costIndex(0), now: NOW });
    expect(unnamed).toMatchObject({ isComplete: false, missing: ['HANGING'] });
  });

  test('linha NOT_FOUND sem preço anterior = NO_PRICE; com preço anterior vale o preço antigo e fica desatualizada', () => {
    const none = valueUnit({ item: ak(), priceOf: prices({ [AK]: { status: 'NOT_FOUND', basePriceCents: null, pricedAt: null, fetchedAt: NOW.toISOString() } }), costIndex: costIndex(0), now: NOW });
    expect(none.status).toBe('NO_PRICE');
    const old = valueUnit({ item: ak(), priceOf: prices({ [AK]: row(700, '2026-11-24T11:00:00.000Z', 'NOT_FOUND') }), costIndex: costIndex(0), now: NOW });
    expect(old).toMatchObject({ status: 'OK', marketValueUsdCents: 700, isStale: true });
    expect(isStaleRow(row(700, '2026-11-24T11:00:00.000Z', 'NOT_FOUND'), NOW)).toBe(true);
  });

  test('summarize: custo nulo não entra na soma do custo nem do lucro; staleUnits conta só as com valor; lista vazia = zeros', () => {
    const a = valueUnit({ item: ak({ id: 1 }), priceOf: prices({ [AK]: row(1000, '2026-11-01T00:00:00.000Z') }), costIndex: costIndex(null), now: NOW });
    const b = valueUnit({ item: ak({ id: 2 }), priceOf: prices({ [AK]: row(500) }), costIndex: costIndex(200), now: NOW });
    expect(summarize([a, b])).toMatchObject({ marketValueUsdCents: 1500, costUsdCents: 200, unrealizedUsdCents: 300, staleUnits: 1, pricedUnits: 2 });
    expect(summarize([])).toMatchObject({ marketValueUsdCents: 0, costUsdCents: 0, unrealizedUsdCents: 0, unrealizedNetUsdCents: 0, unitCount: 0, costEstimated: false });
    expect(summarize([null, null]).unitCount).toBe(0);
  });
});
