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

const MIN_SLOW_ITEM_DAYS = 8;

function parseSlowItemDays(raw) {
  const text = raw === undefined ? '' : String(raw).trim();
  if (text === '') return 21;
  if (!/^\d+$/.test(text) || Number(text) < MIN_SLOW_ITEM_DAYS) {
    throw new Error(
      `Variável de ambiente SLOW_ITEM_DAYS inválida: deve ser um inteiro maior ou igual a ${MIN_SLOW_ITEM_DAYS} (recebido "${raw}").`
    );
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
    slowItemDays: parseSlowItemDays(source.SLOW_ITEM_DAYS),
  });
}

module.exports = loadEnv();
