const { closeDb, getDb } = require('../../src/config/database');
const { insertRow, updateRow } = require('../../src/models/modelHelpers');
const { ValidationError } = require('../../src/errors/AppError');
const Item = require('../../src/models/Item');
const Store = require('../../src/models/Store');
const Deposit = require('../../src/models/Deposit');
const Withdrawal = require('../../src/models/Withdrawal');
const { freshDb, storeIdByName, wonSkin } = require('../helpers/fixtures');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const count = (table) => getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const rawRow = (table, id) => getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);

// Captura o erro lançado para inspecionar status/code/mensagem.
function catchErr(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('esperava que lançasse');
}

function expectUnknownField(err, field) {
  expect(err).toBeInstanceOf(ValidationError);
  expect(err.status).toBe(400);
  expect(err.code).toBe('UNKNOWN_FIELD');
  expect(err.message).toBe(`Campo desconhecido: ${field}`);
}

describe('modelHelpers.pickColumns (via insertRow/updateRow)', () => {
  test('insertRow com chave fora da whitelist lança UNKNOWN_FIELD antes de tocar o banco', () => {
    const before = count('deposits');
    const err = catchErr(() =>
      insertRow(getDb(), 'deposits', { amountBrlCents: 100, depositedAt: '2026-01-01T00:00:00.000Z', foo: 1 }, ['amountBrlCents', 'depositedAt']),
    );
    expectUnknownField(err, 'foo');
    expect(count('deposits')).toBe(before);
  });

  test('chave snake_case (nome da coluna) também é desconhecida', () => {
    const err = catchErr(() => insertRow(getDb(), 'deposits', { amount_brl_cents: 100 }, ['amountBrlCents']));
    expectUnknownField(err, 'amount_brl_cents');
  });

  test('chave desconhecida com valor null é rejeitada (só undefined é ignorado)', () => {
    const err = catchErr(() => updateRow(getDb(), 'deposits', 1, { foo: null }, ['note']));
    expectUnknownField(err, 'foo');
  });

  test('chave desconhecida com valor undefined é ignorada', () => {
    const id = insertRow(
      getDb(), 'deposits',
      { amountBrlCents: 100, depositedAt: '2026-01-01T00:00:00.000Z', foo: undefined },
      ['amountBrlCents', 'depositedAt'],
      { created_at: 'x', updated_at: 'x' },
    );
    expect(rawRow('deposits', Number(id)).amount_brl_cents).toBe(100);
  });
});

describe('models/Item - campos desconhecidos', () => {
  test('create({ ...válido, purchasePrice: 1234 }) → ValidationError 400 UNKNOWN_FIELD e nada é gravado', () => {
    const before = count('items');
    const err = catchErr(() => Item.create(wonSkin({ purchasePrice: 1234 })));
    expectUnknownField(err, 'purchasePrice');
    expect(count('items')).toBe(before);
  });

  test('update com chave desconhecida lança e não altera o registro (nem updated_at)', () => {
    const item = Item.create(wonSkin());
    const snapshot = rawRow('items', item.id);
    const err = catchErr(() => Item.update(item.id, { name: 'Outro nome', salePrice: 999 }));
    expectUnknownField(err, 'salePrice');
    expect(rawRow('items', item.id)).toEqual(snapshot);
  });

  test('undefined continua ignorado em create e update', () => {
    const item = Item.create(wonSkin({ floatValue: undefined, purchasePrice: undefined }));
    expect(item.floatValue).toBeNull();
    const updated = Item.update(item.id, { name: 'Novo', phase: undefined, foo: undefined });
    expect(updated.name).toBe('Novo');
    expect(updated.phase).toBeNull();
  });

  test('update(id, null) não quebra: mantém os campos', () => {
    const item = Item.create(wonSkin());
    const updated = Item.update(item.id, null);
    expect(updated).not.toBeNull();
    expect(updated.id).toBe(item.id);
    expect(updated.name).toBe(item.name);
  });

  test('update(inexistente, null) → null', () => {
    expect(Item.update(999999, null)).toBeNull();
  });

  test('update(id, undefined) não quebra', () => {
    const item = Item.create(wonSkin());
    expect(Item.update(item.id, undefined).id).toBe(item.id);
  });
});

describe('models/Store - campos desconhecidos', () => {
  test('create com chave desconhecida → UNKNOWN_FIELD e nada é gravado', () => {
    const before = count('stores');
    const err = catchErr(() => Store.create({ name: 'Loja X', currency: 'USD', feeRate: 0.05 }));
    expectUnknownField(err, 'feeRate');
    expect(count('stores')).toBe(before);
    expect(getDb().prepare('SELECT 1 FROM stores WHERE name = ?').get('Loja X')).toBeUndefined();
  });

  test('update com chave desconhecida não altera a loja', () => {
    const id = storeIdByName('CSFloat');
    const snapshot = rawRow('stores', id);
    const err = catchErr(() => Store.update(id, { isActive: false, primary: true }));
    expectUnknownField(err, 'primary');
    expect(rawRow('stores', id)).toEqual(snapshot);
  });

  test('undefined ignorado e update(id, null) não quebra', () => {
    const s = Store.create({ name: 'Loja Y', currency: 'USD', saleFeeRate: undefined, xyz: undefined });
    expect(s.saleFeeRate).toBeNull();
    expect(Store.update(s.id, null).name).toBe('Loja Y');
  });
});

describe('models/Deposit e Withdrawal - campos desconhecidos', () => {
  const dep = (o = {}) => ({ amountBrlCents: 10000, depositedAt: '2026-02-01T00:00:00.000Z', ...o });

  test('Deposit.create com chave desconhecida → UNKNOWN_FIELD e nada é gravado', () => {
    const err = catchErr(() => Deposit.create(dep({ amount: 5 })));
    expectUnknownField(err, 'amount');
    expect(count('deposits')).toBe(0);
  });

  test('Deposit.update com chave desconhecida não altera; undefined ignorado; null não quebra', () => {
    const d = Deposit.create(dep({ note: 'a' }));
    const snapshot = rawRow('deposits', d.id);
    expectUnknownField(catchErr(() => Deposit.update(d.id, { note: 'b', obs: 'c' })), 'obs');
    expect(rawRow('deposits', d.id)).toEqual(snapshot);
    expect(Deposit.update(d.id, { note: 'b', obs: undefined }).note).toBe('b');
    expect(Deposit.update(d.id, null).note).toBe('b');
  });

  test('Withdrawal.create com chave desconhecida → UNKNOWN_FIELD e nada é gravado', () => {
    const err = catchErr(() =>
      Withdrawal.create({
        storeId: storeIdByName('CSFloat'), amountStoreCents: 1000, amountBrlCents: 5000,
        withdrawnAt: '2026-02-01T00:00:00.000Z', fee: 1,
      }),
    );
    expectUnknownField(err, 'fee');
    expect(count('withdrawals')).toBe(0);
  });
});
