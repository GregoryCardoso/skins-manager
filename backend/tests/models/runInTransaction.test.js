// QA D64 item 4: runInTransaction (models/modelHelpers.js) — commit no retorno, rollback se lançar.
const fs = require('fs');
const path = require('path');
const { closeDb, getDb } = require('../../src/config/database');
const { runInTransaction } = require('../../src/models/modelHelpers');
const { freshDb } = require('../helpers/fixtures');

beforeEach(() => freshDb());
afterAll(() => closeDb());

const insertSetting = (rate) => getDb().prepare('UPDATE settings SET usd_brl_rate = ? WHERE id = 1').run(rate);
const rate = () => getDb().prepare('SELECT usd_brl_rate AS r FROM settings WHERE id = 1').get().r;
const storeCount = () => getDb().prepare('SELECT COUNT(*) AS n FROM stores').get().n;

describe('runInTransaction', () => {
  test('commit: devolve o valor de fn e grava as alterações', () => {
    const out = runInTransaction(() => {
      insertSetting(5.5);
      return { ok: 42 };
    });
    expect(out).toEqual({ ok: 42 });
    expect(rate()).toBe(5.5);
  });

  test('rollback: se fn lança, propaga o mesmo erro e desfaz tudo (várias escritas)', () => {
    const before = storeCount();
    const boom = new Error('falhou');
    expect(() =>
      runInTransaction(() => {
        insertSetting(7.7);
        getDb().prepare("DELETE FROM stores WHERE name = 'CSMoney'").run();
        throw boom;
      })
    ).toThrow(boom);
    expect(rate()).toBeNull();
    expect(storeCount()).toBe(before);
  });

  test('fora da transação ao terminar (inTransaction false), tanto no commit quanto no rollback', () => {
    runInTransaction(() => expect(getDb().inTransaction).toBe(true));
    expect(getDb().inTransaction).toBe(false);
    expect(() => runInTransaction(() => { throw new Error('x'); })).toThrow('x');
    expect(getDb().inTransaction).toBe(false);
  });

  test('usa a conexão atual (getDb) mesmo após trocar o banco', () => {
    closeDb();
    getDb();
    runInTransaction(() => insertSetting(3.3));
    expect(rate()).toBe(3.3);
  });
});

describe('itemService não acessa o banco diretamente (D64 item 4)', () => {
  test('não importa config/database nem chama getDb/transaction', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/services/itemService.js'), 'utf8');
    expect(src).not.toMatch(/config\/database/);
    expect(src).not.toMatch(/getDb\s*\(/);
    expect(src).not.toMatch(/\.transaction\s*\(/);
    expect(src).toMatch(/require\('\.\.\/models\/modelHelpers'\)/);
  });

  test('nenhum service importa config/database', () => {
    const dir = path.join(__dirname, '../../src/services');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const offenders = walk(dir).filter((f) => f.endsWith('.js') && /config\/database/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
