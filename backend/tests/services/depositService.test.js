'use strict';

// buildDepositRecord (D201, D227, D232): puro, com `now`. Aporte na moeda da loja (só USD); R$ pago é informativo.
const { buildDepositRecord, depositBaseAmount } = require('../../src/services/depositService');
const { MAX_AMOUNT_CENTS, MAX_NOTE_LENGTH } = require('../../src/config/constants');

const NOW = new Date('2026-11-19T15:00:00.000Z'); // 12:00 em Brasília
const CSFLOAT = { id: 1, name: 'CSFloat', currency: 'USD', isActive: 1, allowsWithdrawal: 1 };
const OTHER_USD = { id: 2, name: 'Outra', currency: 'USD', isActive: 1, allowsWithdrawal: 0 };
const INACTIVE_USD = { id: 3, name: 'Antiga', currency: 'USD', isActive: 0, allowsWithdrawal: 0 };
const STEAM = { id: 4, name: 'Steam', currency: 'BRL', isActive: 1, allowsWithdrawal: 0 };
const valid = (overrides = {}) => ({
  storeId: 1, amountStoreCents: 9200, depositedAt: '2026-11-10T12:00:00.000Z', ...overrides,
});
const build = (input, options = {}) => buildDepositRecord(input, { now: NOW, store: CSFLOAT, ...options });
const fails = (fn, code, field) => expect(fn).toThrow(expect.objectContaining({ code, ...(field ? { field } : {}) }));

describe('buildDepositRecord: criação', () => {
  test('registro mínimo: sem valor pago em R$ e sem nota', () => {
    expect(build(valid())).toEqual({
      storeId: 1, amountStoreCents: 9200, feeCents: null, amountBrlCents: null, depositedAt: '2026-11-10T12:00:00.000Z', note: null,
    });
  });

  test('com valor pago em R$ (só informativo) e nota', () => {
    expect(build(valid({ amountBrlCents: 50000, note: ' pix ' }))).toMatchObject({ amountBrlCents: 50000, note: 'pix' });
  });

  test('loja ausente -> STORE_REQUIRED; inexistente -> STORE_NOT_FOUND', () => {
    fails(() => build(valid({ storeId: undefined }), { store: null }), 'STORE_REQUIRED', 'storeId');
    fails(() => build(valid({ storeId: null }), { store: null }), 'STORE_REQUIRED', 'storeId');
    fails(() => build(valid({ storeId: 99 }), { store: null }), 'STORE_NOT_FOUND', 'storeId');
  });

  test('loja inativa em USD é aceita; "permite saque" não importa', () => {
    expect(build(valid({ storeId: 3 }), { store: INACTIVE_USD }).storeId).toBe(3);
    expect(build(valid({ storeId: 2 }), { store: OTHER_USD }).storeId).toBe(2);
  });

  test('loja em BRL (Steam) -> DEPOSIT_STORE_CURRENCY_NOT_ALLOWED no campo storeId (E8-Q16)', () => {
    fails(() => build(valid({ storeId: 4 }), { store: STEAM }), 'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', 'storeId');
  });

  test('valor creditado obrigatório e limites 0, 1, MAX e MAX+1', () => {
    fails(() => build({ storeId: 1, depositedAt: valid().depositedAt }), 'REQUIRED_FIELD', 'amountStoreCents');
    fails(() => build(valid({ amountStoreCents: null })), 'REQUIRED_FIELD', 'amountStoreCents');
    fails(() => build(valid({ amountStoreCents: 0 })), 'INVALID_AMOUNT', 'amountStoreCents');
    expect(build(valid({ amountStoreCents: 1 })).amountStoreCents).toBe(1);
    expect(build(valid({ amountStoreCents: MAX_AMOUNT_CENTS })).amountStoreCents).toBe(MAX_AMOUNT_CENTS);
    fails(() => build(valid({ amountStoreCents: MAX_AMOUNT_CENTS + 1 })), 'INVALID_AMOUNT', 'amountStoreCents');
  });

  test.each([[-5], [10.5], ['100'], [NaN], [Infinity], [true]])('valor creditado %p -> INVALID_AMOUNT', (value) => {
    fails(() => build(valid({ amountStoreCents: value })), 'INVALID_AMOUNT', 'amountStoreCents');
  });

  test('INVALID_AMOUNT informa o teto em params', () => {
    expect(() => build(valid({ amountStoreCents: 0 }))).toThrow(
      expect.objectContaining({ params: { maxCents: MAX_AMOUNT_CENTS } })
    );
  });

  test('valor pago em R$: nulo, 1 e MAX aceitos; 0, MAX+1 e inválidos recusados no campo amountBrlCents', () => {
    expect(build(valid({ amountBrlCents: null })).amountBrlCents).toBeNull();
    expect(build(valid({ amountBrlCents: 1 })).amountBrlCents).toBe(1);
    expect(build(valid({ amountBrlCents: MAX_AMOUNT_CENTS })).amountBrlCents).toBe(MAX_AMOUNT_CENTS);
    fails(() => build(valid({ amountBrlCents: 0 })), 'INVALID_AMOUNT', 'amountBrlCents');
    fails(() => build(valid({ amountBrlCents: MAX_AMOUNT_CENTS + 1 })), 'INVALID_AMOUNT', 'amountBrlCents');
    fails(() => build(valid({ amountBrlCents: 10.5 })), 'INVALID_AMOUNT', 'amountBrlCents');
  });

  test('data obrigatória, inválida e normalizada para UTC', () => {
    fails(() => build({ storeId: 1, amountStoreCents: 100 }), 'REQUIRED_FIELD', 'depositedAt');
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
    expect(buildDepositRecord(valid({ depositedAt: '2026-11-20T02:30:00.000Z' }), { now: late, store: CSFLOAT }).depositedAt)
      .toBe('2026-11-20T02:30:00.000Z');
    fails(() => buildDepositRecord(valid({ depositedAt: '2026-11-20T03:00:00.000Z' }), { now: late, store: CSFLOAT }), 'DEPOSITED_AT_IN_FUTURE');
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
});

describe('buildDepositRecord: edição (registro mesclado)', () => {
  const existing = {
    id: 3, storeId: 1, amountStoreCents: 5000, amountBrlCents: 26000, depositedAt: '2026-01-05T12:00:00.000Z',
    note: 'antigo', createdAt: 'c', updatedAt: 'u',
  };
  const legacy = { ...existing, storeId: null, amountStoreCents: null };
  const legacyWithUsdStore = { ...existing, amountStoreCents: null };
  const legacyWithSteam = { ...existing, storeId: 4, amountStoreCents: null };

  test('parcial mantém o resto e devolve só as colunas do model', () => {
    expect(build({ amountStoreCents: 7000 }, { existing })).toEqual({
      storeId: 1, amountStoreCents: 7000, feeCents: null, amountBrlCents: 26000, depositedAt: '2026-01-05T12:00:00.000Z', note: 'antigo',
    });
  });

  test('amountBrlCents: null limpa o valor pago; a nota também limpa', () => {
    expect(build({ amountBrlCents: null, note: null }, { existing })).toMatchObject({ amountBrlCents: null, note: null });
  });

  test('nulo no valor creditado, na loja ou na data recusa', () => {
    fails(() => build({ amountStoreCents: null }, { existing }), 'REQUIRED_FIELD', 'amountStoreCents');
    fails(() => build({ storeId: null }, { existing, store: null }), 'STORE_REQUIRED', 'storeId');
    fails(() => build({ depositedAt: null }, { existing }), 'REQUIRED_FIELD', 'depositedAt');
  });

  test('trocar para loja em BRL -> DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', () => {
    fails(() => build({ storeId: 4 }, { existing, store: STEAM }), 'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', 'storeId');
  });

  test('trocar entre duas lojas USD sem valor é aceito e mantém o valor creditado', () => {
    expect(build({ storeId: 2 }, { existing, store: OTHER_USD })).toMatchObject({ storeId: 2, amountStoreCents: 5000 });
  });

  test('a data só é revalidada quando alterada (aporte antigo continua editável)', () => {
    const futureLooking = { ...existing, depositedAt: '2027-01-01T00:00:00.000Z' };
    expect(build({ note: 'x' }, { existing: futureLooking }).depositedAt).toBe('2027-01-01T00:00:00.000Z');
    fails(() => build({ depositedAt: '2027-01-01T00:00:00.000Z' }, { existing }), 'DEPOSITED_AT_IN_FUTURE');
  });

  test('não altera a entrada nem o registro existente', () => {
    const input = Object.freeze({ note: ' y ' });
    const frozen = Object.freeze({ ...existing });
    expect(() => build(input, { existing: frozen })).not.toThrow();
  });

  describe('aporte legado (amountStoreCents nulo, D224)', () => {
    test('só a nota, sem loja -> STORE_REQUIRED', () => {
      fails(() => build({ note: 'x' }, { existing: legacy, store: null }), 'STORE_REQUIRED', 'storeId');
    });

    test('só a nota, com loja USD informativa -> REQUIRED_FIELD em amountStoreCents', () => {
      fails(() => build({ note: 'x' }, { existing: legacyWithUsdStore }), 'REQUIRED_FIELD', 'amountStoreCents');
    });

    test('com loja USD e valor creditado: deixa de ser legado e mantém o valor pago em R$', () => {
      const record = build({ storeId: 1, amountStoreCents: 5200 }, { existing: legacy });
      expect(record).toMatchObject({ storeId: 1, amountStoreCents: 5200, amountBrlCents: 26000 });
    });

    test('amountStoreCents: null recusado', () => {
      fails(() => build({ storeId: 1, amountStoreCents: null }, { existing: legacy }), 'REQUIRED_FIELD', 'amountStoreCents');
    });

    test('loja informativa em BRL editada só com o valor -> DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', () => {
      fails(
        () => build({ amountStoreCents: 5200 }, { existing: legacyWithSteam, store: STEAM }),
        'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', 'storeId'
      );
    });

    test('loja informativa em BRL, escolhendo loja USD e valor -> aceito', () => {
      expect(build({ storeId: 1, amountStoreCents: 5200 }, { existing: legacyWithSteam, store: CSFLOAT }))
        .toMatchObject({ storeId: 1, amountStoreCents: 5200 });
    });
  });
});

describe('depositBaseAmount (D225, D227)', () => {
  test('aporte novo em USD é exato e traz o "≈ R$"', () => {
    expect(depositBaseAmount({ storeId: 1, amountStoreCents: 9200, amountBrlCents: 1 }, CSFLOAT, 5.4321))
      .toEqual({ usdCents: 9200, approxBrlCents: 49975, estimated: false });
  });

  test('o valor pago em R$ informativo não altera o resultado', () => {
    const a = depositBaseAmount({ storeId: 1, amountStoreCents: 9200, amountBrlCents: 50000 }, CSFLOAT, 5.4321);
    const b = depositBaseAmount({ storeId: 1, amountStoreCents: 9200, amountBrlCents: null }, CSFLOAT, 5.4321);
    expect(a).toEqual(b);
  });

  test('legado converte o valor em R$ (30000 / 5,4321 -> 5523, estimado)', () => {
    expect(depositBaseAmount({ storeId: null, amountStoreCents: null, amountBrlCents: 30000 }, null, 5.4321))
      .toEqual({ usdCents: 5523, approxBrlCents: 30000, estimated: true });
  });

  test('legado sem cotação -> usdCents nulo', () => {
    expect(depositBaseAmount({ storeId: null, amountStoreCents: null, amountBrlCents: 30000 }, null, null).usdCents).toBeNull();
  });
});

describe('loja referenciada fora do mapa (não assume USD)', () => {
  test('depositBaseAmount: storeId sem loja -> usdCents e approx nulos', () => {
    const deposit = { storeId: 99, amountStoreCents: 9200, amountBrlCents: null };
    expect(depositBaseAmount(deposit, null, 5.4321)).toEqual({ usdCents: null, approxBrlCents: null, estimated: false });
    expect(depositBaseAmount(deposit, CSFLOAT, 5.4321).usdCents).toBe(9200);
  });
});
