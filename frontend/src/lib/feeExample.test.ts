import { describe, expect, test } from 'vitest';
import { feeExampleInput, feeExampleKey } from './feeExample';
import { initialStoreFormState, type StoreFormState } from './storeForm';

const form = (extra: Partial<StoreFormState> = {}): StoreFormState => ({ ...initialStoreFormState(), ...extra });

describe('feeExampleInput', () => {
  test('sem tipo e sem percentual: taxas não configuradas', () => {
    expect(feeExampleInput(form(), '', 'en')).toEqual({ status: 'notConfigured' });
  });

  test('tipo sem percentual, ou percentual sem tipo: incompleto (nada a pedir)', () => {
    expect(feeExampleInput(form({ saleFeeType: 'DEDUCTED' }), '', 'en')).toEqual({ status: 'incomplete' });
    expect(feeExampleInput(form({ saleFeeRateText: '2' }), '', 'en')).toEqual({ status: 'incomplete' });
  });

  test('percentual inválido ou valor que não vira número: incompleto', () => {
    expect(feeExampleInput(form({ saleFeeType: 'DEDUCTED', saleFeeRateText: 'abc' }), '', 'en').status).toBe('incomplete');
    expect(feeExampleInput(form({ saleFeeType: 'DEDUCTED', saleFeeRateText: '2', saleMinFeeText: 'x' }), '', 'en').status).toBe('incomplete');
    expect(feeExampleInput(form({ saleFeeType: 'DEDUCTED', saleFeeRateText: '2' }), 'zzz', 'en').status).toBe('incomplete');
    expect(feeExampleInput(form({ saleFeeType: 'DEDUCTED', saleFeeRateText: '2' }), '0', 'en').status).toBe('incomplete');
  });

  test('monta os parâmetros: fração do percentual, centavos da moeda e preço opcional', () => {
    const input = feeExampleInput(
      form({ saleFeeType: 'ADDED', saleFeeRateText: '2,5', saleFeeRounding: 'FLOOR', saleMinFeeText: '0,30', saleFixedFeeText: '0,10' }),
      '12,50',
      'pt-BR',
    );
    expect(input).toEqual({
      status: 'ready',
      query: { currency: 'USD', saleFeeType: 'ADDED', rate: 0.025, rounding: 'FLOOR', minCents: 30, fixedCents: 10, priceCents: 1250 },
    });
  });

  test('vazio: sem mínima (null), fixa 0 e preço vazio (o backend escolhe o exemplo)', () => {
    const input = feeExampleInput(form({ saleFeeType: 'DEDUCTED', saleFeeRateText: '2' }), '', 'en');
    expect(input).toEqual({
      status: 'ready',
      query: { currency: 'USD', saleFeeType: 'DEDUCTED', rate: 0.02, rounding: 'CEIL', minCents: null, fixedCents: 0, priceCents: null },
    });
  });

  test('JPY: valores na unidade da moeda; fração dá incompleto (sem centavos)', () => {
    const base = form({ currency: 'JPY', saleFeeType: 'DEDUCTED', saleFeeRateText: '10' });
    const ok = feeExampleInput(base, '1500', 'en');
    expect(ok.status === 'ready' && ok.query.priceCents).toBe(150000);
    expect(feeExampleInput(base, '15.5', 'en').status).toBe('incomplete');
  });
});

describe('feeExampleKey', () => {
  test('inclui todos os parâmetros: dois pedidos diferentes nunca compartilham a chave', () => {
    const base = { currency: 'USD', saleFeeType: 'DEDUCTED', rate: 0.02, rounding: 'CEIL', minCents: null, fixedCents: 0, priceCents: 1000 } as const;
    expect(feeExampleKey(base)).not.toEqual(feeExampleKey({ ...base, priceCents: 1001 }));
    expect(feeExampleKey(base)).not.toEqual(feeExampleKey({ ...base, rate: 0.03 }));
    expect(feeExampleKey(base)).not.toEqual(feeExampleKey({ ...base, rounding: 'ROUND' }));
    expect(feeExampleKey(null)).toEqual(['idle']);
  });
});
