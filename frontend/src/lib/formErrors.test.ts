import { describe, expect, test } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { resolveErrorTarget } from './formErrors';

const FIELDS = ['floatValue', 'exterior', 'netReceivedCents', 'saleStoreId'] as const;
const err = (code: string, extra: { field?: string } = {}) => new ApiRequestError(code, 'm', 400, extra);

describe('resolveErrorTarget', () => {
  test('campo informado pelo backend vence', () => {
    expect(resolveErrorTarget(err('FLOAT_OUT_OF_RANGE', { field: 'floatValue' }), FIELDS)).toEqual({ target: 'floatValue', topLabelField: null });
  });

  test('sem campo: mapa de reserva por código', () => {
    expect(resolveErrorTarget(err('EXTERIOR_MISMATCH'), FIELDS)).toEqual({ target: 'exterior', topLabelField: null });
    expect(resolveErrorTarget(err('FEES_NOT_CONFIGURED'), FIELDS)).toEqual({ target: 'saleStoreId', topLabelField: null });
  });

  test('campo que o formulário não tem vai para o topo com o rótulo', () => {
    expect(resolveErrorTarget(err('INVALID_FIELD', { field: 'foo' }), FIELDS)).toEqual({ target: null, topLabelField: 'foo' });
  });

  test('desconhecido ou erro de outro tipo vai para o topo', () => {
    expect(resolveErrorTarget(err('ITEM_ALREADY_SOLD'), FIELDS)).toEqual({ target: null, topLabelField: null });
    expect(resolveErrorTarget(new Error('x'), FIELDS)).toEqual({ target: null, topLabelField: null });
  });

  test('reserva oculta vai para o topo com o rótulo do campo', () => {
    expect(resolveErrorTarget(err('EXTERIOR_MISMATCH'), ['floatValue'])).toEqual({ target: null, topLabelField: 'exterior' });
  });

  test('campo oculto informado pelo backend vai para o topo com o rótulo', () => {
    expect(resolveErrorTarget(err('INVALID_FLOAT', { field: 'floatValue' }), ['name'])).toEqual({ target: null, topLabelField: 'floatValue' });
    expect(resolveErrorTarget(err('GANHEI_COST_NOT_ALLOWED'), ['name'])).toEqual({ target: null, topLabelField: 'purchasePriceCents' });
  });
});
