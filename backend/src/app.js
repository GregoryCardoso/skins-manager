const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');

// Fábrica do app; `now` é o relógio injetável usado pelos controllers (D51).
function createApp({ now = () => new Date() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.now = now;

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = createApp();
module.exports.createApp = createApp;
