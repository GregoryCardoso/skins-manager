'use strict';

const {
  computeWithdrawalFee,
  effectiveRate,
  simulateWithdrawal,
  estimateBalanceBrl,
} = require('../../src/services/withdrawalService');
const { ValidationError } = require('../../src/errors/AppError');
const { csfloat, steam, csmoney } = require('../helpers/storeFixtures');

const SETTINGS = { usdBrlRate: 5.0 };

function w(id, storeId, amountStoreCents, amountBrlCents, withdrawnAt) {
  return { id, storeId, amountStoreCents, amountBrlCents, withdrawnAt };
}

// Cotação efetiva 5.1 para a CSFloat (id 1).
const CSF_WITHDRAWALS = [
  w(1, 1, 1000, 5000, '2026-11-01T12:00:00.000Z'),
  w(2, 1, 1000, 5200, '2026-11-02T12:00:00.000Z'),
];

describe('withdrawalService.computeWithdrawalFee', () => {
  test('CSFloat 10000 → 250', () => {
    expect(computeWithdrawalFee(10000, csfloat())).toBe(250);
  });

  test('com fixa 50 → 300', () => {
    expect(computeWithdrawalFee(10000, csfloat({ withdrawalFixedFeeCents: 50 }))).toBe(300);
  });

  test('arredonda para cima (CEIL): 101 × 0.025 = 2.525 → 3', () => {
    expect(computeWithdrawalFee(101, csfloat())).toBe(3);
  });

  test('taxa nula → null', () => {
    expect(computeWithdrawalFee(10000, csmoney())).toBeNull();
  });
});

describe('withdrawalService.effectiveRate', () => {
  test('[1000→5000, 1000→5200] = 5.1', () => {
    expect(effectiveRate(CSF_WITHDRAWALS)).toBeCloseTo(5.1, 10);
  });

  test('6 saques fora de ordem → usa os 5 mais recentes (desempate por id DESC)', () => {
    const list = [
      w(4, 1, 1000, 5000, '2026-11-03T12:00:00.000Z'),
      w(1, 1, 1000, 100000, '2026-11-01T12:00:00.000Z'), // mesmo instante que id 2, id menor → excluído
      w(6, 1, 1000, 5000, '2026-11-05T12:00:00.000Z'),
      w(2, 1, 1000, 5000, '2026-11-01T12:00:00.000Z'),
      w(5, 1, 1000, 5000, '2026-11-04T12:00:00.000Z'),
      w(3, 1, 1000, 5000, '2026-11-02T12:00:00.000Z'),
    ];
    const copy = JSON.parse(JSON.stringify(list));
    expect(effectiveRate(list, 1)).toBeCloseTo(5.0, 10);
    expect(list).toEqual(copy);
  });

  test('6º saque mais antigo por data é descartado', () => {
    const list = [
      w(10, 1, 1000, 90000, '2026-10-01T12:00:00.000Z'),
      ...[1, 2, 3, 4, 5].map((i) => w(i, 1, 1000, 6000, `2026-11-0${i}T12:00:00.000Z`)),
    ];
    expect(effectiveRate(list, 1)).toBeCloseTo(6.0, 10);
  });

  test('ignora saques sem loja e de outra loja', () => {
    const list = [
      ...CSF_WITHDRAWALS,
      w(3, null, null, 99999, '2026-11-10T12:00:00.000Z'),
      w(4, 3, 1000, 99999, '2026-11-11T12:00:00.000Z'),
    ];
    expect(effectiveRate(list, 1)).toBeCloseTo(5.1, 10);
  });

  test('vazio → null', () => {
    expect(effectiveRate([])).toBeNull();
    expect(effectiveRate([], 1)).toBeNull();
    expect(effectiveRate([w(1, 3, 1000, 5000, '2026-11-01T12:00:00.000Z')], 1)).toBeNull();
  });
});

describe('withdrawalService.simulateWithdrawal', () => {
  test('CSFloat sem saques, 10000, cotação 5.0 → fee 250, net 9750, BRL 48750', () => {
    expect(simulateWithdrawal({ amountStoreCents: 10000, store: csfloat(), settings: SETTINGS, recentWithdrawals: [] })).toEqual({
      storeId: 1,
      amountStoreCents: 10000,
      method: 'FEE_AND_SETTINGS_RATE',
      effectiveRate: null,
      feeCents: 250,
      netStoreCents: 9750,
      estimatedBrlCents: 48750,
      warning: null,
    });
  });

  test('CSFloat com saques (cotação 5.1) → 51000, method EFFECTIVE_RATE', () => {
    const r = simulateWithdrawal({ amountStoreCents: 10000, store: csfloat(), settings: SETTINGS, recentWithdrawals: CSF_WITHDRAWALS });
    expect(r.method).toBe('EFFECTIVE_RATE');
    expect(r.estimatedBrlCents).toBe(51000);
    expect(r.effectiveRate).toBeCloseTo(5.1, 10);
    expect(r.feeCents).toBeNull();
    expect(r.netStoreCents).toBeNull();
    expect(r.warning).toBeNull();
  });

  test('saques de outra loja não contam para a cotação efetiva', () => {
    const others = [w(9, 3, 1000, 9000, '2026-11-05T12:00:00.000Z')];
    const r = simulateWithdrawal({ amountStoreCents: 10000, store: csfloat(), settings: SETTINGS, recentWithdrawals: others });
    expect(r.method).toBe('FEE_AND_SETTINGS_RATE');
    expect(r.estimatedBrlCents).toBe(48750);
  });

  test('CSMoney sem saques → "taxas não configuradas"', () => {
    const r = simulateWithdrawal({ amountStoreCents: 10000, store: csmoney(), settings: SETTINGS, recentWithdrawals: [] });
    expect(r).toMatchObject({
      method: 'FEE_AND_SETTINGS_RATE', feeCents: null, netStoreCents: null, estimatedBrlCents: null, warning: 'taxas não configuradas',
    });
  });

  test('CSMoney com saques → usa a cotação efetiva', () => {
    const list = [w(1, 3, 2000, 10400, '2026-11-01T12:00:00.000Z')]; // 5.2
    const r = simulateWithdrawal({ amountStoreCents: 1000, store: csmoney(), settings: SETTINGS, recentWithdrawals: list });
    expect(r).toMatchObject({ method: 'EFFECTIVE_RATE', estimatedBrlCents: 5200, warning: null });
  });

  test('cotação nula sem saques → "cotação não configurada"', () => {
    const r = simulateWithdrawal({ amountStoreCents: 10000, store: csfloat(), settings: { usdBrlRate: null }, recentWithdrawals: [] });
    expect(r).toMatchObject({ feeCents: 250, netStoreCents: 9750, estimatedBrlCents: null, warning: 'cotação não configurada' });
  });

  test('Steam (allowsWithdrawal falso) → WITHDRAWAL_NOT_ALLOWED', () => {
    expect(() => simulateWithdrawal({ amountStoreCents: 1000, store: steam(), settings: SETTINGS, recentWithdrawals: [] })).toThrow(
      expect.objectContaining({ name: 'ValidationError', code: 'WITHDRAWAL_NOT_ALLOWED' })
    );
  });

  test.each([0, -100, 1.5, '1000', null])('valor inválido (%p) → ValidationError', (amount) => {
    expect(() => simulateWithdrawal({ amountStoreCents: amount, store: csfloat(), settings: SETTINGS, recentWithdrawals: [] })).toThrow(
      ValidationError
    );
  });

  test('P6: CSFloat com fixa 50 e valor 40 → líquido 0, BRL 0, "valor menor que a taxa"', () => {
    const r = simulateWithdrawal({
      amountStoreCents: 40, store: csfloat({ withdrawalFixedFeeCents: 50 }), settings: SETTINGS, recentWithdrawals: [],
    });
    expect(r).toMatchObject({ netStoreCents: 0, estimatedBrlCents: 0, warning: 'valor menor que a taxa' });
  });

  test('P6: valor igual à taxa (50, rate 0, fixa 50) → líquido 0 sem aviso', () => {
    const r = simulateWithdrawal({
      amountStoreCents: 50, store: csfloat({ withdrawalFeeRate: 0, withdrawalFixedFeeCents: 50 }), settings: SETTINGS, recentWithdrawals: [],
    });
    expect(r).toMatchObject({ feeCents: 50, netStoreCents: 0, estimatedBrlCents: 0, warning: null });
  });

  test('loja BRL com saque: estimativa = líquido nominal', () => {
    const store = steam({ allowsWithdrawal: true, withdrawalFeeRate: 0.01 });
    const r = simulateWithdrawal({ amountStoreCents: 10000, store, settings: { usdBrlRate: null }, recentWithdrawals: [] });
    expect(r).toMatchObject({ feeCents: 100, netStoreCents: 9900, estimatedBrlCents: 9900, warning: null });
  });
});

describe('withdrawalService.estimateBalanceBrl', () => {
  test('saldo 0 → 0', () => {
    expect(estimateBalanceBrl({ balanceCents: 0, store: csfloat(), settings: SETTINGS, recentWithdrawals: [] }).estimatedBrlCents).toBe(0);
    expect(estimateBalanceBrl({ balanceCents: 0, store: csmoney(), settings: {}, recentWithdrawals: [] }).estimatedBrlCents).toBe(0);
  });

  test('P2: Steam saldo 5000 BRL → { 5000, withdrawable: false }', () => {
    expect(estimateBalanceBrl({ balanceCents: 5000, store: steam(), settings: SETTINGS, recentWithdrawals: [] })).toEqual({
      estimatedBrlCents: 5000, withdrawable: false, warning: null,
    });
  });

  test('P2: loja USD sem saque, saldo 1000, cotação 5.0 → 5000 withdrawable false', () => {
    const store = csfloat({ allowsWithdrawal: false });
    expect(estimateBalanceBrl({ balanceCents: 1000, store, settings: SETTINGS, recentWithdrawals: [] })).toEqual({
      estimatedBrlCents: 5000, withdrawable: false, warning: null,
    });
  });

  test('P2: idem sem cotação → null + "cotação não configurada"', () => {
    const store = csfloat({ allowsWithdrawal: false });
    expect(estimateBalanceBrl({ balanceCents: 1000, store, settings: { usdBrlRate: null }, recentWithdrawals: [] })).toEqual({
      estimatedBrlCents: null, withdrawable: false, warning: 'cotação não configurada',
    });
  });

  test('P2: loja sem saque ignora taxa de saque configurada', () => {
    const store = csfloat({ allowsWithdrawal: false, withdrawalFeeRate: 0.5 });
    expect(estimateBalanceBrl({ balanceCents: 1000, store, settings: SETTINGS, recentWithdrawals: [] }).estimatedBrlCents).toBe(5000);
  });

  test('CSFloat com saques → cotação efetiva, withdrawable true', () => {
    expect(estimateBalanceBrl({ balanceCents: 10000, store: csfloat(), settings: SETTINGS, recentWithdrawals: CSF_WITHDRAWALS })).toEqual({
      estimatedBrlCents: 51000, withdrawable: true, warning: null,
    });
  });

  test('CSFloat sem saques → taxa + cotação das configurações', () => {
    expect(estimateBalanceBrl({ balanceCents: 10000, store: csfloat(), settings: SETTINGS, recentWithdrawals: [] })).toEqual({
      estimatedBrlCents: 48750, withdrawable: true, warning: null,
    });
  });
});
