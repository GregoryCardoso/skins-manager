import { describe, expect, test } from 'vitest';
import {
  buildDepositCreateBody, buildDepositPatchBody, depositFormFromDeposit, depositStoreOptions, initialDepositState,
  legacyStoreIsNotUsd, validateDepositForm, type DepositFormState,
} from './depositForm';
import type { Deposit, Store } from '@/types/api';

const deposit = (overrides: Partial<Deposit> = {}): Deposit => ({
  id: 1,
  storeId: 2,
  storeName: 'CSFloat',
  currency: 'USD',
  amountStoreCents: 12345,
  amountBrlCents: 65000,
  depositedAt: '2026-11-10T15:30:00.000Z',
  note: 'pix',
  legacy: false,
  amountUsdCents: 12345,
  approxBrlCents: null,
  estimated: false,
  createdAt: '2026-11-10T15:30:00.000Z',
  updatedAt: '2026-11-10T15:30:00.000Z',
  ...overrides,
});
// Aporte legado (v7): só o valor em R$; a loja informativa pode ser USD, BRL ou inexistente.
const legacyDeposit = (overrides: Partial<Deposit> = {}): Deposit =>
  deposit({ amountStoreCents: null, amountBrlCents: 30000, legacy: true, amountUsdCents: 5523, estimated: true, ...overrides });

const store = (overrides: Partial<Store> = {}): Store => ({ id: 1, name: 'CSFloat', currency: 'USD', isActive: true, ...overrides } as Store);

const state = (overrides: Partial<DepositFormState> = {}): DepositFormState => ({
  storeId: 2, amountText: '100,50', paidText: '', feeText: '', depositedAt: '2026-11-10T12:30', note: '', ...overrides,
});

describe('initialDepositState', () => {
  test('data padrão = agora (hora local, minutos), sem loja, valores e nota', () => {
    const now = new Date(2026, 10, 21, 9, 5, 40);
    expect(initialDepositState(now)).toEqual({ storeId: null, amountText: '', paidText: '', feeText: '', depositedAt: '2026-11-21T09:05', note: '' });
  });
});

describe('validateDepositForm', () => {
  test('estado válido não tem erros; o valor pago em R$ é opcional', () => {
    expect(validateDepositForm(state(), 'pt-BR')).toEqual({});
    expect(validateDepositForm(state({ paidText: '500,00' }), 'pt-BR')).toEqual({});
  });

  test('loja obrigatória', () => {
    expect(validateDepositForm(state({ storeId: null }), 'pt-BR')).toEqual({ storeId: 'deposits.form.storeRequired' });
  });

  test('valor creditado vazio, zero, negativo, texto e mais de 2 casas', () => {
    expect(validateDepositForm(state({ amountText: '  ' }), 'pt-BR')).toEqual({ amountStoreCents: 'deposits.form.amountRequired' });
    for (const bad of ['0', '0,00', '-5', 'abc', '1,234', '1,2,3']) {
      expect(validateDepositForm(state({ amountText: bad }), 'pt-BR'), bad).toEqual({ amountStoreCents: 'deposits.form.invalidMoney' });
    }
  });

  test('valor pago em R$: vazio é aceito; zero e texto não', () => {
    expect(validateDepositForm(state({ paidText: '  ' }), 'pt-BR')).toEqual({});
    for (const bad of ['0', '-1', 'abc']) {
      expect(validateDepositForm(state({ paidText: bad }), 'pt-BR'), bad).toEqual({ amountBrlCents: 'deposits.form.invalidMoney' });
    }
  });

  test('data vazia ou impossível', () => {
    expect(validateDepositForm(state({ depositedAt: '' }), 'pt-BR')).toEqual({ depositedAt: 'deposits.form.invalidDate' });
    expect(validateDepositForm(state({ depositedAt: '2026-02-30T10:00' }), 'pt-BR')).toEqual({ depositedAt: 'deposits.form.invalidDate' });
  });

  test('todos os erros juntos', () => {
    expect(Object.keys(validateDepositForm(state({ storeId: null, amountText: '', paidText: 'x', depositedAt: '' }), 'pt-BR')).sort())
      .toEqual(['amountBrlCents', 'amountStoreCents', 'depositedAt', 'storeId']);
  });
});

describe('buildDepositCreateBody', () => {
  test('vírgula vira centavos; valor pago e nota vazios são omitidos; data vai com o offset local', () => {
    const body = buildDepositCreateBody(state(), 'pt-BR');
    expect(body.storeId).toBe(2);
    expect(body.amountStoreCents).toBe(10050);
    expect(body.depositedAt).toMatch(/^2026-11-10T12:30:00[+-]\d{2}:\d{2}$/);
    expect(body).not.toHaveProperty('amountBrlCents');
    expect(body).not.toHaveProperty('note');
  });

  test('R$ vazio vira ausente (nulo na API); R$ informado vai em centavos', () => {
    expect(buildDepositCreateBody(state({ paidText: '' }), 'pt-BR')).not.toHaveProperty('amountBrlCents');
    expect(buildDepositCreateBody(state({ paidText: '540,00' }), 'pt-BR').amountBrlCents).toBe(54000);
  });

  test('separador de milhar e inglês', () => {
    expect(buildDepositCreateBody(state({ amountText: '1.234,56' }), 'pt-BR').amountStoreCents).toBe(123456);
    expect(buildDepositCreateBody(state({ amountText: '1,234.56' }), 'en').amountStoreCents).toBe(123456);
  });

  test('nota com trim', () => {
    expect(buildDepositCreateBody(state({ note: '  mensal  ' }), 'pt-BR')).toMatchObject({ storeId: 2, note: 'mensal' });
  });
});

describe('depositStoreOptions (E8-Q16): só lojas em USD', () => {
  const stores = [
    store({ id: 1, name: 'CSFloat' }),
    store({ id: 2, name: 'CSMoney' }),
    store({ id: 3, name: 'Steam', currency: 'BRL' }),
    store({ id: 4, name: 'Antiga', isActive: false }),
    store({ id: 5, name: 'Steam velha', currency: 'BRL', isActive: false }),
  ];

  test('aporte novo: só USD ativas; a Steam nunca aparece', () => {
    expect(depositStoreOptions(stores, null).map((s) => s.name)).toEqual(['CSFloat', 'CSMoney']);
  });

  test('edição: a loja gravada entra se for USD, mesmo inativa', () => {
    expect(depositStoreOptions(stores, deposit({ storeId: 4 })).map((s) => s.name)).toEqual(['CSFloat', 'CSMoney', 'Antiga']);
  });

  test('edição de legado com loja em BRL: a loja gravada não entra', () => {
    expect(depositStoreOptions(stores, legacyDeposit({ storeId: 3, currency: 'BRL' })).map((s) => s.name)).toEqual(['CSFloat', 'CSMoney']);
    expect(depositStoreOptions(stores, legacyDeposit({ storeId: 5, currency: 'BRL' })).map((s) => s.name)).toEqual(['CSFloat', 'CSMoney']);
  });

  test('sem nenhuma loja USD ativa: lista vazia', () => {
    expect(depositStoreOptions([store({ id: 3, currency: 'BRL' })], null)).toEqual([]);
  });
});

describe('depositFormFromDeposit e buildDepositPatchBody', () => {
  test('preenche o formulário no formato do idioma', () => {
    const original = deposit();
    const form = depositFormFromDeposit(original, 'pt-BR');
    expect(form).toMatchObject({ amountText: '123,45', paidText: '650,00', storeId: 2, note: 'pix' });
    expect(depositFormFromDeposit(original, 'en')).toMatchObject({ amountText: '123.45', paidText: '650.00' });
    expect(depositFormFromDeposit(deposit({ note: null, amountBrlCents: null }), 'pt-BR')).toMatchObject({ note: '', paidText: '' });
  });

  test('sem alterações: corpo vazio (inclusive ida e volta da data)', () => {
    const original = deposit();
    expect(buildDepositPatchBody(depositFormFromDeposit(original, 'pt-BR'), original, 'pt-BR')).toEqual({});
  });

  test('só o que mudou vai no PATCH', () => {
    const original = deposit();
    const base = depositFormFromDeposit(original, 'pt-BR');
    expect(buildDepositPatchBody({ ...base, amountText: '200' }, original, 'pt-BR')).toEqual({ amountStoreCents: 20000 });
    expect(buildDepositPatchBody({ ...base, paidText: '700' }, original, 'pt-BR')).toEqual({ amountBrlCents: 70000 });
    expect(buildDepositPatchBody({ ...base, note: ' outra ' }, original, 'pt-BR')).toEqual({ note: 'outra' });
    expect(buildDepositPatchBody({ ...base, storeId: 5 }, original, 'pt-BR')).toEqual({ storeId: 5 });
    const moved = buildDepositPatchBody({ ...base, depositedAt: '2026-11-11T08:00' }, original, 'pt-BR');
    expect(Object.keys(moved)).toEqual(['depositedAt']);
    expect(moved.depositedAt).toMatch(/^2026-11-11T08:00:00[+-]\d{2}:\d{2}$/);
  });

  test('esvaziar o valor pago e a nota envia null', () => {
    const original = deposit();
    const base = depositFormFromDeposit(original, 'pt-BR');
    expect(buildDepositPatchBody({ ...base, paidText: '', note: '   ' }, original, 'pt-BR')).toEqual({ amountBrlCents: null, note: null });
  });

  test('aporte sem nota: nota continua vazia -> sem alteração', () => {
    const original = deposit({ note: null });
    const base = depositFormFromDeposit(original, 'pt-BR');
    expect(buildDepositPatchBody(base, original, 'pt-BR')).toEqual({});
  });
});

describe('aporte legado (D224, D231)', () => {
  test('loja informativa em USD vem pré-selecionada; valor creditado vazio; valor pago pré-preenchido', () => {
    const original = legacyDeposit({ storeId: 1, currency: 'USD' });
    expect(depositFormFromDeposit(original, 'pt-BR')).toMatchObject({ storeId: 1, amountText: '', paidText: '300,00' });
    expect(legacyStoreIsNotUsd(original)).toBe(false);
  });

  test('loja informativa em BRL (Steam) fica sem pré-seleção e avisa', () => {
    const original = legacyDeposit({ storeId: 3, currency: 'BRL' });
    expect(depositFormFromDeposit(original, 'pt-BR').storeId).toBeNull();
    expect(legacyStoreIsNotUsd(original)).toBe(true);
  });

  test('sem loja: sem pré-seleção e sem aviso de moeda', () => {
    const original = legacyDeposit({ storeId: null, storeName: null, currency: null });
    expect(depositFormFromDeposit(original, 'pt-BR').storeId).toBeNull();
    expect(legacyStoreIsNotUsd(original)).toBe(false);
  });

  test('o PATCH sempre envia storeId e amountStoreCents (mesmo sem trocar a loja), sem reenviar o R$ intacto', () => {
    const original = legacyDeposit({ storeId: 1, currency: 'USD' });
    const form = { ...depositFormFromDeposit(original, 'pt-BR'), amountText: '55,00' };
    expect(buildDepositPatchBody(form, original, 'pt-BR')).toEqual({ storeId: 1, amountStoreCents: 5500 });
  });

  test('escolher outra loja USD envia a nova; apagar o R$ envia null', () => {
    const original = legacyDeposit({ storeId: null, storeName: null, currency: null });
    const form = { ...depositFormFromDeposit(original, 'pt-BR'), storeId: 2, amountText: '55', paidText: '' };
    expect(buildDepositPatchBody(form, original, 'pt-BR')).toEqual({ storeId: 2, amountStoreCents: 5500, amountBrlCents: null });
  });

  test('sem loja escolhida a validação local barra antes (loja obrigatória)', () => {
    const original = legacyDeposit({ storeId: 3, currency: 'BRL' });
    expect(validateDepositForm(depositFormFromDeposit(original, 'pt-BR'), 'pt-BR')).toMatchObject({
      storeId: 'deposits.form.storeRequired', amountStoreCents: 'deposits.form.amountRequired',
    });
  });
});
