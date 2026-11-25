'use strict';

// buildWithdrawalRecord e suggestWithdrawalFeeCents (D201, D203, D211). Puros: sem banco.
const { buildWithdrawalRecord, suggestWithdrawalFeeCents } = require('../../src/services/withdrawalService');
const { MAX_AMOUNT_CENTS } = require('../../src/config/constants');
const { csfloat, steam, csmoney } = require('../helpers/storeFixtures');

// 2026-11-19 12:00 em Brasília
const NOW = new Date('2026-11-19T15:00:00.000Z');
const input = (o = {}) => ({
  storeId: 1, amountStoreCents: 10000, amountBrlCents: 50000, withdrawnAt: '2026-11-10T12:00:00.000Z', ...o,
});
const build = (i, opts = {}) => buildWithdrawalRecord(i, { store: csfloat(), now: NOW, ...opts });
const failWith = (fn, code, field) => {
  let error;
  try { fn(); } catch (err) { error = err; }
  expect(error).toBeDefined();
  expect(error.code).toBe(code);
  if (field !== undefined) expect(error.field).toBe(field);
};

const OLD = {
  id: 7, storeId: 1, amountStoreCents: 10000, feeCents: 250, amountBrlCents: 50000,
  withdrawnAt: '2026-11-01T12:00:00.000Z', note: 'a', createdAt: 'x', updatedAt: 'y',
};
const LEGACY = { ...OLD, storeId: null, amountStoreCents: null, feeCents: null };

describe('buildWithdrawalRecord: criação', () => {
  test('registro mínimo: taxa e nota nulas', () => {
    expect(build(input())).toEqual({
      storeId: 1, amountStoreCents: 10000, feeCents: null, amountBrlCents: 50000, amountBrlCurrency: 'BRL', withdrawnAt: '2026-11-10T12:00:00.000Z', note: null,
    });
  });

  test('data com offset é normalizada para UTC e a nota recebe trim (vazia vira nula)', () => {
    expect(build(input({ withdrawnAt: '2026-11-10T09:00:00-03:00', note: '  pix ' }))).toMatchObject({
      withdrawnAt: '2026-11-10T12:00:00.000Z', note: 'pix',
    });
    expect(build(input({ note: '   ' })).note).toBeNull();
  });

  test('loja obrigatória: STORE_REQUIRED com field storeId (ausente ou nula)', () => {
    failWith(() => build(input({ storeId: undefined }), { store: null }), 'STORE_REQUIRED', 'storeId');
    failWith(() => build(input({ storeId: null }), { store: null }), 'STORE_REQUIRED', 'storeId');
  });

  test('id sem loja carregada -> STORE_NOT_FOUND', () => {
    failWith(() => build(input({ storeId: 99 }), { store: null }), 'STORE_NOT_FOUND', 'storeId');
  });

  test('loja sem permite saque -> WITHDRAWAL_NOT_ALLOWED; loja inativa com saque é aceita', () => {
    failWith(() => build(input({ storeId: 2 }), { store: steam() }), 'WITHDRAWAL_NOT_ALLOWED', 'storeId');
    expect(build(input(), { store: csfloat({ isActive: false }) }).storeId).toBe(1);
  });

  test('valor sacado: obrigatório e limites (0, 1, MAX, MAX+1, não inteiro)', () => {
    failWith(() => build(input({ amountStoreCents: undefined })), 'REQUIRED_FIELD', 'amountStoreCents');
    failWith(() => build(input({ amountStoreCents: 0 })), 'INVALID_AMOUNT', 'amountStoreCents');
    failWith(() => build(input({ amountStoreCents: 10.5 })), 'INVALID_AMOUNT', 'amountStoreCents');
    failWith(() => build(input({ amountStoreCents: '100' })), 'INVALID_AMOUNT', 'amountStoreCents');
    failWith(() => build(input({ amountStoreCents: MAX_AMOUNT_CENTS + 1 })), 'INVALID_AMOUNT', 'amountStoreCents');
    expect(build(input({ amountStoreCents: 1 })).amountStoreCents).toBe(1);
    expect(build(input({ amountStoreCents: MAX_AMOUNT_CENTS })).amountStoreCents).toBe(MAX_AMOUNT_CENTS);
  });

  test('valor recebido em BRL: opcional e só informativo (8.5); quando informado, maior que 0', () => {
    expect(build(input({ amountBrlCents: undefined })).amountBrlCents).toBeNull();
    expect(build(input({ amountBrlCents: null })).amountBrlCents).toBeNull();
    failWith(() => build(input({ amountBrlCents: 0 })), 'INVALID_AMOUNT', 'amountBrlCents');
    failWith(() => build(input({ amountBrlCents: -5 })), 'INVALID_AMOUNT', 'amountBrlCents');
    failWith(() => build(input({ amountBrlCents: MAX_AMOUNT_CENTS + 1 })), 'INVALID_AMOUNT', 'amountBrlCents');
    expect(build(input({ amountBrlCents: 1 })).amountBrlCents).toBe(1);
  });

  test('taxa paga: 0 e igual ao valor passam; valor + 1 -> WITHDRAWAL_FEE_ABOVE_AMOUNT; negativa/decimal -> INVALID_AMOUNT', () => {
    expect(build(input({ feeCents: 0 })).feeCents).toBe(0);
    expect(build(input({ feeCents: 10000 })).feeCents).toBe(10000);
    failWith(() => build(input({ feeCents: 10001 })), 'WITHDRAWAL_FEE_ABOVE_AMOUNT', 'feeCents');
    failWith(() => build(input({ feeCents: -1 })), 'INVALID_AMOUNT', 'feeCents');
    failWith(() => build(input({ feeCents: 1.5 })), 'INVALID_AMOUNT', 'feeCents');
    expect(build(input({ feeCents: null })).feeCents).toBeNull();
  });

  test('data: obrigatória, inválida e futura (virada BRT/UTC)', () => {
    failWith(() => build(input({ withdrawnAt: undefined })), 'REQUIRED_FIELD', 'withdrawnAt');
    failWith(() => build(input({ withdrawnAt: '10/11/2026' })), 'INVALID_DATE', 'withdrawnAt');
    // 20/11 00:00Z = 19/11 21:00 em Brasília: ainda hoje
    expect(build(input({ withdrawnAt: '2026-11-20T00:00:00.000Z' })).withdrawnAt).toBe('2026-11-20T00:00:00.000Z');
    // 20/11 02:59Z = 19/11 23:59 em Brasília: ainda hoje; 03:00Z já é o dia seguinte
    expect(build(input({ withdrawnAt: '2026-11-20T02:59:00.000Z' })).withdrawnAt).toBe('2026-11-20T02:59:00.000Z');
    failWith(() => build(input({ withdrawnAt: '2026-11-20T03:00:00.000Z' })), 'WITHDRAWN_AT_IN_FUTURE', 'withdrawnAt');
    failWith(() => build(input({ withdrawnAt: '2027-01-01T00:00:00.000Z' })), 'WITHDRAWN_AT_IN_FUTURE', 'withdrawnAt');
  });

  test('nota: tipo inválido e acima de 500 caracteres', () => {
    failWith(() => build(input({ note: 7 })), 'INVALID_FIELD', 'note');
    failWith(() => build(input({ note: 'x'.repeat(501) })), 'FIELD_TOO_LONG', 'note');
    expect(build(input({ note: 'x'.repeat(500) })).note).toHaveLength(500);
  });
});

describe('buildWithdrawalRecord: edição (registro mesclado)', () => {
  test('parcial mantém o resto; manter a loja é aceito mesmo que ela não permita mais saque', () => {
    const rec = build({ note: 'b' }, { existing: OLD, store: csfloat({ allowsWithdrawal: false }) });
    expect(rec).toEqual({
      storeId: 1, amountStoreCents: 10000, feeCents: 250, amountBrlCents: 50000, amountBrlCurrency: 'BRL', withdrawnAt: '2026-11-01T12:00:00.000Z', note: 'b',
    });
  });

  test('trocar para loja sem saque -> WITHDRAWAL_NOT_ALLOWED; para loja com saque, aceito', () => {
    failWith(() => build({ storeId: 2 }, { existing: OLD, store: steam() }), 'WITHDRAWAL_NOT_ALLOWED', 'storeId');
    expect(build({ storeId: 3 }, { existing: OLD, store: csmoney(), previousStore: csfloat() }).storeId).toBe(3);
  });

  test('D221: trocar de loja com moeda diferente (ou saque antigo sem loja) exige amountStoreCents', () => {
    const brlWithdrawable = steam({ allowsWithdrawal: true });
    failWith(() => build({ storeId: 2 }, { existing: OLD, store: brlWithdrawable, previousStore: csfloat() }), 'REQUIRED_FIELD', 'amountStoreCents');
    expect(build({ storeId: 2, amountStoreCents: 9000 }, { existing: OLD, store: brlWithdrawable, previousStore: csfloat() }).amountStoreCents).toBe(9000);
    failWith(() => build({ storeId: 1 }, { existing: LEGACY, store: csfloat(), previousStore: null }), 'REQUIRED_FIELD', 'amountStoreCents');
    // mesma moeda: o valor gravado é mantido
    expect(build({ storeId: 3 }, { existing: OLD, store: csmoney(), previousStore: csfloat() }).amountStoreCents).toBe(10000);
  });

  test('feeCents: null limpa a taxa; trocar o valor abaixo da taxa gravada recusa', () => {
    expect(build({ feeCents: null }, { existing: OLD }).feeCents).toBeNull();
    failWith(() => build({ amountStoreCents: 100 }, { existing: OLD }), 'WITHDRAWAL_FEE_ABOVE_AMOUNT', 'feeCents');
    expect(build({ amountStoreCents: 100, feeCents: 2 }, { existing: OLD }).feeCents).toBe(2);
  });

  test('data gravada não é revalidada quando não é enviada; enviada futura é recusada', () => {
    const farPast = { ...OLD, withdrawnAt: '2020-01-01T00:00:00.000Z' };
    expect(build({ note: 'x' }, { existing: farPast }).withdrawnAt).toBe('2020-01-01T00:00:00.000Z');
    failWith(() => build({ withdrawnAt: '2027-01-01T00:00:00.000Z' }, { existing: OLD }), 'WITHDRAWN_AT_IN_FUTURE', 'withdrawnAt');
  });

  test('saque antigo sem loja: só a nota -> STORE_REQUIRED; com loja mas sem valor -> REQUIRED_FIELD; com ambos, aceito', () => {
    failWith(() => build({ note: 'x' }, { existing: LEGACY, store: null }), 'STORE_REQUIRED', 'storeId');
    failWith(() => build({ storeId: 1 }, { existing: LEGACY }), 'REQUIRED_FIELD', 'amountStoreCents');
    const rec = build({ storeId: 1, amountStoreCents: 20000 }, { existing: LEGACY });
    expect(rec).toMatchObject({ storeId: 1, amountStoreCents: 20000, feeCents: null, amountBrlCents: 50000 });
  });

  test('8.5: amountBrlCents: null no PATCH limpa o valor recebido; saque antigo editado sem amountBrlCents é aceito', () => {
    expect(build({ amountBrlCents: null }, { existing: OLD }).amountBrlCents).toBeNull();
    const rec = build({ storeId: 1, amountStoreCents: 20000, amountBrlCents: null }, { existing: LEGACY });
    expect(rec).toMatchObject({ storeId: 1, amountStoreCents: 20000, amountBrlCents: null });
    expect(build({ storeId: 1, amountStoreCents: 20000 }, { existing: { ...LEGACY, amountBrlCents: null } }).amountBrlCents).toBeNull();
  });

  test('saque antigo: escolher loja sem saque também é recusado', () => {
    failWith(() => build({ storeId: 2, amountStoreCents: 100 }, { existing: LEGACY, store: steam() }), 'WITHDRAWAL_NOT_ALLOWED', 'storeId');
  });
});

describe('suggestWithdrawalFeeCents (E8-Q12)', () => {
  const sugg = (amount, store) => suggestWithdrawalFeeCents(amount, store);

  test('arredonda para cima: CSFloat 2,5% -> 10000 = 250; 3333 = 83,325 -> 84; 1 -> 1 (limitada ao valor)', () => {
    expect(sugg(10000, csfloat())).toEqual({ suggestedFeeCents: 250, warningCode: null });
    expect(sugg(3333, csfloat()).suggestedFeeCents).toBe(84);
    expect(sugg(1, csfloat()).suggestedFeeCents).toBe(1);
    expect(sugg(40, csfloat()).suggestedFeeCents).toBe(1);
  });

  test('soma a taxa fixa depois de arredondar', () => {
    expect(sugg(10000, csfloat({ withdrawalFixedFeeCents: 30 })).suggestedFeeCents).toBe(280);
    expect(sugg(3333, csfloat({ withdrawalFixedFeeCents: 30 })).suggestedFeeCents).toBe(114);
  });

  test('limitada ao valor sacado', () => {
    expect(sugg(100, csfloat({ withdrawalFixedFeeCents: 500 })).suggestedFeeCents).toBe(100);
    expect(sugg(500, csfloat({ withdrawalFeeRate: 0.9, withdrawalFixedFeeCents: 500 })).suggestedFeeCents).toBe(500);
  });

  test('taxa 0% com taxa fixa: só a fixa', () => {
    expect(sugg(10000, csfloat({ withdrawalFeeRate: 0, withdrawalFixedFeeCents: 25 })).suggestedFeeCents).toBe(25);
  });

  test('loja sem taxa configurada -> nulo e FEES_NOT_CONFIGURED', () => {
    expect(sugg(10000, csmoney())).toEqual({ suggestedFeeCents: null, warningCode: 'FEES_NOT_CONFIGURED' });
    expect(sugg(10000, csfloat({ withdrawalFeeRate: null, withdrawalFixedFeeCents: 100 }))).toEqual({
      suggestedFeeCents: null, warningCode: 'FEES_NOT_CONFIGURED',
    });
  });

  test('valor inválido -> INVALID_AMOUNT', () => {
    failWith(() => sugg(0, csfloat()), 'INVALID_AMOUNT');
    failWith(() => sugg(1.5, csfloat()), 'INVALID_AMOUNT');
  });
});
