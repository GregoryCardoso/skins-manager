import { describe, expect, test } from 'vitest';
import {
  buildStoreCreateBody, buildStorePatchBody, initialStoreFormState, MAX_SALE_HOLD_DAYS, storeFormFromStore, validateStoreForm,
} from './storeForm';
import { makeStore } from './testFixtures';

// 8.3 (D213, D211): campo "retenção do saldo" (saleHoldDays) no formulário de lojas.
const withHold = (text: string) => ({ ...initialStoreFormState(), name: 'Loja', saleHoldDaysText: text });
const errorOf = (text: string) => validateStoreForm(withHold(text), 'pt-BR').saleHoldDays;

describe('saleHoldDays no formulário da loja', () => {
  test('constante igual à do backend (30) e padrão do formulário novo = "0"', () => {
    expect(MAX_SALE_HOLD_DAYS).toBe(30);
    expect(initialStoreFormState().saleHoldDaysText).toBe('0');
  });

  test.each(['0', '1', '7', '30', ' 7 ', '007'])('"%s" é aceito', (text) => {
    expect(errorOf(text)).toBeUndefined();
  });

  test.each(['', '   ', '31', '70', '-1', '7.5', '7,5', 'abc', '1e1', '+7', '99999999999999999999'])('"%s" gera o erro de retenção', (text) => {
    expect(errorOf(text)).toBe('storeForm.invalidSaleHoldDays');
  });

  test('"7" vira 7 no corpo; "0" vira 0; "30" vira 30', () => {
    expect(buildStoreCreateBody(withHold('7'), 'pt-BR').saleHoldDays).toBe(7);
    expect(buildStoreCreateBody(withHold('0'), 'pt-BR').saleHoldDays).toBe(0);
    expect(buildStoreCreateBody(withHold(' 30 '), 'pt-BR').saleHoldDays).toBe(30);
  });

  test('o erro de retenção é independente dos demais campos', () => {
    const errors = validateStoreForm({ ...withHold('31'), name: '' }, 'pt-BR');
    expect(Object.keys(errors).sort()).toEqual(['name', 'saleHoldDays']);
  });

  test('edição: carrega o valor da loja e o PATCH leva só a retenção alterada', () => {
    const store = makeStore({ id: 1, name: 'CSFloat', saleHoldDays: 7 });
    const state = storeFormFromStore(store, 'pt-BR');
    expect(state.saleHoldDaysText).toBe('7');
    expect(buildStorePatchBody(state, store, 'pt-BR')).toEqual({});
    expect(buildStorePatchBody({ ...state, saleHoldDaysText: '3' }, store, 'pt-BR')).toEqual({ saleHoldDays: 3 });
    expect(buildStorePatchBody({ ...state, saleHoldDaysText: '0' }, store, 'pt-BR')).toEqual({ saleHoldDays: 0 });
  });
});
