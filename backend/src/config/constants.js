// Constantes compartilhadas entre config e services (T14). Arquivo sem dependências além de `path`.
const path = require('path');

const MIN_SLOW_ITEM_DAYS = 8;
// Teto de qualquer valor em centavos recebido pela API (R$/US$ 100 milhões).
const MAX_AMOUNT_CENTS = 1e10;
// Limites de texto (após trim).
const MAX_NAME_LENGTH = 200;
const MAX_ORIGIN_DETAIL_LENGTH = 200;
const MAX_NOTE_LENGTH = 500; // note de deposits/withdrawals (Etapa 7); sem validador nesta etapa

// Catálogo de itens (D70, D80, D81).
// Adendo D80: o GitHub Pages antigo (bymykel.github.io) redireciona para um 404; a API hospedada vive no raw do GitHub.
const CATALOG_BASE_URL = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/';
const CATALOG_LANGUAGES = Object.freeze(['en', 'pt-BR']);
const CATALOG_FILES = Object.freeze({
  SKINS: 'skins.json',
  STICKERS: 'stickers.json',
  CRATES: 'crates.json',
  KEYCHAINS: 'keychains.json',
  AGENTS: 'agents.json',
});
const CATALOG_FETCH_TIMEOUT_MS = 120000;
const CATALOG_SEARCH_DEFAULT_LIMIT = 20;
const CATALOG_SEARCH_MAX_LIMIT = 50;
const CATALOG_ID_MAX_LENGTH = 100;
const CATALOG_SNAPSHOT_PATH = path.join(__dirname, '..', '..', 'data', 'seed', 'catalog.json');

// Preferências pessoais (D83).
const THEMES = Object.freeze(['SYSTEM', 'LIGHT', 'DARK']);
const LANGUAGES = Object.freeze(['pt-BR', 'en']);

module.exports = Object.freeze({
  MIN_SLOW_ITEM_DAYS,
  MAX_AMOUNT_CENTS,
  MAX_NAME_LENGTH,
  MAX_ORIGIN_DETAIL_LENGTH,
  MAX_NOTE_LENGTH,
  CATALOG_BASE_URL,
  CATALOG_LANGUAGES,
  CATALOG_FILES,
  CATALOG_FETCH_TIMEOUT_MS,
  CATALOG_SEARCH_DEFAULT_LIMIT,
  CATALOG_SEARCH_MAX_LIMIT,
  CATALOG_ID_MAX_LENGTH,
  CATALOG_SNAPSHOT_PATH,
  THEMES,
  LANGUAGES,
});
