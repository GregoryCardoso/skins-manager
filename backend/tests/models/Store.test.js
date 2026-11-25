const { closeDb, getDb } = require('../../src/config/database');
const Store = require('../../src/models/Store');
const Item = require('../../src/models/Item');
const { freshDb, storeIdByName, wonSkin } = require('../helpers/fixtures');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const base = (overrides = {}) => ({ name: 'Nova Loja', currency: 'USD', ...overrides });

describe('models/Store', () => {
  describe('create e leitura', () => {
    test('create aplica defaults do DDL e mapeia booleanos/camelCase', () => {
      const s = Store.create(base());
      expect(s).toMatchObject({
        name: 'Nova Loja', currency: 'USD', isActive: true, isPrimary: false, saleFeeType: null,
        saleFeeRate: null, saleFeeRounding: 'CEIL', saleMinFeeCents: null, saleFixedFeeCents: 0,
        allowsWithdrawal: false, withdrawalFeeRate: null, withdrawalFixedFeeCents: 0,
      });
      expect(typeof s.id).toBe('number');
      expect(s.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(s.updatedAt).toBe(s.createdAt);
      expect(Object.keys(s).some((k) => k.includes('_'))).toBe(false);
    });

    test('null explícito grava NULL', () => {
      const s = Store.create(base({ saleFeeRate: null, saleFeeType: null }));
      expect(s.saleFeeRate).toBeNull();
    });

    test('booleanos true/false gravam 1/0', () => {
      const s = Store.create(base({ allowsWithdrawal: true, isActive: false }));
      expect(s.allowsWithdrawal).toBe(true);
      expect(s.isActive).toBe(false);
      expect(getDb().prepare('SELECT allows_withdrawal, is_active FROM stores WHERE id = ?').get(s.id)).toEqual({
        allows_withdrawal: 1, is_active: 0,
      });
    });

    test('findById inexistente → null', () => {
      expect(Store.findById(99999)).toBeNull();
    });

    test('findAll ordena por nome; activeOnly filtra', () => {
      Store.create(base({ name: 'aaa', isActive: false }));
      expect(Store.findAll().map((s) => s.name)).toEqual(['aaa', 'CSFloat', 'CSMoney', 'Steam']);
      expect(Store.findAll({ activeOnly: true }).map((s) => s.name)).toEqual(['CSFloat', 'CSMoney', 'Steam']);
    });

    test('findPrimary devolve CSFloat; null se nenhuma principal', () => {
      expect(Store.findPrimary().name).toBe('CSFloat');
      Store.update(storeIdByName('CSFloat'), { isPrimary: false });
      expect(Store.findPrimary()).toBeNull();
    });
  });

  describe('restrições', () => {
    test('recusa 2ª loja principal', () => {
      expect(() => Store.create(base({ isPrimary: true }))).toThrow(/UNIQUE/);
      expect(() => Store.update(storeIdByName('Steam'), { isPrimary: true })).toThrow(/UNIQUE/);
    });

    test('recusa loja principal inativa', () => {
      Store.update(storeIdByName('CSFloat'), { isPrimary: false });
      expect(() => Store.create(base({ isPrimary: true, isActive: false }))).toThrow(/CHECK/);
    });

    test('recusa desativar a principal atual', () => {
      expect(() => Store.update(storeIdByName('CSFloat'), { isActive: false })).toThrow(/CHECK/);
    });

    test('recusa "csfloat" duplicando "CSFloat" (NOCASE)', () => {
      expect(() => Store.create(base({ name: 'csfloat' }))).toThrow(/UNIQUE/);
    });

    test('recusa nome vazio ou só espaços', () => {
      expect(() => Store.create(base({ name: '   ' }))).toThrow(/CHECK/);
    });

    test('aceita qualquer moeda no formato (11.4: a lista das 17 fica no service) e recusa formato inválido', () => {
      expect(Store.create(base({ name: 'Loja EUR', currency: 'EUR' })).currency).toBe('EUR');
      expect(() => Store.create(base({ name: 'Loja eur', currency: 'eur' }))).toThrow(/CHECK/);
      expect(() => Store.create(base({ name: 'Loja EURO', currency: 'EURO' }))).toThrow(/CHECK/);
    });

    test.each([1, -0.01])('recusa sale_fee_rate = %p', (rate) => {
      expect(() => Store.create(base({ saleFeeRate: rate }))).toThrow(/CHECK/);
    });

    test.each([1, -0.01])('recusa withdrawal_fee_rate = %p', (rate) => {
      expect(() => Store.create(base({ withdrawalFeeRate: rate }))).toThrow(/CHECK/);
    });

    test('aceita taxa 0 e 0.999', () => {
      expect(Store.create(base({ name: 'A', saleFeeRate: 0 })).saleFeeRate).toBe(0);
      expect(Store.create(base({ name: 'B', saleFeeRate: 0.999 })).saleFeeRate).toBe(0.999);
    });

    test('recusa rounding "UP" e sale_fee_type inválido', () => {
      expect(() => Store.create(base({ saleFeeRounding: 'UP' }))).toThrow(/CHECK/);
      expect(() => Store.create(base({ saleFeeType: 'OTHER' }))).toThrow(/CHECK/);
    });

    test('recusa sale_fixed_fee_cents = 1.5 (STRICT)', () => {
      expect(() => Store.create(base({ saleFixedFeeCents: 1.5 }))).toThrow(/cannot store REAL value in INTEGER column/);
    });

    test('recusa taxas fixas e mínimo negativos', () => {
      expect(() => Store.create(base({ saleFixedFeeCents: -1 }))).toThrow(/CHECK/);
      expect(() => Store.create(base({ saleMinFeeCents: -1 }))).toThrow(/CHECK/);
      expect(() => Store.create(base({ withdrawalFixedFeeCents: -1 }))).toThrow(/CHECK/);
    });

    test('recusa taxa fixa NULL (NOT NULL)', () => {
      expect(() => Store.create(base({ saleFixedFeeCents: null }))).toThrow(/NOT NULL/);
    });
  });

  describe('update e remove', () => {
    test('update parcial preserva demais campos e muda updatedAt', () => {
      jest.useFakeTimers({ now: new Date('2026-05-01T00:00:00.000Z') });
      try {
        const created = Store.create(base({ saleFeeRate: 0.1, saleFeeType: 'DEDUCTED' }));
        jest.setSystemTime(new Date('2026-05-02T00:00:00.000Z'));
        const updated = Store.update(created.id, { saleFeeRate: 0.2 });
        expect(updated).toEqual({ ...created, saleFeeRate: 0.2, updatedAt: '2026-05-02T00:00:00.000Z' });
      } finally {
        jest.useRealTimers();
      }
    });

    test('update id inexistente → null', () => {
      expect(Store.update(99999, { name: 'x' })).toBeNull();
    });

    test('remove loja livre → true; de novo → false', () => {
      const s = Store.create(base());
      expect(Store.remove(s.id)).toBe(true);
      expect(Store.findById(s.id)).toBeNull();
      expect(Store.remove(s.id)).toBe(false);
    });

    test('remove de loja em uso por item → erro de FK', () => {
      const id = storeIdByName('CSFloat');
      Item.create(wonSkin({ acquisitionType: 'COMPRA', purchaseStoreId: id, purchasePriceCents: 500 }));
      expect(() => Store.remove(id)).toThrow(/FOREIGN KEY/);
      expect(Store.findById(id)).not.toBeNull();
    });
  });

  test('nome com aspas e "\'; DROP TABLE" gravado sem alteração', () => {
    const names = [`Loja "Aspas" d'Água`, "x'; DROP TABLE stores; --"];
    for (const name of names) {
      const s = Store.create(base({ name }));
      expect(Store.findById(s.id).name).toBe(name);
    }
    expect(Store.findAll()).toHaveLength(5);
  });
});
