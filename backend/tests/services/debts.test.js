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

  test('pricing', () => {
    expect(codeOf(() => findMinSalePriceCents(-1, CSF))).toBe('INVALID_AMOUNT');
    expect(codeOf(() => computeSale({ salePriceCents: 0, store: csfloat() }))).toBe('INVALID_AMOUNT');
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

  test('warnings.js exporta textos e pares texto/código (sem aviso de trade lock) (D83)', () => {
    expect(warnings).toEqual({
      WARNINGS: {
        FEES_NOT_CONFIGURED: { code: 'FEES_NOT_CONFIGURED', text: 'taxas não configuradas' },
        FX_NOT_CONFIGURED: { code: 'FX_NOT_CONFIGURED', text: 'cotação não configurada' },
        BALANCE_MAYBE_OUTDATED: { code: 'BALANCE_MAYBE_OUTDATED', text: 'saldo possivelmente desatualizado' },
        PRICE_OVERFLOW: { code: 'PRICE_OVERFLOW', text: 'valor alto demais para calcular o preço mínimo' },
      },
      WARNING_FEES: 'taxas não configuradas',
      WARNING_FX: 'cotação não configurada',
      WARNING_PRICE_OVERFLOW: 'valor alto demais para calcular o preço mínimo',
    });
  });

  test('limites de giro vêm de config/constants.js (D159) e não são redeclarados em env/aging', () => {
    expect(constants.MIN_SLOW_ITEM_DAYS).toBe(2);
    expect(constants.MAX_SLOW_ITEM_DAYS).toBe(365);
    expect(constants.DEFAULT_FAST_TURNOVER_DAYS).toBe(7);
    expect(() => classifyStock(5, { fastTurnoverDays: 7, slowItemDays: 7 })).toThrow(/1 <= rápido < agarrado <= 365/);
    const root = path.join(__dirname, '..', '..', 'src');
    for (const f of ['config/env.js', 'services/inventoryAgingService.js']) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      expect(src).not.toMatch(/const (MIN|MAX)_SLOW_ITEM_DAYS\s*=/);
      expect(src).not.toMatch(/const FAST_DAYS\s*=/);
    }
  });
});

describe('T18 - dias inválidos', () => {
  test.each([NaN, -1, 1.5, undefined, '3'])('classify com days=%p lança Error', (days) => {
    expect(() => classifyStock(days, { fastTurnoverDays: 7, slowItemDays: 21 })).toThrow(Error);
    expect(() => classifyTurnaround(days, { fastTurnoverDays: 7, slowItemDays: 21 })).toThrow(Error);
  });
  test('0 é válido', () => {
    expect(classifyStock(0, { fastTurnoverDays: 7, slowItemDays: 21 })).toBe('RECENTE');
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
    expect(r).toMatchObject({ depositsUsdCents: 0, withdrawalsNetUsdCents: 0, stockUsdCents: 0, realProfitUsdCents: 0 });
    expect(computeRealProfit().realProfitUsdCents).toBe(0);
  });
});

describe('T24 - testes faltantes', () => {
  test('estoque USD com custo 0 e item BRL pela cotação gravada, sem cotação atual, não anulam o estoque (D46/M1, D225)', () => {
    const r = computeRealProfit({
      stockItems: [usdItem({ purchasePriceCents: 0 }), usdItem({ id: 2, purchaseCurrency: 'BRL', purchasePriceCents: 300, fxRateAtPurchase: 5 })],
      settings: { usdBrlRate: null },
    });
    expect(r.stockUsdCents).toBe(60); // BRL 300 pela cotação gravada (5,0)
    expect(r.warnings).toEqual([]);
    expect(r.realProfitUsdCents).toBe(60);
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
