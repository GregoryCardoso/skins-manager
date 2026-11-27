'use strict';

// 11.5 (D369): migração v026 (`catalog_item_names`). Copia os nomes pt-BR existentes sem alterar nenhuma linha; backup da v25 antes.
// Bancos temporários; nada no %APPDATA%.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../../src/config/database');
const { MIGRATIONS } = require('../../src/config/migrations');

const UP_TO_25 = MIGRATIONS.filter((m) => m.version <= 25);
const NOW = new Date('2026-11-25T12:00:00.000Z');
let tmpRoot;
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-mig-v26-')); });
afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporário */ }
});

function seedV25(dir) {
  const dbPath = path.join(tmpRoot, dir, 'inventory.sqlite');
  const db = openDatabase(dbPath, { migrations: UP_TO_25 });
  const insert = db.prepare(
    `INSERT INTO catalog_items (id, source, category, name, name_pt_br, name_key, search_text, updated_at)
     VALUES (?, 'SKINS', 'SKIN', ?, ?, ?, ?, 'u')`
  );
  insert.run('a', 'AK-47 | Redline', 'AK-47 | Linha Vermelha', 'ak-47 | redline', 'ak-47 | redline ak-47 | linha vermelha');
  insert.run('b', 'Glock-18 | Fade', null, 'glock-18 | fade', 'glock-18 | fade');
  insert.run('c', 'M4A4 | Howl', '   ', 'm4a4 | howl', 'm4a4 | howl');
  const before = db.prepare('SELECT * FROM catalog_items ORDER BY id').all();
  db.close();
  return { dbPath, before };
}

test('v26 cria catalog_item_names, copia só os nomes pt-BR preenchidos e não altera o catálogo', () => {
  const { dbPath, before } = seedV25('a');
  const db = openDatabase(dbPath, { now: NOW });
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(28);
    expect(db.prepare('SELECT catalog_id, language, name FROM catalog_item_names ORDER BY catalog_id').all()).toEqual([
      { catalog_id: 'a', language: 'pt-BR', name: 'AK-47 | Linha Vermelha' },
    ]);
    expect(db.prepare('SELECT * FROM catalog_items ORDER BY id').all()).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const table = db.prepare("SELECT strict FROM pragma_table_list WHERE name = 'catalog_item_names'").get();
    expect(table.strict).toBe(1);
  } finally {
    db.close();
  }
});

test('a tabela rejeita nome repetido por idioma, nome vazio e item inexistente; apagar o item apaga os nomes', () => {
  const { dbPath } = seedV25('b');
  const db = openDatabase(dbPath, { now: NOW });
  try {
    const ins = db.prepare('INSERT INTO catalog_item_names (catalog_id, language, name) VALUES (?, ?, ?)');
    expect(() => ins.run('a', 'pt-BR', 'repetido')).toThrow();
    expect(() => ins.run('b', 'es', '  ')).toThrow();
    expect(() => ins.run('nao-existe', 'es', 'x')).toThrow();
    ins.run('a', 'zh-CN', 'x-zh');
    db.prepare("DELETE FROM catalog_items WHERE id = 'a'").run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM catalog_item_names').get().n).toBe(0);
  } finally {
    db.close();
  }
});

test('faz o backup automático da v25 antes de migrar', () => {
  const { dbPath } = seedV25('c');
  openDatabase(dbPath, { now: NOW }).close();
  const dir = path.dirname(dbPath);
  const sub = path.join(dir, 'backups');
  const files = fs.readdirSync(dir).concat(fs.existsSync(sub) ? fs.readdirSync(sub) : []);
  expect(files.some((f) => /inventory-v25-/.test(f))).toBe(true);
});
