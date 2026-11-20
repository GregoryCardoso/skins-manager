'use strict';

// Fixtures puras (sem banco) para os testes dos services. Não é arquivo de teste.
// Espelham as lojas do seed (src/config/seed.js), já em camelCase como os models devolvem.

// Parâmetros de referência da CSFloat (D44).
const CSF = Object.freeze({ feeType: 'DEDUCTED', rate: 0.02, rounding: 'CEIL', minFeeCents: null, fixedFeeCents: 0 });
const STEAM_PARAMS = Object.freeze({ feeType: 'ADDED', rate: 0.15, rounding: 'CEIL', minFeeCents: null, fixedFeeCents: 0 });

function csfloat(overrides = {}) {
  return {
    id: 1,
    name: 'CSFloat',
    currency: 'USD',
    isActive: true,
    isPrimary: true,
    saleFeeType: 'DEDUCTED',
    saleFeeRate: 0.02,
    saleFeeRounding: 'CEIL',
    saleMinFeeCents: null,
    saleFixedFeeCents: 0,
    allowsWithdrawal: true,
    withdrawalFeeRate: 0.025,
    withdrawalFixedFeeCents: 0,
    ...overrides,
  };
}

function steam(overrides = {}) {
  return {
    id: 2,
    name: 'Steam',
    currency: 'BRL',
    isActive: true,
    isPrimary: false,
    saleFeeType: 'ADDED',
    saleFeeRate: 0.15,
    saleFeeRounding: 'CEIL',
    saleMinFeeCents: null,
    saleFixedFeeCents: 0,
    allowsWithdrawal: false,
    withdrawalFeeRate: null,
    withdrawalFixedFeeCents: 0,
    ...overrides,
  };
}

function csmoney(overrides = {}) {
  return {
    id: 3,
    name: 'CSMoney',
    currency: 'USD',
    isActive: true,
    isPrimary: false,
    saleFeeType: null,
    saleFeeRate: null,
    saleFeeRounding: 'CEIL',
    saleMinFeeCents: null,
    saleFixedFeeCents: 0,
    allowsWithdrawal: true,
    withdrawalFeeRate: null,
    withdrawalFixedFeeCents: 0,
    ...overrides,
  };
}

function usdItem(overrides = {}) {
  return {
    id: 1,
    name: 'AK-47 | Redline',
    category: 'SKIN',
    variant: 'NORMAL',
    exterior: 'FT',
    status: 'EM_ESTOQUE',
    acquisitionType: 'COMPRA',
    purchasePriceCents: 100,
    purchaseCurrency: 'USD',
    fxRateAtPurchase: null,
    acquiredAt: '2026-11-01T12:00:00.000Z',
    ...overrides,
  };
}

module.exports = { CSF, STEAM_PARAMS, csfloat, steam, csmoney, usdItem };
