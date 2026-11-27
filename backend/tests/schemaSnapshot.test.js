'use strict';

// S3 (12.10, parte 3): trava o esquema do banco. Aplica TODAS as migrações num banco temporário (em memória, nunca o real) e
// compara `sqlite_master` e `user_version` com o snapshot versionado. Também confere o sha256 de cada migração publicada:
// migração publicada nunca é editada (D69); mudança de esquema só entra por migração nova.
//
// Mudança INTENCIONAL (migração nova): regenerar o snapshot e registrar isso no commit.
//   PowerShell:  $env:UPDATE_SCHEMA_SNAPSHOT = '1'; npx jest tests/schemaSnapshot.test.js; Remove-Item Env:UPDATE_SCHEMA_SNAPSHOT
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { closeDb, getDb } = require('../src/config/database');
const { MIGRATIONS } = require('../src/config/migrations');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'config', 'migrations');
const SNAPSHOT_FILE = path.join(__dirname, 'fixtures', 'schema.snapshot.json');
const HINT = 'Se a mudança é intencional (migração nova), regenere o snapshot com UPDATE_SCHEMA_SNAPSHOT=1 e registre no commit. Migração publicada nunca é editada.';

// O fim de linha não pode mudar o hash (o Git do Windows converte LF/CRLF).
function sha256(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function migrationHashes() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^v\d{3}_.+\.js$/.test(name))
    .sort();
  return Object.fromEntries(files.map((name) => [name, sha256(path.join(MIGRATIONS_DIR, name))]));
}

function currentSchema() {
  closeDb();
  const db = getDb(); // DB_PATH=':memory:' (tests/setup.js): aplica todas as migrações do zero
  const objects = db
    .prepare("SELECT type, name, tbl_name AS tblName, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all()
    .map((row) => ({ ...row, sql: row.sql === null ? null : row.sql.replace(/\r\n/g, '\n') }));
  const userVersion = db.pragma('user_version', { simple: true });
  closeDb();
  return { userVersion, objects };
}

afterAll(() => closeDb());

if (process.env.UPDATE_SCHEMA_SNAPSHOT === '1') {
  test('regenera o snapshot do esquema', () => {
    const snapshot = { ...currentSchema(), migrations: migrationHashes() };
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
    expect(fs.existsSync(SNAPSHOT_FILE)).toBe(true);
  });
} else {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));

  describe('snapshot do esquema do banco', () => {
    test('user_version é o da última migração', () => {
      const schema = currentSchema();
      expect(schema.userVersion).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
      expect({ userVersion: schema.userVersion, hint: HINT }).toEqual({ userVersion: snapshot.userVersion, hint: HINT });
    });

    test('tabelas, colunas, índices, gatilhos e views iguais às do snapshot', () => {
      const schema = currentSchema();
      const byKey = (list) => Object.fromEntries(list.map((o) => [`${o.type}:${o.name}`, o]));
      const now = byKey(schema.objects);
      const saved = byKey(snapshot.objects);
      expect({ added: Object.keys(now).filter((k) => !saved[k]), removed: Object.keys(saved).filter((k) => !now[k]), hint: HINT }).toEqual({
        added: [],
        removed: [],
        hint: HINT,
      });
      for (const key of Object.keys(saved)) {
        expect({ key, sql: now[key].sql, table: now[key].tblName }).toEqual({ key, sql: saved[key].sql, table: saved[key].tblName });
      }
    });

    test('cada migração publicada tem o mesmo sha256 do snapshot (nenhuma foi editada)', () => {
      const hashes = migrationHashes();
      const edited = Object.keys(snapshot.migrations).filter((name) => hashes[name] !== undefined && hashes[name] !== snapshot.migrations[name]);
      const removed = Object.keys(snapshot.migrations).filter((name) => hashes[name] === undefined);
      const added = Object.keys(hashes).filter((name) => snapshot.migrations[name] === undefined);
      expect({ edited, removed, added, hint: HINT }).toEqual({ edited: [], removed: [], added: [], hint: HINT });
    });

    test('a lista de migrações cobre os arquivos, em ordem, sem pulos', () => {
      const files = Object.keys(migrationHashes());
      expect(MIGRATIONS).toHaveLength(files.length);
      MIGRATIONS.forEach((migration, index) => expect(migration.version).toBe(index + 1));
    });
  });
}
