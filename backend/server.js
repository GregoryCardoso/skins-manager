const path = require('path');
const fs = require('fs');

const HOST = '127.0.0.1'; // D135: só a própria máquina acessa o app.

function fatal(message) {
  console.error(message);
  process.exit(1);
}

let env;
let closeDb;
let app;
let lock = null;
try {
  env = require('./src/config/env');
  // Ordem (D172, D173): trava da pasta de dados, migração legada, banco, listen.
  if (env.dbPath !== ':memory:') {
    const { acquireLock } = require('./src/config/instanceLock');
    const { APP_VERSION } = require('./src/config/appInfo');
    lock = acquireLock(path.dirname(env.dbPath), {
      port: env.port,
      mode: process.env.SKINS_MANAGER_MODE === 'desktop' ? 'desktop' : 'browser',
      version: APP_VERSION,
    });
    process.on('exit', () => lock.release());
    require('./src/config/legacyDataMigration').runLegacyMigration({ dbPathIsDefault: env.dbPathIsDefault, dbPath: env.dbPath });
  }
  ({ closeDb } = require('./src/config/database'));
  const { getDb } = require('./src/config/database');
  app = require('./src/app');
  const { syncBundledCatalog } = require('./src/services/catalogService');
  getDb();
  // Importa o catálogo embutido (offline) se for mais novo que o gravado; nunca derruba o servidor (D81).
  syncBundledCatalog();
} catch (err) {
  // T45: mensagem em português, sem stack trace.
  if (lock) lock.release();
  fatal(`Não foi possível iniciar o Skins Manager: ${err && err.message ? err.message : err}`);
}

const hasUi = fs.existsSync(path.join(app.locals.staticDir, 'index.html'));

const server = app.listen(env.port, HOST, (err) => {
  // Express 5 passa o erro do listen para este callback; o handler 'error' abaixo cuida dele.
  if (err) return;
  if (hasUi) console.log(`Skins Manager rodando em http://localhost:${env.port}`);
  else console.log(`Skins Manager API rodando em http://localhost:${env.port}/api (interface não compilada)`);
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`A porta ${env.port} já está em uso. Feche a outra instância do Skins Manager ou altere PORT no backend/.env.`);
  } else {
    console.error(`Falha ao iniciar o servidor: ${err && err.message ? err.message : err}`);
  }
  closeDb();
  if (lock) lock.release();
  process.exit(1);
});

function shutdown() {
  server.close(() => {
    closeDb();
    if (lock) lock.release();
    process.exit(0);
  });
  setTimeout(() => {
    closeDb();
    if (lock) lock.release();
    process.exit(0);
  }, 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
