'use strict';

// Saque na moeda da loja (8.5, D225, D228): líquido na moeda da loja e na moeda base (USD). O valor recebido em R$ é
// só informativo e nunca entra na conta de um saque com loja. A taxa de saque pertence ao saque.
const withdrawalService = require('../../src/services/withdrawalService');
const { csfloat, steam } = require('../helpers/storeFixtures');

const { withdrawalNetStoreCents, withdrawalBaseAmount } = withdrawalService;
const RATE = 5.4321;
const w = (overrides = {}) => ({ storeId: 1, amountStoreCents: 10000, feeCents: 250, amountBrlCents: 52037, ...overrides });

describe('withdrawalNetStoreCents (D228, D233)', () => {
  test('sacado menos a taxa', () => expect(withdrawalNetStoreCents(w())).toBe(9750));
  test('taxa 0', () => expect(withdrawalNetStoreCents(w({ feeCents: 0 }))).toBe(10000));
  test('taxa não informada conta 0 (D233)', () => expect(withdrawalNetStoreCents(w({ feeCents: null }))).toBe(10000));
  test('taxa igual ao valor: líquido 0 (parcela 0, não nula)', () => {
    expect(withdrawalNetStoreCents(w({ feeCents: 10000 }))).toBe(0);
    expect(withdrawalBaseAmount(w({ feeCents: 10000 }), csfloat(), null)).toEqual({ usdCents: 0, approxCents: 0, approxCurrency: 'BRL', estimated: false });
  });
  test('saque sem loja: nulo', () => {
    expect(withdrawalNetStoreCents({ storeId: null, amountStoreCents: null, feeCents: null, amountBrlCents: 10000 })).toBeNull();
  });
});

describe('withdrawalBaseAmount (D225, D226)', () => {
  test('exemplo de D226: saque 1 da CSFloat = 9750 exato, mesmo com valor recebido informativo', () => {
    expect(withdrawalBaseAmount(w(), csfloat(), RATE)).toEqual({ usdCents: 9750, approxCents: 52963, approxCurrency: 'BRL', estimated: false });
    expect(withdrawalBaseAmount(w({ amountBrlCents: null }), csfloat(), RATE).usdCents).toBe(9750);
    expect(withdrawalBaseAmount(w({ amountBrlCents: 999999 }), csfloat(), RATE).usdCents).toBe(9750);
  });

  test('USD sem cotação: US$ exato e "≈ R$" nulo', () => {
    expect(withdrawalBaseAmount(w(), csfloat(), null)).toEqual({ usdCents: 9750, approxCents: null, approxCurrency: 'BRL', estimated: false });
  });

  test('saque sem loja: R$ convertido (10000 / 5,4321 -> 1841), estimado; sem cotação, nulo', () => {
    const legacy = { storeId: null, amountStoreCents: null, feeCents: null, amountBrlCents: 10000 };
    expect(withdrawalBaseAmount(legacy, null, RATE)).toEqual({ usdCents: 1841, approxCents: 10000, approxCurrency: 'BRL', estimated: true });
    expect(withdrawalBaseAmount(legacy, null, null).usdCents).toBeNull();
  });

  test('loja em BRL com saque: líquido convertido pela cotação, estimado', () => {
    expect(withdrawalBaseAmount(w({ amountStoreCents: 4590, feeCents: null }), steam({ allowsWithdrawal: true }), RATE))
      .toEqual({ usdCents: 845, approxCents: 4590, approxCurrency: 'BRL', estimated: true });
  });
});

describe('withdrawalService: API pública', () => {
  test('sem cotação efetiva, simulação de saque nem estimateBalanceBrl (saiu na 8.5); só regras, conversões puras e orquestradores', () => {
    expect(Object.keys(withdrawalService).sort()).toEqual([
      'buildWithdrawalRecord', 'createWithdrawal', 'deleteWithdrawal', 'getFeeSuggestion', 'listWithdrawals',
      'suggestWithdrawalFeeCents', 'toWithdrawalView', 'updateWithdrawal', 'withdrawalBaseAmount', 'withdrawalNetStoreCents',
    ]);
  });
});

describe('withdrawalBaseAmount: loja referenciada fora do mapa', () => {
  test('storeId sem loja -> usdCents e approx nulos (não assume USD)', () => {
    const w = { storeId: 99, amountStoreCents: 10000, feeCents: 250, amountBrlCents: null };
    expect(withdrawalBaseAmount(w, null, 5.4321)).toEqual({ usdCents: null, approxCents: null, approxCurrency: 'BRL', estimated: false });
  });
});
