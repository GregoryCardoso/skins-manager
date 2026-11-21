const path = require('path');
const dotenv = require('dotenv');
const { MIN_SLOW_ITEM_DAYS, MAX_SLOW_ITEM_DAYS } = require('./constants');
const { resolveDefaultDataDir } = require('./paths');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

function parsePort(raw, fallback) {
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 65535) {
    throw new Error(`Variável de ambiente PORT inválida: deve ser um inteiro entre 1 e 65535 (recebido "${raw}").`);
  }
  return Number(text);
}

function parseSlowItemDays(raw) {
  const text = raw === undefined ? '' : String(raw).trim();
  if (text === '') return 21;
  if (!/^\d+$/.test(text) || Number(text) < MIN_SLOW_ITEM_DAYS || Number(text) > MAX_SLOW_ITEM_DAYS) {
    throw new Error(
      `Variável de ambiente SLOW_ITEM_DAYS inválida: deve ser um inteiro de ${MIN_SLOW_ITEM_DAYS} a ${MAX_SLOW_ITEM_DAYS} (recebido "${raw}").`
    );
  }
  return Number(text);
}

function nonEmpty(value, fallback) {
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
}

const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

// CORS_ORIGIN aceita uma lista separada por vírgula; vazio/ausente usa as duas origens locais do frontend (D100).
function parseCorsOrigins(raw) {
  const list = nonEmpty(raw, '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin !== '');
  return list.length > 0 ? list : [...DEFAULT_CORS_ORIGINS];
}

function resolveDbPath(value) {
  if (value === ':memory:') return value;
  return path.resolve(path.join(__dirname, '..', '..'), value);
}

// DB_PATH vazio = <pasta de dados>\inventory.sqlite (D171): %APPDATA%\SkinsManager no Windows.
function loadEnv(source = process.env) {
  const explicitDbPath = nonEmpty(source.DB_PATH, '');
  const dbPathIsDefault = explicitDbPath === '';
  return Object.freeze({
    port: parsePort(source.PORT, 3001),
    dbPath: dbPathIsDefault
      ? path.join(resolveDefaultDataDir({ env: source }), 'inventory.sqlite')
      : resolveDbPath(explicitDbPath),
    dbPathIsDefault,
    corsOrigin: Object.freeze(parseCorsOrigins(source.CORS_ORIGIN)),
    slowItemDays: parseSlowItemDays(source.SLOW_ITEM_DAYS),
  });
}

module.exports = loadEnv();
