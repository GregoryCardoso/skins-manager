'use strict';

// Backup do banco (D150, D151): exportar, importar com validação e backup automático, e retenção.
const fs = require('fs');
const path = require('path');
const DatabaseFile = require('../models/DatabaseFile');
const { MIGRATIONS } = require('../config/migrations');
const { AUTO_BACKUP_KEEP, SQLITE_APPLICATION_ID } = require('../config/constants');
const { AppError, ValidationError, ConflictError } = require('../errors/AppError');
const catalogService = require('./catalogService');
const settingsService = require('./settingsService');
const Item = require('../models/Item');
const Store = require('../models/Store');

const SQLITE_SIGNATURE = Buffer.from('SQLite format 3\0', 'latin1');
const REQUIRED_TABLES = Object.freeze(['stores', 'items', 'settings', 'deposits', 'withdrawals', 'store_balances']);
const EXPORT_CONTENT_TYPE = 'application/vnd.sqlite3';
const IMPORT_BACKUP_PREFIX = 'inventory-before-import-v';
const MIGRATION_BACKUP_PREFIX = 'inventory-v';
// Carimbo de backupBeforeMigrating: ISO com ":" trocado por "-" (ex.: 2026-11-20T10-11-12.345Z).
const STAMP_PATTERN = '(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}(?:\\.\\d+)?Z)';

const pad = (n, size = 2) => String(n).padStart(size, '0');

// --- Funções puras ------------------------------------------------------------------------------

function backupStamp(now) {
  return now.toISOString().replace(/:/g, '-');
}

// Nome do arquivo exportado, com a data/hora local (D150): skins-manager-backup-v5-2026-11-20-1534.sqlite.
function buildExportFileName(schemaVersion, now) {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `skins-manager-backup-v${schemaVersion}-${date}-${time}.sqlite`;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Carimbo do nome se ele segue exatamente o padrão do tipo (`prefix` + versão + "-" + carimbo + ".sqlite"); senão null.
function parseBackupStamp(fileName, prefix) {
  const match = new RegExp(`^${escapeRegExp(prefix)}\\d+-${STAMP_PATTERN}\\.sqlite$`).exec(fileName);
  return match ? match[1] : null;
}

// Nomes a apagar: os mais antigos do tipo `prefix`, mantendo os `keep` mais novos (D151, retenção).
// `files`: nomes (string) ou { name, mtimeMs }. Ordena pelo carimbo no nome; empate pela data de modificação.
// Nome fora do padrão do tipo nunca entra na lista.
function selectBackupsToDelete(files, { prefix, keep = AUTO_BACKUP_KEEP } = {}) {
  const candidates = [];
  for (const file of files) {
    const name = typeof file === 'string' ? file : file.name;
    const mtimeMs = typeof file === 'string' ? 0 : file.mtimeMs || 0;
    const stamp = parseBackupStamp(name, prefix);
    if (stamp !== null) candidates.push({ name, stamp, mtimeMs });
  }
  const newestFirst = candidates.sort((a, b) => {
    if (a.stamp !== b.stamp) return a.stamp < b.stamp ? 1 : -1;
    if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
  });
  return newestFirst.slice(Math.max(0, keep)).map((c) => c.name);
}

// Avalia o arquivo inspecionado (D151, passo 4). `info`: { userVersion, applicationId, tables }.
// Devolve { accepted: true } ou { accepted: false, code, params? }.
function assessBackupFile(info, latestVersion) {
  const invalid = { accepted: false, code: 'BACKUP_INVALID_FILE' };
  const { userVersion, applicationId } = info;
  const tables = Array.isArray(info.tables) ? info.tables : [];
  if (applicationId !== 0 && applicationId !== SQLITE_APPLICATION_ID) return invalid;
  if (!Number.isInteger(userVersion) || userVersion <= 0) return invalid;
  if (userVersion > latestVersion) {
    return { accepted: false, code: 'BACKUP_NEWER_VERSION', params: { fileVersion: userVersion, appVersion: latestVersion } };
  }
  if (REQUIRED_TABLES.some((table) => !tables.includes(table))) return invalid;
  if (userVersion >= 4 && applicationId !== SQLITE_APPLICATION_ID) return invalid;
  return { accepted: true };
}

function hasSqliteSignature(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= SQLITE_SIGNATURE.length && buffer.subarray(0, SQLITE_SIGNATURE.length).equals(SQLITE_SIGNATURE);
}

// --- Travas de operações longas -----------------------------------------------------------------

// Operações que impedem a importação. Para incluir outra trava (ex.: cotação de outra fonte), acrescente aqui.
const BUSY_CHECKS = Object.freeze([
  () => catalogService.isCatalogRefreshInProgress(),
  () => settingsService.isPtaxRefreshInProgress(),
]);

function isBackupBusy() {
  return BUSY_CHECKS.some((check) => check());
}

// --- Infraestrutura de arquivos -----------------------------------------------------------------

function getDataDir() {
  return path.dirname(DatabaseFile.getDbPath());
}

function ensureFileDatabase() {
  if (DatabaseFile.getDbPath() === ':memory:') {
    throw new ConflictError('O backup não está disponível com o banco em memória.', 'BACKUP_UNAVAILABLE');
  }
}

function removeQuietly(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch (err) {
    console.error(`Não foi possível apagar o arquivo temporário ${path.basename(filePath)}: ${err && err.message ? err.message : err}`);
  }
}

function tempFilePath(prefix) {
  const dir = path.join(getDataDir(), 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sqlite`);
}

// --- Exportar (D150) ----------------------------------------------------------------------------

// Gera a cópia temporária. O chamador envia `filePath` e chama `cleanup()` ao fim (também se o cliente abortar).
function createExport({ now = new Date() } = {}) {
  ensureFileDatabase();
  const filePath = tempFilePath('export');
  try {
    DatabaseFile.exportTo(filePath);
  } catch (err) {
    removeQuietly(filePath);
    throw err;
  }
  return {
    filePath,
    fileName: buildExportFileName(DatabaseFile.getSchemaVersion(), now),
    contentType: EXPORT_CONTENT_TYPE,
    sizeBytes: fs.statSync(filePath).size,
    cleanup: () => removeQuietly(filePath),
  };
}

// --- Importar (D151) ----------------------------------------------------------------------------

function importFailed(detail) {
  return new AppError(
    500,
    'BACKUP_IMPORT_FAILED',
    `Não foi possível importar o backup (${detail}). Os dados anteriores foram preservados.`
  );
}

// Nome livre em `dir`: se já existe (mesmo carimbo), avança 1 ms até achar.
function uniqueBackupPath(dir, prefix, version, now) {
  let moment = now.getTime();
  for (;;) {
    const candidate = path.join(dir, `${prefix}${version}-${backupStamp(new Date(moment))}.sqlite`);
    if (!fs.existsSync(candidate)) return candidate;
    moment += 1;
  }
}

function inspectUploadedCopy(tempPath, latestVersion) {
  let info;
  try {
    info = DatabaseFile.inspectFile(tempPath);
  } catch (err) {
    throw new ValidationError('O arquivo está corrompido ou não é um banco de dados válido.', 'BACKUP_CORRUPTED');
  }
  if (info.quickCheck !== 'ok') {
    throw new ValidationError('O arquivo está corrompido (a verificação de integridade falhou).', 'BACKUP_CORRUPTED');
  }
  const verdict = assessBackupFile(info, latestVersion);
  if (!verdict.accepted) {
    const message =
      verdict.code === 'BACKUP_NEWER_VERSION'
        ? 'Este backup foi criado por uma versão mais nova do Skins Manager. Atualize o app.'
        : 'O arquivo não é um backup do Skins Manager.';
    throw new ValidationError(message, verdict.code, verdict.params ? { params: verdict.params } : undefined);
  }
  return info;
}

function importBackup(buffer, { now = new Date() } = {}) {
  ensureFileDatabase();
  // 1. Operação longa em andamento.
  if (isBackupBusy()) {
    throw new ConflictError('Há uma atualização em andamento (catálogo ou cotação). Aguarde terminar e tente de novo.', 'BACKUP_BUSY');
  }
  // 2. Assinatura SQLite.
  if (!hasSqliteSignature(buffer)) {
    throw new ValidationError('O arquivo não é um banco SQLite.', 'BACKUP_INVALID_FILE');
  }

  const latestVersion = DatabaseFile.getLatestSchemaVersion();
  const tempPath = tempFilePath('import');
  try {
    // 3 e 4. Cópia temporária, verificação de integridade e avaliação.
    fs.writeFileSync(tempPath, buffer);
    const info = inspectUploadedCopy(tempPath, latestVersion);

    // 5. Backup automático do banco atual (nada foi alterado até aqui).
    const backupsDir = path.join(getDataDir(), 'backups');
    const currentVersion = DatabaseFile.getSchemaVersion();
    let preImportPath;
    try {
      fs.mkdirSync(backupsDir, { recursive: true });
      preImportPath = uniqueBackupPath(backupsDir, IMPORT_BACKUP_PREFIX, currentVersion, now);
      DatabaseFile.exportTo(preImportPath);
    } catch (err) {
      console.error(`Falha ao criar o backup antes de importar: ${err && err.message ? err.message : err}`);
      throw importFailed('não foi possível salvar uma cópia dos dados atuais');
    }
    DatabaseFile.pruneAutoBackups(backupsDir, IMPORT_BACKUP_PREFIX);

    // 6 e 7. Troca o arquivo, reabre (migrações + seed) e sincroniza o catálogo embutido.
    let result;
    try {
      DatabaseFile.replaceFile(tempPath);
      DatabaseFile.open({ now });
      catalogService.syncBundledCatalog({ now });
      result = {
        fileVersion: info.userVersion,
        schemaVersion: DatabaseFile.getSchemaVersion(),
        migrationsApplied: MIGRATIONS.filter((m) => m.version > info.userVersion).map((m) => m.version),
        preImportBackupFile: path.basename(preImportPath),
        counts: { items: Item.countAll(), stores: Store.countAll() },
      };
    } catch (err) {
      console.error(`Falha ao importar o backup; restaurando os dados anteriores: ${err && err.message ? err.message : err}`);
      try {
        DatabaseFile.restoreFile(preImportPath);
        DatabaseFile.open({ now });
      } catch (restoreErr) {
        console.error(`Falha ao restaurar os dados anteriores: ${restoreErr && restoreErr.message ? restoreErr.message : restoreErr}`);
        throw new AppError(
          500,
          'BACKUP_IMPORT_FAILED',
          `Não foi possível importar o backup e a restauração automática falhou. Seus dados anteriores estão em backups/${path.basename(preImportPath)}.`
        );
      }
      throw importFailed('o arquivo não pôde ser aberto pelo app');
    }
    return result;
  } finally {
    // 8. O temporário some em todos os caminhos (depois do rename ele já não existe).
    removeQuietly(tempPath);
  }
}

module.exports = {
  EXPORT_CONTENT_TYPE,
  IMPORT_BACKUP_PREFIX,
  MIGRATION_BACKUP_PREFIX,
  buildExportFileName,
  selectBackupsToDelete,
  assessBackupFile,
  hasSqliteSignature,
  isBackupBusy,
  createExport,
  importBackup,
};
