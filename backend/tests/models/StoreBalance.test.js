const { closeDb } = require('../../src/config/database');
const StoreBalance = require('../../src/models/StoreBalance');
const Store = require('../../src/models/Store');
const { freshDb, storeIdByName } = require('../helpers/fixtures');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const bal = (storeId, balanceCents, recordedAt, extra = {}) =>
  StoreBalance.create({ storeId, kind: 'CHECK', balanceCents, recordedAt, ...extra });

describe('models/StoreBalance', () => {
  test('create grava e mapeia', () => {
    const b = bal(storeIdByName('Steam'), 1000, '2026-01-01T00:00:00.000Z', { fxRate: 5.5, note: 'n' });
    expect(b).toMatchObject({
      storeId: storeIdByName('Steam'), kind: 'CHECK', balanceCents: 1000, fxRate: 5.5, note: 'n',
      computedCents: null, adjustmentCents: null, recordedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(typeof b.createdAt).toBe('string');
    expect(b.updatedAt).toBeUndefined();
  });

  test('saldo 0 aceito; negativo, fracionário e fxRate 0 recusados', () => {
    const id = storeIdByName('CSFloat');
    expect(bal(id, 0, '2026-01-01T00:00:00.000Z').balanceCents).toBe(0);
    expect(() => bal(id, -1, '2026-01-01T00:00:00.000Z')).toThrow(/CHECK/);
    expect(() => bal(id, 1.5, '2026-01-01T00:00:00.000Z')).toThrow(/cannot store REAL value/);
    expect(() => bal(id, 1, '2026-01-01T00:00:00.000Z', { fxRate: 0 })).toThrow(/CHECK/);
  });

  test('loja obrigatória e existente', () => {
    expect(() => StoreBalance.create({ kind: 'CHECK', balanceCents: 1, recordedAt: '2026-01-01T00:00:00.000Z' })).toThrow(/NOT NULL/);
    expect(() => bal(9999, 1, '2026-01-01T00:00:00.000Z')).toThrow(/FOREIGN KEY/);
  });

  test('loja com saldo não pode ser removida (FK)', () => {
    const id = storeIdByName('CSMoney');
    bal(id, 1, '2026-01-01T00:00:00.000Z');
    expect(() => Store.remove(id)).toThrow(/FOREIGN KEY/);
  });

  test('findByStore: mais recente primeiro (desempate por id), só da loja pedida', () => {
    const csfloat = storeIdByName('CSFloat');
    const a = bal(csfloat, 1, '2026-01-01T00:00:00.000Z');
    const b = bal(csfloat, 2, '2026-03-01T00:00:00.000Z');
    const c = bal(csfloat, 3, '2026-03-01T00:00:00.000Z');
    bal(storeIdByName('CSMoney'), 9, '2026-04-01T00:00:00.000Z');
    expect(StoreBalance.findByStore(csfloat).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
  });

  test('findAllEntries devolve tudo, mais recente primeiro', () => {
    expect(StoreBalance.findAllEntries()).toEqual([]);
    const a = bal(storeIdByName('CSFloat'), 1, '2026-01-01T00:00:00.000Z');
    const b = bal(storeIdByName('Steam'), 2, '2026-02-01T00:00:00.000Z');
    expect(StoreBalance.findAllEntries().map((x) => x.id)).toEqual([b.id, a.id]);
  });

  test('create grava sempre kind CHECK (não existe mais saldo inicial, D253) e o banco recusa INITIAL', () => {
    const id = storeIdByName('CSFloat');
    const b = StoreBalance.create({ storeId: id, kind: 'INITIAL', balanceCents: 5, recordedAt: '2026-01-01T00:00:00.000Z' });
    expect(b.kind).toBe('CHECK');
    expect(() => require('../../src/config/database').getDb()
      .prepare("INSERT INTO store_balances (store_id, kind, balance_cents, recorded_at, created_at) VALUES (?, 'INITIAL', 1, 'r', 'c')").run(id)).toThrow(/CHECK/);
  });

  test('remove apaga e devolve true/false', () => {
    const row = bal(storeIdByName('CSFloat'), 1, '2026-01-01T00:00:00.000Z');
    expect(StoreBalance.remove(row.id)).toBe(true);
    expect(StoreBalance.remove(row.id)).toBe(false);
  });
});
