'use strict';

// 10.6 (D365, QA): ajustes pequenos do backend. B1 (Doppler/Gamma Doppler de SKIN e FACA, com e sem fase), B2 (motivo do NO_PRICE),
// B3 (netUnits) e as invariantes de que o valor de mercado não alcança o lucro real, o itemStats, o preço mínimo nem os saldos.
// Puro: sem rede e sem banco (preços e loja entram como parâmetro). Dados INVENTADOS.
const fs = require('fs');
const path = require('path');
const { buildPriceTarget } = require('../../src/services/valuation/marketHashName');
const { valueUnit, summarize } = require('../../src/services/valuation/valuationService');
const { buildValuationIndex, groupValuation } = require('../../src/services/valuation/valuationIndex');
const { collectTargets } = require('../../src/services/valuation/marketValueService');
const { DOPPLER_PHASES_BY_FINISH } = require('../../src/services/imports/adapters/csfloatStates');

const NOW = new Date('2026-11-24T12:00:00.000Z');
const FINISHES = ['Doppler', 'Gamma Doppler'];

const subject = (category, finish, extra = {}) => ({
  category,
  name: category === 'FACA' ? `★ Karambit | ${finish}` : `Glock-18 | ${finish}`,
  variant: 'NORMAL',
  exterior: 'FN',
  phase: null,
  ...extra,
});

describe('B1: Doppler e Gamma Doppler, SKIN e FACA', () => {
  describe.each(FINISHES.flatMap((finish) => ['SKIN', 'FACA'].map((category) => [finish, category])))('%s de %s', (finish, category) => {
    test.each([['null', null], ['undefined', undefined], ['vazia', ''], ['só espaços', '   ']])('sem fase (%s) -> PHASE_REQUIRED', (_label, phase) => {
      expect(buildPriceTarget(subject(category, finish, { phase }))).toEqual({ notPriceable: 'PHASE_REQUIRED' });
    });

    test('NO_EXTERIOR vem antes, com e sem fase', () => {
      for (const phase of [null, 'Phase 1']) {
        expect(buildPriceTarget(subject(category, finish, { exterior: null, phase }))).toEqual({ notPriceable: 'NO_EXTERIOR' });
        expect(buildPriceTarget(subject(category, finish, { exterior: 'XX', phase }))).toEqual({ notPriceable: 'NO_EXTERIOR' });
      }
    });

    test('fase fora da tabela -> PHASE_UNMAPPED', () => {
      expect(buildPriceTarget(subject(category, finish, { phase: 'Fase Nova' }))).toEqual({ notPriceable: 'PHASE_UNMAPPED' });
    });

    test('a fase só do catálogo conta como fase (nunca PHASE_REQUIRED)', () => {
      const catalogById = new Map([['c1', { id: 'c1', phase: 'Phase 2' }]]);
      const target = buildPriceTarget(subject(category, finish, { catalogId: 'c1' }), { catalogById });
      if (category === 'FACA') expect(target.paintIndex).toBe(finish === 'Doppler' ? 419 : 570);
      else if (finish === 'Gamma Doppler') expect(target.paintIndex).toBe(1121);
      else expect(target).toEqual({ notPriceable: 'PHASE_UNMAPPED' });
    });

    test('a fase do item prevalece sobre a do catálogo', () => {
      const catalogById = new Map([['c1', { id: 'c1', phase: 'Phase 2' }]]);
      const target = buildPriceTarget(subject(category, finish, { catalogId: 'c1', phase: 'Phase 1' }), { catalogById });
      if (category === 'FACA') expect(target.paintIndex).toBe(finish === 'Doppler' ? 418 : 569);
      else if (finish === 'Gamma Doppler') expect(target.paintIndex).toBe(1120);
      else expect(target).toEqual({ notPriceable: 'PHASE_UNMAPPED' });
    });

    test('StatTrak sem fase também pede a fase; com nome em minúsculas também', () => {
      expect(buildPriceTarget(subject(category, finish, { variant: 'STATTRAK' }))).toEqual({ notPriceable: 'PHASE_REQUIRED' });
      expect(buildPriceTarget(subject(category, finish, { name: subject(category, finish).name.toLowerCase() }))).toEqual({ notPriceable: 'PHASE_REQUIRED' });
    });
  });

  test('toda fase da tabela tem índice; Glock Gamma Doppler usa a sua tabela; outras armas com fase seguem PHASE_UNMAPPED (E-P2-Q56, D368)', () => {
    const cases = { DOPPLER_KNIFE: ['FACA', 'Doppler'], GAMMA_DOPPLER_KNIFE: ['FACA', 'Gamma Doppler'], GLOCK_GAMMA_DOPPLER: ['SKIN', 'Gamma Doppler'] };
    for (const [key, table] of Object.entries(DOPPLER_PHASES_BY_FINISH)) {
      for (const [index, phase] of Object.entries(table)) {
        const [category, finish] = cases[key];
        expect(buildPriceTarget(subject(category, finish, { phase })).paintIndex).toBe(Number(index));
      }
    }
    expect(buildPriceTarget(subject('SKIN', 'Doppler', { phase: 'Phase 1' }))).toEqual({ notPriceable: 'PHASE_UNMAPPED' });
  });

  test('faca Doppler com a fase de outro acabamento (Emerald numa Doppler comum) -> PHASE_UNMAPPED', () => {
    expect(buildPriceTarget(subject('FACA', 'Doppler', { phase: 'Emerald' }))).toEqual({ notPriceable: 'PHASE_UNMAPPED' });
    expect(buildPriceTarget(subject('FACA', 'Gamma Doppler', { phase: 'Ruby' }))).toEqual({ notPriceable: 'PHASE_UNMAPPED' });
  });

  test('nomes que não terminam em Doppler, outras categorias e faca vanilla seguem avaliáveis sem fase', () => {
    expect(buildPriceTarget(subject('SKIN', 'Doppler Custom')).notPriceable).toBeUndefined();
    expect(buildPriceTarget({ category: 'SKIN', name: 'AK-47 | Redline', variant: 'NORMAL', exterior: 'FT', phase: null }).notPriceable).toBeUndefined();
    expect(buildPriceTarget({ category: 'FACA', name: '★ Karambit', variant: 'NORMAL', exterior: null, phase: null }).priceKey).toBe('★ Karambit|');
    expect(buildPriceTarget({ category: 'FACA', name: '★ Karambit | Fade', variant: 'NORMAL', exterior: 'FN', phase: null }).notPriceable).toBeUndefined();
    expect(buildPriceTarget({ category: 'LUVA', name: '★ Sport Gloves | Vice', variant: 'NORMAL', exterior: 'FT', phase: null }).notPriceable).toBeUndefined();
    expect(buildPriceTarget({ category: 'CAIXA', name: 'Doppler Case | Doppler', phase: null }).notPriceable).toBeUndefined();
  });

  test('collectTargets: PHASE_REQUIRED não gera chave (nenhuma chamada à fonte) e conta em notPriceableUnits', () => {
    const stock = (id, extra) => ({ id, status: 'EM_ESTOQUE', ...subject('SKIN', 'Gamma Doppler'), ...extra });
    const { targets, notPriceableUnits } = collectTargets({
      items: [
        stock(1), // sem fase
        stock(2, { phase: 'Phase 2' }), // Glock Gamma Doppler com fase: 1121
        { id: 3, status: 'EM_ESTOQUE', ...subject('FACA', 'Doppler') }, // sem fase
        { id: 4, status: 'EM_ESTOQUE', ...subject('FACA', 'Doppler', { phase: 'Phase 1' }) }, // 418
        { id: 5, status: 'VENDIDO', ...subject('FACA', 'Doppler') }, // vendido: nem conta
      ],
    });
    expect(notPriceableUnits).toBe(2);
    expect(targets.map((t) => t.priceKey).sort()).toEqual(['Glock-18 | Gamma Doppler (Factory New)|1121', '★ Karambit | Doppler (Factory New)|418']);
  });

  test('valueUnit: PHASE_REQUIRED não consulta o cache, mesmo com linha antiga da chave sem fase; custo é mantido', () => {
    const priceOf = jest.fn(() => ({ status: 'OK', basePriceCents: 99999, pricedAt: '2026-11-24T10:00:00.000Z' }));
    const costIndex = { effectiveOf: () => ({ effectiveUsdCents: 700, estimated: false }) };
    const v = valueUnit({ item: { id: 1, status: 'EM_ESTOQUE', ...subject('SKIN', 'Gamma Doppler') }, priceOf, costIndex, now: NOW });
    expect(v).toMatchObject({ status: 'NOT_PRICEABLE', reason: 'PHASE_REQUIRED', marketValueUsdCents: null, costUsdCents: 700, unrealizedUsdCents: null });
    expect(priceOf).not.toHaveBeenCalled();
    expect(summarize([v])).toMatchObject({ pricedUnits: 0, notPriceableUnits: 1, unpricedUnits: 0, marketValueUsdCents: 0, netUnits: 0 });
  });
});

describe('B2: motivo do NO_PRICE', () => {
  const costIndex = { effectiveOf: () => ({ effectiveUsdCents: 100, estimated: false }) };
  const ak = { id: 1, status: 'EM_ESTOQUE', category: 'SKIN', name: 'AK-47 | Redline', variant: 'NORMAL', exterior: 'FT', phase: null };
  const KEY = 'AK-47 | Redline (Field-Tested)|';
  const run = (rowOrNull, extra = {}) => valueUnit({ item: ak, priceOf: (key) => (key === KEY ? rowOrNull : null), costIndex, now: NOW, ...extra });

  test('sem linha (null ou undefined) -> NOT_FETCHED', () => {
    expect(run(null)).toMatchObject({ status: 'NO_PRICE', reason: 'NOT_FETCHED', marketValueUsdCents: null, costUsdCents: 100 });
    expect(run(undefined)).toMatchObject({ status: 'NO_PRICE', reason: 'NOT_FETCHED' });
  });

  test('NOT_FOUND sem preço anterior -> NOT_FOUND (com base ou data soltas, ainda sem preço válido)', () => {
    expect(run({ status: 'NOT_FOUND', basePriceCents: null, pricedAt: null })).toMatchObject({ status: 'NO_PRICE', reason: 'NOT_FOUND' });
    expect(run({ status: 'NOT_FOUND', basePriceCents: 500, pricedAt: null })).toMatchObject({ status: 'NO_PRICE', reason: 'NOT_FOUND' });
    expect(run({ status: 'NOT_FOUND', basePriceCents: null, pricedAt: '2026-11-24T10:00:00.000Z' })).toMatchObject({ status: 'NO_PRICE', reason: 'NOT_FOUND' });
  });

  test('NOT_FOUND com preço anterior -> OK desatualizado, sem motivo; OK normal sem motivo', () => {
    expect(run({ status: 'NOT_FOUND', basePriceCents: 500, pricedAt: '2026-11-24T10:00:00.000Z' })).toMatchObject({ status: 'OK', isStale: true, reason: null, marketValueUsdCents: 500 });
    expect(run({ status: 'OK', basePriceCents: 500, pricedAt: '2026-11-24T10:00:00.000Z' })).toMatchObject({ status: 'OK', isStale: false, reason: null });
  });

  test('o chaveiro com preço não salva um item sem preço; o motivo é o do item', () => {
    const v = valueUnit({
      item: ak, components: [{ kind: 'CHARM', name: 'Charm | C' }], costIndex, now: NOW,
      priceOf: (key) => (key === 'Charm | C|' ? { status: 'OK', basePriceCents: 250, pricedAt: '2026-11-24T10:00:00.000Z' } : null),
    });
    expect(v).toMatchObject({ status: 'NO_PRICE', reason: 'NOT_FETCHED' });
  });

  test('os contadores do summarize separam sem preço de sem avaliação, qualquer que seja o motivo', () => {
    const notFetched = run(null);
    const notFound = run({ status: 'NOT_FOUND', basePriceCents: null, pricedAt: null });
    const noExterior = valueUnit({ item: { ...ak, exterior: null }, priceOf: () => null, costIndex, now: NOW });
    expect(summarize([notFetched, notFound, noExterior, null])).toMatchObject({ unpricedUnits: 2, notPriceableUnits: 1, pricedUnits: 0, unitCount: 3 });
  });
});

describe('B3: netUnits', () => {
  const store = { id: 1, name: 'CSFloat', currency: 'USD', saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeeRounding: 'CEIL', saleMinFeeCents: null, saleFixedFeeCents: 0 };
  const noFeeStore = { ...store, saleFeeType: null, saleFeeRate: null, saleFeeRounding: null };
  const row = (basePriceCents) => ({ status: 'OK', basePriceCents, pricedAt: '2026-11-24T10:00:00.000Z' });
  const unit = (id, { cost = 100, price = 1000, saleStore = store } = {}) => valueUnit({
    item: { id, status: 'EM_ESTOQUE', category: 'SKIN', name: 'AK-47 | Redline', variant: 'NORMAL', exterior: 'FT', phase: null },
    priceOf: () => row(price),
    costIndex: { effectiveOf: () => ({ effectiveUsdCents: cost, estimated: false }) },
    saleStore,
    now: NOW,
  });

  test('líquido total 0 de verdade (líquido igual ao custo) tem netUnits 1; sem loja da integração tem netUnits 0 e o mesmo 0', () => {
    // 1000 - taxa de 2% (20) = 980; custo 980 -> PnL líquido 0 real.
    const real = summarize([unit(1, { cost: 980 })]);
    expect(real).toMatchObject({ unrealizedNetUsdCents: 0, netUnits: 1, pricedUnits: 1 });
    const none = summarize([unit(1, { cost: 980, saleStore: null })]);
    expect(none).toMatchObject({ unrealizedNetUsdCents: 0, netUnits: 0, pricedUnits: 1 });
  });

  test('loja sem taxa de venda: sem líquido, motivo FEES_NOT_CONFIGURED, netUnits 0', () => {
    const v = unit(1, { saleStore: noFeeStore });
    expect(v).toMatchObject({ unrealizedNetUsdCents: null, netUnavailableReason: 'FEES_NOT_CONFIGURED' });
    expect(summarize([v]).netUnits).toBe(0);
  });

  test('sem loja: motivo NO_INTEGRATION_STORE; valor 0 (preço real 0): NET_NOT_COMPUTABLE', () => {
    expect(unit(1, { saleStore: null })).toMatchObject({ netUnavailableReason: 'NO_INTEGRATION_STORE', unrealizedNetUsdCents: null });
    expect(unit(1, { price: 0 })).toMatchObject({ status: 'OK', marketValueUsdCents: 0, netUnavailableReason: 'NET_NOT_COMPUTABLE', unrealizedNetUsdCents: null });
  });

  test('B7: loja da integração em BRL (valor de mercado é em US$): sem líquido, NET_NOT_COMPUTABLE', () => {
    const v = unit(1, { saleStore: { ...store, currency: 'BRL' } });
    expect(v).toMatchObject({ status: 'OK', unrealizedNetUsdCents: null, netUnavailableReason: 'NET_NOT_COMPUTABLE' });
    expect(summarize([v]).netUnits).toBe(0);
  });

  test('cobertura mista: custo desconhecido e valor 0 ficam fora do netUnits, e o total soma só as com líquido', () => {
    const units = [unit(1), unit(2, { cost: 200 }), unit(3, { cost: null }), unit(4, { price: 0 })];
    const totals = summarize(units);
    expect(totals).toMatchObject({ pricedUnits: 4, netUnits: 2, unitCount: 4 });
    expect(totals.unrealizedNetUsdCents).toBe((980 - 100) + (980 - 200));
    expect(totals.netUnits).toBeLessThanOrEqual(totals.pricedUnits);
  });

  test('os totais são aditivos: à venda + holding = total (inclusive netUnits e contadores)', () => {
    const a = [unit(1), unit(2, { saleStore: null }), valueUnit({ item: { id: 9, status: 'EM_ESTOQUE', category: 'SKIN', name: 'X', exterior: null }, priceOf: () => null, now: NOW })];
    const b = [unit(3, { cost: 500 }), null];
    const sumA = summarize(a);
    const sumB = summarize(b);
    const all = summarize([...a, ...b]);
    for (const key of ['marketValueUsdCents', 'costUsdCents', 'unrealizedUsdCents', 'unrealizedNetUsdCents', 'pricedUnits', 'netUnits', 'unpricedUnits', 'notPriceableUnits', 'staleUnits', 'unitCount']) {
      expect([key, all[key]]).toEqual([key, sumA[key] + sumB[key]]);
    }
  });

  test('grupo: groupValuation repassa netUnits, ignora vendidas e usa a cotação só para o "≈ R$"', () => {
    const items = [1, 2, 3].map((id) => ({ id, status: 'EM_ESTOQUE', category: 'SKIN', name: 'AK-47 | Redline', variant: 'NORMAL', exterior: 'FT', phase: null }));
    items.push({ id: 4, status: 'VENDIDO', category: 'SKIN', name: 'AK-47 | Redline', variant: 'NORMAL', exterior: 'FT', phase: null });
    const costIndex = { effectiveOf: (item) => ({ effectiveUsdCents: item.id === 3 ? null : 100, estimated: false }) };
    const rows = new Map([['AK-47 | Redline (Field-Tested)|', { status: 'OK', basePriceCents: 1000, pricedAt: '2026-11-24T10:00:00.000Z' }]]);
    const index = buildValuationIndex({ items, costIndex, fx: 5, now: NOW, rows, saleStore: store });
    expect(index.has(4)).toBe(false);
    const group = groupValuation(items, index, 5);
    expect(group).toMatchObject({ pricedUnits: 3, netUnits: 2, unitCount: 3, marketValueUsdCents: 3000, unrealizedNetUsdCents: 2 * 880 });
    expect(group.approx.marketValue).toBe(15000);
    const noRate = groupValuation(items, index, null);
    expect(noRate.approx).toEqual({ marketValue: null, unrealized: null, unrealizedNet: null });
    expect(noRate.marketValueUsdCents).toBe(group.marketValueUsdCents);
    const noStore = groupValuation(items, buildValuationIndex({ items, costIndex, fx: 5, now: NOW, rows, saleStore: null }), 5);
    expect(noStore).toMatchObject({ netUnits: 0, unrealizedNetUsdCents: 0, pricedUnits: 3 });
  });
});

describe('invariantes: o valor de mercado não alcança o lucro real, o itemStats, o preço mínimo nem os saldos', () => {
  const SERVICES = path.join(__dirname, '..', '..', 'src', 'services');
  // A trava (valuationLock) é só mutex da rodada; o que não pode entrar no lucro real é o cálculo, o cache e a fonte de preços.
  const FORBIDDEN = /require\(\s*['"][^'"]*(valuationService|valuationIndex|valuationSources|marketHashName|marketValueService|MarketPrice)[^'"]*['"]\s*\)/i;
  const read = (file) => fs.readFileSync(path.join(SERVICES, file), 'utf8');
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test.each([
    'profitService.js', 'itemStatsService.js', 'pricingService.js', 'storeBalanceService.js', 'inventoryAgingService.js', 'currencyService.js',
    'depositService.js', 'withdrawalService.js', 'storeService.js', 'settingsService.js',
  ])('%s não importa nada de valuation/marketValue', (file) => {
    const full = path.join(SERVICES, file);
    if (!fs.existsSync(full)) return;
    expect(code(read(file))).not.toMatch(FORBIDDEN);
  });

  test('só o itemService (views de itens e grupos) e a importação/backup usam o módulo de valuation', () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const users = walk(path.join(SERVICES)).filter((f) => f.endsWith('.js') && !f.includes(`${path.sep}valuation${path.sep}`) && FORBIDDEN.test(code(fs.readFileSync(f, 'utf8'))));
    const names = users.map((f) => path.relative(SERVICES, f).replace(/\\/g, '/')).sort();
    // Se aparecer um arquivo novo aqui, confira que ele não alimenta o lucro real, o itemStats nem o preço mínimo.
    expect(names.filter((n) => /profit|stats|pricing|balance|aging|currency/i.test(n))).toEqual([]);
  });

  test('o profitService nunca lê os campos do valor de mercado', () => {
    expect(code(read('profitService.js'))).not.toMatch(/marketValue|unrealized|market_price|marketPrice/i);
    expect(code(read('itemStatsService.js'))).not.toMatch(/marketValue|unrealized|market_price|marketPrice/i);
  });
});
