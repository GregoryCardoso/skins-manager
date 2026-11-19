const { closeDb } = require('../../src/config/database');
const StoreBalance = require('../../src/models/StoreBalance');
const Store = require('../../src/models/Store');
const { freshDb, storeIdByName } = require('../helpers/fixtures');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const bal = (storeId, balanceCents, recordedAt, extra = {}) =>
  StoreBalance.create({ storeId, balanceCents, recordedAt, ...extra });

describe('models/StoreBalance', () => {
  test('create grava e mapeia', () => {
    const b = bal(storeIdByName('Steam'), 1000, '2026-01-01T00:00:00.000Z', { fxRate: 5.5 });
    expect(b).toMatchObject({ storeId: storeIdByName('Steam'), balanceCents: 1000, fxRate: 5.5, recordedAt: '2026-01-01T00:00:00.000Z' });
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
    expect(() => StoreBalance.create({ balanceCents: 1, recordedAt: '2026-01-01T00:00:00.000Z' })).toThrow(/NOT NULL/);
    expect(() => bal(9999, 1, '2026-01-01T00:00:00.000Z')).toThrow(/FOREIGN KEY/);
  });

  test('loja com saldo não pode ser removida (FK)', () => {
    const id = storeIdByName('CSMoney');
    bal(id, 1, '2026-01-01T00:00:00.000Z');
    expect(() => Store.remove(id)).toThrow(/FOREIGN KEY/);
  });

  test('findLatestByStore escolhe por recorded_at, não por inserção', () => {
    const id = storeIdByName('CSFloat');
    const newest = bal(id, 300, '2026-03-01T00:00:00.000Z');
    bal(id, 100, '2026-01-01T00:00:00.000Z');
    bal(id, 200, '2026-02-01T00:00:00.000Z');
    expect(StoreBalance.findLatestByStore(id).id).toBe(newest.id);
  });

  test('findLatestByStore em empate de recorded_at → maior id', () => {
    const id = storeIdByName('CSFloat');
    bal(id, 100, '2026-01-01T00:00:00.000Z');
    const second = bal(id, 200, '2026-01-01T00:00:00.000Z');
    expect(StoreBalance.findLatestByStore(id).id).toBe(second.id);
  });

  test('findLatestByStore sem saldo → null', () => {
    expect(StoreBalance.findLatestByStore(storeIdByName('CSFloat'))).toBeNull();
  });

  test('findLatestAll devolve um por loja (o mais recente, com desempate por id)', () => {
    const csfloat = storeIdByName('CSFloat');
    const steam = storeIdByName('Steam');
    const f1 = bal(csfloat, 1, '2026-02-01T00:00:00.000Z');
    bal(csfloat, 2, '2026-01-01T00:00:00.000Z');
    bal(steam, 3, '2026-05-01T00:00:00.000Z', { fxRate: 5 });
    const s2 = bal(steam, 4, '2026-05-01T00:00:00.000Z', { fxRate: 5 });
    const all = StoreBalance.findLatestAll();
    expect(all).toHaveLength(2);
    expect(all.find((b) => b.storeId === csfloat).id).toBe(f1.id);
    expect(all.find((b) => b.storeId === steam).id).toBe(s2.id);
  });

  test('findLatestAll vazio → []', () => {
    expect(StoreBalance.findLatestAll()).toEqual([]);
  });

  test('findHistory mais recente primeiro, só da loja pedida', () => {
    const csfloat = storeIdByName('CSFloat');
    const a = bal(csfloat, 1, '2026-01-01T00:00:00.000Z');
    const b = bal(csfloat, 2, '2026-03-01T00:00:00.000Z');
    const c = bal(csfloat, 3, '2026-02-01T00:00:00.000Z');
    bal(storeIdByName('CSMoney'), 9, '2026-04-01T00:00:00.000Z');
    expect(StoreBalance.findHistory(csfloat).map((x) => x.id)).toEqual([b.id, c.id, a.id]);
  });
});
