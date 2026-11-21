import { describe, expect, test } from 'vitest';
import {
  applyFeeSuggestion, buildWithdrawalCreateBody, buildWithdrawalPatchBody, editFee, feeSuggestionRequest, initialWithdrawalState,
  validateWithdrawalForm, withdrawalFormFromWithdrawal, withdrawalStoreOptions, type WithdrawalFormState,
} from './withdrawalForm';
import { localInputToIso } from '@/lib/dateInput';
import type { Store, Withdrawal } from '@/types/api';

const withdrawal = (overrides: Partial<Withdrawal> = {}): Withdrawal => ({
  id: 1,
  storeId: 1,
  storeName: 'CSFloat',
  currency: 'USD',
  amountStoreCents: 10000,
  feeCents: 250,
  amountBrlCents: 52000,
  withdrawnAt: '2026-11-10T15:30:00.000Z',
  note: 'pix',
  legacyWithoutStore: false,
  createdAt: '2026-11-10T15:30:00.000Z',
  updatedAt: '2026-11-10T15:30:00.000Z',
  ...overrides,
});

const legacy = () => withdrawal({ storeId: null, storeName: null, currency: null, amountStoreCents: null, feeCents: null, legacyWithoutStore: true });

const state = (overrides: Partial<WithdrawalFormState> = {}): WithdrawalFormState => ({
  storeId: 1, amountText: '100,00', feeText: '', feeTouched: false, receivedText: '520,00', withdrawnAt: '2026-11-10T12:30', note: '', ...overrides,
});

const store = (overrides: Partial<Store>): Store => ({ id: 1, name: 'S', isActive: true, allowsWithdrawal: true, currency: 'USD', ...overrides } as Store);

describe('initialWithdrawalState', () => {
  test('data padrão = agora; sem loja, valores e taxa; taxa não tocada', () => {
    const now = new Date(2026, 10, 21, 9, 5, 40);
    expect(initialWithdrawalState(now)).toEqual({
      storeId: null, amountText: '', feeText: '', feeTouched: false, receivedText: '', withdrawnAt: '2026-11-21T09:05', note: '',
    });
  });
});

describe('withdrawalStoreOptions (filtro de lojas)', () => {
  const stores = [
    store({ id: 1, name: 'CSFloat' }),
    store({ id: 2, name: 'Steam', allowsWithdrawal: false }),
    store({ id: 3, name: 'Antiga', isActive: false }),
    store({ id: 4, name: 'CSMoney' }),
  ];

  test('só ativas com "permite saque"', () => {
    expect(withdrawalStoreOptions(stores, null).map((s) => s.id)).toEqual([1, 4]);
  });

  test('na edição a loja já gravada continua na lista, mesmo inativa ou sem saque', () => {
    expect(withdrawalStoreOptions(stores, 3).map((s) => s.id)).toEqual([1, 3, 4]);
    expect(withdrawalStoreOptions(stores, 2).map((s) => s.id)).toEqual([1, 2, 4]);
  });
});

describe('taxa "tocada" e sugestão (E8-Q12)', () => {
  test('feeSuggestionRequest: precisa de loja e valor válido; taxa tocada não consulta', () => {
    expect(feeSuggestionRequest(state(), 'pt-BR')).toEqual({ storeId: 1, amountStoreCents: 10000 });
    expect(feeSuggestionRequest(state({ storeId: null }), 'pt-BR')).toBeNull();
    expect(feeSuggestionRequest(state({ amountText: '' }), 'pt-BR')).toBeNull();
    expect(feeSuggestionRequest(state({ amountText: '0' }), 'pt-BR')).toBeNull();
    expect(feeSuggestionRequest(state({ amountText: 'abc' }), 'pt-BR')).toBeNull();
    expect(feeSuggestionRequest(state({ feeTouched: true }), 'pt-BR')).toBeNull();
  });

  test('applyFeeSuggestion preenche o campo enquanto não tocado; nula esvazia', () => {
    const filled = applyFeeSuggestion(state(), 250, 'pt-BR');
    expect(filled).toMatchObject({ feeText: '2,50', feeTouched: false });
    expect(applyFeeSuggestion(filled, 84, 'pt-BR').feeText).toBe('0,84');
    expect(applyFeeSuggestion(filled, null, 'pt-BR').feeText).toBe('');
    expect(applyFeeSuggestion(state(), 250, 'en').feeText).toBe('2.50');
  });

  test('depois de editar a taxa, a sugestão (mesmo atrasada) não a sobrescreve', () => {
    const touched = editFee(state({ feeText: '2,50' }), '3,00');
    expect(touched).toMatchObject({ feeText: '3,00', feeTouched: true });
    expect(applyFeeSuggestion(touched, 999, 'pt-BR')).toBe(touched);
    expect(applyFeeSuggestion(touched, null, 'pt-BR')).toBe(touched);
  });

  test('esvaziar a taxa também a marca como tocada ("não informada" de propósito)', () => {
    const cleared = editFee(state({ feeText: '2,50' }), '');
    expect(cleared.feeTouched).toBe(true);
    expect(applyFeeSuggestion(cleared, 250, 'pt-BR').feeText).toBe('');
  });

  test('mudar o valor ou a loja depois de tocar a taxa não a altera', () => {
    let s = editFee(state(), '1,00');
    s = { ...s, amountText: '500,00', storeId: 4 };
    expect(feeSuggestionRequest(s, 'pt-BR')).toBeNull();
    expect(applyFeeSuggestion(s, 1250, 'pt-BR').feeText).toBe('1,00');
  });

  test('edição de saque com taxa gravada já começa tocada; saque antigo sem loja não', () => {
    expect(withdrawalFormFromWithdrawal(withdrawal(), 'pt-BR').feeTouched).toBe(true);
    expect(withdrawalFormFromWithdrawal(withdrawal({ feeCents: null }), 'pt-BR')).toMatchObject({ feeTouched: true, feeText: '' });
    expect(withdrawalFormFromWithdrawal(legacy(), 'pt-BR')).toMatchObject({ feeTouched: false, feeText: '', storeId: null, amountText: '' });
  });
});

describe('withdrawalFormFromWithdrawal', () => {
  test('textos no formato do idioma e data local', () => {
    expect(withdrawalFormFromWithdrawal(withdrawal(), 'pt-BR')).toMatchObject({
      storeId: 1, amountText: '100,00', feeText: '2,50', receivedText: '520,00', note: 'pix',
    });
    expect(withdrawalFormFromWithdrawal(withdrawal(), 'en')).toMatchObject({ amountText: '100.00', feeText: '2.50', receivedText: '520.00' });
  });
});

describe('validateWithdrawalForm', () => {
  test('estado válido não tem erros; taxa vazia e taxa 0 são válidas', () => {
    expect(validateWithdrawalForm(state(), 'pt-BR')).toEqual({});
    expect(validateWithdrawalForm(state({ feeText: '0' }), 'pt-BR')).toEqual({});
    expect(validateWithdrawalForm(state({ feeText: '0,00' }), 'pt-BR')).toEqual({});
  });

  test('loja obrigatória', () => {
    expect(validateWithdrawalForm(state({ storeId: null }), 'pt-BR')).toEqual({ storeId: 'withdrawals.form.storeRequired' });
  });

  test('valor sacado: vazio, zero, negativo, texto e mais de 2 casas', () => {
    expect(validateWithdrawalForm(state({ amountText: ' ' }), 'pt-BR')).toEqual({ amountStoreCents: 'withdrawals.form.amountRequired' });
    for (const bad of ['0', '-5', 'abc', '1,234']) {
      expect(validateWithdrawalForm(state({ amountText: bad }), 'pt-BR'), bad).toEqual({ amountStoreCents: 'withdrawals.form.invalidMoney' });
    }
  });

  test('taxa inválida', () => {
    for (const bad of ['abc', '-1', '1,234']) {
      expect(validateWithdrawalForm(state({ feeText: bad }), 'pt-BR'), bad).toEqual({ feeCents: 'withdrawals.form.invalidFee' });
    }
  });

  test('valor recebido: obrigatório e maior que zero', () => {
    expect(validateWithdrawalForm(state({ receivedText: '' }), 'pt-BR')).toEqual({ amountBrlCents: 'withdrawals.form.receivedRequired' });
    expect(validateWithdrawalForm(state({ receivedText: '0' }), 'pt-BR')).toEqual({ amountBrlCents: 'withdrawals.form.invalidMoney' });
  });

  test('data vazia ou impossível', () => {
    expect(validateWithdrawalForm(state({ withdrawnAt: '' }), 'pt-BR')).toEqual({ withdrawnAt: 'withdrawals.form.invalidDate' });
    expect(validateWithdrawalForm(state({ withdrawnAt: '2026-02-30T10:00' }), 'pt-BR')).toEqual({ withdrawnAt: 'withdrawals.form.invalidDate' });
  });
});

describe('buildWithdrawalCreateBody', () => {
  test('mínimo: taxa e nota omitidas', () => {
    expect(buildWithdrawalCreateBody(state(), 'pt-BR')).toEqual({
      storeId: 1, amountStoreCents: 10000, amountBrlCents: 52000, withdrawnAt: localInputToIso('2026-11-10T12:30'),
    });
  });

  test('taxa 0 é enviada (paga zero); taxa preenchida e nota com trim', () => {
    expect(buildWithdrawalCreateBody(state({ feeText: '0' }), 'pt-BR').feeCents).toBe(0);
    const body = buildWithdrawalCreateBody(state({ feeText: '2,50', note: '  pix ' }), 'pt-BR');
    expect(body).toMatchObject({ feeCents: 250, note: 'pix' });
  });
});

describe('buildWithdrawalPatchBody', () => {
  const original = withdrawal();
  const same = () => withdrawalFormFromWithdrawal(original, 'pt-BR');

  test('sem alterações: corpo vazio', () => {
    expect(buildWithdrawalPatchBody(same(), original, 'pt-BR')).toEqual({});
  });

  test('só o que mudou', () => {
    expect(buildWithdrawalPatchBody({ ...same(), receivedText: '600,00' }, original, 'pt-BR')).toEqual({ amountBrlCents: 60000 });
    expect(buildWithdrawalPatchBody({ ...same(), storeId: 4 }, original, 'pt-BR')).toEqual({ storeId: 4 });
    expect(buildWithdrawalPatchBody({ ...same(), amountText: '50,00', feeText: '1,00' }, original, 'pt-BR'))
      .toEqual({ amountStoreCents: 5000, feeCents: 100 });
  });

  test('taxa esvaziada vira null (não informada); nota esvaziada vira null', () => {
    expect(buildWithdrawalPatchBody({ ...same(), feeText: '', note: '' }, original, 'pt-BR')).toEqual({ feeCents: null, note: null });
  });

  test('taxa já nula e campo vazio: nada a enviar; taxa 0 sobre taxa nula é enviada', () => {
    const noFee = withdrawal({ feeCents: null });
    const base = withdrawalFormFromWithdrawal(noFee, 'pt-BR');
    expect(buildWithdrawalPatchBody(base, noFee, 'pt-BR')).toEqual({});
    expect(buildWithdrawalPatchBody({ ...base, feeText: '0' }, noFee, 'pt-BR')).toEqual({ feeCents: 0 });
  });

  test('saque antigo sem loja: loja e valor sacado sempre vão no corpo', () => {
    const old = legacy();
    const form = { ...withdrawalFormFromWithdrawal(old, 'pt-BR'), storeId: 1, amountText: '60,00' };
    expect(buildWithdrawalPatchBody(form, old, 'pt-BR')).toEqual({ storeId: 1, amountStoreCents: 6000 });
  });
});

