'use strict';

// Backup do banco (D150, D151): exportar, importar com validação e backup automático, e retenção.
const fs = require('fs');
const path = require('path');
const DatabaseFile = require('../models/DatabaseFile');
const { MIGRATIONS } = require('../config/migrations');
const { SQLITE_APPLICATION_ID } = require('../config/constants');
const {
  IMPORT_BACKUP_PREFIX,
  MIGRATION_BACKUP_PREFIX,
  backupStamp,
  selectBackupsToDelete,
} = require('../config/backupRetention');
const { AUTO_BACKUP_KEEP } = require('../config/backupRetention');
const { AppError, ValidationError, ConflictError } = require('../errors/AppError');
const folderOpener = require('./system/folderOpener');
const catalogService = require('./catalogService');
const integrationService = require('./integrationService');
const settingsService = require('./settingsService');
const importLock = require('./imports/importLock');
const valuationLock = require('./valuation/valuationLock');
const Item = require('../models/Item');
const Store = require('../models/Store');

const SQLITE_SIGNATURE = Buffer.from('SQLite format 3\0', 'latin1');
const REQUIRED_TABLES = Object.freeze(['stores', 'items', 'settings', 'deposits', 'withdrawals', 'store_balances']);
// Colunas mínimas por tabela, só da v1 (existem em todas as versões: as migrações posteriores só acrescentam).
const REQUIRED_COLUMNS = Object.freeze({
  stores: ['id', 'name', 'currency', 'is_active', 'is_primary', 'created_at', 'updated_at'],
  items: ['id', 'name', 'category', 'acquisition_type', 'purchase_price_cents', 'purchase_currency', 'acquired_at', 'status', 'created_at', 'updated_at'],
  settings: ['id', 'usd_brl_rate', 'updated_at'],
  deposits: ['id', 'amount_brl_cents', 'deposited_at'],
  withdrawals: ['id', 'amount_brl_cents', 'withdrawn_at'],
  store_balances: ['id', 'store_id', 'balance_cents', 'recorded_at'],
});
const EXPORT_CONTENT_TYPE = 'application/vnd.sqlite3';
const pad = (n, size = 2) => String(n).padStart(size, '0');

// --- Funções puras ------------------------------------------------------------------------------

// Nome do arquivo exportado, com a data/hora local (D150): skins-manager-backup-v5-2026-11-20-1534.sqlite.
function buildExportFileName(schemaVersion, now) {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `skins-manager-backup-v${schemaVersion}-${date}-${time}.sqlite`;
}

// Avalia o arquivo inspecionado (D151, passo 4). `info`: { userVersion, applicationId, tables, columns }.
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
  const columns = info.columns && typeof info.columns === 'object' ? info.columns : {};
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const present = Array.isArray(columns[table]) ? columns[table] : [];
    if (required.some((column) => !present.includes(column))) return invalid;
  }
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
  () => settingsService.isFxRefreshInProgress(),
  () => importLock.isImportInProgress(), // importação do CSFloat (D303, D318)
  () => valuationLock.isValuationInProgress(), // atualização de preços (D364)
]);

function isBackupBusy() {
  return exportInProgress || BUSY_CHECKS.some((check) => check());
}

// O que impede a importação do CSFloat (revisão da Etapa 9): só a exportação do backup, que é assíncrona (a restauração é
// síncrona e não intercala). A cotação e o catálogo gravam outras tabelas e não bloqueiam a importação: antes, a cotação
// buscada ao abrir o app (D338) fazia a importação automática ser pulada em silêncio.
function isExportInProgress() {
  return exportInProgress;
}

// Uma exportação por vez (e nenhuma importação durante ela). Liberada em `cleanup` (fim, erro ou aborto).
let exportInProgress = false;

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
  if (exportInProgress) {
    throw new ConflictError('Já existe uma exportação em andamento. Aguarde terminar e tente de novo.', 'BACKUP_BUSY');
  }
  exportInProgress = true;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      exportInProgress = false;
    }
  };
  let filePath;
  try {
    filePath = tempFilePath('export');
    DatabaseFile.exportTo(filePath);
    return {
      filePath,
      fileName: buildExportFileName(DatabaseFile.getSchemaVersion(), now),
      contentType: EXPORT_CONTENT_TYPE,
      sizeBytes: fs.statSync(filePath).size,
      cleanup: () => {
        try {
          removeQuietly(filePath);
        } finally {
          release();
        }
      },
    };
  } catch (err) {
    if (filePath) removeQuietly(filePath);
    release();
    throw err;
  }
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
    throw new ConflictError('Há uma operação em andamento (catálogo, cotação, importação do CSFloat ou exportação). Aguarde terminar e tente de novo.', 'BACKUP_BUSY');
  }
  // 2. Assinatura SQLite.
  if (!hasSqliteSignature(buffer)) {
    throw new ValidationError('O arquivo não é um banco SQLite.', 'BACKUP_INVALID_FILE');
  }

  const latestVersion = DatabaseFile.getLatestSchemaVersion();
  const tempPath = tempFilePath('import');
  let secrets = null; // chave(s) atual(is) da API, só em memória durante a importação (D290)
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

    // 6 e 7. Troca o arquivo, reabre (migrações + seed), sincroniza o catálogo embutido e regrava a chave da API atual (D290):
    // a chave nunca entra por backup; qualquer chave do arquivo importado é sobrescrita.
    let result;
    secrets = integrationService.captureSecrets();
    try {
      DatabaseFile.replaceFile(tempPath);
      DatabaseFile.open({ now, skipMigrationBackup: true });
      catalogService.syncBundledCatalog({ now });
      integrationService.restoreSecrets(secrets, { now });
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
        DatabaseFile.open({ now, skipMigrationBackup: true });
        integrationService.restoreSecrets(secrets, { now }); // o backup automático está sem a chave
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
    // 8. O temporário some em todos os caminhos (depois do rename ele já não existe); a chave some da memória.
    secrets = null;
    removeQuietly(tempPath);
  }
}

// --- Pasta de backups (D175) ----------------------------------------------------------------------

function backupsDirPath() {
  return path.join(getDataDir(), 'backups');
}

function getBackupInfo({ canOpenFn = folderOpener.canOpenFolder } = {}) {
  ensureFileDatabase();
  return {
    dataDir: getDataDir(),
    backupsDir: backupsDirPath(),
    autoBackupKeep: AUTO_BACKUP_KEEP,
    canOpenFolder: Boolean(canOpenFn()),
  };
}

// Abre a pasta de backups (criando-a se preciso). `openFolderFn(dir)` é injetável (Promise).
async function openBackupsFolder({ openFolderFn = folderOpener.openFolder, canOpenFn = folderOpener.canOpenFolder } = {}) {
  ensureFileDatabase();
  if (!canOpenFn()) {
    throw new ConflictError('Abrir a pasta só é possível no Windows. Copie o caminho e abra manualmente.', 'FOLDER_OPEN_UNSUPPORTED');
  }
  const dir = backupsDirPath();
  try {
    fs.mkdirSync(dir, { recursive: true });
    await openFolderFn(dir);
  } catch (err) {
    console.error(`Falha ao abrir a pasta de backups: ${err && err.message ? err.message : err}`);
    throw new AppError(500, 'FOLDER_OPEN_FAILED', 'Não foi possível abrir a pasta de backups. Copie o caminho e abra manualmente.');
  }
  return { path: dir };
}

module.exports = {
  getBackupInfo,
  openBackupsFolder,
  EXPORT_CONTENT_TYPE,
  IMPORT_BACKUP_PREFIX,
  MIGRATION_BACKUP_PREFIX,
  buildExportFileName,
  selectBackupsToDelete,
  assessBackupFile,
  REQUIRED_COLUMNS,
  hasSqliteSignature,
  isBackupBusy,
  isExportInProgress,
  createExport,
  importBackup,
};
