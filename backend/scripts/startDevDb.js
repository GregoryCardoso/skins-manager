'use strict';

// Sobe o backend apontando para o banco de exemplo (D108). O banco real não é aberto.
const fs = require('fs');
const devDb = require('./devDb');

const target = devDb.resolveSeedTarget({ argv: [] }); // recusa se o banco de exemplo coincidir com o real
if (!fs.existsSync(target)) {
  console.error('O banco de exemplo ainda não existe. Rode primeiro: npm run seed:dev');
  process.exit(1);
}
process.env.DB_PATH = target; // antes de carregar server.js (dotenv não sobrescreve)
console.log(`Modo demonstração: usando o banco de exemplo ${target}`);
require('../server');
