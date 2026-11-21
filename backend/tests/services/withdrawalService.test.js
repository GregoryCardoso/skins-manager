'use strict';

// Saldo estimado em BRL (D163, D165, regra de 2026-11-20): saldo bruto × cotação das configurações.
// A taxa de saque não entra na estimativa.
const withdrawalService = require('../../src/services/withdrawalService');
const { ValidationError } = require('../../src/errors/AppError');
const { csfloat, steam, csmoney } = require('../helpers/storeFixtures');

const { estimateBalanceBrl } = withdrawalService;
const SETTINGS = { usdBrlRate: 5.0 };

describe('withdrawalService: API pública', () => {
  test('sem cotação efetiva nem simulação de saque; só estimativa de saldo, regras e orquestradores dos saques', () => {
    expect(Object.keys(withdrawalService).sort()).toEqual([
      'buildWithdrawalRecord', 'createWithdrawal', 'deleteWithdrawal', 'estimateBalanceBrl', 'getFeeSuggestion',
      'listWithdrawals', 'suggestWithdrawalFeeCents', 'toWithdrawalView', 'updateWithdrawal',
    ]);
  });
});

describe('withdrawalService.estimateBalanceBrl', () => {
  test('saldo 0 → 0', () => {
    expect(estimateBalanceBrl({ balanceCents: 0, store: csfloat(), settings: SETTINGS }).estimatedBrlCents).toBe(0);
    expect(estimateBalanceBrl({ balanceCents: 0, store: csmoney(), settings: {} }).estimatedBrlCents).toBe(0);
  });

  test('loja BRL não é convertida e não é "estimada"', () => {
    expect(estimateBalanceBrl({ balanceCents: 5000, store: steam(), settings: SETTINGS })).toEqual({
      estimatedBrlCents: 5000, estimated: false, warning: null, warningCode: null,
    });
    expect(estimateBalanceBrl({ balanceCents: 5000, store: steam({ allowsWithdrawal: true, withdrawalFeeRate: 0.5 }), settings: {} })).toEqual({
      estimatedBrlCents: 5000, estimated: false, warning: null, warningCode: null,
    });
  });

  test('loja USD que permite saque: saldo bruto × cotação, sem descontar a taxa de saque', () => {
    expect(estimateBalanceBrl({ balanceCents: 10000, store: csfloat(), settings: SETTINGS })).toEqual({
      estimatedBrlCents: 50000, estimated: true, warning: null, warningCode: null,
    });
  });

  test('taxa de saque nula, alta ou fixa não muda o resultado; não há aviso de taxas', () => {
    const base = estimateBalanceBrl({ balanceCents: 1000, store: csfloat(), settings: SETTINGS });
    for (const store of [csmoney(), csfloat({ withdrawalFeeRate: 0.9 }), csfloat({ withdrawalFixedFeeCents: 5000 })]) {
      expect(estimateBalanceBrl({ balanceCents: 1000, store, settings: SETTINGS })).toEqual(base);
    }
  });

  test('loja USD sem saque → saldo × cotação', () => {
    expect(estimateBalanceBrl({ balanceCents: 1000, store: csfloat({ allowsWithdrawal: false }), settings: SETTINGS })).toEqual({
      estimatedBrlCents: 5000, estimated: true, warning: null, warningCode: null,
    });
  });

  test.each([{ usdBrlRate: null }, {}, null])('sem cotação (%p) → null + "cotação não configurada"', (settings) => {
    expect(estimateBalanceBrl({ balanceCents: 1000, store: csfloat(), settings })).toEqual({
      estimatedBrlCents: null, estimated: true, warning: 'cotação não configurada', warningCode: 'FX_NOT_CONFIGURED',
    });
  });

  test('arredonda ao centavo mais próximo (ROUND, T82)', () => {
    expect(estimateBalanceBrl({ balanceCents: 1001, store: csfloat(), settings: { usdBrlRate: 5.2999 } }).estimatedBrlCents).toBe(5305);
    expect(estimateBalanceBrl({ balanceCents: 12346, store: csfloat(), settings: { usdBrlRate: 5.4321 } }).estimatedBrlCents).toBe(67065);
  });

  test.each([-1, 1.5, '1000', null, NaN])('saldo inválido (%p) → ValidationError', (balanceCents) => {
    expect(() => estimateBalanceBrl({ balanceCents, store: csfloat(), settings: SETTINGS })).toThrow(ValidationError);
  });
});
