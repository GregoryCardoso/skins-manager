const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data', 'inventory.sqlite');

function parsePositiveInt(name, raw, fallback) {
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text) || Number(text) <= 0) {
    throw new Error(`Variável de ambiente ${name} inválida: deve ser um inteiro maior que 0 (recebido "${raw}").`);
  }
  return Number(text);
}

function nonEmpty(value, fallback) {
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
}

function resolveDbPath(value) {
  if (value === ':memory:') return value;
  return path.resolve(path.join(__dirname, '..', '..'), value);
}

function loadEnv(source = process.env) {
  return Object.freeze({
    port: parsePositiveInt('PORT', source.PORT, 3001),
    dbPath: resolveDbPath(nonEmpty(source.DB_PATH, DEFAULT_DB_PATH)),
    corsOrigin: nonEmpty(source.CORS_ORIGIN, 'http://localhost:3000'),
    slowItemDays: parsePositiveInt('SLOW_ITEM_DAYS', source.SLOW_ITEM_DAYS, 21),
  });
}

module.exports = loadEnv();
