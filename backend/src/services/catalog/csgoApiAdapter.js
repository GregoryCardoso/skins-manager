'use strict';

// Adapter (puro) da CSGO-API (https://github.com/ByMykel/CSGO-API) para linhas do catálogo local (D80).
// Entrada: JSON bruto de cada fonte. Saída: linhas camelCase prontas para `CatalogItem.upsertMany`.
// Nenhum acesso a rede ou banco aqui.

const { CATALOG_ID_MAX_LENGTH } = require('../../config/constants');

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const SOURCES = Object.freeze(['SKINS', 'STICKERS', 'CRATES', 'KEYCHAINS', 'AGENTS', 'PATCHES']);

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

// Texto de busca: nome em inglês + os nomes de todos os idiomas (D369, 11.5), sem repetir. `names`: { idioma: nome } ou nulo.
function buildSearchText(nameKey, names) {
  const keys = [nameKey];
  if (names && typeof names === 'object') {
    for (const name of Object.values(names)) {
      const key = typeof name === 'string' ? normalizeSearchText(name) : '';
      if (key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys.join(' ');
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

function baseRow(entry, { source, category, names }) {
  const name = entry.name.trim();
  const nameKey = normalizeSearchText(name);
  // Nome traduzido igual ao inglês não tem utilidade (sem tradução, a exibição já cai no inglês): não é guardado.
  names = Object.fromEntries(Object.entries(names || {}).filter(([, translated]) => translated !== name));
  return {
    id: entry.id,
    source,
    category,
    name,
    names,
    nameKey,
    searchText: buildSearchText(nameKey, names),
    imageUrl: toSafeImageUrl(entry.image),
    minFloat: null,
    maxFloat: null,
    hasStattrak: 0,
    hasSouvenir: 0,
    phase: null,
    rarity: entry.rarity && isNonEmptyString(entry.rarity.name) ? entry.rarity.name : null,
  };
}

// `nameMaps`: { idioma: Map(id -> nome) } dos idiomas baixados; devolve só os nomes que existem para o id.
function namesFor(nameMaps, id) {
  const names = {};
  if (nameMaps) {
    for (const [lang, map] of Object.entries(nameMaps)) {
      const name = map.get(id);
      if (name) names[lang] = name;
    }
  }
  return names;
}

// Mapeia uma lista bruta com a regra `categoryOf(entry)` e extras por fonte.
function mapSource(raw, nameMaps, { source, categoryOf, extend }) {
  const rows = [];
  let skipped = 0;
  const list = Array.isArray(raw) ? raw : [];
  for (const entry of list) {
    if (!entry || !validId(entry.id) || !isNonEmptyString(entry.name)) {
      skipped += 1;
      continue;
    }
    const row = baseRow(entry, { source, category: categoryOf(entry), names: namesFor(nameMaps, entry.id) });
    if (extend) extend(row, entry);
    rows.push(row);
  }
  return { rows, skipped };
}

function mapSkins(raw, nameMaps) {
  return mapSource(raw, nameMaps, {
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

function mapStickers(raw, nameMaps) {
  return mapSource(raw, nameMaps, { source: 'STICKERS', categoryOf: () => 'STICKER' });
}

function mapCrates(raw, nameMaps) {
  return mapSource(raw, nameMaps, {
    source: 'CRATES',
    categoryOf: (e) => CRATE_TYPE_TO_CATEGORY[e.type] || 'OUTRO',
  });
}

function mapKeychains(raw, nameMaps) {
  return mapSource(raw, nameMaps, { source: 'KEYCHAINS', categoryOf: () => 'PINGENTE' });
}

function mapAgents(raw, nameMaps) {
  return mapSource(raw, nameMaps, { source: 'AGENTS', categoryOf: () => 'PERSONAGEM' });
}

// Patches de agente (10.3, D362): "Patch | ..." do patches.json; categoria PATCH.
function mapPatches(raw, nameMaps) {
  return mapSource(raw, nameMaps, { source: 'PATCHES', categoryOf: () => 'PATCH' });
}

const MAPPERS = { SKINS: mapSkins, STICKERS: mapStickers, CRATES: mapCrates, KEYCHAINS: mapKeychains, AGENTS: mapAgents, PATCHES: mapPatches };

// `en`: { SKINS, STICKERS, CRATES, KEYCHAINS, AGENTS, PATCHES } com o JSON bruto. `translations`: { idioma: { fonte: JSON bruto } }
// (qualquer idioma ou fonte pode faltar; `ptBr` é o atalho antigo de `translations['pt-BR']`). As linhas vêm do `en`; dos demais
// idiomas só se usa o nome, pelo mesmo id. Cada linha sai com `names: { idioma: nome }`.
function mapCatalog({ en, translations, ptBr } = {}) {
  const all = { ...(translations || {}) };
  if (ptBr && !all['pt-BR']) all['pt-BR'] = ptBr;
  const rows = [];
  let skipped = 0;
  for (const source of SOURCES) {
    const nameMaps = {};
    for (const [lang, data] of Object.entries(all)) if (data && data[source]) nameMaps[lang] = buildNameMap(data[source]);
    const result = MAPPERS[source]((en && en[source]) || [], nameMaps);
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
  mapPatches,
  mapCatalog,
};
