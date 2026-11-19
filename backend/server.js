const env = require('./src/config/env');
const { getDb, closeDb } = require('./src/config/database');
const app = require('./src/app');

getDb();

const server = app.listen(env.port, (err) => {
  // Express 5 passa o erro do listen para este callback; o handler 'error' abaixo cuida dele.
  if (err) return;
  console.log(`Skins Manager API rodando em http://localhost:${env.port}`);
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`A porta ${env.port} já está em uso. Feche a outra instância do Skins Manager ou altere PORT no backend/.env.`);
  } else {
    console.error(`Falha ao iniciar o servidor: ${err && err.message ? err.message : err}`);
  }
  closeDb();
  process.exit(1);
});

function shutdown() {
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => {
    closeDb();
    process.exit(0);
  }, 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
