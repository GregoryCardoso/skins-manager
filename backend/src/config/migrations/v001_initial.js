'use strict';

// Migração 1: esquema inicial (Etapa 1). O SQL vive em config/schema.js e nunca é editado (D10, D69).
const { SCHEMA_SQL } = require('../schema');

module.exports = {
  version: 1,
  name: 'initial',
  up(db) {
    db.exec(SCHEMA_SQL);
  },
};
