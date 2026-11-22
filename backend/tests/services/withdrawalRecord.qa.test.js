'use strict';

// QA da 8.2: ordem das validações de buildWithdrawalRecord e bordas de suggestWithdrawalFeeCents. Puros: sem banco.
const { buildWithdrawalRecord, suggestWithdrawalFeeCents } = require('../../src/services/withdrawalService');
const { MAX_AMOUNT_CENTS } = require('../../src/config/constants');
const { csfloat, steam } = require('../helpers/storeFixtures');

const NOW = new Date('2026-11-19T15:00:00.000Z');
const valid = { storeId: 1, amountStoreCents: 10000, feeCents: 250, amountBrlCents: 50000, withdrawnAt: '2026-11-10T12:00:00.000Z' };
const build = (input, opts = {}) => buildWithdrawalRecord(input, { store: csfloat(), now: NOW, ...opts });
const codeOf = (fn) => {
  try { fn(); } catch (err) { return `${err.code}:${err.field}`; }
  return 'OK';
};

describe('ordem: loja, valor sacado, taxa, recebido, data, nota', () => {
  const allBad = {
    storeId: 1, amountStoreCents: 0, feeCents: -1, amountBrlCents: 0, withdrawnAt: 'x', note: 5,
  };

  test('cada erro só aparece depois de corrigir os anteriores', () => {
    expect(codeOf(() => build({ ...allBad, storeId: null }, { store: null }))).toBe('STORE_REQUIRED:storeId');
    expect(codeOf(() => build(allBad, { store: null }))).toBe('STORE_NOT_FOUND:storeId');
    expect(codeOf(() => build(allBad, { store: steam() }))).toBe('WITHDRAWAL_NOT_ALLOWED:storeId');
    expect(codeOf(() => build(allBad))).toBe('INVALID_AMOUNT:amountStoreCents');
    expect(codeOf(() => build({ ...allBad, amountStoreCents: 100 }))).toBe('INVALID_AMOUNT:feeCents');
    expect(codeOf(() => build({ ...allBad, amountStoreCents: 100, feeCents: 101 }))).toBe('WITHDRAWAL_FEE_ABOVE_AMOUNT:feeCents');
    expect(codeOf(() => build({ ...allBad, amountStoreCents: 100, feeCents: 1 }))).toBe('INVALID_AMOUNT:amountBrlCents');
    expect(codeOf(() => build({ ...allBad, amountStoreCents: 100, feeCents: 1, amountBrlCents: 1 }))).toBe('INVALID_DATE:withdrawnAt');
    expect(codeOf(() => build({ ...allBad, amountStoreCents: 100, feeCents: 1, amountBrlCents: 1, withdrawnAt: valid.withdrawnAt }))).toBe('INVALID_FIELD:note');
  });

  test('valor sacado ausente é REQUIRED_FIELD (não INVALID_AMOUNT); o recebido em R$ ausente não é erro (8.5)', () => {
    expect(codeOf(() => build({ storeId: 1 }))).toBe('REQUIRED_FIELD:amountStoreCents');
    expect(codeOf(() => build({ storeId: 1, amountStoreCents: 100 }))).toBe('REQUIRED_FIELD:withdrawnAt');
    expect(codeOf(() => build({ storeId: 1, amountStoreCents: 100, amountBrlCents: 100 }))).toBe('REQUIRED_FIELD:withdrawnAt');
  });

  test('NaN e Infinity (impossíveis em JSON, mas possíveis em chamada direta) são recusados', () => {
    for (const v of [NaN, Infinity, -Infinity]) {
      expect(codeOf(() => build({ ...valid, amountStoreCents: v }))).toBe('INVALID_AMOUNT:amountStoreCents');
      expect(codeOf(() => build({ ...valid, feeCents: v }))).toBe('INVALID_AMOUNT:feeCents');
      expect(codeOf(() => build({ ...valid, amountBrlCents: v }))).toBe('INVALID_AMOUNT:amountBrlCents');
    }
  });

  test('taxa e valor no limite MAX_AMOUNT_CENTS: taxa igual ao valor passa, valor+1 na taxa recusa', () => {
    expect(build({ ...valid, amountStoreCents: MAX_AMOUNT_CENTS, feeCents: MAX_AMOUNT_CENTS }).feeCents).toBe(MAX_AMOUNT_CENTS);
    expect(codeOf(() => build({ ...valid, feeCents: 10001 }))).toBe('WITHDRAWAL_FEE_ABOVE_AMOUNT:feeCents');
  });
});

describe('edição: casos do registro mesclado', () => {
  const existing = {
    id: 1, storeId: 1, amountStoreCents: 10000, feeCents: 250, amountBrlCents: 50000, withdrawnAt: '2026-11-01T12:00:00.000Z', note: 'a',
  };

  test('troca de loja sem permissão é recusada antes do erro de valor', () => {
    expect(codeOf(() => build({ storeId: 2, amountStoreCents: 0 }, { existing, store: steam() }))).toBe('WITHDRAWAL_NOT_ALLOWED:storeId');
  });

  test('storeId igual ao gravado conta como manter, mesmo com loja sem permissão e inativa', () => {
    const rec = build({ storeId: 1, note: 'x' }, { existing, store: csfloat({ allowsWithdrawal: false, isActive: false }) });
    expect(rec.storeId).toBe(1);
  });

  test('note: null limpa; note: "" limpa; sem a chave mantém', () => {
    expect(build({ note: null }, { existing }).note).toBeNull();
    expect(build({ note: '' }, { existing }).note).toBeNull();
    expect(build({ amountBrlCents: 1 }, { existing }).note).toBe('a');
  });

  test('a data gravada vem em ISO e não é reescrita quando não enviada (mesmo em formato não normalizado)', () => {
    const odd = { ...existing, withdrawnAt: '2026-11-01T09:00:00-03:00' };
    expect(build({ note: 'z' }, { existing: odd }).withdrawnAt).toBe('2026-11-01T09:00:00-03:00');
    expect(build({ withdrawnAt: '2026-11-01T09:00:00-03:00' }, { existing: odd }).withdrawnAt).toBe('2026-11-01T12:00:00.000Z');
  });

  test('não muta o registro gravado nem a entrada', () => {
    const frozenExisting = Object.freeze({ ...existing });
    const input = Object.freeze({ note: 'novo' });
    expect(() => build(input, { existing: frozenExisting })).not.toThrow();
    expect(frozenExisting.note).toBe('a');
  });

  test('campos fora da lista (id, createdAt) na entrada são ignorados no registro devolvido', () => {
    const rec = build({ ...valid, id: 99, createdAt: 'x', extra: 1 });
    expect(Object.keys(rec).sort()).toEqual(['amountBrlCents', 'amountStoreCents', 'feeCents', 'note', 'storeId', 'withdrawnAt']);
  });
});

describe('suggestWithdrawalFeeCents: bordas', () => {
  test('valor acima de MAX_AMOUNT_CENTS, negativo, NaN e string -> INVALID_AMOUNT', () => {
    for (const v of [MAX_AMOUNT_CENTS + 1, -1, NaN, '100', null, undefined]) {
      expect(codeOf(() => suggestWithdrawalFeeCents(v, csfloat()))).toBe('INVALID_AMOUNT:amountStoreCents');
    }
  });

  test('loja nula (não encontrada) devolve FEES_NOT_CONFIGURED; taxa fixa ausente (undefined) conta como 0', () => {
    expect(suggestWithdrawalFeeCents(1000, null)).toEqual({ suggestedFeeCents: null, warningCode: 'FEES_NOT_CONFIGURED' });
    expect(suggestWithdrawalFeeCents(1000, csfloat({ withdrawalFixedFeeCents: undefined })).suggestedFeeCents).toBe(25);
  });

  test('aritmética inteira: 10% de 30 = 3, 7% de 100 = 7, 0,1% de 1000 = 1, 29,9% de 10000 = 2990 (sem ruído de float)', () => {
    expect(suggestWithdrawalFeeCents(30, csfloat({ withdrawalFeeRate: 0.1 })).suggestedFeeCents).toBe(3);
    expect(suggestWithdrawalFeeCents(100, csfloat({ withdrawalFeeRate: 0.07 })).suggestedFeeCents).toBe(7);
    expect(suggestWithdrawalFeeCents(1000, csfloat({ withdrawalFeeRate: 0.001 })).suggestedFeeCents).toBe(1);
    expect(suggestWithdrawalFeeCents(10000, csfloat({ withdrawalFeeRate: 0.299 })).suggestedFeeCents).toBe(2990);
  });

  test('não muta a loja e devolve só as duas chaves', () => {
    const store = Object.freeze(csfloat());
    expect(Object.keys(suggestWithdrawalFeeCents(100, store)).sort()).toEqual(['suggestedFeeCents', 'warningCode']);
  });
});
