'use strict';

// Débitos técnicos T11-T24 (D58): códigos de erro, helpers compartilhados e testes faltantes.
const fs = require('fs');
const path = require('path');
const { applyRateRounding, roundCents } = require('../../src/services/fees/rounding');
const added = require('../../src/services/fees/addedSaleFee');
const { computeSaleFee } = require('../../src/services/fees/saleFeeFormula');
const { isValidFxRate, toUsdCents } = require('../../src/services/currencyService');
const { findMinSalePriceCents, computeSale } = require('../../src/services/pricingService');
const {
  effectiveRate, simulateWithdrawal, estimateBalanceBrl,
} = require('../../src/services/withdrawalService');
const {
  classifyStock, classifyTurnaround, sortByAge, sortByTurnaround, assertNotFutureDay,
} = require('../../src/services/inventoryAgingService');
const { computeRealProfit } = require('../../src/services/profitService');
const warnings = require('../../src/services/warnings');
const constants = require('../../src/config/constants');
const { csfloat, steam, csmoney, usdItem, CSF } = require('../helpers/storeFixtures');

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return undefined;
}

describe('T11 - códigos específicos', () => {
  test('rounding', () => {
    expect(codeOf(() => applyRateRounding(1.5, 0.02, 'CEIL'))).toBe('INVALID_AMOUNT');
    expect(codeOf(() => applyRateRounding(-1, 0.02, 'CEIL'))).toBe('INVALID_AMOUNT');
    expect(codeOf(() => applyRateRounding(100, -0.1, 'CEIL'))).toBe('INVALID_RATE');
    expect(codeOf(() => applyRateRounding(100, NaN, 'CEIL'))).toBe('INVALID_RATE');
    expect(codeOf(() => roundCents(NaN, 'ROUND'))).toBe('INVALID_AMOUNT');
  });

  test('pricing e withdrawal', () => {
    expect(codeOf(() => findMinSalePriceCents(-1, CSF))).toBe('INVALID_AMOUNT');
    expect(codeOf(() => computeSale({ salePriceCents: 0, store: csfloat() }))).toBe('INVALID_AMOUNT');
    expect(codeOf(() => simulateWithdrawal({ amountStoreCents: 0, store: csfloat(), settings: {}, recentWithdrawals: [] }))).toBe('INVALID_AMOUNT');
    expect(codeOf(() => estimateBalanceBrl({ balanceCents: -1, store: csfloat(), settings: {}, recentWithdrawals: [] }))).toBe('INVALID_AMOUNT');
  });

  test('nenhum service usa o código genérico VALIDATION_ERROR', () => {
    const root = path.join(__dirname, '..', '..', 'src', 'services');
    const files = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    })(root);
    for (const file of files) expect(fs.readFileSync(file, 'utf8')).not.toContain('VALIDATION_ERROR');
  });

  test('todo new ValidationError dos services e middlewares tem código explícito', () => {
    const dirs = ['services', 'middlewares'].map((d) => path.join(__dirname, '..', '..', 'src', d));
    const bad = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) {
          const src = fs.readFileSync(full, 'utf8');
          // `fail(...)`/helpers passam o código por parâmetro; aqui só detecta `new ValidationError('...')` com 1 argumento.
          const re = /new ValidationError\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\)/g;
          if (re.test(src)) bad.push(full);
        }
      }
    })(dirs[0]);
    walk2(dirs[1]);
    function walk2(dir) {
      for (const f of fs.readdirSync(dir)) {
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        if (/new ValidationError\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\)/.test(src)) bad.push(f);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('T12 / T13 / T14', () => {
  test('mensagem de cotação ausente', () => {
    expect(() => toUsdCents(100, 'BRL', null)).toThrow('Cotação USD→BRL ausente ou inválida.');
    expect(codeOf(() => toUsdCents(100, 'BRL', 0))).toBe('FX_RATE_REQUIRED');
  });

  test('isValidFxRate', () => {
    expect(isValidFxRate(5.1)).toBe(true);
    for (const v of [0, -1, NaN, Infinity, '5', null, undefined]) expect(isValidFxRate(v)).toBe(false);
  });

  test('warnings.js exporta só os textos (sem aviso de trade lock)', () => {
    expect(warnings).toEqual({
      WARNING_FEES: 'taxas não configuradas',
      WARNING_FX: 'cotação não configurada',
      WARNING_BELOW_FEE: 'valor menor que a taxa',
      WARNING_PRICE_OVERFLOW: 'valor alto demais para calcular o preço mínimo',
    });
  });

  test('MIN_SLOW_ITEM_DAYS vem de config/constants.js e é usado por env e pelo aging', () => {
    expect(constants.MIN_SLOW_ITEM_DAYS).toBe(8);
    expect(() => classifyStock(5, 7)).toThrow(/maior ou igual a 8/);
    const root = path.join(__dirname, '..', '..', 'src');
    for (const f of ['config/env.js', 'services/inventoryAgingService.js']) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      expect(src).not.toMatch(/const MIN_SLOW_ITEM_DAYS\s*=/);
    }
  });
});

describe('T16 - effectiveRate', () => {
  test('ordena por instante (ISO mistos Z e -03:00) e usa os 5 mais recentes', () => {
    // 10:00-03:00 = 13:00Z (mais recente que 12:00Z, embora "10:00..." < "12:00..." como texto)
    const w = (id, withdrawnAt, brl) => ({ id, storeId: 1, amountStoreCents: 1000, amountBrlCents: brl, withdrawnAt });
    const list = [
      w(1, '2026-11-01T12:00:00.000Z', 1000),
      w(2, '2026-11-01T10:00:00.000-03:00', 9000),
      w(3, '2026-11-02T12:00:00.000Z', 5000),
      w(4, '2026-11-03T12:00:00.000Z', 5000),
      w(5, '2026-11-04T12:00:00.000Z', 5000),
      w(6, '2026-11-05T12:00:00.000Z', 5000),
    ];
    // 5 mais recentes: ids 6,5,4,3 e 2 (13:00Z de 01/11); id 1 (12:00Z) fica de fora.
    expect(effectiveRate(list, 1)).toBeCloseTo((5 + 5 + 5 + 5 + 9) / 5, 10);
  });

  test('descarta saques com amountBrlCents inválido', () => {
    const list = [
      { id: 1, storeId: 1, amountStoreCents: 1000, amountBrlCents: 5000, withdrawnAt: '2026-11-01T00:00:00Z' },
      { id: 2, storeId: 1, amountStoreCents: 1000, amountBrlCents: 0, withdrawnAt: '2026-11-02T00:00:00Z' },
      { id: 3, storeId: 1, amountStoreCents: 1000, amountBrlCents: null, withdrawnAt: '2026-11-03T00:00:00Z' },
    ];
    expect(effectiveRate(list, 1)).toBe(5);
  });
});

describe('T17 - estimativa sem store.id', () => {
  test('ignora saques e cai em taxa + cotação', () => {
    const store = csfloat({ id: undefined });
    const withdrawals = [{ id: 1, storeId: 1, amountStoreCents: 1000, amountBrlCents: 6000, withdrawnAt: '2026-11-01T00:00:00Z' }];
    const sim = simulateWithdrawal({ amountStoreCents: 10000, store, settings: { usdBrlRate: 5 }, recentWithdrawals: withdrawals });
    expect(sim).toMatchObject({ method: 'FEE_AND_SETTINGS_RATE', feeCents: 250, estimatedBrlCents: 48750 });
  });
});

describe('T18 - dias inválidos', () => {
  test.each([NaN, -1, 1.5, undefined, '3'])('classify com days=%p lança Error', (days) => {
    expect(() => classifyStock(days, 21)).toThrow(Error);
    expect(() => classifyTurnaround(days, 21)).toThrow(Error);
  });
  test('0 é válido', () => {
    expect(classifyStock(0, 21)).toBe('RECENTE');
  });
});

describe('T19 - ADDED com minFee alto', () => {
  const params = { feeType: 'ADDED', rate: 0.15, rounding: 'CEIL', minFeeCents: 1e9, fixedFeeCents: 0 };
  test('net com minFee enorme responde rápido e sem estourar o limite', () => {
    const t0 = Date.now();
    expect(added.net(1e9 + 50, params)).toBe(50);
    expect(added.net(10, params)).toBe(10 - 1e9);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('T20 / T21 - ordenação', () => {
  test('T20 e T24: sortByTurnaround com itens em estoque no fim, mesmo com soldAt inconsistente', () => {
    const items = [
      { id: 1, status: 'EM_ESTOQUE', acquiredAt: '2026-11-01T00:00:00Z', soldAt: null },
      { id: 2, status: 'VENDIDO', acquiredAt: '2026-11-01T00:00:00Z', soldAt: '2026-11-10T00:00:00Z' },
      { id: 3, status: 'VENDIDO', acquiredAt: '2026-11-01T00:00:00Z', soldAt: '2026-11-03T00:00:00Z' },
      { id: 4, status: 'EM_ESTOQUE', acquiredAt: '2026-10-01T00:00:00Z', soldAt: '2026-11-05T00:00:00Z' },
    ];
    expect(sortByTurnaround(items).map((i) => i.id)).toEqual([3, 2, 1, 4]);
    expect(sortByTurnaround(items, 'desc').map((i) => i.id)).toEqual([2, 3, 1, 4]);
  });

  test('T21: sortByAge distingue itens do mesmo dia pelo instante', () => {
    const now = new Date('2026-11-19T15:00:00Z');
    const items = [
      { id: 1, acquiredAt: '2026-11-10T20:00:00Z' },
      { id: 2, acquiredAt: '2026-11-10T08:00:00-03:00' }, // 11:00Z: mais antigo
      { id: 3, acquiredAt: '2026-11-10T15:00:00Z' },
    ];
    expect(sortByAge(items, 'desc', now).map((i) => i.id)).toEqual([2, 3, 1]);
    expect(sortByAge(items, 'asc', now).map((i) => i.id)).toEqual([1, 3, 2]);
  });

  test('assertNotFutureDay genérico', () => {
    const now = new Date('2026-11-19T15:00:00Z');
    const opts = { code: 'X', message: 'm' };
    expect(() => assertNotFutureDay('2026-11-20T02:59:00Z', now, opts)).not.toThrow();
    expect(codeOf(() => assertNotFutureDay('2026-11-20T03:00:00Z', now, opts))).toBe('X');
  });
});

describe('T22 - inteiros seguros', () => {
  test('base e produto fora do limite seguro -> INVALID_AMOUNT', () => {
    expect(codeOf(() => applyRateRounding(2 ** 53, 0.02, 'CEIL'))).toBe('INVALID_AMOUNT');
    expect(codeOf(() => applyRateRounding(1e12, 0.02, 'CEIL'))).toBe('INVALID_AMOUNT');
    expect(applyRateRounding(1e10, 0.02, 'CEIL')).toBe(2e8);
  });
});

describe('T23 - null explícito em computeRealProfit', () => {
  test('deposits/withdrawals/platformBalances/stockItems/settings nulos viram vazios', () => {
    const r = computeRealProfit({ deposits: null, withdrawals: null, platformBalances: null, stockItems: null, settings: null });
    expect(r).toMatchObject({ depositsBrlCents: 0, withdrawalsBrlCents: 0, stockEstimatedBrlCents: 0, realProfitBrlCents: 0 });
    expect(computeRealProfit().realProfitBrlCents).toBe(0);
  });
});

describe('T24 - testes faltantes', () => {
  test('estoque USD com custo 0 sem cotação não anula o estoque (D46/M1)', () => {
    const r = computeRealProfit({
      stockItems: [usdItem({ purchasePriceCents: 0 }), usdItem({ id: 2, purchaseCurrency: 'BRL', purchasePriceCents: 300, fxRateAtPurchase: 5 })],
      settings: { usdBrlRate: null },
    });
    expect(r.stockEstimatedBrlCents).toBe(300);
    expect(r.warnings).toEqual([]);
    expect(r.realProfitBrlCents).toBe(300);
  });

  test('força bruta ADDED com fixedFee e minFee: net é o maior r com r + taxa(r) <= g', () => {
    const cases = [
      { feeType: 'ADDED', rate: 0.15, rounding: 'CEIL', minFeeCents: 7, fixedFeeCents: 3 },
      { feeType: 'ADDED', rate: 0.1, rounding: 'ROUND', minFeeCents: null, fixedFeeCents: 5 },
      { feeType: 'ADDED', rate: 0.05, rounding: 'FLOOR', minFeeCents: 20, fixedFeeCents: 0 },
    ];
    for (const params of cases) {
      for (let g = 1; g <= 400; g++) {
        let best = null;
        for (let r = 0; r <= g; r++) if (r + computeSaleFee(r, params) <= g) best = r;
        const expected = best === null ? g - computeSaleFee(0, params) : best;
        expect(added.net(g, params)).toBe(expected);
      }
    }
  });
});
