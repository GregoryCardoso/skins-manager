'use strict';

// Revisão 11.1 (M2/baixa g): a v23 recria a tabela `settings` e só pode mudar o padrão (dflt_value) de `language`; os outros CHECKs
// continuam valendo. Só bancos temporários em arquivo; nada no %APPDATA%.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-v23schema-'));
let database;
let MIGRATIONS;

beforeAll(() => {
  jest.resetModules();
  database = require('../../src/config/database');
  ({ MIGRATIONS } = require('../../src/config/migrations'));
});

afterAll(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporário */ }
});

const columns = (db) => db.prepare("SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_info('settings') ORDER BY cid").all();

describe('v23: esquema da tabela settings', () => {
  test('a única diferença entre a v22 e a v23 é o dflt_value de language', () => {
    const db22 = database.openDatabase(path.join(dir, 'v22.sqlite'), { migrations: MIGRATIONS.filter((m) => m.version <= 22), skipBackup: true });
    const db23 = database.openDatabase(path.join(dir, 'v23.sqlite'), { migrations: MIGRATIONS.filter((m) => m.version <= 23), skipBackup: true });
    try {
      const before = columns(db22);
      const after = columns(db23);
      expect(after.map((c) => c.name)).toEqual(before.map((c) => c.name));
      const differences = after.filter((col, index) => JSON.stringify(col) !== JSON.stringify(before[index]));
      expect(differences.map((c) => c.name)).toEqual(['language']);
      const was = before.find((c) => c.name === 'language');
      const now = after.find((c) => c.name === 'language');
      expect({ ...now, dflt_value: null }).toEqual({ ...was, dflt_value: null });
      expect(now.dflt_value).not.toBe(was.dflt_value);
      expect(now.dflt_value).toBe("'en'");
    } finally {
      db22.close();
      db23.close();
    }
  });

  test('os outros CHECKs seguem valendo: theme, inventory_view e price_refresh_last_status inválidos são rejeitados', () => {
    const db = database.openDatabase(path.join(dir, 'checks.sqlite'), { migrations: MIGRATIONS.filter((m) => m.version <= 23), skipBackup: true });
    try {
      for (const column of ['theme', 'inventory_view', 'price_refresh_last_status']) {
        expect(() => db.prepare(`UPDATE settings SET ${column} = 'X'`).run()).toThrow(/CHECK constraint failed/);
      }
      expect(() => db.prepare("UPDATE settings SET language = 'X'").run()).toThrow(/CHECK constraint failed/);
      expect(() => db.prepare("UPDATE settings SET theme = 'DARK', inventory_view = 'INDIVIDUAL', language = 'pt-BR'").run()).not.toThrow();
    } finally {
      db.close();
    }
  });
});
