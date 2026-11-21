'use strict';

// Retenção dos backups automáticos (D151): módulo puro, sem dependências, para que `config/database` e
// `services/backupService` o usem sem ciclo de importação (D64).
const AUTO_BACKUP_KEEP = 10;
const IMPORT_BACKUP_PREFIX = 'inventory-before-import-v';
const MIGRATION_BACKUP_PREFIX = 'inventory-v';
// Carimbo de backupBeforeMigrating: ISO com ":" trocado por "-" (ex.: 2026-11-20T10-11-12.345Z).
const STAMP_PATTERN = '(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}(?:\\.\\d+)?Z)';

function backupStamp(now) {
  return now.toISOString().replace(/:/g, '-');
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

module.exports = {
  AUTO_BACKUP_KEEP,
  IMPORT_BACKUP_PREFIX,
  MIGRATION_BACKUP_PREFIX,
  backupStamp,
  parseBackupStamp,
  selectBackupsToDelete,
};
