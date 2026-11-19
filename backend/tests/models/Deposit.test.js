const { closeDb } = require('../../src/config/database');
const Deposit = require('../../src/models/Deposit');
const { freshDb, storeIdByName } = require('../helpers/fixtures');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const dep = (overrides = {}) => ({ amountBrlCents: 10000, depositedAt: '2026-02-01T00:00:00.000Z', ...overrides });

describe('models/Deposit', () => {
  test('create sem loja e sem nota', () => {
    const d = Deposit.create(dep());
    expect(d).toMatchObject({ amountBrlCents: 10000, depositedAt: '2026-02-01T00:00:00.000Z', storeId: null, note: null });
    expect(d.createdAt).toBe(d.updatedAt);
  });

  test('create com loja e nota', () => {
    const d = Deposit.create(dep({ storeId: storeIdByName('CSFloat'), note: "aporte 'pix'" }));
    expect(d.storeId).toBe(storeIdByName('CSFloat'));
    expect(d.note).toBe("aporte 'pix'");
  });

  test('valor 0 e negativo recusados', () => {
    expect(() => Deposit.create(dep({ amountBrlCents: 0 }))).toThrow(/CHECK/);
    expect(() => Deposit.create(dep({ amountBrlCents: -5 }))).toThrow(/CHECK/);
  });

  test('valor fracionário recusado (STRICT)', () => {
    expect(() => Deposit.create(dep({ amountBrlCents: 1.5 }))).toThrow(/cannot store REAL value/);
  });

  test('loja inexistente → FK', () => {
    expect(() => Deposit.create(dep({ storeId: 9999 }))).toThrow(/FOREIGN KEY/);
  });

  test('soma com tabela vazia = 0', () => {
    expect(Deposit.sumAmountBrlCents()).toBe(0);
  });

  test('soma dos valores', () => {
    Deposit.create(dep({ amountBrlCents: 100 }));
    Deposit.create(dep({ amountBrlCents: 250 }));
    expect(Deposit.sumAmountBrlCents()).toBe(350);
  });

  test('findAll mais recente primeiro e filtra from/to inclusivos', () => {
    const a = Deposit.create(dep({ depositedAt: '2026-01-01T00:00:00.000Z' }));
    const b = Deposit.create(dep({ depositedAt: '2026-03-01T00:00:00.000Z' }));
    const c = Deposit.create(dep({ depositedAt: '2026-02-01T00:00:00.000Z' }));
    expect(Deposit.findAll().map((d) => d.id)).toEqual([b.id, c.id, a.id]);
    expect(Deposit.findAll({ from: '2026-02-01T00:00:00.000Z' }).map((d) => d.id)).toEqual([b.id, c.id]);
    expect(Deposit.findAll({ to: '2026-02-01T00:00:00.000Z' }).map((d) => d.id)).toEqual([c.id, a.id]);
    expect(
      Deposit.findAll({ from: '2026-01-15T00:00:00.000Z', to: '2026-02-15T00:00:00.000Z' }).map((d) => d.id)
    ).toEqual([c.id]);
  });

  test('update parcial, update inexistente e remove', () => {
    const d = Deposit.create(dep({ note: 'x' }));
    const u = Deposit.update(d.id, { amountBrlCents: 500 });
    expect(u).toMatchObject({ amountBrlCents: 500, note: 'x', depositedAt: d.depositedAt });
    expect(Deposit.update(9999, { note: 'y' })).toBeNull();
    expect(Deposit.findById(9999)).toBeNull();
    expect(Deposit.remove(d.id)).toBe(true);
    expect(Deposit.remove(d.id)).toBe(false);
  });
});
