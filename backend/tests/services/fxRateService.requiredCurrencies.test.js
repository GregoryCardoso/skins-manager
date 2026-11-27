'use strict';

// S2 (12.10, parte 3): requiredCurrencies() usa SELECT EXISTS em vez de carregar aportes e saques inteiros. O resultado precisa
// ser o mesmo de antes: BRL entra só com aporte legado (sem valor na moeda da loja) ou saque sem loja.
const { closeDb, getDb } = require('../../src/config/database');
const Deposit = require('../../src/models/Deposit');
const Withdrawal = require('../../src/models/Withdrawal');
const fxRateService = require('../../src/services/fxRateService');
const { freshDb, storeIdByName } = require('../helpers/fixtures');

const NOW = new Date('2026-11-20T12:00:00.000Z');
const isNil = (v) => v === null || v === undefined;

// Implementação anterior (findAll + some), mantida aqui como referência.
function legacyHasBrl() {
  return Deposit.findAll().some((d) => isNil(d.amountStoreCents)) || Withdrawal.findAll().some((w) => isNil(w.storeId));
}

// Todas as lojas e a moeda de conversão em USD: o BRL só pode vir dos registros legados.
function usdOnlyDb() {
  const db = freshDb({ displayCurrency: 'USD', steamCurrency: 'USD' });
  db.prepare("UPDATE stores SET currency = 'USD'").run();
  return db;
}

const storeDeposit = (storeId) => Deposit.create({ storeId, amountStoreCents: 5000, amountBrlCents: null, depositedAt: '2026-11-01T00:00:00.000Z' }, { now: NOW });
const legacyDeposit = () => Deposit.create({ storeId: null, amountStoreCents: null, amountBrlCents: 10000, depositedAt: '2026-11-01T00:00:00.000Z' }, { now: NOW });
const storeWithdrawal = (storeId) =>
  Withdrawal.create({ storeId, amountStoreCents: 10000, feeCents: 250, amountBrlCents: null, withdrawnAt: '2026-11-10T12:00:00.000Z' }, { now: NOW });
const legacyWithdrawal = () =>
  Withdrawal.create({ storeId: null, amountStoreCents: null, feeCents: null, amountBrlCents: 40000, withdrawnAt: '2026-11-10T12:00:00.000Z' }, { now: NOW });

afterAll(() => closeDb());

describe('models: existsWithoutStoreAmount e existsWithoutStore', () => {
  beforeEach(() => usdOnlyDb());

  test('banco sem aportes nem saques: falso nos dois', () => {
    expect(Deposit.existsWithoutStoreAmount()).toBe(false);
    expect(Withdrawal.existsWithoutStore()).toBe(false);
  });

  test('aporte com valor na moeda da loja não conta; o legado conta', () => {
    storeDeposit(storeIdByName('CSFloat'));
    expect(Deposit.existsWithoutStoreAmount()).toBe(false);
    legacyDeposit();
    expect(Deposit.existsWithoutStoreAmount()).toBe(true);
  });

  test('saque com loja não conta; o sem loja conta', () => {
    storeWithdrawal(storeIdByName('CSFloat'));
    expect(Withdrawal.existsWithoutStore()).toBe(false);
    legacyWithdrawal();
    expect(Withdrawal.existsWithoutStore()).toBe(true);
  });

  test('devolve booleano (e não o número do SQLite)', () => {
    expect(typeof Deposit.existsWithoutStoreAmount()).toBe('boolean');
    expect(typeof Withdrawal.existsWithoutStore()).toBe('boolean');
  });
});

describe('fxRateService.requiredCurrencies com e sem registros legados', () => {
  beforeEach(() => usdOnlyDb());

  test('sem nada legado: nenhuma moeda (tudo em USD)', () => {
    storeDeposit(storeIdByName('CSFloat'));
    storeWithdrawal(storeIdByName('CSFloat'));
    expect(fxRateService.requiredCurrencies()).toEqual([]);
    expect(legacyHasBrl()).toBe(false);
  });

  test('aporte legado: BRL entra', () => {
    legacyDeposit();
    expect(fxRateService.requiredCurrencies()).toEqual(['BRL']);
    expect(legacyHasBrl()).toBe(true);
  });

  test('saque sem loja: BRL entra', () => {
    legacyWithdrawal();
    expect(fxRateService.requiredCurrencies()).toEqual(['BRL']);
    expect(legacyHasBrl()).toBe(true);
  });

  test('os dois legados juntos: BRL uma vez só, junto com a moeda de conversão e as das lojas, em ordem', () => {
    legacyDeposit();
    legacyWithdrawal();
    getDb().prepare('UPDATE settings SET display_currency = ?').run('EUR');
    getDb().prepare("UPDATE stores SET currency = 'GBP' WHERE name = 'CSFloat'").run();
    expect(fxRateService.requiredCurrencies()).toEqual(['BRL', 'EUR', 'GBP']);
  });

  test('o resultado é igual ao da implementação anterior nas quatro combinações', () => {
    const csf = storeIdByName('CSFloat');
    const combos = [
      { deposit: false, withdrawal: false },
      { deposit: true, withdrawal: false },
      { deposit: false, withdrawal: true },
      { deposit: true, withdrawal: true },
    ];
    for (const combo of combos) {
      usdOnlyDb();
      storeDeposit(csf);
      storeWithdrawal(csf);
      if (combo.deposit) legacyDeposit();
      if (combo.withdrawal) legacyWithdrawal();
      expect(fxRateService.requiredCurrencies().includes('BRL')).toBe(legacyHasBrl());
      expect(fxRateService.requiredCurrencies().includes('BRL')).toBe(combo.deposit || combo.withdrawal);
    }
  });

  test('QA: vários registros mistos (a CHECK do banco impede valor sem loja)', () => {
    const csf = storeIdByName('CSFloat');
    storeDeposit(csf);
    storeWithdrawal(csf);
    legacyWithdrawal();
    storeDeposit(csf);
    expect(Deposit.existsWithoutStoreAmount()).toBe(false);
    expect(Withdrawal.existsWithoutStore()).toBe(true);
    expect(fxRateService.requiredCurrencies().includes('BRL')).toBe(legacyHasBrl());
    expect(fxRateService.requiredCurrencies().includes('BRL')).toBe(true);
  });

  test('não carrega as listas inteiras (usa as consultas EXISTS)', () => {
    const findDeposits = jest.spyOn(Deposit, 'findAll');
    const findWithdrawals = jest.spyOn(Withdrawal, 'findAll');
    try {
      fxRateService.requiredCurrencies();
      expect(findDeposits).not.toHaveBeenCalled();
      expect(findWithdrawals).not.toHaveBeenCalled();
    } finally {
      findDeposits.mockRestore();
      findWithdrawals.mockRestore();
    }
  });
});
