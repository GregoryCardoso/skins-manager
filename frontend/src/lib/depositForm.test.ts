import { describe, expect, test } from 'vitest';
import {
  buildDepositCreateBody, buildDepositPatchBody, depositFormFromDeposit, initialDepositState, validateDepositForm,
  type DepositFormState,
} from './depositForm';
import type { Deposit } from '@/types/api';

const deposit = (overrides: Partial<Deposit> = {}): Deposit => ({
  id: 1,
  amountBrlCents: 12345,
  depositedAt: '2026-11-10T15:30:00.000Z',
  storeId: 2,
  storeName: 'Steam',
  note: 'pix',
  createdAt: '2026-11-10T15:30:00.000Z',
  updatedAt: '2026-11-10T15:30:00.000Z',
  ...overrides,
});

const state = (overrides: Partial<DepositFormState> = {}): DepositFormState => ({
  amountText: '100,50', depositedAt: '2026-11-10T12:30', storeId: null, note: '', ...overrides,
});

describe('initialDepositState', () => {
  test('data padrão = agora (hora local, minutos), sem valor, loja e nota', () => {
    const now = new Date(2026, 10, 21, 9, 5, 40);
    expect(initialDepositState(now)).toEqual({ amountText: '', depositedAt: '2026-11-21T09:05', storeId: null, note: '' });
  });
});

describe('validateDepositForm', () => {
  test('estado válido não tem erros', () => {
    expect(validateDepositForm(state(), 'pt-BR')).toEqual({});
  });

  test('valor vazio, zero, negativo, texto e mais de 2 casas', () => {
    expect(validateDepositForm(state({ amountText: '  ' }), 'pt-BR')).toEqual({ amountBrlCents: 'deposits.form.amountRequired' });
    for (const bad of ['0', '0,00', '-5', 'abc', '1,234', '1,2,3']) {
      expect(validateDepositForm(state({ amountText: bad }), 'pt-BR'), bad).toEqual({ amountBrlCents: 'deposits.form.invalidMoney' });
    }
  });

  test('data vazia ou impossível', () => {
    expect(validateDepositForm(state({ depositedAt: '' }), 'pt-BR')).toEqual({ depositedAt: 'deposits.form.invalidDate' });
    expect(validateDepositForm(state({ depositedAt: '2026-02-30T10:00' }), 'pt-BR')).toEqual({ depositedAt: 'deposits.form.invalidDate' });
  });

  test('os dois erros juntos', () => {
    expect(Object.keys(validateDepositForm(state({ amountText: '', depositedAt: '' }), 'pt-BR')).sort()).toEqual(['amountBrlCents', 'depositedAt']);
  });
});

describe('buildDepositCreateBody', () => {
  test('vírgula vira centavos; loja e nota vazias são omitidas; data vai com o offset local', () => {
    const body = buildDepositCreateBody(state(), 'pt-BR');
    expect(body.amountBrlCents).toBe(10050);
    expect(body.depositedAt).toMatch(/^2026-11-10T12:30:00[+-]\d{2}:\d{2}$/);
    expect(body).not.toHaveProperty('storeId');
    expect(body).not.toHaveProperty('note');
  });

  test('separador de milhar e inglês', () => {
    expect(buildDepositCreateBody(state({ amountText: '1.234,56' }), 'pt-BR').amountBrlCents).toBe(123456);
    expect(buildDepositCreateBody(state({ amountText: '1,234.56' }), 'en').amountBrlCents).toBe(123456);
  });

  test('com loja e nota (com trim)', () => {
    const body = buildDepositCreateBody(state({ storeId: 3, note: '  mensal  ' }), 'pt-BR');
    expect(body).toMatchObject({ storeId: 3, note: 'mensal' });
  });
});

describe('depositFormFromDeposit e buildDepositPatchBody', () => {
  test('preenche o formulário no formato do idioma', () => {
    const original = deposit();
    const form = depositFormFromDeposit(original, 'pt-BR');
    expect(form).toMatchObject({ amountText: '123,45', storeId: 2, note: 'pix' });
    expect(depositFormFromDeposit(original, 'en').amountText).toBe('123.45');
    expect(depositFormFromDeposit(deposit({ note: null, storeId: null }), 'pt-BR')).toMatchObject({ note: '', storeId: null });
  });

  test('sem alterações: corpo vazio (inclusive ida e volta da data)', () => {
    const original = deposit();
    expect(buildDepositPatchBody(depositFormFromDeposit(original, 'pt-BR'), original, 'pt-BR')).toEqual({});
  });

  test('só o que mudou vai no PATCH', () => {
    const original = deposit();
    const base = depositFormFromDeposit(original, 'pt-BR');
    expect(buildDepositPatchBody({ ...base, amountText: '200' }, original, 'pt-BR')).toEqual({ amountBrlCents: 20000 });
    expect(buildDepositPatchBody({ ...base, note: ' outra ' }, original, 'pt-BR')).toEqual({ note: 'outra' });
    expect(buildDepositPatchBody({ ...base, storeId: 5 }, original, 'pt-BR')).toEqual({ storeId: 5 });
    const moved = buildDepositPatchBody({ ...base, depositedAt: '2026-11-11T08:00' }, original, 'pt-BR');
    expect(Object.keys(moved)).toEqual(['depositedAt']);
    expect(moved.depositedAt).toMatch(/^2026-11-11T08:00:00[+-]\d{2}:\d{2}$/);
  });

  test('esvaziar loja e nota envia null', () => {
    const original = deposit();
    const base = depositFormFromDeposit(original, 'pt-BR');
    expect(buildDepositPatchBody({ ...base, storeId: null, note: '   ' }, original, 'pt-BR')).toEqual({ storeId: null, note: null });
  });

  test('aporte sem nota: nota continua vazia -> sem alteração', () => {
    const original = deposit({ note: null });
    const base = depositFormFromDeposit(original, 'pt-BR');
    expect(buildDepositPatchBody(base, original, 'pt-BR')).toEqual({});
  });
});
