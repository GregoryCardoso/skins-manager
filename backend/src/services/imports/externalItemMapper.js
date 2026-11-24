'use strict';

// Trade -> item do catálogo e atributos do app (D297, D318 seção 6). Funções puras: o acesso ao catálogo é injetado
// (`findByNameKeyAnyCategory`), então os testes não precisam de banco.
const { normalizeSearchText } = require('../catalog/csgoApiAdapter');
const { isWeaponCategory } = require('../itemAttributesService');
const { allowedKindsFor, CATALOG_CATEGORY, SLOT_MAX, MAX_STICKERS, MAX_HANGING, MAX_PATCHES } = require('../itemComponentService');
const { DOPPLER_PHASES } = require('./adapters/csfloatStates');
const { IMPORT_DEFAULT_TRADE_LOCK_DAYS } = require('../../config/constants');

const EXTERIOR_SUFFIX = /\s+\((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/;
// Itens sem equivalente no catálogo que entram como OUTRO (E9-Q8): patch, grafite, music kit e chave de caixa.
const FREE_NAME_PREFIXES = Object.freeze(['Patch |', 'Sealed Graffiti |', 'Graffiti |', 'Music Kit |', 'StatTrak™ Music Kit |']);
const FREE_NAME_SUFFIX = / Key$/;

// Nome do catálogo a procurar: sem ★, sem "StatTrak™ " (se for StatTrak), sem "Souvenir " (se for Souvenir; assim não estraga
// "Souvenir Package") e sem o sufixo de desgaste. Devolve o texto já normalizado (name_key).
function baseNameKey(item) {
  let name = item.marketHashName.trim().replace(/^★\s*/, '');
  if (item.isStattrak) name = name.replace(/^StatTrak™\s+/, '');
  if (item.isSouvenir) name = name.replace(/^Souvenir\s+/, '');
  name = name.replace(EXTERIOR_SUFFIX, '');
  return normalizeSearchText(name);
}

function variantOf(item) {
  if (item.isStattrak) return 'STATTRAK';
  if (item.isSouvenir) return 'SOUVENIR';
  return 'NORMAL';
}

// Fase da Doppler/Gamma Doppler: o texto `phase` do CSFloat; sem ele, a tabela fixa por `paint_index`. Normalizada, ou null.
function tradePhaseKey(item) {
  const text = item.phase || (item.paintIndex !== null && item.paintIndex !== undefined ? DOPPLER_PHASES[item.paintIndex] : null);
  return text ? normalizeSearchText(text) : null;
}

function isFreeNameItem(marketHashName) {
  return FREE_NAME_PREFIXES.some((prefix) => marketHashName.startsWith(prefix)) || FREE_NAME_SUFFIX.test(marketHashName);
}

// Entre os candidatos do catálogo escolhe um: nenhum -> NOT_FOUND; um -> ele; vários -> desempata pela fase; entradas idênticas
// (as facas duplicadas, D115) ficam com a de menor id; o resto é ambíguo.
function pickCandidate(candidates, phaseKey) {
  if (candidates.length === 0) return { kind: 'NOT_FOUND' };
  const hasPhases = candidates.some((c) => c.phase !== null && c.phase !== undefined);
  let pool = candidates;
  if (hasPhases) {
    if (phaseKey === null) return { kind: 'AMBIGUOUS' };
    pool = candidates.filter((c) => c.phase && normalizeSearchText(c.phase) === phaseKey);
    if (pool.length === 0) return { kind: 'AMBIGUOUS' };
  }
  if (pool.length === 1) return { kind: 'FOUND', entry: pool[0] };
  const first = pool[0];
  const identical = pool.every(
    (c) => c.category === first.category && normalizeSearchText(c.name) === normalizeSearchText(first.name)
      && normalizeSearchText(c.phase || '') === normalizeSearchText(first.phase || '')
  );
  if (!identical) return { kind: 'AMBIGUOUS' };
  return { kind: 'FOUND', entry: [...pool].sort((a, b) => (a.id < b.id ? -1 : 1))[0] };
}

// Mapeia o item do trade. `findByNameKeyAnyCategory(nameKey)` devolve as entradas do catálogo (ordenadas).
// Sucesso: { ok: true, catalogEntry|null, category, name, variant, floatValue, paintSeed, phase }
//   (sem `catalogEntry` = categoria OUTRO, nome livre = market_hash_name)
// Falha: { ok: false, reason: 'CATALOG_NOT_FOUND' | 'CATALOG_AMBIGUOUS' }
function mapTradeItem(item, { findByNameKeyAnyCategory }) {
  const picked = pickCandidate(findByNameKeyAnyCategory(baseNameKey(item)), tradePhaseKey(item));
  if (picked.kind === 'AMBIGUOUS') return { ok: false, reason: 'CATALOG_AMBIGUOUS' };
  if (picked.kind === 'NOT_FOUND') {
    if (!isFreeNameItem(item.marketHashName)) return { ok: false, reason: 'CATALOG_NOT_FOUND' };
    return { ok: true, catalogEntry: null, category: 'OUTRO', name: item.marketHashName, variant: null, floatValue: null, paintSeed: null, phase: null };
  }
  const entry = picked.entry;
  const weapon = isWeaponCategory(entry.category);
  const hasFloat = weapon && !item.isCommodity && item.floatValue !== null && item.floatValue !== undefined;
  return {
    ok: true,
    catalogEntry: entry,
    category: entry.category,
    name: entry.name,
    variant: weapon ? variantOf(item) : null,
    floatValue: hasFloat ? item.floatValue : null,
    paintSeed: hasFloat && item.paintSeed !== null ? item.paintSeed : null,
    // Com fase no catálogo, ela é derivada (mandar a fase daria CATALOG_DERIVED_FIELD).
    phase: weapon && (entry.phase === null || entry.phase === undefined) && item.phase ? item.phase : null,
  };
}

// Fim do trade lock: o fim exato da proteção da Steam; sem ele, aceite + 7 dias (a mesma conta da D161, chamada explicitamente).
function computeTradeUnlockAt(trade) {
  if (trade.protectionEndsAt) return trade.protectionEndsAt;
  if (!trade.acceptedAt) return null;
  return new Date(Date.parse(trade.acceptedAt) + IMPORT_DEFAULT_TRADE_LOCK_DAYS * 86400000).toISOString();
}

// Corpo do `itemService.createItem` para uma compra importada. `inspectLink`, `assetId` e `originDetail` nunca são enviados.
function buildPurchaseInput(trade, mapped, { storeId, components = [] }) {
  const input = {
    acquisitionType: 'COMPRA',
    purchaseStoreId: storeId,
    purchasePriceCents: trade.priceCents,
    acquiredAt: trade.soldAt || trade.acceptedAt || trade.createdAt,
    tradeUnlockAt: computeTradeUnlockAt(trade),
  };
  if (mapped.catalogEntry) input.catalogId = mapped.catalogEntry.id;
  else {
    input.category = mapped.category;
    input.name = mapped.name;
  }
  if (isWeaponCategory(mapped.category)) {
    input.variant = mapped.variant;
    if (mapped.floatValue !== null) input.floatValue = mapped.floatValue;
    if (mapped.paintSeed !== null) input.paintSeed = mapped.paintSeed;
    if (mapped.phase) input.phase = mapped.phase;
  }
  if (components.length) input.components = components;
  return input;
}

// --- Componentes (D361) ------------------------------------------------------------------------------------------------

const MAX_COMPONENT_WARNINGS = 10;
// Códigos dos avisos de componentes (não são erros da API: ficam no `display_json` e no resumo da importação).
const COMPONENT_WARNINGS = Object.freeze({
  CATALOG_NOT_FOUND: 'COMPONENT_CATALOG_NOT_FOUND',
  FULLY_SCRAPED: 'COMPONENT_FULLY_SCRAPED',
  LIMIT_EXCEEDED: 'COMPONENT_LIMIT_EXCEEDED',
  NOT_ALLOWED: 'COMPONENTS_NOT_ALLOWED',
});
const PATCH_PREFIX = 'Patch |';
const SLAB_PREFIX = 'Sticker Slab | ';

// Tipo do componente pelo nome e pela origem no trade (`stickers[]` ou `keychains[]`) e o nome a procurar no catálogo.
// O Sticker Slab é procurado como o sticker de dentro ("Sticker | X"); hipótese, ainda sem exemplo real.
function componentKindOf(raw) {
  const name = raw.name;
  if (raw.from === 'KEYCHAIN') {
    if (name.startsWith(SLAB_PREFIX)) return { kind: 'STICKER_SLAB', lookup: `Sticker | ${name.slice(SLAB_PREFIX.length)}` };
    return { kind: 'CHARM', lookup: name };
  }
  return { kind: name.startsWith(PATCH_PREFIX) ? 'PATCH' : 'STICKER', lookup: name };
}

// Componentes do trade -> componentes do app, casados com o catálogo, mais os avisos do que não foi registrado (D361). Pura: o
// catálogo é injetado. Nunca lança nem bloqueia a compra. O resultado sempre passa no `itemComponentService.normalizeComponents`.
//   rawComponents: `trade.item.components` (csfloatMapper); category: categoria do item no app.
// Devolve { components: [{ kind, catalogId, slot, wear?, pattern? }], warnings: [{ code, name }] } (sem repetição, no máximo 10).
function mapComponents(rawComponents, { category, findByNameKeyAnyCategory }) {
  const list = Array.isArray(rawComponents) ? rawComponents : [];
  const components = [];
  const warnings = [];
  const seen = new Set();
  const warn = (code, name = null) => {
    const key = `${code}|${name}`;
    if (seen.has(key) || warnings.length >= MAX_COMPONENT_WARNINGS) return;
    seen.add(key);
    warnings.push({ code, name });
  };
  if (list.length === 0) return { components, warnings };
  const allowed = allowedKindsFor(category);
  const limits = { STICKER: MAX_STICKERS, HANGING: MAX_HANGING, PATCH: MAX_PATCHES };
  const used = { STICKER: 0, HANGING: 0, PATCH: 0 };
  for (const raw of list) {
    if (!raw || typeof raw.name !== 'string' || raw.name === '') {
      warn(COMPONENT_WARNINGS.CATALOG_NOT_FOUND, null);
      continue;
    }
    const { kind, lookup } = componentKindOf(raw);
    if (!allowed.includes(kind)) {
      warn(COMPONENT_WARNINGS.NOT_ALLOWED, null);
      continue;
    }
    // Raspado até o fim sai do registro (2.2.2).
    if (kind === 'STICKER' && typeof raw.wear === 'number' && raw.wear >= 1) {
      warn(COMPONENT_WARNINGS.FULLY_SCRAPED, raw.name);
      continue;
    }
    const candidates = findByNameKeyAnyCategory(normalizeSearchText(lookup)).filter((c) => c.category === CATALOG_CATEGORY[kind]);
    const picked = pickCandidate(candidates, null);
    if (picked.kind !== 'FOUND') {
      warn(COMPONENT_WARNINGS.CATALOG_NOT_FOUND, raw.name);
      continue;
    }
    const bucket = kind === 'STICKER' || kind === 'PATCH' ? kind : 'HANGING';
    if (used[bucket] >= limits[bucket]) {
      warn(COMPONENT_WARNINGS.LIMIT_EXCEEDED, raw.name);
      continue;
    }
    used[bucket] += 1;
    const component = {
      kind,
      catalogId: picked.entry.id,
      slot: Number.isSafeInteger(raw.slot) && raw.slot >= 0 && raw.slot <= SLOT_MAX[kind] ? raw.slot : null,
    };
    if (kind === 'STICKER' && typeof raw.wear === 'number' && Number.isFinite(raw.wear)) component.wear = raw.wear;
    if ((kind === 'CHARM' || kind === 'STICKER_SLAB') && Number.isSafeInteger(raw.pattern)) component.pattern = raw.pattern;
    components.push(component);
  }
  return { components, warnings };
}

module.exports = {
  mapComponents, COMPONENT_WARNINGS, baseNameKey, variantOf, tradePhaseKey, isFreeNameItem, pickCandidate, mapTradeItem, computeTradeUnlockAt, buildPurchaseInput,
};
