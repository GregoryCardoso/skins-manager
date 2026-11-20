'use strict';

// Adapter (puro) da CSGO-API (https://github.com/ByMykel/CSGO-API) para linhas do catálogo local (D80).
// Entrada: JSON bruto de cada fonte. Saída: linhas camelCase prontas para `CatalogItem.upsertMany`.
// Nenhum acesso a rede ou banco aqui.

const { CATALOG_ID_MAX_LENGTH } = require('../../config/constants');

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const SOURCES = Object.freeze(['SKINS', 'STICKERS', 'CRATES', 'KEYCHAINS', 'AGENTS']);

// Ids de categoria da CSGO-API (skins.json) que não são "arma comum".
const KNIFE_CATEGORY_ID = 'sfui_invpanel_filter_melee';
const GLOVES_CATEGORY_ID = 'sfui_invpanel_filter_gloves';

// Campo `type` das crates (crates.json) -> categoria do app (D71, E4-Q4). Demais tipos (inclusive `null`,
// graffiti e music kits) viram OUTRO.
const CRATE_TYPE_TO_CATEGORY = Object.freeze({
  Case: 'CAIXA',
  Souvenir: 'CAIXA',
  'Souvenir Highlight': 'CAIXA',
  'Sticker Capsule': 'CAPSULA',
  'Autograph Capsule': 'CAPSULA',
  'Patch Capsule': 'CAPSULA',
  Pins: 'CAPSULA',
});

// NFD sem marcas diacríticas, sem ★ ™ ®, minúsculas, espaços colapsados e `trim`.
function normalizeSearchText(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[★™®]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Texto de busca: nome em inglês + tradução (quando existe e difere).
function buildSearchText(nameKey, namePtBr) {
  const ptKey = namePtBr ? normalizeSearchText(namePtBr) : '';
  return ptKey && ptKey !== nameKey ? `${nameKey} ${ptKey}` : nameKey;
}

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

function validId(id) {
  return typeof id === 'string' && id.length <= CATALOG_ID_MAX_LENGTH && ID_PATTERN.test(id);
}

// Mapa id -> name de um arquivo bruto (idioma secundário). Entradas sem id ou nome são ignoradas.
function buildNameMap(raw) {
  const map = new Map();
  if (!Array.isArray(raw)) return map;
  for (const entry of raw) {
    if (entry && typeof entry.id === 'string' && isNonEmptyString(entry.name)) map.set(entry.id, entry.name.trim());
  }
  return map;
}

// T37 (D102): só URLs https:// viram imagem; qualquer outra coisa vira null (sem erro).
function toSafeImageUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  let url;
  try {
    url = new URL(text);
  } catch (err) {
    return null;
  }
  return url.protocol === 'https:' && url.hostname !== '' ? text : null;
}

function floatOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

function baseRow(entry, { source, category, namePtBr }) {
  const name = entry.name.trim();
  const nameKey = normalizeSearchText(name);
  return {
    id: entry.id,
    source,
    category,
    name,
    namePtBr: namePtBr || null,
    nameKey,
    searchText: buildSearchText(nameKey, namePtBr),
    imageUrl: toSafeImageUrl(entry.image),
    minFloat: null,
    maxFloat: null,
    hasStattrak: 0,
    hasSouvenir: 0,
    phase: null,
    rarity: entry.rarity && isNonEmptyString(entry.rarity.name) ? entry.rarity.name : null,
  };
}

// Mapeia uma lista bruta com a regra `categoryOf(entry)` e extras por fonte.
function mapSource(raw, ptNames, { source, categoryOf, extend }) {
  const rows = [];
  let skipped = 0;
  const list = Array.isArray(raw) ? raw : [];
  for (const entry of list) {
    if (!entry || !validId(entry.id) || !isNonEmptyString(entry.name)) {
      skipped += 1;
      continue;
    }
    const row = baseRow(entry, { source, category: categoryOf(entry), namePtBr: ptNames ? ptNames.get(entry.id) : null });
    if (extend) extend(row, entry);
    rows.push(row);
  }
  return { rows, skipped };
}

function mapSkins(raw, ptNames) {
  return mapSource(raw, ptNames, {
    source: 'SKINS',
    categoryOf: (e) => {
      const catId = e.category && e.category.id;
      if (catId === KNIFE_CATEGORY_ID) return 'FACA';
      if (catId === GLOVES_CATEGORY_ID) return 'LUVA';
      return 'SKIN';
    },
    extend: (row, e) => {
      let min = floatOrNull(e.min_float);
      let max = floatOrNull(e.max_float);
      if (min === null || max === null || min > max) {
        min = null;
        max = null;
      }
      row.minFloat = min;
      row.maxFloat = max;
      row.hasStattrak = e.stattrak === true ? 1 : 0;
      row.hasSouvenir = e.souvenir === true ? 1 : 0;
      row.phase = isNonEmptyString(e.phase) ? e.phase.trim() : null;
    },
  });
}

function mapStickers(raw, ptNames) {
  return mapSource(raw, ptNames, { source: 'STICKERS', categoryOf: () => 'STICKER' });
}

function mapCrates(raw, ptNames) {
  return mapSource(raw, ptNames, {
    source: 'CRATES',
    categoryOf: (e) => CRATE_TYPE_TO_CATEGORY[e.type] || 'OUTRO',
  });
}

function mapKeychains(raw, ptNames) {
  return mapSource(raw, ptNames, { source: 'KEYCHAINS', categoryOf: () => 'PINGENTE' });
}

function mapAgents(raw, ptNames) {
  return mapSource(raw, ptNames, { source: 'AGENTS', categoryOf: () => 'PERSONAGEM' });
}

const MAPPERS = { SKINS: mapSkins, STICKERS: mapStickers, CRATES: mapCrates, KEYCHAINS: mapKeychains, AGENTS: mapAgents };

// `en` e `ptBr`: { SKINS, STICKERS, CRATES, KEYCHAINS, AGENTS } com o JSON bruto (ptBr pode faltar, no
// todo ou por fonte). As linhas vêm do `en`; do `ptBr` só se usa o nome, pelo mesmo id.
function mapCatalog({ en, ptBr } = {}) {
  const rows = [];
  let skipped = 0;
  for (const source of SOURCES) {
    const ptNames = ptBr && ptBr[source] ? buildNameMap(ptBr[source]) : null;
    const result = MAPPERS[source]((en && en[source]) || [], ptNames);
    rows.push(...result.rows);
    skipped += result.skipped;
  }
  return { rows, skipped };
}

module.exports = {
  SOURCES,
  normalizeSearchText,
  buildSearchText,
  toSafeImageUrl,
  mapSkins,
  mapStickers,
  mapCrates,
  mapKeychains,
  mapAgents,
  mapCatalog,
};
