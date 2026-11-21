const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const env = require('./env');
const { MIGRATIONS } = require('./migrations');
const { runSeed } = require('./seed');
const {
  AUTO_BACKUP_KEEP,
  MIGRATION_BACKUP_PREFIX,
  backupStamp,
  selectBackupsToDelete,
} = require('./backupRetention');

let instance = null;

function latestVersion(migrations) {
  return migrations.length ? migrations[migrations.length - 1].version : 0;
}

function assertSupportedVersion(db, migrations) {
  const current = db.pragma('user_version', { simple: true });
  if (current > latestVersion(migrations)) {
    const err = new Error(
      `O banco de dados foi criado por uma versão mais nova do Skins Manager (v${current}; este app conhece até v${latestVersion(migrations)}). Atualize o app.`
    );
    err.name = 'NewerDatabaseError'; // o server.js traduz para o código `fatal` do app desktop (D177)
    throw err;
  }
  return current;
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Retenção dos backups automáticos (D151): apaga os mais antigos do mesmo tipo, só os de nome conforme o padrão.
// Nunca lança: falha ao apagar (arquivo travado no Windows) vira aviso no console.
function pruneAutoBackups(dir, prefix, keep = AUTO_BACKUP_KEEP) {
  try {
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

// T79: apaga de `tmp/` os temporários de exportar/importar (export-*.sqlite, import-*.sqlite e seus -wal/-shm) com mais
// de `maxAgeMs` (1 h) que sobraram de um processo que caiu. Arquivos recentes ou fora do padrão ficam.
// Nunca lança: arquivo travado (Windows) só gera log.
const STALE_TMP_PATTERN = /^(export|import)-.+\.sqlite(-wal|-shm)?$/;
const STALE_TMP_MAX_AGE_MS = 60 * 60 * 1000;

function cleanStaleTempFiles(dbPath, now = new Date(), maxAgeMs = STALE_TMP_MAX_AGE_MS) {
  const dir = path.join(path.dirname(dbPath), 'tmp');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return 0; // pasta inexistente: nada a limpar
  }
  let removed = 0;
  for (const name of names) {
    if (!STALE_TMP_PATTERN.test(name)) continue;
    try {
      const filePath = path.join(dir, name);
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || now.getTime() - stat.mtimeMs <= maxAgeMs) continue;
      fs.rmSync(filePath, { force: true });
      removed += 1;
    } catch (err) {
      console.error(`Não foi possível apagar o temporário antigo ${name}: ${err && err.message ? err.message : err}`);
    }
  }
  return removed;
}

// Cópia consistente do banco antes de migrar (VACUUM INTO). Não roda dentro de transação.
function backupBeforeMigrating(db, dbPath, fromVersion, now) {
  const dir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  // O nome pode colidir com o backup de importação do mesmo instante (mesmo carimbo): avança 1 ms até achar um livre.
  let moment = now.getTime();
  let target = path.join(dir, `${MIGRATION_BACKUP_PREFIX}${fromVersion}-${backupStamp(new Date(moment))}.sqlite`);
  while (fs.existsSync(target)) {
    moment += 1;
    target = path.join(dir, `${MIGRATION_BACKUP_PREFIX}${fromVersion}-${backupStamp(new Date(moment))}.sqlite`);
  }
  db.exec(`VACUUM INTO ${sqlQuote(target)}`);
  pruneAutoBackups(dir, MIGRATION_BACKUP_PREFIX);
  return target;
}

// Aplica as migrações pendentes, cada uma na sua transação (D69).
function runMigrations(db, migrations = MIGRATIONS, { dbPath = ':memory:', now = new Date(), skipBackup = false } = {}) {
  const current = assertSupportedVersion(db, migrations);
  const pending = migrations.filter((m) => m.version > current);
  if (pending.length === 0) return { from: current, to: current, applied: [], backupPath: null };

  let backupPath = null;
  if (!skipBackup && dbPath !== ':memory:' && current >= 1) backupPath = backupBeforeMigrating(db, dbPath, current, now);

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

function openDatabase(dbPath, { migrations = MIGRATIONS, now = new Date(), skipMigrationBackup = false } = {}) {
  const inMemory = dbPath === ':memory:';
  if (!inMemory) fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');
    // Recusa banco de versão futura antes de qualquer escrita (inclusive a troca para WAL).
    assertSupportedVersion(db, migrations);
    if (!inMemory) db.pragma('journal_mode = WAL');

    runMigrations(db, migrations, { dbPath, now, skipBackup: skipMigrationBackup });
    runSeed(db, now);
    if (!inMemory) cleanStaleTempFiles(dbPath, now);
  } catch (err) {
    // Libera o handle (no Windows ele trava o arquivo .sqlite) e propaga o erro original.
    db.close();
    throw err;
  }
  return db;
}

// `now` só vale quando a conexão é aberta (carimbo do backup de migração).
// `skipMigrationBackup` evita o backup `inventory-v*` de migração (usado na importação, que já tem os seus).
function getDb({ now = new Date(), skipMigrationBackup = false } = {}) {
  if (!instance) instance = openDatabase(env.dbPath, { now, skipMigrationBackup });
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

// Colunas de cada tabela: { tabela: [colunas] } (pragma_table_info).
function readColumns(db) {
  const columns = {};
  const stmt = db.prepare('SELECT name FROM pragma_table_info(?)');
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
    columns[name] = stmt.all(name).map((row) => row.name);
  }
  return columns;
}

// Lê um arquivo SQLite sem tocar no banco do app (D151, passo 3). Lança se o arquivo não for um banco legível.
function inspectDatabaseFile(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const quickCheck = db.pragma('quick_check', { simple: true });
    if (quickCheck !== 'ok') return { quickCheck: String(quickCheck) };
    return {
      quickCheck: 'ok',
      userVersion: db.pragma('user_version', { simple: true }),
      applicationId: db.pragma('application_id', { simple: true }),
      tables: db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
      columns: readColumns(db),
    };
  } finally {
    db.close();
    // Um arquivo em modo WAL pode deixar -wal/-shm ao lado do temporário; removê-los não afeta o arquivo principal.
    removeWalFiles(filePath);
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
  cleanStaleTempFiles,
  sqlQuote,
};
