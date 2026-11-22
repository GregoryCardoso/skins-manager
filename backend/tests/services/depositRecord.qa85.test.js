'use strict';

// QA 8.5: bordas de buildDepositRecord (D227, D224, D232): ordem dos erros, loja BRL no POST e no PATCH, legado com loja
// informativa BRL, PATCH de legado, loja inativa USD e o valor pago em R$ (ausente, nulo, 0).
const { buildDepositRecord } = require('../../src/services/depositService');
const { MAX_AMOUNT_CENTS } = require('../../src/config/constants');

const NOW = new Date('2026-11-19T15:00:00.000Z');
const CSFLOAT = { id: 1, name: 'CSFloat', currency: 'USD', isActive: 1, allowsWithdrawal: 1 };
const OTHER_USD = { id: 2, name: 'Outra', currency: 'USD', isActive: 1, allowsWithdrawal: 0 };
const INACTIVE_USD = { id: 3, name: 'Antiga', currency: 'USD', isActive: 0, allowsWithdrawal: 0 };
const STEAM = { id: 4, name: 'Steam', currency: 'BRL', isActive: 1, allowsWithdrawal: 0 };
const DATE = '2026-11-10T12:00:00.000Z';

const run = (input, options = {}) => buildDepositRecord(input, { now: NOW, store: CSFLOAT, ...options });
const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return `${error.code}:${error.field}`;
  }
  return 'OK';
};

const stored = (overrides = {}) => ({
  id: 7, storeId: 1, amountStoreCents: 9200, amountBrlCents: 50000, depositedAt: DATE, note: null, ...overrides,
});
const legacy = (overrides = {}) => stored({ storeId: null, amountStoreCents: null, amountBrlCents: 30000, ...overrides });

describe('ordem dos erros: loja, moeda da loja, valor creditado, valor pago, data, nota', () => {
  const allWrong = { storeId: 1, amountStoreCents: 0, amountBrlCents: 0, depositedAt: 'lixo', note: 5 };

  test('cada erro só aparece depois de corrigir os anteriores', () => {
    expect(codeOf(() => run({ ...allWrong, storeId: null }, { store: null }))).toBe('STORE_REQUIRED:storeId');
    expect(codeOf(() => run({ ...allWrong, storeId: 99 }, { store: null }))).toBe('STORE_NOT_FOUND:storeId');
    expect(codeOf(() => run({ ...allWrong, storeId: 4 }, { store: STEAM }))).toBe('DEPOSIT_STORE_CURRENCY_NOT_ALLOWED:storeId');
    expect(codeOf(() => run(allWrong))).toBe('INVALID_AMOUNT:amountStoreCents');
    expect(codeOf(() => run({ ...allWrong, amountStoreCents: 100 }))).toBe('INVALID_AMOUNT:amountBrlCents');
    expect(codeOf(() => run({ ...allWrong, amountStoreCents: 100, amountBrlCents: null }))).toBe('INVALID_DATE:depositedAt');
    expect(codeOf(() => run({ ...allWrong, amountStoreCents: 100, amountBrlCents: null, depositedAt: DATE }))).toBe('INVALID_FIELD:note');
  });

  test('loja BRL vem antes do valor ausente (moeda antes de REQUIRED_FIELD)', () => {
    expect(codeOf(() => run({ storeId: 4, depositedAt: DATE }, { store: STEAM }))).toBe('DEPOSIT_STORE_CURRENCY_NOT_ALLOWED:storeId');
  });

  test('loja inexistente vem antes da moeda: store nulo com storeId informado nunca vira erro de moeda', () => {
    expect(codeOf(() => run({ storeId: 4, amountStoreCents: 1, depositedAt: DATE }, { store: null }))).toBe('STORE_NOT_FOUND:storeId');
  });

  test('valor creditado ausente vem antes do valor pago inválido e da data', () => {
    expect(codeOf(() => run({ storeId: 1, amountBrlCents: 0, depositedAt: 'lixo' }))).toBe('REQUIRED_FIELD:amountStoreCents');
  });

  test('data ausente (REQUIRED_FIELD) vem depois dos valores', () => {
    expect(codeOf(() => run({ storeId: 1, amountStoreCents: 1 }))).toBe('REQUIRED_FIELD:depositedAt');
    expect(codeOf(() => run({ storeId: 1, amountStoreCents: 1, amountBrlCents: -1 }))).toBe('INVALID_AMOUNT:amountBrlCents');
  });
});

describe('valor pago em R$ opcional: ausente, nulo, 0 e limites', () => {
  const base = { storeId: 1, amountStoreCents: 100, depositedAt: DATE };

  test('ausente e null viram null; undefined também', () => {
    expect(run(base).amountBrlCents).toBeNull();
    expect(run({ ...base, amountBrlCents: null }).amountBrlCents).toBeNull();
    expect(run({ ...base, amountBrlCents: undefined }).amountBrlCents).toBeNull();
  });

  test('0 é recusado (não vira null) e o campo do erro é amountBrlCents', () => {
    expect(codeOf(() => run({ ...base, amountBrlCents: 0 }))).toBe('INVALID_AMOUNT:amountBrlCents');
  });

  test('1 e MAX aceitos; MAX+1, negativo, decimal, NaN e texto recusados', () => {
    expect(run({ ...base, amountBrlCents: 1 }).amountBrlCents).toBe(1);
    expect(run({ ...base, amountBrlCents: MAX_AMOUNT_CENTS }).amountBrlCents).toBe(MAX_AMOUNT_CENTS);
    for (const bad of [MAX_AMOUNT_CENTS + 1, -5, 1.5, NaN, Infinity, '100']) {
      expect(codeOf(() => run({ ...base, amountBrlCents: bad }))).toBe('INVALID_AMOUNT:amountBrlCents');
    }
  });

  test('o valor pago não influencia a validação do valor creditado (nem o contrário)', () => {
    expect(run({ ...base, amountStoreCents: 1, amountBrlCents: MAX_AMOUNT_CENTS }).amountStoreCents).toBe(1);
    expect(run({ ...base, amountStoreCents: MAX_AMOUNT_CENTS, amountBrlCents: 1 }).amountStoreCents).toBe(MAX_AMOUNT_CENTS);
  });

  test('PATCH: null limpa; 0 recusado; ausente mantém', () => {
    const existing = stored();
    expect(run({ amountBrlCents: null }, { existing }).amountBrlCents).toBeNull();
    expect(run({ note: 'x' }, { existing }).amountBrlCents).toBe(50000);
    expect(codeOf(() => run({ amountBrlCents: 0 }, { existing }))).toBe('INVALID_AMOUNT:amountBrlCents');
  });
});

describe('valor creditado: tipos', () => {
  const base = { storeId: 1, depositedAt: DATE };
  test('texto, booleano, NaN, decimal e negativo -> INVALID_AMOUNT; null e ausente -> REQUIRED_FIELD', () => {
    for (const bad of ['100', true, NaN, 0.5, -1, [], {}]) {
      expect(codeOf(() => run({ ...base, amountStoreCents: bad }))).toBe('INVALID_AMOUNT:amountStoreCents');
    }
    expect(codeOf(() => run({ ...base, amountStoreCents: null }))).toBe('REQUIRED_FIELD:amountStoreCents');
    expect(codeOf(() => run(base))).toBe('REQUIRED_FIELD:amountStoreCents');
  });
});

describe('loja: POST e PATCH', () => {
  test('inativa em USD aceita no POST e no PATCH; loja BRL ativa ou inativa recusada', () => {
    expect(run({ storeId: 3, amountStoreCents: 5, depositedAt: DATE }, { store: INACTIVE_USD }).storeId).toBe(3);
    expect(run({ storeId: 3 }, { existing: stored(), store: INACTIVE_USD }).storeId).toBe(3);
    const inactiveBrl = { ...STEAM, isActive: 0 };
    expect(codeOf(() => run({ storeId: 4, amountStoreCents: 5, depositedAt: DATE }, { store: inactiveBrl }))).toBe('DEPOSIT_STORE_CURRENCY_NOT_ALLOWED:storeId');
  });

  test('PATCH trocando para loja BRL, mesmo mandando valor válido, é recusado e não muta o existente', () => {
    const existing = stored();
    const copy = JSON.parse(JSON.stringify(existing));
    expect(codeOf(() => run({ storeId: 4, amountStoreCents: 100 }, { existing, store: STEAM }))).toBe('DEPOSIT_STORE_CURRENCY_NOT_ALLOWED:storeId');
    expect(existing).toEqual(copy);
  });

  test('PATCH sem storeId sobre aporte cuja loja gravada virou BRL (store carregada = BRL): recusado', () => {
    // a moeda de loja com aporte não muda (STORE_CURRENCY_LOCKED), mas o service não pode confiar nisso
    expect(codeOf(() => run({ note: 'x' }, { existing: stored({ storeId: 4 }), store: STEAM }))).toBe('DEPOSIT_STORE_CURRENCY_NOT_ALLOWED:storeId');
  });

  test('troca entre lojas USD sem valor: mantém o valor creditado e o valor pago', () => {
    const r = run({ storeId: 2 }, { existing: stored(), store: OTHER_USD });
    expect(r).toMatchObject({ storeId: 2, amountStoreCents: 9200, amountBrlCents: 50000 });
  });

  test('"permite saque" não importa (loja sem saque aceita)', () => {
    expect(run({ storeId: 2, amountStoreCents: 5, depositedAt: DATE }, { store: OTHER_USD }).storeId).toBe(2);
  });
});

describe('aporte legado (amountStoreCents nulo)', () => {
  test('legado sem loja: só a nota -> STORE_REQUIRED; nota + valor sem loja -> STORE_REQUIRED', () => {
    expect(codeOf(() => run({ note: 'x' }, { existing: legacy(), store: null }))).toBe('STORE_REQUIRED:storeId');
    expect(codeOf(() => run({ amountStoreCents: 100 }, { existing: legacy(), store: null }))).toBe('STORE_REQUIRED:storeId');
  });

  test('legado sem loja: só a loja USD -> REQUIRED_FIELD em amountStoreCents', () => {
    expect(codeOf(() => run({ storeId: 1 }, { existing: legacy(), store: CSFLOAT }))).toBe('REQUIRED_FIELD:amountStoreCents');
  });

  test('legado sem loja: loja USD + valor -> deixa de ser legado e mantém o valor pago antigo em R$', () => {
    const r = run({ storeId: 1, amountStoreCents: 5523 }, { existing: legacy(), store: CSFLOAT });
    expect(r).toEqual({ storeId: 1, amountStoreCents: 5523, amountBrlCents: 30000, depositedAt: DATE, note: null });
  });

  test('legado com loja informativa USD: só a nota -> REQUIRED_FIELD; com valor -> aceito', () => {
    const existing = legacy({ storeId: 1 });
    expect(codeOf(() => run({ note: 'x' }, { existing, store: CSFLOAT }))).toBe('REQUIRED_FIELD:amountStoreCents');
    expect(run({ amountStoreCents: 5523 }, { existing, store: CSFLOAT }).amountStoreCents).toBe(5523);
  });

  test('legado com loja informativa BRL: só valor -> DEPOSIT_STORE_CURRENCY_NOT_ALLOWED; só a nota também', () => {
    const existing = legacy({ storeId: 4 });
    expect(codeOf(() => run({ amountStoreCents: 100 }, { existing, store: STEAM }))).toBe('DEPOSIT_STORE_CURRENCY_NOT_ALLOWED:storeId');
    expect(codeOf(() => run({ note: 'x' }, { existing, store: STEAM }))).toBe('DEPOSIT_STORE_CURRENCY_NOT_ALLOWED:storeId');
  });

  test('legado com loja informativa BRL: trocar para loja USD + valor -> aceito', () => {
    const r = run({ storeId: 1, amountStoreCents: 5523 }, { existing: legacy({ storeId: 4 }), store: CSFLOAT });
    expect(r).toMatchObject({ storeId: 1, amountStoreCents: 5523, amountBrlCents: 30000 });
  });

  test('amountStoreCents: null no PATCH de aporte normal ou legado é recusado (REQUIRED_FIELD)', () => {
    expect(codeOf(() => run({ amountStoreCents: null }, { existing: stored() }))).toBe('REQUIRED_FIELD:amountStoreCents');
    expect(codeOf(() => run({ storeId: 1, amountStoreCents: null }, { existing: legacy() }))).toBe('REQUIRED_FIELD:amountStoreCents');
  });

  test('legado: amountBrlCents: null junto com loja e valor limpa o valor pago', () => {
    const r = run({ storeId: 1, amountStoreCents: 100, amountBrlCents: null }, { existing: legacy(), store: CSFLOAT });
    expect(r.amountBrlCents).toBeNull();
  });

  test('a data do legado só é revalidada quando enviada (data antiga gravada em formato livre passa)', () => {
    const r = run({ storeId: 1, amountStoreCents: 100 }, { existing: legacy({ depositedAt: '2020-01-01T00:00:00.000Z' }), store: CSFLOAT });
    expect(r.depositedAt).toBe('2020-01-01T00:00:00.000Z');
  });
});
