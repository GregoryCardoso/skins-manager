const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const env = require('./env');
const { MIGRATIONS } = require('./migrations');
const { runSeed } = require('./seed');

let instance = null;

function latestVersion(migrations) {
  return migrations.length ? migrations[migrations.length - 1].version : 0;
}

function assertSupportedVersion(db, migrations) {
  const current = db.pragma('user_version', { simple: true });
  if (current > latestVersion(migrations)) {
    throw new Error('Este banco foi criado por uma versão mais nova do Skins Manager. Atualize o app.');
  }
  return current;
}

// Cópia consistente do banco antes de migrar (VACUUM INTO). Não roda dentro de transação.
function backupBeforeMigrating(db, dbPath, fromVersion, now) {
  const dir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/:/g, '-');
  const target = path.join(dir, `inventory-v${fromVersion}-${stamp}.sqlite`);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

// Aplica as migrações pendentes, cada uma na sua transação (D69).
function runMigrations(db, migrations = MIGRATIONS, { dbPath = ':memory:', now = new Date() } = {}) {
  const current = assertSupportedVersion(db, migrations);
  const pending = migrations.filter((m) => m.version > current);
  if (pending.length === 0) return { from: current, to: current, applied: [], backupPath: null };

  let backupPath = null;
  if (dbPath !== ':memory:' && current >= 1) backupPath = backupBeforeMigrating(db, dbPath, current, now);

  const applied = [];
  for (const migration of pending) {
    // Reconstrução de tabela exige foreign_keys = OFF fora da transação (procedimento oficial do SQLite).
    const needsFkOff = migration.disableForeignKeys === true;
    if (needsFkOff) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        migration.up(db);
        if (needsFkOff) {
          const violations = db.pragma('foreign_key_check');
          if (violations.length > 0) throw new Error(`A migração ${migration.version} violou chaves estrangeiras.`);
        }
        db.pragma(`user_version = ${migration.version}`);
      })();
    } finally {
      if (needsFkOff) db.pragma('foreign_keys = ON');
    }
    applied.push(migration.version);
  }
  return { from: current, to: latestVersion(pending), applied, backupPath };
}

function openDatabase(dbPath, { migrations = MIGRATIONS, now = new Date() } = {}) {
  const inMemory = dbPath === ':memory:';
  if (!inMemory) fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');
    // Recusa banco de versão futura antes de qualquer escrita (inclusive a troca para WAL).
    assertSupportedVersion(db, migrations);
    if (!inMemory) db.pragma('journal_mode = WAL');

    runMigrations(db, migrations, { dbPath, now });
    runSeed(db);
  } catch (err) {
    // Libera o handle (no Windows ele trava o arquivo .sqlite) e propaga o erro original.
    db.close();
    throw err;
  }
  return db;
}

function getDb() {
  if (!instance) instance = openDatabase(env.dbPath);
  return instance;
}

function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

module.exports = { getDb, closeDb, openDatabase, runMigrations };
