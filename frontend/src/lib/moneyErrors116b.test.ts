import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate, translatePlural } from '@/i18n/translate';
import { moneyErrorParams } from './currencies';
import { validateDepositForm, type DepositFormState } from './depositForm';
import { validateStoreBalanceForm } from './storeBalanceForm';
import { validateWithdrawalForm, type WithdrawalFormState } from './withdrawalForm';

// 11.6, parada B (seção 11 da lista): mensagens de valor inválido do aporte, do saque e da conferência por moeda (JPY, KRW e CLP sem centavos).
const deposit = (overrides: Partial<DepositFormState> = {}): DepositFormState =>
  ({ storeId: 1, amountText: '10', paidText: '', feeText: '', depositedAt: '2026-11-10T10:00', note: '', ...overrides }) as DepositFormState;
const withdrawal = (overrides: Partial<WithdrawalFormState> = {}): WithdrawalFormState =>
  ({ storeId: 1, amountText: '10', feeText: '', feeTouched: true, receivedText: '', withdrawnAt: '2026-11-10T10:00', note: '', ...overrides }) as WithdrawalFormState;

describe('aporte: valor pago em moeda sem centavos', () => {
  test.each(['JPY', 'KRW', 'CLP'])('%s usa a mensagem de número inteiro', (c) => {
    expect(validateDepositForm(deposit({ paidText: '10.5' }), 'en', c)).toEqual({ amountBrlCents: 'deposits.form.invalidMoneyWhole' });
  });
  test('moeda com centavos e valor em US$ mantêm a mensagem comum', () => {
    expect(validateDepositForm(deposit({ paidText: 'abc' }), 'en', 'EUR')).toEqual({ amountBrlCents: 'deposits.form.invalidMoney' });
    expect(validateDepositForm(deposit({ amountText: 'abc' }), 'en', 'JPY')).toEqual({ amountStoreCents: 'deposits.form.invalidMoney' });
  });
});

describe('saque: valor, taxa e valor recebido por moeda', () => {
  test.each(['JPY', 'KRW', 'CLP'])('%s: valor e taxa pedem número inteiro', (c) => {
    const errors = validateWithdrawalForm(withdrawal({ amountText: '5000,5', feeText: '1,5' }), 'pt-BR', { store: c, received: 'EUR' });
    expect(errors).toEqual({ amountStoreCents: 'withdrawals.form.invalidMoneyWhole', feeCents: 'withdrawals.form.invalidFeeWhole' });
  });
  test('valor recebido em JPY pede inteiro; loja em US$ mantém as mensagens comuns', () => {
    expect(validateWithdrawalForm(withdrawal({ receivedText: '30,5' }), 'pt-BR', { store: 'USD', received: 'JPY' }))
      .toEqual({ amountBrlCents: 'withdrawals.form.invalidMoneyWhole' });
    expect(validateWithdrawalForm(withdrawal({ amountText: 'x', feeText: 'x' }), 'en', { store: 'USD', received: 'BRL' }))
      .toEqual({ amountStoreCents: 'withdrawals.form.invalidMoney', feeCents: 'withdrawals.form.invalidFee' });
  });
});

describe('conferência de saldo em moeda sem centavos', () => {
  const state = { amountText: '123.5', recordedAt: '2026-11-10T10:00', noteText: '' };
  test.each(['JPY', 'KRW', 'CLP'])('%s usa a mensagem de número inteiro', (c) => {
    expect(validateStoreBalanceForm(state, 'en', { currency: c })).toEqual({ balanceCents: 'storeBalances.form.invalidMoneyWhole' });
  });
  test('USD usa a mensagem comum', () => {
    expect(validateStoreBalanceForm({ ...state, amountText: '1.234' }, 'en', { currency: 'USD' })).toEqual({ balanceCents: 'storeBalances.form.invalidMoney' });
  });
});

describe('textos finais das mensagens "Whole" e do exemplo pelo idioma', () => {
  test('en', () => {
    const p = moneyErrorParams('en', 'KRW');
    expect(translate(en, 'deposits.form.invalidMoneyWhole', p)).toBe('Invalid amount. KRW has no decimal places: use a whole number greater than zero, like 1500.');
    expect(translate(en, 'withdrawals.form.invalidMoneyWhole', p)).toContain('KRW has no decimal places');
    expect(translate(en, 'withdrawals.form.invalidFeeWhole', p)).toBe('Invalid fee. KRW has no decimal places: use a whole number (0 is allowed), like 1500, or leave it empty.');
    expect(translate(en, 'storeBalances.form.invalidMoneyWhole', p)).toBe('KRW has no decimal places. Enter a whole number, like 1500.');
    expect(translate(en, 'deposits.form.invalidMoney', moneyErrorParams('en', 'USD'))).toBe('Invalid amount. Use a format like 1.25, greater than zero.');
    expect(translate(en, 'fx.invalidInput', { example: moneyErrorParams('en', undefined).example })).toBe('Enter a number greater than zero, like 1.25.');
  });
  test('pt-BR', () => {
    const p = moneyErrorParams('pt-BR', 'JPY');
    expect(translate(ptBR, 'deposits.form.invalidMoneyWhole', p)).toBe('Valor inválido. JPY não tem centavos: use um número inteiro maior que zero, como 1500.');
    expect(translate(ptBR, 'withdrawals.form.invalidFeeWhole', p)).toBe('Taxa inválida. JPY não tem centavos: use um número inteiro (0 é permitido), como 1500, ou deixe vazio.');
    expect(translate(ptBR, 'storeBalances.form.invalidMoneyWhole', p)).toBe('JPY não tem centavos. Informe um número inteiro, como 1500.');
    expect(translate(ptBR, 'withdrawals.form.invalidMoney', moneyErrorParams('pt-BR', 'USD'))).toBe('Valor inválido. Use um formato como 1,25, maior que zero.');
    expect(translate(ptBR, 'fx.invalidInput', { example: moneyErrorParams('pt-BR', undefined).example })).toBe('Digite um número maior que zero, como 1,25.');
  });
});

describe('chave zero das contagens (B1)', () => {
  test.each([
    ['deposits.count', 'Nenhum aporte', 'No deposits', '1 aporte', '1 deposit'],
    ['withdrawals.count', 'Nenhum saque', 'No withdrawals', '1 saque', '1 withdrawal'],
    ['storeBalances.count', 'Nenhuma loja', 'No stores', '1 loja', '1 store'],
  ])('%s', (key, ptZero, enZero, ptOne, enOne) => {
    expect(translatePlural(ptBR, key, 0, 'pt-BR')).toBe(ptZero);
    expect(translatePlural(en, key, 0, 'en')).toBe(enZero);
    expect(translatePlural(ptBR, key, 1, 'pt-BR')).toBe(ptOne);
    expect(translatePlural(en, key, 1, 'en')).toBe(enOne);
  });
  test('dias: 0 dias no pt-BR; média de dias das vendas com plural e casas decimais', () => {
    expect(translatePlural(ptBR, 'common.dayCount', 0, 'pt-BR')).toBe('0 dias');
    expect(translatePlural(en, 'common.dayCount', 0, 'en')).toBe('0 days');
    expect(translatePlural(ptBR, 'salesSummary.avgTurnaroundValue', 1, 'pt-BR', { days: '1' })).toBe('1 dia');
    expect(translatePlural(ptBR, 'salesSummary.avgTurnaroundValue', 0, 'pt-BR', { days: '0' })).toBe('0 dias');
    expect(translatePlural(ptBR, 'salesSummary.avgTurnaroundValue', 3.5, 'pt-BR', { days: '3,5' })).toBe('3,5 dias');
    expect(translatePlural(en, 'salesSummary.avgTurnaroundValue', 1, 'en', { days: '1' })).toBe('1 day');
    expect(translatePlural(en, 'salesSummary.avgTurnaroundValue', 2.5, 'en', { days: '2.5' })).toBe('2.5 days');
    expect(translatePlural(ptBR, 'history.daysValue', 0, 'pt-BR', { days: '0' })).toBe('0 dias');
  });
});
