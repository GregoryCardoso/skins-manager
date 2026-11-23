// Acesso ao arquivo e à conexão do banco para o backup (D150, D151). Só infraestrutura, sem regra de negócio:
// existe para que services/ nunca importem config/database diretamente (D64).
const database = require('../config/database');

module.exports = {
  getDbPath: () => database.getDbPath(),
  getSchemaVersion: () => database.getSchemaVersion(),
  getLatestSchemaVersion: () => database.getLatestSchemaVersion(),
  exportTo: (targetPath, options) => database.exportDatabaseTo(targetPath, options),
  inspectFile: (filePath) => database.inspectDatabaseFile(filePath),
  replaceFile: (sourcePath) => database.replaceDatabaseFile(sourcePath),
  restoreFile: (backupPath) => database.restoreDatabaseFile(backupPath),
  open: (options) => database.getDb(options),
  pruneAutoBackups: (dir, prefix) => database.pruneAutoBackups(dir, prefix),
};
