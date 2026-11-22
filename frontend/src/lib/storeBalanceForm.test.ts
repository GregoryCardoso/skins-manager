import { describe, expect, test } from 'vitest';
import { buildCheckPreviewQuery, buildStoreBalanceBody, initialStoreBalanceState, validateStoreBalanceForm } from './storeBalanceForm';

const base = { amountText: '1', recordedAt: '2026-11-21T09:05', noteText: '' };

describe('storeBalanceForm (conferência, D242/D247)', () => {
  test('estado inicial: valor vazio, data = agora (hora local, minutos) e nota vazia', () => {
    const now = new Date(2026, 10, 21, 9, 5);
    expect(initialStoreBalanceState(now)).toEqual({ amountText: '', recordedAt: '2026-11-21T09:05', noteText: '' });
  });

  test('valor vazio -> amountRequired; "0" é válido', () => {
    expect(validateStoreBalanceForm({ ...base, amountText: '' }, 'pt-BR')).toEqual({ balanceCents: 'storeBalances.form.amountRequired' });
    expect(validateStoreBalanceForm({ ...base, amountText: '  ' }, 'pt-BR').balanceCents).toBe('storeBalances.form.amountRequired');
    expect(validateStoreBalanceForm({ ...base, amountText: '0' }, 'pt-BR')).toEqual({});
  });

  test.each(['abc', '1,234', '-5', '1,2,3', '12.50.1'])('valor inválido "%s" (pt-BR)', (text) => {
    expect(validateStoreBalanceForm({ ...base, amountText: text }, 'pt-BR').balanceCents).toBe('storeBalances.form.invalidMoney');
  });

  test('data vazia ou impossível -> invalidDate', () => {
    for (const bad of ['', '2026-02-30T10:00', 'ontem']) {
      expect(validateStoreBalanceForm({ ...base, recordedAt: bad }, 'pt-BR').recordedAt).toBe('storeBalances.form.invalidDate');
    }
  });

  test('nota: obrigatória só ao ajustar (vazia ou só espaços não vale)', () => {
    expect(validateStoreBalanceForm(base, 'pt-BR', { adjust: true })).toEqual({ note: 'errors.ADJUSTMENT_NOTE_REQUIRED' });
    expect(validateStoreBalanceForm({ ...base, noteText: '   ' }, 'pt-BR', { adjust: true }).note).toBe('errors.ADJUSTMENT_NOTE_REQUIRED');
    expect(validateStoreBalanceForm({ ...base, noteText: 'taxa' }, 'pt-BR', { adjust: true })).toEqual({});
    expect(validateStoreBalanceForm(base, 'pt-BR')).toEqual({});
  });

  test('corpo: vírgula (pt-BR) e ponto (en) viram centavos; loja e data ISO com offset; adjust e nota', () => {
    const state = { amountText: '123,46', recordedAt: '2026-11-20T14:30', noteText: '' };
    const body = buildStoreBalanceBody(state, 7, 'pt-BR');
    expect(body).toMatchObject({ storeId: 7, balanceCents: 12346, adjust: false });
    expect(body).not.toHaveProperty('note');
    expect(body.recordedAt).toMatch(/^2026-11-20T14:30:00[+-]\d{2}:\d{2}$/);
    expect(buildStoreBalanceBody({ ...state, amountText: '123.46' }, 7, 'en').balanceCents).toBe(12346);
    expect(buildStoreBalanceBody({ ...state, amountText: '0' }, 7, 'pt-BR').balanceCents).toBe(0);
    expect(buildStoreBalanceBody({ ...state, amountText: '5' }, 7, 'pt-BR').balanceCents).toBe(500);
    expect(buildStoreBalanceBody({ ...state, noteText: '  taxa  ' }, 7, 'pt-BR', true)).toMatchObject({ adjust: true, note: 'taxa' });
  });

  test('consulta da prévia: nula com formulário incompleto ou inválido', () => {
    expect(buildCheckPreviewQuery({ ...base, amountText: '' }, 3, 'pt-BR')).toBeNull();
    expect(buildCheckPreviewQuery({ ...base, amountText: 'x' }, 3, 'pt-BR')).toBeNull();
    expect(buildCheckPreviewQuery({ ...base, recordedAt: '' }, 3, 'pt-BR')).toBeNull();
    const query = buildCheckPreviewQuery({ ...base, amountText: '80,50' }, 3, 'pt-BR');
    expect(query).toMatchObject({ storeId: 3, balanceCents: 8050 });
    expect(query?.recordedAt).toMatch(/^2026-11-21T09:05:00[+-]\d{2}:\d{2}$/);
  });
});
