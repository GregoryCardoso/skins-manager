'use strict';

// Migração única de backend/data para a pasta de dados nova (D172). O original nunca é apagado nem alterado.
const fs = require('fs');
const path = require('path');

const LEGACY_DATA_DIR = path.join(__dirname, '..', '..', 'data');
const NOTE_FILE_NAME = 'LEIA-ME-DADOS-MOVIDOS.txt';

// Pura. Devolve { action: 'migrate' | 'skip', reason }.
function planLegacyMigration({ dbPathIsDefault, newDbExists, legacyDbExists }) {
  if (!dbPathIsDefault) return { action: 'skip', reason: 'custom-db-path' };
  if (!legacyDbExists) return { action: 'skip', reason: 'no-legacy' };
  if (newDbExists) return { action: 'skip', reason: 'new-exists' };
  return { action: 'migrate', reason: 'first-run' };
}

function removeQuietly(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch (err) {
    // melhor esforço
  }
}

// Copia o banco legado (VACUUM INTO, consistente com -wal) e os backups. Lança Error em português se falhar,
// depois de apagar o destino parcial.
function copyLegacyData({ legacyDir, newDbPath, Database }) {
  const legacyDb = path.join(legacyDir, 'inventory.sqlite');
  const newDir = path.dirname(newDbPath);
  fs.mkdirSync(newDir, { recursive: true });
  let src;
  try {
    src = new Database(legacyDb, { readonly: true, fileMustExist: true });
    const check = src.pragma('quick_check', { simple: true });
    if (check !== 'ok') throw new Error('a verificação de integridade do banco antigo falhou');
    src.prepare('VACUUM INTO ?').run(newDbPath);
  } catch (err) {
    if (src && src.open) src.close();
    src = null;
    removeQuietly(newDbPath);
    throw new Error(
      `Não foi possível copiar seus dados de ${legacyDir} para ${newDir}: ${err && err.message ? err.message : err}. ` +
        'Seus dados originais continuam intactos.'
    );
  }
  src.close();

  // Backups antigos (sem sobrescrever); falha aqui não é fatal.
  const legacyBackups = path.join(legacyDir, 'backups');
  try {
    if (fs.existsSync(legacyBackups)) {
      const target = path.join(newDir, 'backups');
      fs.mkdirSync(target, { recursive: true });
      for (const name of fs.readdirSync(legacyBackups)) {
        if (!name.toLowerCase().endsWith('.sqlite')) continue;
        const dest = path.join(target, name);
        if (!fs.existsSync(dest)) fs.copyFileSync(path.join(legacyBackups, name), dest);
      }
    }
  } catch (err) {
    console.error(`Aviso: não foi possível copiar os backups antigos: ${err && err.message ? err.message : err}`);
  }

  try {
    fs.writeFileSync(
      path.join(legacyDir, NOTE_FILE_NAME),
      `Seus dados do Skins Manager agora ficam em:\r\n${newDir}\r\n\r\n` +
        'Esta pasta foi mantida como estava (nada foi apagado), mas o app não a usa mais.\r\n'
    );
  } catch (err) {
    // a nota é só informativa
  }
}

// Decide e executa. Devolve o plano. `Database` é o better-sqlite3 (injetável).
function runLegacyMigration({
  dbPathIsDefault,
  dbPath,
  legacyDir = LEGACY_DATA_DIR,
  Database = require('better-sqlite3'),
  log = console.log,
} = {}) {
  const legacyDbExists = fs.existsSync(path.join(legacyDir, 'inventory.sqlite'));
  const newDbExists = dbPath !== ':memory:' && fs.existsSync(dbPath);
  const plan = planLegacyMigration({ dbPathIsDefault, newDbExists, legacyDbExists });
  if (plan.action === 'migrate') {
    log(`Copiando seus dados de ${legacyDir} para ${path.dirname(dbPath)} (o original será mantido)...`);
    copyLegacyData({ legacyDir, newDbPath: dbPath, Database });
    log('Dados copiados com sucesso.');
  } else if (plan.reason === 'new-exists' && !fs.existsSync(path.join(legacyDir, NOTE_FILE_NAME))) {
    log(`Os dados antigos em ${legacyDir} foram ignorados: já existe um banco em ${dbPath}.`);
  }
  return plan;
}

module.exports = { planLegacyMigration, runLegacyMigration, copyLegacyData, LEGACY_DATA_DIR, NOTE_FILE_NAME };
