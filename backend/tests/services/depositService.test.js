'use strict';

// buildDepositRecord (D201): puro, com `now`.
const { buildDepositRecord } = require('../../src/services/depositService');
const { MAX_AMOUNT_CENTS, MAX_NOTE_LENGTH } = require('../../src/config/constants');

const NOW = new Date('2026-11-19T15:00:00.000Z'); // 12:00 em Brasília
const STORE = { id: 1, name: 'CSFloat' };
const valid = (overrides = {}) => ({ amountBrlCents: 10000, depositedAt: '2026-11-10T12:00:00.000Z', ...overrides });
const build = (input, options = {}) => buildDepositRecord(input, { now: NOW, ...options });
const fails = (fn, code, field) => expect(fn).toThrow(expect.objectContaining({ code, ...(field ? { field } : {}) }));

describe('buildDepositRecord: criação', () => {
  test('registro mínimo: sem loja e sem nota', () => {
    expect(build(valid())).toEqual({
      amountBrlCents: 10000, depositedAt: '2026-11-10T12:00:00.000Z', storeId: null, note: null,
    });
  });

  test('valor obrigatório e limites 0, 1, MAX e MAX+1', () => {
    fails(() => build({ depositedAt: valid().depositedAt }), 'REQUIRED_FIELD', 'amountBrlCents');
    fails(() => build(valid({ amountBrlCents: null })), 'REQUIRED_FIELD', 'amountBrlCents');
    fails(() => build(valid({ amountBrlCents: 0 })), 'INVALID_AMOUNT', 'amountBrlCents');
    expect(build(valid({ amountBrlCents: 1 })).amountBrlCents).toBe(1);
    expect(build(valid({ amountBrlCents: MAX_AMOUNT_CENTS })).amountBrlCents).toBe(MAX_AMOUNT_CENTS);
    fails(() => build(valid({ amountBrlCents: MAX_AMOUNT_CENTS + 1 })), 'INVALID_AMOUNT', 'amountBrlCents');
  });

  test.each([[-5], [10.5], ['100'], [NaN], [Infinity], [true]])('valor %p -> INVALID_AMOUNT', (value) => {
    fails(() => build(valid({ amountBrlCents: value })), 'INVALID_AMOUNT', 'amountBrlCents');
  });

  test('INVALID_AMOUNT informa o teto em params', () => {
    expect(() => build(valid({ amountBrlCents: 0 }))).toThrow(
      expect.objectContaining({ params: { maxCents: MAX_AMOUNT_CENTS } })
    );
  });

  test('data obrigatória, inválida e normalizada para UTC', () => {
    fails(() => build({ amountBrlCents: 100 }), 'REQUIRED_FIELD', 'depositedAt');
    fails(() => build(valid({ depositedAt: 'ontem' })), 'INVALID_DATE', 'depositedAt');
    fails(() => build(valid({ depositedAt: '2026-11-10' })), 'INVALID_DATE', 'depositedAt'); // sem fuso
    fails(() => build(valid({ depositedAt: 1234 })), 'INVALID_DATE', 'depositedAt');
    expect(build(valid({ depositedAt: '2026-11-10T09:00:00-03:00' })).depositedAt).toBe('2026-11-10T12:00:00.000Z');
  });

  test('data futura: dia posterior ao de hoje em Brasília é recusado; o mesmo dia passa', () => {
    expect(build(valid({ depositedAt: '2026-11-19T14:59:00.000Z' })).depositedAt).toBe('2026-11-19T14:59:00.000Z');
    expect(build(valid({ depositedAt: '2026-11-19T23:59:00-03:00' })).depositedAt).toBe('2026-11-20T02:59:00.000Z'); // ainda hoje em Brasília
    fails(() => build(valid({ depositedAt: '2026-11-20T03:00:00.000Z' })), 'DEPOSITED_AT_IN_FUTURE', 'depositedAt');
    fails(() => build(valid({ depositedAt: '2026-12-01T12:00:00.000Z' })), 'DEPOSITED_AT_IN_FUTURE', 'depositedAt');
  });

  test('virada BRT/UTC: 02:00Z do dia seguinte ainda é "hoje" em Brasília quando now é 23:00 BRT', () => {
    const late = new Date('2026-11-20T02:00:00.000Z'); // 19/11 23:00 em Brasília
    expect(buildDepositRecord(valid({ depositedAt: '2026-11-20T02:30:00.000Z' }), { now: late }).depositedAt)
      .toBe('2026-11-20T02:30:00.000Z');
    fails(() => buildDepositRecord(valid({ depositedAt: '2026-11-20T03:00:00.000Z' }), { now: late }), 'DEPOSITED_AT_IN_FUTURE');
  });

  test('nota: trim, vazia vira nulo, 500 ok e 501 recusado', () => {
    expect(build(valid({ note: '  pix  ' })).note).toBe('pix');
    expect(build(valid({ note: '   ' })).note).toBeNull();
    expect(build(valid({ note: '' })).note).toBeNull();
    expect(build(valid({ note: null })).note).toBeNull();
    expect(build(valid({ note: 'x'.repeat(MAX_NOTE_LENGTH) })).note).toHaveLength(MAX_NOTE_LENGTH);
    expect(build(valid({ note: ` ${'x'.repeat(MAX_NOTE_LENGTH)} ` })).note).toHaveLength(MAX_NOTE_LENGTH); // o limite vale após o trim
    expect(() => build(valid({ note: 'x'.repeat(MAX_NOTE_LENGTH + 1) }))).toThrow(
      expect.objectContaining({ code: 'FIELD_TOO_LONG', field: 'note', params: { maxLength: MAX_NOTE_LENGTH } })
    );
    fails(() => build(valid({ note: 5 })), 'INVALID_FIELD', 'note');
  });

  test('loja informada exige a loja carregada (STORE_NOT_FOUND no campo storeId)', () => {
    expect(build(valid({ storeId: 1 }), { store: STORE }).storeId).toBe(1);
    fails(() => build(valid({ storeId: 99 }), { store: null }), 'STORE_NOT_FOUND', 'storeId');
    expect(build(valid({ storeId: null })).storeId).toBeNull();
  });
});

describe('buildDepositRecord: edição (registro mesclado)', () => {
  const existing = {
    id: 3, amountBrlCents: 5000, depositedAt: '2026-01-05T12:00:00.000Z', storeId: 1, note: 'antigo',
    createdAt: 'c', updatedAt: 'u',
  };

  test('parcial mantém o resto e devolve só as colunas do model', () => {
    expect(build({ amountBrlCents: 7000 }, { existing, store: STORE })).toEqual({
      amountBrlCents: 7000, depositedAt: '2026-01-05T12:00:00.000Z', storeId: 1, note: 'antigo',
    });
  });

  test('null limpa a loja e a nota; nulo no valor ou na data recusa', () => {
    expect(build({ storeId: null, note: null }, { existing })).toMatchObject({ storeId: null, note: null });
    fails(() => build({ amountBrlCents: null }, { existing }), 'REQUIRED_FIELD', 'amountBrlCents');
    fails(() => build({ depositedAt: null }, { existing }), 'REQUIRED_FIELD', 'depositedAt');
  });

  test('a data só é revalidada quando alterada (aporte antigo continua editável)', () => {
    const futureLooking = { ...existing, depositedAt: '2027-01-01T00:00:00.000Z' };
    expect(build({ note: 'x' }, { existing: futureLooking, store: STORE }).depositedAt).toBe('2027-01-01T00:00:00.000Z');
    fails(() => build({ depositedAt: '2027-01-01T00:00:00.000Z' }, { existing, store: STORE }), 'DEPOSITED_AT_IN_FUTURE');
  });

  test('não altera a entrada nem o registro existente', () => {
    const input = Object.freeze({ note: ' y ' });
    const frozen = Object.freeze({ ...existing });
    expect(() => build(input, { existing: frozen, store: STORE })).not.toThrow();
  });
});
