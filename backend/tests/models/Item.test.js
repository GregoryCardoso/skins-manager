const { closeDb } = require('../../src/config/database');
const Item = require('../../src/models/Item');
const { freshDb, storeIdByName, wonSkin, soldFields } = require('../helpers/fixtures');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const csfloat = () => storeIdByName('CSFloat');
const nonSkin = (category, overrides = {}) =>
  wonSkin({ name: 'Item', category, variant: undefined, ...overrides });

describe('models/Item', () => {
  describe('create e leitura', () => {
    test('GANHEI sem loja aceito com purchasePriceCents 0, USD e EM_ESTOQUE (defaults do DDL)', () => {
      const item = Item.create(wonSkin());
      expect(item).toMatchObject({
        name: 'AK-47 | Redline', category: 'SKIN', variant: 'NORMAL', acquisitionType: 'GANHEI',
        purchaseStoreId: null, purchasePriceCents: 0, purchaseCurrency: 'USD', fxRateAtPurchase: null,
        status: 'EM_ESTOQUE', tradeUnlockAt: null, soldAt: null, netReceivedCents: null,
      });
      expect(item.createdAt).toBe(item.updatedAt);
      expect(Object.keys(item).some((k) => k.includes('_'))).toBe(false);
    });

    test('GANHEI com loja opcional é aceito', () => {
      expect(Item.create(wonSkin({ purchaseStoreId: csfloat() })).purchaseStoreId).toBe(csfloat());
    });

    test('COMPRA com loja aceito', () => {
      const item = Item.create(wonSkin({ acquisitionType: 'COMPRA', purchaseStoreId: csfloat(), purchasePriceCents: 1234 }));
      expect(item.purchasePriceCents).toBe(1234);
    });

    test('findById inexistente → null', () => {
      expect(Item.findById(424242)).toBeNull();
    });

    test('findAll ordena por id e filtra por status e categoria', () => {
      const a = Item.create(wonSkin());
      const b = Item.create(nonSkin('CAIXA'));
      const c = Item.create(wonSkin({ ...soldFields(csfloat()) }));
      expect(Item.findAll().map((i) => i.id)).toEqual([a.id, b.id, c.id]);
      expect(Item.findAll({ status: 'EM_ESTOQUE' }).map((i) => i.id)).toEqual([a.id, b.id]);
      expect(Item.findAll({ status: 'VENDIDO' }).map((i) => i.id)).toEqual([c.id]);
      expect(Item.findAll({ category: 'CAIXA' }).map((i) => i.id)).toEqual([b.id]);
      expect(Item.findAll({ status: 'VENDIDO', category: 'CAIXA' })).toEqual([]);
    });

    test('remove → true; repetido → false', () => {
      const a = Item.create(wonSkin());
      expect(Item.remove(a.id)).toBe(true);
      expect(Item.remove(a.id)).toBe(false);
    });

    test('nome com aspas e "\'; DROP TABLE" gravado sem alteração', () => {
      const name = `Faca "Karambit" d'ouro'; DROP TABLE items; --`;
      const item = Item.create(wonSkin({ name }));
      expect(Item.findById(item.id).name).toBe(name);
      expect(Item.findAll()).toHaveLength(1);
    });
  });

  describe('aquisição e moeda', () => {
    test('COMPRA sem loja recusado', () => {
      expect(() => Item.create(wonSkin({ acquisitionType: 'COMPRA', purchasePriceCents: 100 }))).toThrow(/CHECK/);
    });

    test('acquisition_type inválido recusado', () => {
      expect(() => Item.create(wonSkin({ acquisitionType: 'TROCA' }))).toThrow(/CHECK/);
    });

    test('BRL sem cotação recusado; BRL com cotação aceito', () => {
      expect(() => Item.create(wonSkin({ purchaseCurrency: 'BRL' }))).toThrow(/CHECK/);
      expect(Item.create(wonSkin({ purchaseCurrency: 'BRL', fxRateAtPurchase: 5.2 })).fxRateAtPurchase).toBe(5.2);
    });

    test('USD com cotação recusado', () => {
      expect(() => Item.create(wonSkin({ purchaseCurrency: 'USD', fxRateAtPurchase: 5.2 }))).toThrow(/CHECK/);
    });

    test('cotação 0 recusada', () => {
      expect(() => Item.create(wonSkin({ purchaseCurrency: 'BRL', fxRateAtPurchase: 0 }))).toThrow(/CHECK/);
    });

    test('loja inexistente → erro de FK', () => {
      expect(() => Item.create(wonSkin({ acquisitionType: 'COMPRA', purchaseStoreId: 9999 }))).toThrow(/FOREIGN KEY/);
    });

    test('preço negativo recusado; preço fracionário recusado (STRICT)', () => {
      expect(() => Item.create(wonSkin({ purchasePriceCents: -1 }))).toThrow(/CHECK/);
      expect(() => Item.create(wonSkin({ purchasePriceCents: 10.5 }))).toThrow(/cannot store REAL value/);
    });

    test('acquiredAt obrigatório', () => {
      expect(() => Item.create(wonSkin({ acquiredAt: undefined }))).toThrow(/NOT NULL/);
    });
  });

  describe('atributos', () => {
    test('STICKER com variant recusado', () => {
      expect(() => Item.create(nonSkin('STICKER', { variant: 'NORMAL' }))).toThrow(/CHECK/);
    });

    test('STICKER com float recusado', () => {
      expect(() => Item.create(nonSkin('STICKER', { floatValue: 0.1 }))).toThrow(/CHECK/);
    });

    test.each([['exterior', 'FN'], ['paintSeed', 1], ['phase', 'P1']])('CAIXA com %s recusado', (field, value) => {
      expect(() => Item.create(nonSkin('CAIXA', { [field]: value }))).toThrow(/CHECK/);
    });

    test('STICKER sem atributos aceito', () => {
      expect(Item.create(nonSkin('STICKER')).variant).toBeNull();
    });

    test('SKIN sem variant recusado', () => {
      expect(() => Item.create(wonSkin({ variant: undefined }))).toThrow(/CHECK/);
    });

    test('LUVA STATTRAK recusada; LUVA NORMAL aceita', () => {
      expect(() => Item.create(wonSkin({ category: 'LUVA', variant: 'STATTRAK' }))).toThrow(/CHECK/);
      expect(Item.create(wonSkin({ category: 'LUVA', variant: 'NORMAL' })).category).toBe('LUVA');
    });

    test('FACA SOUVENIR recusada; FACA STATTRAK aceita', () => {
      expect(() => Item.create(wonSkin({ category: 'FACA', variant: 'SOUVENIR' }))).toThrow(/CHECK/);
      expect(Item.create(wonSkin({ category: 'FACA', variant: 'STATTRAK' })).variant).toBe('STATTRAK');
    });

    test('categoria e exterior inválidos recusados', () => {
      expect(() => Item.create(wonSkin({ category: 'ARMA' }))).toThrow(/CHECK/);
      expect(() => Item.create(wonSkin({ exterior: 'XX' }))).toThrow(/CHECK/);
    });

    test.each([-0.01, 1.01])('float %p recusado', (f) => {
      expect(() => Item.create(wonSkin({ floatValue: f }))).toThrow(/CHECK/);
    });

    test('seed 1001 e -1 recusados', () => {
      expect(() => Item.create(wonSkin({ paintSeed: 1001 }))).toThrow(/CHECK/);
      expect(() => Item.create(wonSkin({ paintSeed: -1 }))).toThrow(/CHECK/);
    });

    test('float 0, float 1, seed 0 e seed 1000 aceitos', () => {
      expect(Item.create(wonSkin({ floatValue: 0 })).floatValue).toBe(0);
      expect(Item.create(wonSkin({ floatValue: 1 })).floatValue).toBe(1);
      expect(Item.create(wonSkin({ paintSeed: 0 })).paintSeed).toBe(0);
      expect(Item.create(wonSkin({ paintSeed: 1000 })).paintSeed).toBe(1000);
    });
  });

  describe('status e venda', () => {
    const REQUIRED = [
      'saleStoreId', 'salePriceCents', 'saleCurrency', 'saleFeeTypeApplied', 'saleFeeRateApplied',
      'saleFeeRoundingApplied', 'saleFixedFeeCentsApplied', 'netReceivedCents', 'soldAt',
    ];

    test('VENDIDO completo aceito com saleMinFeeCentsApplied NULL', () => {
      const item = Item.create(wonSkin(soldFields(csfloat())));
      expect(item.status).toBe('VENDIDO');
      expect(item.saleMinFeeCentsApplied).toBeNull();
    });

    test.each(REQUIRED)('VENDIDO sem %s recusado', (field) => {
      expect(() => Item.create(wonSkin(soldFields(csfloat(), { [field]: undefined })))).toThrow(/CHECK/);
    });

    test.each(REQUIRED)('VENDIDO com %s = null recusado', (field) => {
      expect(() => Item.create(wonSkin(soldFields(csfloat(), { [field]: null })))).toThrow(/CHECK/);
    });

    test('EM_ESTOQUE com soldAt recusado', () => {
      expect(() => Item.create(wonSkin({ soldAt: '2026-02-01T00:00:00.000Z' }))).toThrow(/CHECK/);
    });

    test('EM_ESTOQUE com fxRateAtSale recusado', () => {
      expect(() => Item.create(wonSkin({ fxRateAtSale: 5 }))).toThrow(/CHECK/);
    });

    test('EM_ESTOQUE com saleMinFeeCentsApplied recusado', () => {
      expect(() => Item.create(wonSkin({ saleMinFeeCentsApplied: 0 }))).toThrow(/CHECK/);
    });

    test('salePriceCents = 0 recusado', () => {
      expect(() => Item.create(wonSkin(soldFields(csfloat(), { salePriceCents: 0 })))).toThrow(/CHECK/);
    });

    test('venda BRL sem cotação recusada; com cotação aceita; USD com cotação recusada', () => {
      const steam = storeIdByName('Steam');
      expect(() => Item.create(wonSkin(soldFields(steam, { saleCurrency: 'BRL' })))).toThrow(/CHECK/);
      expect(Item.create(wonSkin(soldFields(steam, { saleCurrency: 'BRL', fxRateAtSale: 5.4 }))).fxRateAtSale).toBe(5.4);
      expect(() => Item.create(wonSkin(soldFields(csfloat(), { fxRateAtSale: 5.4 })))).toThrow(/CHECK/);
    });

    test('loja de venda inexistente → FK', () => {
      expect(() => Item.create(wonSkin(soldFields(9999)))).toThrow(/FOREIGN KEY/);
    });

    test('status inválido recusado', () => {
      expect(() => Item.create(wonSkin({ status: 'BLOQUEADO_TROCA' }))).toThrow(/CHECK/);
    });
  });

  describe('update', () => {
    test('parcial preserva campos e muda updatedAt', () => {
      jest.useFakeTimers({ now: new Date('2026-04-01T00:00:00.000Z') });
      try {
        const created = Item.create(wonSkin({ floatValue: 0.15, exterior: 'FT', paintSeed: 77 }));
        jest.setSystemTime(new Date('2026-04-01T01:00:00.000Z'));
        const updated = Item.update(created.id, { name: 'M4A4 | Howl' });
        expect(updated).toEqual({ ...created, name: 'M4A4 | Howl', updatedAt: '2026-04-01T01:00:00.000Z' });
        expect(updated.createdAt).toBe('2026-04-01T00:00:00.000Z');
      } finally {
        jest.useRealTimers();
      }
    });

    test('update pode marcar como vendido em um passo', () => {
      const created = Item.create(wonSkin());
      const sold = Item.update(created.id, soldFields(csfloat()));
      expect(sold.status).toBe('VENDIDO');
      expect(sold.netReceivedCents).toBe(980);
    });

    test('update inválido não altera a linha', () => {
      const created = Item.create(wonSkin());
      expect(() => Item.update(created.id, { status: 'VENDIDO' })).toThrow(/CHECK/);
      expect(Item.findById(created.id)).toEqual(created);
    });

    test('update com null limpa campo opcional', () => {
      const created = Item.create(wonSkin({ phase: 'P2' }));
      expect(Item.update(created.id, { phase: null }).phase).toBeNull();
    });

    test('id inexistente → null', () => {
      expect(Item.update(9999, { name: 'x' })).toBeNull();
    });
  });
});
