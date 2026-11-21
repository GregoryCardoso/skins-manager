import { describe, expect, test } from 'vitest';
import { buildStoreBalanceBody, initialStoreBalanceState, validateStoreBalanceForm } from './storeBalanceForm';

describe('storeBalanceForm (D204)', () => {
  test('estado inicial: valor vazio e data = agora (hora local, minutos)', () => {
    const now = new Date(2026, 10, 21, 9, 5);
    expect(initialStoreBalanceState(now)).toEqual({ amountText: '', recordedAt: '2026-11-21T09:05' });
  });

  test('valor vazio -> amountRequired; "0" é válido', () => {
    const date = '2026-11-21T09:05';
    expect(validateStoreBalanceForm({ amountText: '', recordedAt: date }, 'pt-BR')).toEqual({ balanceCents: 'storeBalances.form.amountRequired' });
    expect(validateStoreBalanceForm({ amountText: '  ', recordedAt: date }, 'pt-BR').balanceCents).toBe('storeBalances.form.amountRequired');
    expect(validateStoreBalanceForm({ amountText: '0', recordedAt: date }, 'pt-BR')).toEqual({});
  });

  test.each(['abc', '1,234', '-5', '1,2,3', '12.50.1'])('valor inválido "%s" (pt-BR)', (text) => {
    expect(validateStoreBalanceForm({ amountText: text, recordedAt: '2026-11-21T09:05' }, 'pt-BR').balanceCents).toBe('storeBalances.form.invalidMoney');
  });

  test('data vazia ou impossível -> invalidDate', () => {
    for (const bad of ['', '2026-02-30T10:00', 'ontem']) {
      expect(validateStoreBalanceForm({ amountText: '1', recordedAt: bad }, 'pt-BR').recordedAt).toBe('storeBalances.form.invalidDate');
    }
  });

  test('corpo: vírgula (pt-BR) e ponto (en) viram centavos; loja e data ISO com offset', () => {
    const state = { amountText: '123,46', recordedAt: '2026-11-20T14:30' };
    const body = buildStoreBalanceBody(state, 7, 'pt-BR');
    expect(body).toMatchObject({ storeId: 7, balanceCents: 12346 });
    expect(body.recordedAt).toMatch(/^2026-11-20T14:30:00[+-]\d{2}:\d{2}$/);
    expect(buildStoreBalanceBody({ ...state, amountText: '123.46' }, 7, 'en').balanceCents).toBe(12346);
    expect(buildStoreBalanceBody({ ...state, amountText: '0' }, 7, 'pt-BR').balanceCents).toBe(0);
    expect(buildStoreBalanceBody({ ...state, amountText: '5' }, 7, 'pt-BR').balanceCents).toBe(500);
  });
});
