import { describe, expect, test } from 'vitest';
import {
  applyFeeSuggestion, buildWithdrawalCreateBody, buildWithdrawalPatchBody, editFee, feeSuggestionRequest,
  validateWithdrawalForm, withdrawalFormFromWithdrawal, withdrawalStoreOptions, type WithdrawalFormState,
} from './withdrawalForm';
import { isoToLocalInput, localInputToIso } from '@/lib/dateInput';
import type { Store, Withdrawal } from '@/types/api';

// QA da 8.2: conversões pt-BR/en, taxa "tocada", PATCH só com o que mudou, lojas da edição.
const withdrawal = (overrides: Partial<Withdrawal> = {}): Withdrawal => ({
  id: 1, storeId: 1, storeName: 'CSFloat', currency: 'USD', amountStoreCents: 123456, feeCents: 250, amountBrlCents: 654321,
  withdrawnAt: '2026-11-10T15:30:00.000Z', note: 'pix', legacyWithoutStore: false,
  netStoreCents: 9750, amountUsdCents: 9750, approxCents: null, estimated: false,
  createdAt: '2026-11-10T15:30:00.000Z', updatedAt: '2026-11-10T15:30:00.000Z', ...overrides,
});
const legacy = (overrides: Partial<Withdrawal> = {}) =>
  withdrawal({ storeId: null, storeName: null, currency: null, amountStoreCents: null, feeCents: null, legacyWithoutStore: true, note: null, ...overrides });
const state = (overrides: Partial<WithdrawalFormState> = {}): WithdrawalFormState => ({
  storeId: 1, amountText: '100,00', feeText: '', feeTouched: false, receivedText: '520,00', withdrawnAt: '2026-11-10T12:30', note: '', ...overrides,
});
const store = (overrides: Partial<Store>): Store => ({ id: 1, name: 'S', isActive: true, allowsWithdrawal: true, currency: 'USD', ...overrides } as Store);

describe('conversão de valores pt-BR e en', () => {
  test('pt-BR: milhar com ponto e vírgula decimal; en: milhar com vírgula e ponto decimal', () => {
    const pt = buildWithdrawalCreateBody(state({ amountText: '1.234,56', receivedText: '6.543,21', feeText: '12,5' }), 'pt-BR');
    expect(pt).toMatchObject({ amountStoreCents: 123456, amountBrlCents: 654321, feeCents: 1250 });
    const en = buildWithdrawalCreateBody(state({ amountText: '1,234.56', receivedText: '6,543.21', feeText: '12.5' }), 'en');
    expect(en).toMatchObject({ amountStoreCents: 123456, amountBrlCents: 654321, feeCents: 1250 });
  });

  test('valores inteiros sem casas e com uma casa', () => {
    expect(buildWithdrawalCreateBody(state({ amountText: '100', receivedText: '5,5' }), 'pt-BR')).toMatchObject({ amountStoreCents: 10000, amountBrlCents: 550 });
    expect(buildWithdrawalCreateBody(state({ amountText: '100', receivedText: '5.5' }), 'en')).toMatchObject({ amountStoreCents: 10000, amountBrlCents: 550 });
  });

  test('três casas, negativo, texto e símbolo de moeda são inválidos nos dois idiomas (nunca arredonda)', () => {
    for (const language of ['pt-BR', 'en']) {
      for (const bad of ['1,234', '1.2345', '-1', 'R$ 10', '1e3', ',5x']) {
        const errors = validateWithdrawalForm(state({ amountText: bad, receivedText: bad }), language);
        expect(errors.amountStoreCents, `${language} ${bad}`).toBeDefined();
        expect(errors.amountBrlCents, `${language} ${bad}`).toBeDefined();
      }
    }
  });

  test('ida e volta: centavos -> texto -> centavos, nos dois idiomas, sem perder centavo', () => {
    for (const language of ['pt-BR', 'en']) {
      for (const cents of [1, 5, 99, 100, 123456, 99999999]) {
        const form = withdrawalFormFromWithdrawal(withdrawal({ amountStoreCents: cents, feeCents: 1, amountBrlCents: cents }), language);
        expect(buildWithdrawalPatchBody(form, withdrawal({ amountStoreCents: cents, feeCents: 1, amountBrlCents: cents }), language)).toEqual({});
      }
    }
  });

  test('valores de centavos 1 e 5 viram "0,01" e "0,05" (sem 0,1 nem 0,5)', () => {
    expect(withdrawalFormFromWithdrawal(withdrawal({ amountStoreCents: 1, feeCents: 5 }), 'pt-BR')).toMatchObject({ amountText: '0,01', feeText: '0,05' });
  });
});

describe('taxa vazia, zero e espaços', () => {
  test('espaços na taxa contam como vazia (omitida no POST) e não geram erro', () => {
    const s = state({ feeText: '   ' });
    expect(validateWithdrawalForm(s, 'pt-BR')).toEqual({});
    expect(buildWithdrawalCreateBody(s, 'pt-BR')).not.toHaveProperty('feeCents');
  });

  test('"0", "0,00" e "0.00" viram feeCents 0 (não omitido, não nulo)', () => {
    for (const [text, language] of [['0', 'pt-BR'], ['0,00', 'pt-BR'], ['0.00', 'en']] as const) {
      expect(buildWithdrawalCreateBody(state({ feeText: text }), language).feeCents).toBe(0);
    }
  });

  test('PATCH: taxa 250 -> vazio envia null; 250 -> 0 envia 0; vazio -> vazio não envia nada; null -> 0 envia 0', () => {
    const orig = withdrawal();
    const base = withdrawalFormFromWithdrawal(orig, 'pt-BR');
    expect(buildWithdrawalPatchBody({ ...base, feeText: '' }, orig, 'pt-BR')).toEqual({ feeCents: null });
    expect(buildWithdrawalPatchBody({ ...base, feeText: '0,00' }, orig, 'pt-BR')).toEqual({ feeCents: 0 });
    const noFee = withdrawal({ feeCents: null });
    const b2 = withdrawalFormFromWithdrawal(noFee, 'pt-BR');
    expect(buildWithdrawalPatchBody(b2, noFee, 'pt-BR')).toEqual({});
    expect(buildWithdrawalPatchBody({ ...b2, feeText: '0' }, noFee, 'pt-BR')).toEqual({ feeCents: 0 });
  });

  test('PATCH com taxa 0 gravada e campo mantido em "0,00" não envia nada', () => {
    const orig = withdrawal({ feeCents: 0 });
    expect(buildWithdrawalPatchBody(withdrawalFormFromWithdrawal(orig, 'pt-BR'), orig, 'pt-BR')).toEqual({});
  });
});

describe('taxa "tocada" e respostas atrasadas', () => {
  test('uma resposta que chega depois da edição devolve exatamente o mesmo estado (mesma referência)', () => {
    const touched = editFee(state(), '9,99');
    expect(applyFeeSuggestion(touched, 12345, 'en')).toBe(touched);
  });

  test('sugestão igual ao texto atual não cria estado novo', () => {
    const s = state({ feeText: '2,50' });
    expect(applyFeeSuggestion(s, 250, 'pt-BR')).toBe(s);
  });

  test('sugestão zero ("0,00") preenche o campo e continua não tocada; ao enviar vai feeCents 0', () => {
    const filled = applyFeeSuggestion(state(), 0, 'pt-BR');
    expect(filled).toMatchObject({ feeText: '0,00', feeTouched: false });
    expect(buildWithdrawalCreateBody(filled, 'pt-BR').feeCents).toBe(0);
  });

  test('sequência: sugestão preenche, usuário edita, nova resposta é ignorada, depois valor muda e não há nova consulta', () => {
    let s = applyFeeSuggestion(state(), 250, 'pt-BR');
    expect(s.feeText).toBe('2,50');
    s = editFee(s, '3,10');
    s = applyFeeSuggestion(s, 84, 'pt-BR');
    expect(s.feeText).toBe('3,10');
    s = { ...s, amountText: '500,00' };
    expect(feeSuggestionRequest(s, 'pt-BR')).toBeNull();
  });

  test('antes de tocar: trocar o valor gera nova consulta; esvaziar o valor pede limpeza (request nulo)', () => {
    const s = state();
    expect(feeSuggestionRequest({ ...s, amountText: '50,00' }, 'pt-BR')).toEqual({ storeId: 1, amountStoreCents: 5000 });
    expect(feeSuggestionRequest({ ...s, amountText: '' }, 'pt-BR')).toBeNull();
    expect(applyFeeSuggestion({ ...s, feeText: '2,50' }, null, 'pt-BR').feeText).toBe('');
  });

  test('o pedido de sugestão respeita o idioma ao ler o valor (en: 1,000.50)', () => {
    expect(feeSuggestionRequest(state({ amountText: '1,000.50' }), 'en')).toEqual({ storeId: 1, amountStoreCents: 100050 });
    expect(feeSuggestionRequest(state({ amountText: '1.000,50' }), 'pt-BR')).toEqual({ storeId: 1, amountStoreCents: 100050 });
  });
});

describe('PATCH só com o que mudou', () => {
  const orig = withdrawal();
  const base = () => withdrawalFormFromWithdrawal(orig, 'pt-BR');

  test('formato en: ida e volta sem mudança dá corpo vazio', () => {
    expect(buildWithdrawalPatchBody(withdrawalFormFromWithdrawal(orig, 'en'), orig, 'en')).toEqual({});
  });

  test('só a data mudou: envia withdrawnAt em UTC; data igual não é enviada mesmo que o texto seja reformatado', () => {
    const changed = buildWithdrawalPatchBody({ ...base(), withdrawnAt: '2026-11-11T08:00' }, orig, 'pt-BR');
    expect(changed).toEqual({ withdrawnAt: localInputToIso('2026-11-11T08:00') });
    expect(buildWithdrawalPatchBody({ ...base(), withdrawnAt: isoToLocalInput(orig.withdrawnAt) }, orig, 'pt-BR')).toEqual({});
  });

  test('data inválida no estado não entra no corpo (a validação local barra antes)', () => {
    expect(buildWithdrawalPatchBody({ ...base(), withdrawnAt: '2026-02-30T10:00' }, orig, 'pt-BR')).toEqual({});
  });

  test('nota: igual não envia; só espaços sobre nota nula não envia; trim ao enviar', () => {
    expect(buildWithdrawalPatchBody({ ...base(), note: '  pix  ' }, orig, 'pt-BR')).toEqual({});
    const noNote = withdrawal({ note: null });
    expect(buildWithdrawalPatchBody({ ...withdrawalFormFromWithdrawal(noNote, 'pt-BR'), note: '   ' }, noNote, 'pt-BR')).toEqual({});
    expect(buildWithdrawalPatchBody({ ...base(), note: ' nova ' }, orig, 'pt-BR')).toEqual({ note: 'nova' });
  });

  test('trocar a loja sem mexer no resto envia storeId, o valor sacado e a taxa (D221)', () => {
    expect(buildWithdrawalPatchBody({ ...base(), storeId: 4 }, orig, 'pt-BR')).toEqual({ storeId: 4, amountStoreCents: 123456, feeCents: 250 });
  });

  test('a loja não escolhida (null) nunca vai no corpo', () => {
    expect(buildWithdrawalPatchBody({ ...base(), storeId: null }, orig, 'pt-BR')).toEqual({});
  });

  test('saque antigo: loja escolhida, valor e taxa digitados; recebido e data iguais não vão', () => {
    const old = legacy();
    const form = { ...withdrawalFormFromWithdrawal(old, 'pt-BR'), storeId: 1, amountText: '60,00', feeText: '1,50' };
    expect(buildWithdrawalPatchBody(form, old, 'pt-BR')).toEqual({ storeId: 1, amountStoreCents: 6000, feeCents: 150 });
  });

  test('saque antigo sem nada preenchido: validação local exige loja e valor sacado', () => {
    const errors = validateWithdrawalForm(withdrawalFormFromWithdrawal(legacy(), 'pt-BR'), 'pt-BR');
    expect(Object.keys(errors).sort()).toEqual(['amountStoreCents', 'storeId']);
  });
});

describe('withdrawalStoreOptions: bordas', () => {
  const stores = [store({ id: 1 }), store({ id: 2, allowsWithdrawal: false }), store({ id: 3, isActive: false, allowsWithdrawal: false })];

  test('loja gravada que não existe mais na lista não quebra nem aparece', () => {
    expect(withdrawalStoreOptions(stores, 99).map((s) => s.id)).toEqual([1]);
  });

  test('lista vazia e loja gravada nula', () => {
    expect(withdrawalStoreOptions([], null)).toEqual([]);
    expect(withdrawalStoreOptions(stores, null).map((s) => s.id)).toEqual([1]);
  });

  test('a loja gravada não é duplicada quando já é elegível, e a ordem original é mantida', () => {
    expect(withdrawalStoreOptions(stores, 1).map((s) => s.id)).toEqual([1]);
    expect(withdrawalStoreOptions(stores, 3).map((s) => s.id)).toEqual([1, 3]);
  });

  test('não muta a lista recebida', () => {
    const copy = [...stores];
    withdrawalStoreOptions(stores, 2);
    expect(stores).toEqual(copy);
  });
});
