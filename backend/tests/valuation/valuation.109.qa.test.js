'use strict';

// 10.9 (D368, QA, E-P2-Q56): fases da Glock-18 | Gamma Doppler (paint_index 1119-1123) na avaliação. Complementa valuation.106.qa e
// valuation.pure(.qa): aqui só o que ainda não estava coberto (as cinco fases em FN e MW, StatTrak, normalização do texto da fase, fases de
// outro acabamento, a faca nunca usando a tabela da Glock e a salvaguarda de paint_index divergente). Sem rede e sem o banco real.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { createApp } = require('../../src/app');
const { freshDb } = require('../helpers/fixtures');
const { importCatalogFixture } = require('../helpers/catalog');
const { purchaseBody } = require('../helpers/apiFixtures');
const CatalogItem = require('../../src/models/CatalogItem');
const { buildPriceTarget, phaseTableOf, paintIndexOf } = require('../../src/services/valuation/marketHashName');
const { DOPPLER_PHASES, DOPPLER_PHASES_BY_FINISH } = require('../../src/services/imports/adapters/csfloatStates');
const { mapListingReference } = require('../../src/services/imports/adapters/csfloatMapper');
const { fakeListing } = require('../helpers/listingFixtures');
const { KEY, fakeResponse } = require('../helpers/csfloatFixtures');
const marketValueService = require('../../src/services/valuation/marketValueService');
const importService = require('../../src/services/imports/importService');

const GLOCK = 'Glock-18 | Gamma Doppler';
const PHASES = [['Emerald', 1119], ['Phase 1', 1120], ['Phase 2', 1121], ['Phase 3', 1122], ['Phase 4', 1123]];
const glock = (extra = {}) => ({ category: 'SKIN', name: GLOCK, variant: 'NORMAL', exterior: 'FN', phase: 'Phase 1', ...extra });
const knife = (finish, extra = {}) => ({ category: 'FACA', name: `★ Karambit | ${finish}`, variant: 'NORMAL', exterior: 'FN', phase: 'Phase 1', ...extra });

describe('tabelas de fase por acabamento', () => {
  test('a Glock tem exatamente 1119-1123 e a união plana não repete índice entre acabamentos', () => {
    expect(DOPPLER_PHASES_BY_FINISH.GLOCK_GAMMA_DOPPLER).toEqual({ 1119: 'Emerald', 1120: 'Phase 1', 1121: 'Phase 2', 1122: 'Phase 3', 1123: 'Phase 4' });
    const total = Object.values(DOPPLER_PHASES_BY_FINISH).reduce((n, t) => n + Object.keys(t).length, 0);
    expect(Object.keys(DOPPLER_PHASES)).toHaveLength(total);
    expect(DOPPLER_PHASES[1119]).toBe('Emerald');
    expect(DOPPLER_PHASES[568]).toBe('Emerald');
  });

  test('phaseTableOf escolhe a tabela pelo acabamento e pela categoria', () => {
    expect(phaseTableOf({ category: 'SKIN', name: GLOCK })).toBe('GLOCK_GAMMA_DOPPLER');
    expect(phaseTableOf({ category: 'SKIN', name: `  ${GLOCK.toUpperCase()}  ` })).toBe('GLOCK_GAMMA_DOPPLER');
    expect(phaseTableOf({ category: 'FACA', name: '★ Karambit | Gamma Doppler' })).toBe('GAMMA_DOPPLER_KNIFE');
    expect(phaseTableOf({ category: 'FACA', name: '★ Karambit | Doppler' })).toBe('DOPPLER_KNIFE');
    expect(phaseTableOf({ category: 'FACA', name: GLOCK })).toBe('GAMMA_DOPPLER_KNIFE'); // faca com o nome da Glock usa a tabela da faca
    expect(phaseTableOf({ category: 'SKIN', name: 'AK-47 | Gamma Doppler' })).toBe(null);
    expect(phaseTableOf({ category: 'LUVA', name: GLOCK })).toBe(null);
    expect(phaseTableOf({ category: 'SKIN', name: null })).toBe(null);
  });
});

describe('Q56 avaliação: Glock-18 | Gamma Doppler', () => {
  test.each([['FN', 'Factory New'], ['MW', 'Minimal Wear']])('as 5 fases em %s: índice 1119-1123 e priceKey com o desgaste', (exterior, exteriorName) => {
    for (const [phase, index] of PHASES) {
      const target = buildPriceTarget(glock({ exterior, phase }));
      expect(target).toEqual({
        marketHashName: `${GLOCK} (${exteriorName})`,
        paintIndex: index,
        priceKey: `${GLOCK} (${exteriorName})|${index}`,
      });
    }
  });

  test('priceKey literal da fase Emerald em FN', () => {
    expect(buildPriceTarget(glock({ phase: 'Emerald' })).priceKey).toBe('Glock-18 | Gamma Doppler (Factory New)|1119');
  });

  test('StatTrak: prefixo "StatTrak™ " no nome e o mesmo índice; Souvenir também mantém o índice', () => {
    for (const [phase, index] of PHASES) {
      const st = buildPriceTarget(glock({ variant: 'STATTRAK', phase }));
      expect(st).toMatchObject({ marketHashName: `StatTrak™ ${GLOCK} (Factory New)`, paintIndex: index });
      expect(st.priceKey).toBe(`StatTrak™ ${GLOCK} (Factory New)|${index}`);
    }
    expect(buildPriceTarget(glock({ variant: 'SOUVENIR', phase: 'Phase 3' })).paintIndex).toBe(1122);
  });

  test('fase em minúsculas, maiúsculas e com espaços extras; nome da arma com espaços/caixa diferentes', () => {
    expect(buildPriceTarget(glock({ phase: 'phase 2' })).paintIndex).toBe(1121);
    expect(buildPriceTarget(glock({ phase: '  PHASE 4  ' })).paintIndex).toBe(1123);
    expect(buildPriceTarget(glock({ phase: ' emerald ' })).paintIndex).toBe(1119);
    expect(buildPriceTarget(glock({ name: `  ${GLOCK.toLowerCase()}  ` })).paintIndex).toBe(1120);
  });

  test('o preço usa a fase do catálogo quando o item não tem a sua', () => {
    const catalogById = new Map([['g1', { id: 'g1', phase: 'Phase 4' }]]);
    expect(buildPriceTarget(glock({ phase: null, catalogId: 'g1' }), { catalogById }).paintIndex).toBe(1123);
  });

  test('sem fase (null, vazia, só espaços) -> PHASE_REQUIRED; sem exterior -> NO_EXTERIOR (vem antes)', () => {
    for (const phase of [null, undefined, '', '   ']) expect(buildPriceTarget(glock({ phase }))).toEqual({ notPriceable: 'PHASE_REQUIRED' });
    for (const phase of [null, 'Phase 1']) expect(buildPriceTarget(glock({ exterior: null, phase }))).toEqual({ notPriceable: 'NO_EXTERIOR' });
  });

  test('fases de outro acabamento na Glock (Ruby, Sapphire, Black Pearl) -> PHASE_UNMAPPED', () => {
    for (const phase of ['Ruby', 'Sapphire', 'Black Pearl', 'Phase 5', 'Fase Nova']) {
      expect(buildPriceTarget(glock({ phase }))).toEqual({ notPriceable: 'PHASE_UNMAPPED' });
    }
  });

  test('outra arma Doppler ou Gamma Doppler com fase -> PHASE_UNMAPPED (nunca a tabela da Glock)', () => {
    for (const name of ['AK-47 | Gamma Doppler', 'Glock-18 | Doppler', 'USP-S | Doppler', 'Desert Eagle | Gamma Doppler', 'Glock-18 | Gamma Doppler Custom']) {
      expect(buildPriceTarget(glock({ name, phase: 'Phase 1' }))).toEqual({ notPriceable: 'PHASE_UNMAPPED' });
    }
  });

  test('Glock com a fase Emerald na tabela da faca não vaza: faca Gamma Doppler Emerald = 568, nunca 1119', () => {
    expect(buildPriceTarget(knife('Gamma Doppler', { phase: 'Emerald' })).paintIndex).toBe(568);
    expect(buildPriceTarget(glock({ phase: 'Emerald' })).paintIndex).toBe(1119);
  });

  test('faca Doppler com Emerald -> PHASE_UNMAPPED', () => {
    expect(buildPriceTarget(knife('Doppler', { phase: 'Emerald' }))).toEqual({ notPriceable: 'PHASE_UNMAPPED' });
  });

  test('FACA com o nome da Glock não usa a tabela da Glock', () => {
    for (const phase of ['Emerald', 'Phase 1', 'Phase 4']) {
      const target = buildPriceTarget({ category: 'FACA', name: GLOCK, variant: 'NORMAL', exterior: 'FN', phase });
      expect(target.paintIndex === undefined || ![1119, 1120, 1121, 1122, 1123].includes(target.paintIndex)).toBe(true);
      expect(paintIndexOf({ category: 'FACA', name: GLOCK, phase })).toBe(phase === 'Emerald' ? 568 : phase === 'Phase 1' ? 569 : 572);
    }
  });

  test('LUVA e OUTRO com o nome da Glock e fase não usam a tabela', () => {
    expect(paintIndexOf({ category: 'LUVA', name: GLOCK, phase: 'Phase 1' })).toBe(null);
    expect(paintIndexOf({ category: 'OUTRO', name: GLOCK, phase: 'Phase 1' })).toBe(null);
  });

  test('toda faca continua com os seus índices (415-421 e 568-572) depois da tabela por acabamento', () => {
    for (const [phase, index] of Object.entries(DOPPLER_PHASES_BY_FINISH.DOPPLER_KNIFE).map(([i, p]) => [p, Number(i)])) {
      expect(buildPriceTarget(knife('Doppler', { phase })).paintIndex).toBe(index);
    }
    for (const [phase, index] of Object.entries(DOPPLER_PHASES_BY_FINISH.GAMMA_DOPPLER_KNIFE).map(([i, p]) => [p, Number(i)])) {
      expect(buildPriceTarget(knife('Gamma Doppler', { phase })).paintIndex).toBe(index);
    }
  });
});

describe('Q56 salvaguarda: anúncio com paint_index diferente do pedido', () => {
  const NAME = `${GLOCK} (Factory New)`;

  test('mapListingReference: pediu 1119 e veio 1120 -> NOT_FOUND; veio 1119 -> OK', () => {
    const notFound = { status: 'NOT_FOUND', basePriceCents: null, referenceQuantity: null, sourceUpdatedAt: null };
    expect(mapListingReference({ data: [fakeListing({ marketHashName: NAME, paintIndex: 1120 })] }, { marketHashName: NAME, paintIndex: 1119 })).toEqual(notFound);
    expect(mapListingReference({ data: [fakeListing({ marketHashName: NAME, paintIndex: 1119, basePrice: 123 })] }, { marketHashName: NAME, paintIndex: 1119 }))
      .toMatchObject({ status: 'OK', basePriceCents: 123 });
  });

  describe('pela API (fetch falso)', () => {
    const JSON_TYPE = 'application/json';
    const NOW = new Date('2026-11-24T12:00:00.000Z');
    let app;
    let currentFetch;

    const row = (id, phase) => ({
      id, source: 'SKINS', category: 'SKIN', name: GLOCK, nameKey: GLOCK.toLowerCase(), searchText: GLOCK.toLowerCase(),
      minFloat: 0, maxFloat: 0.08, hasStattrak: 1, hasSouvenir: 0, phase,
    });
    const create = async (body) => {
      const res = await request(app).post('/api/items').set('Content-Type', JSON_TYPE).send(body);
      expect(res.status).toBe(201);
      return res.body.data;
    };
    const valueOf = async (id) => (await request(app).get(`/api/items/${id}`)).body.data.marketValue;

    beforeEach(async () => {
      freshDb();
      importCatalogFixture();
      CatalogItem.upsertMany([row('glock-gd-emerald', 'Emerald'), row('glock-gd-p1', 'Phase 1')], { now: NOW });
      marketValueService.resetAttemptForTests();
      importService.resetAutoForTests();
      app = createApp({ now: () => new Date(NOW), fetchFn: (...args) => currentFetch(...args), sleepFn: jest.fn(async () => {}) });
      await request(app).put('/api/integrations/csfloat/api-key').set('Content-Type', JSON_TYPE).send({ apiKey: KEY }).expect(200);
    });
    afterAll(() => closeDb());

    test('a fonte devolve sempre 1120: o item Phase 1 (1120) tem preço; o Emerald (1119) fica NO_PRICE/NOT_FOUND só na sua chave', async () => {
      // o routedListings repete o paint_index pedido; aqui a fonte ignora o filtro e devolve sempre um anúncio 1120
      const seen = [];
      currentFetch = jest.fn(async (url) => {
        const query = Object.fromEntries(new URL(url).searchParams.entries());
        seen.push([query.market_hash_name, query.paint_index]);
        return fakeResponse(200, { data: [fakeListing({ marketHashName: NAME, paintIndex: 1120, basePrice: 4000 })], cursor: null }, {});
      });
      const emerald = await create(purchaseBody({ catalogId: 'glock-gd-emerald', exterior: 'FN', purchasePriceCents: 3000, floatValue: 0.01 }));
      const phase1 = await create(purchaseBody({ catalogId: 'glock-gd-p1', exterior: 'FN', purchasePriceCents: 3000, floatValue: 0.02 }));
      await request(app).post('/api/market-values/refresh').set('Content-Type', JSON_TYPE).send({}).expect(200);
      const queried = [...seen].sort();
      expect(queried).toEqual([[NAME, '1119'], [NAME, '1120']]);
      expect(await valueOf(emerald.id)).toMatchObject({ status: 'NO_PRICE', reason: 'NOT_FOUND', marketValueUsdCents: null });
      expect(await valueOf(phase1.id)).toMatchObject({ status: 'OK', marketValueUsdCents: 4000 });
    });
  });
});
