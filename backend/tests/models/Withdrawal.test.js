const { closeDb } = require('../../src/config/database');
const Withdrawal = require('../../src/models/Withdrawal');
const { freshDb, storeIdByName } = require('../helpers/fixtures');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const wd = (overrides = {}) => ({ amountBrlCents: 5000, withdrawnAt: '2026-02-01T00:00:00.000Z', ...overrides });

describe('models/Withdrawal', () => {
  test('com loja e amountStoreCents aceito', () => {
    const w = Withdrawal.create(wd({ storeId: storeIdByName('CSFloat'), amountStoreCents: 1000, note: 'n' }));
    expect(w).toMatchObject({ storeId: storeIdByName('CSFloat'), amountStoreCents: 1000, amountBrlCents: 5000, note: 'n' });
  });

  test('sem loja e sem amountStoreCents aceito', () => {
    const w = Withdrawal.create(wd());
    expect(w).toMatchObject({ storeId: null, amountStoreCents: null, note: null });
  });

  test('loja sem amountStoreCents recusado', () => {
    expect(() => Withdrawal.create(wd({ storeId: storeIdByName('CSFloat') }))).toThrow(/CHECK/);
  });

  test('amountStoreCents sem loja recusado', () => {
    expect(() => Withdrawal.create(wd({ amountStoreCents: 1000 }))).toThrow(/CHECK/);
  });

  test('valores 0 recusados', () => {
    expect(() => Withdrawal.create(wd({ amountBrlCents: 0 }))).toThrow(/CHECK/);
    expect(() => Withdrawal.create(wd({ storeId: storeIdByName('CSFloat'), amountStoreCents: 0 }))).toThrow(/CHECK/);
  });

  test('loja inexistente → FK', () => {
    expect(() => Withdrawal.create(wd({ storeId: 9999, amountStoreCents: 10 }))).toThrow(/FOREIGN KEY/);
  });

  test('findAll e sumAmountBrlCents', () => {
    expect(Withdrawal.sumAmountBrlCents()).toBe(0);
    const a = Withdrawal.create(wd({ amountBrlCents: 100, withdrawnAt: '2026-01-01T00:00:00.000Z' }));
    const b = Withdrawal.create(wd({ amountBrlCents: 200, withdrawnAt: '2026-03-01T00:00:00.000Z' }));
    expect(Withdrawal.sumAmountBrlCents()).toBe(300);
    expect(Withdrawal.findAll().map((w) => w.id)).toEqual([b.id, a.id]);
    expect(Withdrawal.findAll({ from: '2026-02-01T00:00:00.000Z' }).map((w) => w.id)).toEqual([b.id]);
    expect(Withdrawal.findAll({ to: '2026-02-01T00:00:00.000Z' }).map((w) => w.id)).toEqual([a.id]);
  });

  test('update parcial, inexistente e remove', () => {
    const w = Withdrawal.create(wd({ note: 'a' }));
    expect(Withdrawal.update(w.id, { note: 'b' })).toMatchObject({ note: 'b', amountBrlCents: 5000 });
    expect(() => Withdrawal.update(w.id, { amountStoreCents: 10 })).toThrow(/CHECK/);
    expect(Withdrawal.update(9999, { note: 'x' })).toBeNull();
    expect(Withdrawal.remove(w.id)).toBe(true);
    expect(Withdrawal.remove(w.id)).toBe(false);
  });
});
