import { describe, expect, test } from 'vitest';
import {
  buildStoreCreateBody, buildStorePatchBody, initialStoreFormState, percentTextToRate, rateToPercentText,
  storeFormFromStore, storeFormRounds, validateStoreForm,
} from './storeForm';
import { makeStore } from './testFixtures';

describe('percentTextToRate / rateToPercentText', () => {
  test.each([
    ['2,5', 'pt-BR', 0.025], ['15', 'pt-BR', 0.15], ['0,5', 'pt-BR', 0.005], ['2.5', 'en', 0.025], ['0', 'pt-BR', 0],
  ])('%s (%s) -> %s e volta', (text, lang, rate) => {
    expect(percentTextToRate(text, lang)).toEqual({ ok: true, rate });
    expect(percentTextToRate(rateToPercentText(rate, lang), lang)).toEqual({ ok: true, rate });
  });

  test('vazio vira null; inválido, negativo e >= 100 viram erro', () => {
    expect(percentTextToRate('  ', 'pt-BR')).toEqual({ ok: true, rate: null });
    for (const bad of ['abc', '-1', '100', '100,5', '99,99999', '1,2,3']) expect(percentTextToRate(bad, 'pt-BR')).toEqual({ ok: false });
  });

  test('texto sem erro de arredondamento e por idioma', () => {
    expect(rateToPercentText(0.025, 'pt-BR')).toBe('2,5');
    expect(rateToPercentText(0.025, 'en')).toBe('2.5');
    expect(rateToPercentText(0.15, 'pt-BR')).toBe('15');
    expect(rateToPercentText(null, 'pt-BR')).toBe('');
  });
});

describe('formulário de loja', () => {
  const base = { ...initialStoreFormState(), name: ' Nova ', currency: 'BRL' as const };

  test('corpo de criação: vazio = null nas anuláveis e 0 nas fixas', () => {
    expect(buildStoreCreateBody(base, 'pt-BR')).toEqual({
      name: 'Nova', currency: 'BRL', saleFeeType: null, saleFeeRate: null, saleFeeRounding: 'CEIL', saleMinFeeCents: null,
      saleFixedFeeCents: 0, allowsWithdrawal: false, withdrawalFeeRate: null, withdrawalFixedFeeCents: 0, saleHoldDays: 0, isActive: true, isPrimary: false,
    });
  });

  test('converte percentuais e centavos digitados', () => {
    const body = buildStoreCreateBody(
      { ...base, saleFeeType: 'ADDED', saleFeeRateText: '2,5', saleMinFeeText: '0,30', saleFixedFeeText: '1' }, 'pt-BR',
    );
    expect(body).toMatchObject({ saleFeeType: 'ADDED', saleFeeRate: 0.025, saleMinFeeCents: 30, saleFixedFeeCents: 100 });
  });

  test('validação local', () => {
    expect(validateStoreForm(base, 'pt-BR')).toEqual({});
    expect(validateStoreForm({ ...base, name: ' ', saleFeeRateText: 'x', saleMinFeeText: '1,234', withdrawalFixedFeeText: '-1' }, 'pt-BR')).toEqual({
      name: 'storeForm.nameRequired', saleFeeRate: 'storeForm.invalidRate', saleMinFeeCents: 'storeForm.invalidMoney',
      withdrawalFixedFeeCents: 'storeForm.invalidMoney',
    });
  });

  test('PATCH envia só o que mudou; ida e volta sem mudar não envia nada', () => {
    const store = makeStore({
      id: 5, name: 'Steam', currency: 'BRL', saleFeeType: 'ADDED', saleFeeRate: 0.15, saleMinFeeCents: 30, saleFixedFeeCents: 5,
      withdrawalFeeRate: 0.025, withdrawalFixedFeeCents: 0, allowsWithdrawal: true,
    });
    const state = storeFormFromStore(store, 'pt-BR');
    expect(buildStorePatchBody(state, store, 'pt-BR')).toEqual({});
    expect(buildStorePatchBody({ ...state, saleFeeRateText: '16' }, store, 'pt-BR')).toEqual({ saleFeeRate: 0.16 });
    expect(buildStorePatchBody({ ...state, saleMinFeeText: '' }, store, 'pt-BR')).toEqual({ saleMinFeeCents: null });
  });
});

describe('T85 - aviso de arredondamento', () => {
  test('mais casas que o aceito -> rounded: true', () => {
    expect(percentTextToRate('2,1234567', 'pt-BR')).toEqual({ ok: true, rate: 0.021235, rounded: true });
  });
  test('até 4 casas não arredonda', () => {
    expect(percentTextToRate('2,1234', 'pt-BR')).toEqual({ ok: true, rate: 0.021234 });
    expect(percentTextToRate('2,5', 'pt-BR')).toEqual({ ok: true, rate: 0.025 });
  });
});

describe('T85 - storeFormRounds e casos de borda', () => {
  const base = { saleFeeRateText: '', withdrawalFeeRateText: '' };
  test('avisa quando qualquer um dos dois percentuais será arredondado', () => {
    expect(storeFormRounds({ ...base, saleFeeRateText: '2,1234567' }, 'pt-BR')).toBe(true);
    expect(storeFormRounds({ ...base, withdrawalFeeRateText: '1.00001' }, 'en')).toBe(true);
    expect(storeFormRounds({ saleFeeRateText: '2,5', withdrawalFeeRateText: '' }, 'pt-BR')).toBe(false);
    expect(storeFormRounds({ saleFeeRateText: 'abc', withdrawalFeeRateText: '150' }, 'pt-BR')).toBe(false);
  });
  test('4 casas exatas com erro de ponto flutuante não geram aviso falso', () => {
    for (const t of ['2,1235', '0,0001', '7,3', '99,9999', '0,29', '1,1']) {
      expect(percentTextToRate(t, 'pt-BR'), t).not.toHaveProperty('rounded');
    }
  });
});
