const path = require('path');
const fs = require('fs');

const HOST = '127.0.0.1'; // D135: só a própria máquina acessa o app.

// Modo desktop (D177): o Electron sobe este arquivo com utilityProcess.fork, e `process.parentPort` existe.
// Fora dele (start-app.bat, npm start, testes) nada muda: sem mensagens, saída direta.
const parentPort = process.parentPort || null;

function notifyParent(message) {
  if (!parentPort) return;
  try {
    parentPort.postMessage(message);
  } catch (err) {
    // sem canal com o pai: o código de saída e o log já dizem o que houve
  }
}

function fatal(message, code = 'STARTUP_FAILED') {
  console.error(message);
  notifyParent({ type: 'fatal', code, message });
  // Dá tempo de a mensagem chegar ao processo principal antes de sair.
  if (parentPort) setTimeout(() => process.exit(1), 300);
  else process.exit(1);
}

// Código enviado ao Electron na mensagem `fatal` (D177).
function startupErrorCode(err) {
  if (err && err.name === 'NewerDatabaseError') return 'DB_NEWER_VERSION';
  return err && typeof err.code === 'string' ? err.code : 'STARTUP_FAILED';
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
    try {
      require('./src/config/legacyDataMigration').runLegacyMigration({ dbPathIsDefault: env.dbPathIsDefault, dbPath: env.dbPath });
    } catch (err) {
      if (err && typeof err === 'object' && !err.code) err.code = 'LEGACY_MIGRATION_FAILED';
      throw err;
    }
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
  fatal(
    `Não foi possível iniciar o Skins Manager: ${err && err.message ? err.message : err}`,
    startupErrorCode(err)
  );
}

let server = null;
if (app) startServer();

function startServer() {
  const hasUi = fs.existsSync(path.join(app.locals.staticDir, 'index.html'));

  server = app.listen(env.port, HOST, (err) => {
    // Express 5 passa o erro do listen para este callback; o handler 'error' abaixo cuida dele.
    if (err) return;
    if (hasUi) console.log(`Skins Manager rodando em http://localhost:${env.port}`);
    else console.log(`Skins Manager API rodando em http://localhost:${env.port}/api (interface não compilada)`);
    notifyParent({ type: 'ready', port: env.port, version: require('./src/config/appInfo').APP_VERSION });
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`A porta ${env.port} já está em uso. Feche a outra instância do Skins Manager ou altere PORT no backend/.env.`);
    } else {
      console.error(`Falha ao iniciar o servidor: ${err && err.message ? err.message : err}`);
    }
    closeDb();
    if (lock) lock.release();
    const code = err && err.code === 'EADDRINUSE' ? 'PORT_IN_USE' : 'STARTUP_FAILED';
    notifyParent({ type: 'fatal', code, message: err && err.code === 'EADDRINUSE' ? `A porta ${env.port} já está em uso.` : String((err && err.message) || err) });
    if (parentPort) setTimeout(() => process.exit(1), 300);
    else process.exit(1);
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
  // No Windows não há SIGTERM entre processos: o Electron pede o encerramento por mensagem (D177).
  if (parentPort) {
    parentPort.on('message', (event) => {
      const data = event && event.data;
      if (data && data.type === 'shutdown') shutdown();
    });
  }
}
