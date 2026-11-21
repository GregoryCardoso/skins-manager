// Preload (node -r) usado por tests/server.dataDir.test.js. Não é arquivo de teste.
// Redireciona a pasta "legada" da migração para SM_TEST_LEGACY_DIR (nunca o backend/data real) e registra
// na stdout a ordem de inicialização: no momento da migração, a trava já existe? o banco novo ainda não?
const fs = require('fs');
const path = require('path');

const legacyModule = require(path.resolve(__dirname, '..', '..', 'src', 'config', 'legacyDataMigration.js'));
const original = legacyModule.runLegacyMigration;
const redirected = process.env.SM_TEST_LEGACY_DIR;
if (!redirected) {
  process.stderr.write('[helper] SM_TEST_LEGACY_DIR ausente: recusando subir para não tocar backend/data real\n');
  process.exit(97);
}

legacyModule.runLegacyMigration = function wrapped(opts) {
  const dir = path.dirname(opts.dbPath);
  const lock = fs.existsSync(path.join(dir, 'skins-manager.lock'));
  const db = fs.existsSync(opts.dbPath);
  process.stdout.write(`[order] migration lock=${lock} dbExists=${db}\n`);
  return original({ ...opts, legacyDir: redirected, log: () => {} });
};

const dbModule = require(path.resolve(__dirname, '..', '..', 'src', 'config', 'database.js'));
const originalGetDb = dbModule.getDb;
let announced = false;
dbModule.getDb = function spiedGetDb() {
  if (!announced) {
    announced = true;
    process.stdout.write('[order] getDb\n');
  }
  return originalGetDb.apply(this, arguments);
};
