const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const env = require('./env');
const { MIGRATIONS } = require('./migrations');
const { runSeed } = require('./seed');
const { AUTO_BACKUP_KEEP } = require('./constants');

let instance = null;

function latestVersion(migrations) {
  return migrations.length ? migrations[migrations.length - 1].version : 0;
}

function assertSupportedVersion(db, migrations) {
  const current = db.pragma('user_version', { simple: true });
  if (current > latestVersion(migrations)) {
    throw new Error(
      `O banco de dados foi criado por uma versão mais nova do Skins Manager (v${current}; este app conhece até v${latestVersion(migrations)}). Atualize o app.`
    );
  }
  return current;
}

const MIGRATION_BACKUP_PREFIX = 'inventory-v';

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Retenção dos backups automáticos (D151): apaga os mais antigos do mesmo tipo, só os de nome conforme o padrão.
// Nunca lança: falha ao apagar (arquivo travado no Windows) vira aviso no console.
function pruneAutoBackups(dir, prefix, keep = AUTO_BACKUP_KEEP) {
  try {
    const { selectBackupsToDelete } = require('../services/backupService'); // lazy: backupService usa este módulo
    const entries = fs.readdirSync(dir).map((name) => {
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(path.join(dir, name)).mtimeMs;
      } catch (err) {
        // arquivo sumiu entre a listagem e o stat: segue sem data
      }
      return { name, mtimeMs };
    });
    for (const name of selectBackupsToDelete(entries, { prefix, keep })) {
      try {
        fs.rmSync(path.join(dir, name), { force: true });
      } catch (err) {
        console.error(`Não foi possível apagar o backup antigo ${name}: ${err && err.message ? err.message : err}`);
      }
    }
  } catch (err) {
    console.error(`Não foi possível limpar os backups antigos: ${err && err.message ? err.message : err}`);
  }
}

// Cópia consistente do banco antes de migrar (VACUUM INTO). Não roda dentro de transação.
function backupBeforeMigrating(db, dbPath, fromVersion, now) {
  const dir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/:/g, '-');
  const target = path.join(dir, `inventory-v${fromVersion}-${stamp}.sqlite`);
  db.exec(`VACUUM INTO ${sqlQuote(target)}`);
  pruneAutoBackups(dir, MIGRATION_BACKUP_PREFIX);
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
    runSeed(db, now);
  } catch (err) {
    // Libera o handle (no Windows ele trava o arquivo .sqlite) e propaga o erro original.
    db.close();
    throw err;
  }
  return db;
}

// `now` só vale quando a conexão é aberta (carimbo do backup de migração).
function getDb({ now = new Date() } = {}) {
  if (!instance) instance = openDatabase(env.dbPath, { now });
  return instance;
}

function getDbPath() {
  return env.dbPath;
}

function getLatestSchemaVersion() {
  return latestVersion(MIGRATIONS);
}

function getSchemaVersion() {
  return getDb().pragma('user_version', { simple: true });
}

// Cópia consistente e compacta do banco aberto (D150). O destino não pode existir.
function exportDatabaseTo(targetPath) {
  getDb().exec(`VACUUM INTO ${sqlQuote(targetPath)}`);
}

// Lê um arquivo SQLite sem tocar no banco do app (D151, passo 3). Lança se o arquivo não for um banco legível.
function inspectDatabaseFile(filePath) {
  const db = new Database(filePath);
  try {
    const quickCheck = db.pragma('quick_check', { simple: true });
    if (quickCheck !== 'ok') return { quickCheck: String(quickCheck) };
    return {
      quickCheck: 'ok',
      userVersion: db.pragma('user_version', { simple: true }),
      applicationId: db.pragma('application_id', { simple: true }),
      tables: db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
    };
  } finally {
    db.close();
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeWalFiles(dbPath) {
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

// Troca o arquivo do banco (D151, passo 6): fecha a conexão, apaga -wal/-shm e move `sourcePath` para o lugar.
// No Windows o rename pode falhar com EPERM/EBUSY (antivírus, indexador): tenta de novo e, por fim, copia.
// Não reabre o banco: quem chama usa getDb().
function replaceDatabaseFile(sourcePath, { retries = 3, retryDelayMs = 100 } = {}) {
  const dbPath = getDbPath();
  closeDb();
  removeWalFiles(dbPath);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      fs.renameSync(sourcePath, dbPath);
      return 'rename';
    } catch (err) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err && err.code)) throw err;
      if (attempt < retries) sleepSync(retryDelayMs);
    }
  }
  fs.copyFileSync(sourcePath, dbPath);
  fs.rmSync(sourcePath, { force: true });
  return 'copy';
}

// Restaura o banco a partir de uma cópia (D151, passo 7, falha). Sempre copia: o backup precisa continuar existindo.
function restoreDatabaseFile(backupPath) {
  const dbPath = getDbPath();
  closeDb();
  removeWalFiles(dbPath);
  fs.copyFileSync(backupPath, dbPath);
}

function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

module.exports = {
  getDb,
  closeDb,
  openDatabase,
  runMigrations,
  getDbPath,
  getLatestSchemaVersion,
  getSchemaVersion,
  exportDatabaseTo,
  inspectDatabaseFile,
  replaceDatabaseFile,
  restoreDatabaseFile,
  pruneAutoBackups,
  sqlQuote,
};
