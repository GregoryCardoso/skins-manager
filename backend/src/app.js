const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');

// Fábrica do app; `now` é o relógio injetável usado pelos controllers (D51) e `fetchFn` a rede injetável
// (D70; `undefined` = fetch global do Node).
function createApp({ now = () => new Date(), fetchFn, catalogValidation } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.now = now;
  app.locals.fetchFn = fetchFn;
  app.locals.catalogValidation = catalogValidation; // `undefined` = padrão do service (T36)

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = createApp();
module.exports.createApp = createApp;
