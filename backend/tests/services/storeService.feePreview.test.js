// previewSaleFee (12.8): pura, sem banco e sem relógio.
const { previewSaleFee } = require('../../src/services/storeService');
const { saleFeeParamsFromDraft, saleFeeParamsFromStore } = require('../../src/services/fees');

describe('previewSaleFee', () => {
  test('DEDUCTED 2% CEIL', () => {
    expect(previewSaleFee({ currency: 'USD', saleFeeType: 'DEDUCTED', rate: 0.02, priceCents: 120 })).toEqual({
      currency: 'USD', saleFeeType: 'DEDUCTED', priceCents: 120, feeCents: 3, netCents: 117,
    });
  });
  test('padrões: CEIL, sem mínima, fixa 0 e preço de exemplo', () => {
    const res = previewSaleFee({ currency: 'USD', saleFeeType: 'DEDUCTED', rate: 0.02 });
    expect(res.priceCents).toBe(1000);
    expect(res.feeCents).toBe(20);
  });
  test('rate 0 sem mínima nem fixa: taxa 0', () => {
    expect(previewSaleFee({ currency: 'USD', saleFeeType: 'DEDUCTED', rate: 0, priceCents: 500 }).feeCents).toBe(0);
  });
  test('rate inválida lança INVALID_RATE', () => {
    expect(() => previewSaleFee({ currency: 'USD', saleFeeType: 'DEDUCTED', rate: 1.5 })).toThrow(expect.objectContaining({ code: 'INVALID_RATE' }));
  });
});

describe('saleFeeParamsFromDraft', () => {
  test('é o mesmo cálculo da loja gravada', () => {
    const store = { currency: 'JPY', saleFeeType: 'ADDED', saleFeeRate: 0.05, saleFeeRounding: 'FLOOR', saleMinFeeCents: 100, saleFixedFeeCents: 0 };
    expect(saleFeeParamsFromDraft(store)).toEqual(saleFeeParamsFromStore(store));
    expect(saleFeeParamsFromDraft(store).unitCents).toBe(100);
  });
  test('sem tipo ou taxa devolve null (nunca assume 0)', () => {
    expect(saleFeeParamsFromDraft({ currency: 'USD', saleFeeType: null, saleFeeRate: null })).toBeNull();
    expect(saleFeeParamsFromDraft(null)).toBeNull();
  });
});
