const path = require('path');
const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const routes = require('./routes');
const { hostGuard } = require('./middlewares/hostGuard');
const { createStaticFrontend } = require('./middlewares/staticFrontend');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');

// Fábrica do app; `now` é o relógio injetável usado pelos controllers (D51) e `fetchFn` a rede injetável
// (D70; `undefined` = fetch global do Node). `staticDir` é a pasta do frontend exportado (D134).
const DEFAULT_STATIC_DIR = path.join(__dirname, '..', '..', 'frontend', 'out');

function createApp({ now = () => new Date(), fetchFn, catalogValidation, staticDir = DEFAULT_STATIC_DIR, backupMaxBytes, openFolderFn, canOpenFolderFn } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.now = now;
  app.locals.fetchFn = fetchFn;
  app.locals.staticDir = staticDir;
  app.locals.backupMaxBytes = backupMaxBytes; // `undefined` = BACKUP_MAX_BYTES (D151)
  app.locals.openFolderFn = openFolderFn; // `undefined` = Explorer real (D175)
  app.locals.canOpenFolderFn = canOpenFolderFn; // `undefined` = só no Windows
  app.locals.catalogValidation = catalogValidation; // `undefined` = padrão do service (T36)

  app.use(hostGuard); // antes de tudo: DNS rebinding (inclui /api/health)
  app.use(cors({ origin: env.corsOrigin, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json());

  app.use('/api', routes);
  app.use(createStaticFrontend({ dir: staticDir }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = createApp();
module.exports.createApp = createApp;
